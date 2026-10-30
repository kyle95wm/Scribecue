import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEEDS, toBase, atBase, baseFromSpeed, DEFAULT_CPS, pickVoices, groupVoices, estimate, spoken, tts, isSpeed, speedLabel,
  piperVoiceList, kokoroVoiceList, readWav, writeWav, mixTrack, onlyNotes, TRACK_PEAK_DB, TRACK_MAX_DB, mixLevels,
  googleVoiceList, googleRequest, googleFailure, makesAudio, overCap, nextFitSpeed, bestFit, resample,
  toggleFavourite, favouriteVoices, voiceLabel, missingVoiceAdvice } from '../app/js/tts.js';

const v = (name, lang, localService, extra = {}) => ({ name, lang, localService, voiceURI: name, ...extra });
const voices = [
  v('Zed', 'en-US', true), v('Google UK', 'en-GB', false), v('Amélie', 'fr-CA', true),
  v('Alex', 'en-GB', true), v('Anna', 'en-US', true),
];

test('text to speech is off until turned on', () => {
  assert.equal(tts.on, false);
  assert.equal(tts.online, false);
});

test('once turned on, new blocks take their end from the reading unless that is turned off', () => {
  assert.equal(tts.autoEnd, true);
});

test('only voices on this computer are offered unless online voices are allowed', () => {
  assert.deepEqual(pickVoices(voices, { lang: 'en-US' }).map((x) => x.name), ['Anna', 'Zed', 'Alex', 'Amélie']);
  assert.ok(pickVoices(voices, { online: true, lang: 'en-US' }).some((x) => x.name === 'Google UK'));
});

test('voices in the user language come first', () => {
  assert.deepEqual(pickVoices(voices, { lang: 'fr-FR' }).map((x) => x.name)[0], 'Amélie');
  assert.deepEqual(pickVoices(voices, { online: true, lang: 'en-GB' }).map((x) => x.name).slice(0, 2), ['Alex', 'Google UK']);
});

test('the speeds match Frazier, from −30% to +100%', () => {
  assert.deepEqual(SPEEDS.map(([s]) => s), [0.7, 0.85, 1, 1.15, 1.3, 1.5, 2]);
});

test('reading time scales with length and speed', () => {
  const line = 'x'.repeat(30);
  assert.equal(estimate(line), 30 / DEFAULT_CPS);
  assert.equal(estimate(line, 10, 2), 1.5);
  assert.ok(estimate(line, 15, 0.7) > estimate(line, 15, 1));
  assert.equal(estimate('   '), 0);
});

test('tags and line breaks are not read out', () => {
  assert.equal(spoken('<i>Hello</i>\n  {\\an8}there'), 'Hello there');
});

test('the voice menu lists Piper and Kokoro, then voices on this computer, then online ones', () => {
  const piper = piperVoiceList({ 'en_GB-alba-medium': {}, 'en_US-lessac-medium': {} });
  const kokoro = kokoroVoiceList({ voices: [{ id: 'af_heart', lang: 'en-US' }] });
  const groups = groupVoices([...piper, ...kokoro, ...pickVoices(voices, { online: true, lang: 'en-US' })]);
  assert.deepEqual(groups.map(([label]) => label),
    ['Piper: natural voices on this computer', 'Kokoro: natural voices on this computer', 'Google Cloud: the text is sent to Google',
      'On this computer', 'Online: the text is sent to the provider']);
  assert.deepEqual(groups[0][1].map((x) => x.name), ['Alba', 'Lessac']);
  assert.deepEqual(groups[1][1].map((x) => x.name), ['Heart']);
  assert.deepEqual(groups[2][1], []);
  assert.deepEqual(groups[3][1].map((x) => x.name), ['Anna', 'Zed', 'Alex', 'Amélie']);
  assert.deepEqual(groups[4][1].map((x) => x.name), ['Google UK']);
});

test('Kokoro voice names are made readable, with the language from the first letter', () => {
  const list = kokoroVoiceList({ voices: [{ id: 'bf_emma', lang: 'en-GB', gender: 'female' }, 'am_santa_claus', 'ff_siwis', 'zf_xiaobei', 'nonsense'] });
  assert.deepEqual(list, [
    { voiceURI: 'kokoro:am_santa_claus', kokoro: 'am_santa_claus', name: 'Santa Claus', lang: 'en-US', localService: true },
    { voiceURI: 'kokoro:bf_emma', kokoro: 'bf_emma', name: 'Emma', lang: 'en-GB', localService: true },
    { voiceURI: 'kokoro:ff_siwis', kokoro: 'ff_siwis', name: 'Siwis', lang: 'fr-FR', localService: true },
    { voiceURI: 'kokoro:zf_xiaobei', kokoro: 'zf_xiaobei', name: 'Xiaobei', lang: '', localService: true },
  ]);
  assert.equal(makesAudio(list[0]), true);
  assert.deepEqual(kokoroVoiceList(null), []);
});

test('Piper voice names are made readable', () => {
  assert.deepEqual(piperVoiceList({ 'en_GB-northern_english_male-medium': {} })[0],
    { voiceURI: 'piper:en_GB-northern_english_male-medium', piper: 'en_GB-northern_english_male-medium',
      name: 'Northern English Male', lang: 'en-GB', localService: true });
  assert.deepEqual(piperVoiceList(null), []);
});

test('WAV files round-trip, and their length is exact', async () => {
  const samples = Int16Array.from({ length: 22050 * 2 }, (_, i) => Math.round(8000 * Math.sin(i / 10)));
  const buf = await writeWav(samples, 22050).arrayBuffer();
  const wav = readWav(buf);
  assert.equal(wav.rate, 22050);
  assert.equal(wav.secs, 2);
  assert.deepEqual(wav.samples, samples);
  assert.throws(() => readWav(new ArrayBuffer(20)), /not a WAV/);
});

const dbfs = (v) => 20 * Math.log10(Math.abs(v) / 32767);
const peakOf = (a) => a.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

test('the description track puts each reading at its start, at the same level, with headroom', () => {
  const quiet = new Int16Array(10).fill(1000), full = new Int16Array(10).fill(32767);
  const out = mixTrack([{ start: 0.5, samples: quiet }, { start: 1.2, samples: full }], 20, 2);
  assert.equal(out.length, 40);
  assert.equal(out[9], 0);
  assert.equal(out[10], out[24]); // a quiet reading and a full-scale one come out the same
  assert.equal(out[20], 0);
  assert.ok(Math.abs(dbfs(out[10]) - TRACK_PEAK_DB) < 0.01, `peaks at ${dbfs(out[10])} dBFS`);
  assert.ok(TRACK_PEAK_DB >= -10 && TRACK_PEAK_DB <= -6);
});

test('overlapping readings never take the track past the ceiling', () => {
  const full = new Int16Array(10).fill(32767);
  const out = mixTrack([{ start: 0, samples: full }, { start: 0.25, samples: full }], 20, 1);
  assert.ok(Math.abs(dbfs(peakOf(out)) - TRACK_MAX_DB) < 0.01, `peaks at ${dbfs(peakOf(out))} dBFS`);
  const silent = mixTrack([{ start: 0, samples: new Int16Array(5) }], 20, 1);
  assert.equal(peakOf(silent), 0);
});

test('block speed labels and validation', () => {
  assert.deepEqual(SPEEDS.map(([s]) => speedLabel(s)), ['−30%', '−15%', 'normal', '+15%', '+30%', '+50%', '+100%']);
  assert.equal(isSpeed(1.15), true);
  assert.equal(isSpeed(1.2), false);
  assert.equal(isSpeed(undefined), false);
});

test('notes in [square brackets] are left out of readings only when the setting is on', () => {
  const line = '[Wide shot, pause here] She opens the door. [Check name]';
  assert.equal(spoken(line), '[Wide shot, pause here] She opens the door. [Check name]');
  assert.equal(spoken(line, true), 'She opens the door.');
  assert.equal(spoken('A [note\nacross lines] B', true), 'A B');
  assert.equal(spoken('Unclosed [bracket is read', true), 'Unclosed [bracket is read');
  tts.skipNotes = true;
  try {
    assert.equal(estimate(line), estimate('She opens the door.'));
    assert.equal(onlyNotes('[Music cue]'), true);
    assert.equal(onlyNotes('She waves.'), false);
    assert.equal(onlyNotes(''), false);
  } finally {
    tts.skipNotes = false;
  }
  assert.equal(onlyNotes('[Music cue]'), false);
});

test('a reading is sped up or slowed down to fill a block, within limits', async () => {
  const { speedToFit, speedName, isBlockSpeed, MIN_SPEED, MAX_SPEED } = await import('../app/js/tts.js');
  assert.equal(speedToFit(3, 1, 2.5), 1.2); // 3 s at normal speed into 2.5 s: 20% faster
  assert.equal(speedToFit(3, 1, 4), 0.75);
  assert.equal(speedToFit(2.4, 1.2, 2.5), 1.15); // from a reading already measured at 1.2
  assert.equal(speedToFit(3, 1, 0.5), MAX_SPEED);
  assert.equal(speedToFit(3, 1, 60), MIN_SPEED);
  assert.equal(speedToFit(0, 1, 2), null);
  assert.equal(speedName(1.15), 'fast (+15%)');
  assert.equal(speedName(1.2), 'custom (+20%)');
  assert.equal(speedName(0.88), 'custom (−12%)');
  assert.equal(isBlockSpeed(1.2), true);
  assert.equal(isBlockSpeed(3), false);
});

test('fitting from two readings allows for reading time not scaling evenly with speed', async () => {
  const { speedFromReadings } = await import('../app/js/tts.js');
  // Piper's real lengths for one line: 2.87 s at normal speed, 3.27 s at 0.76.
  // secs = a + b / speed through those gives about 0.66 for 3.5 s, where an even
  // scale would have said 0.82.
  const two = [{ speed: 1, secs: 2.87 }, { speed: 0.76, secs: 3.27 }];
  const s = speedFromReadings(two, 3.5, 0.76);
  assert.ok(s > 0.6 && s < 0.7, `got ${s}`);
  assert.equal(speedFromReadings([{ speed: 1, secs: 3 }], 2.5), 1.2); // one reading: even scale
  assert.equal(speedFromReadings([], 2), null);
});

test('from one reading, the part that doesn’t change with speed is allowed for', async () => {
  const { speedFromReadings, MAX_SPEED } = await import('../app/js/tts.js');
  // A Piper line: 3.077 s at normal speed, of which about a quarter stays the same at any
  // speed. Fitting it into 1.95 s from that one reading:
  const one = [{ speed: 1, secs: 3.077 }];
  assert.equal(speedFromReadings(one, 1.95, 1), 1.58); // even scale would say 1.58 too…
  const s = speedFromReadings(one, 1.95, 1, 0.25);
  assert.ok(s > 1.9 && s < 2, `got ${s}`); // …but the real answer is close to 2
  // Shorter than the fixed part can ever be: as fast as it goes.
  assert.equal(speedFromReadings(one, 0.5, 1, 0.25), MAX_SPEED);
  // A reading at another speed works out the same.
  assert.equal(speedFromReadings([{ speed: 2, secs: 3.077 * (0.25 + 0.75 / 2) }], 3.077, 2, 0.25), 1);
});

test('sounds like changes only the reading, as whole words in any case', async () => {
  const { soundsLike, hasWord } = await import('../app/js/tts.js');
  const say = [['Siobhan', 'shiv-awn'], ['York', 'yawk'], ['New York', 'noo yawk']];
  assert.equal(soundsLike('SIOBHAN met siobhan in New York, not York.', say), 'shiv-awn met shiv-awn in noo yawk, not yawk.');
  assert.equal(soundsLike('Siobhans and Yorkshire', say), 'Siobhans and Yorkshire'); // part of a word: left alone
  assert.equal(soundsLike('Siobhan’s coat', say), 'shiv-awn’s coat');
  assert.equal(soundsLike('Café crème', [['café', 'ka-fay']]), 'ka-fay crème'); // accented letters count as letters
  assert.equal(soundsLike('a (b) c', [['(b)', 'bee']]), 'a bee c'); // punctuation in a phrase is matched as written
  assert.equal(soundsLike('Same text', []), 'Same text');
  assert.equal(soundsLike('Same text', [['text', ' '], [' ', 'x']]), 'Same text'); // empty halves ignored
  assert.ok(hasWord('Wave to Niamh.', 'niamh'));
  assert.ok(!hasWord('Niamhs', 'Niamh'));
  assert.ok(!hasWord('anything', '  '));
});

test('the web version offers its Piper voices in the user’s language first, with their sizes', async () => {
  const { webPiper, webVoiceChoices, megabytes } = await import('../app/js/tts.js');
  webPiper.offered = null;
  assert.deepEqual(webVoiceChoices(), []);
  webPiper.offered = { 'en_GB-alba-medium': 63201294, 'en_US-lessac-medium': 63201294 };
  const list = webVoiceChoices();
  assert.deepEqual(list.map((v) => v.id).sort(), ['en_GB-alba-medium', 'en_US-lessac-medium']);
  assert.ok(list.every((v) => v.bytes === 63201294 && v.name && v.lang));
  const lang = (globalThis.navigator?.language || 'en').toLowerCase();
  if (lang === 'en-us') assert.equal(list[0].id, 'en_US-lessac-medium');
  if (lang === 'en-gb') assert.equal(list[0].id, 'en_GB-alba-medium');
  assert.equal(megabytes(63201294), '63 MB');
  webPiper.offered = null;
});

test('a sounds-like list takes more words, and a word already in it takes the new sound', async () => {
  const { mergeSay } = await import('../app/js/tts.js');
  assert.deepEqual(mergeSay([['Siobhan', 'shiv-awn']], [['Okafor', 'oh-KAH-for']]), [['Siobhan', 'shiv-awn'], ['Okafor', 'oh-KAH-for']]);
  assert.deepEqual(mergeSay([['siobhan', 'old']], [['Siobhan', 'shiv-AWN']]), [['Siobhan', 'shiv-AWN']]);
  assert.deepEqual(mergeSay(undefined, [['Leeds', 'leeds']]), [['Leeds', 'leeds']]);
});

test('the mix slider turns one side down, never either up past full', () => {
  assert.deepEqual(mixLevels(0), { reading: 1, video: 1 });
  assert.deepEqual(mixLevels(0.4), { reading: 1, video: 0.6 });
  assert.deepEqual(mixLevels(-0.25), { reading: 0.75, video: 1 });
  assert.deepEqual(mixLevels(1), { reading: 1, video: 0 });
  assert.deepEqual(mixLevels(-3), { reading: 0, video: 1 }, 'kept within the ends');
  assert.deepEqual(mixLevels(undefined), { reading: 1, video: 1 });
  assert.equal(tts.mix, 0, 'even unless moved');
});

const googleJson = { voices: [
  { name: 'en-GB-Standard-A', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
  { name: 'en-GB-Wavenet-B', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-US-Standard-B', languageCodes: ['en-US'], ssmlGender: 'MALE' },
  { name: 'fr-CA-Standard-A', languageCodes: ['fr-CA'], ssmlGender: 'FEMALE' },
] };

test('Google voices: only Standard ones, in the user languages, with readable names', () => {
  const list = googleVoiceList(googleJson, ['en-CA']);
  assert.deepEqual(list.map((x) => x.name), ['Google Standard A, female', 'Google Standard B, male']);
  assert.deepEqual(list[0], { voiceURI: 'google:en-GB-Standard-A', google: 'en-GB-Standard-A',
    name: 'Google Standard A, female', lang: 'en-GB', localService: false });
  assert.deepEqual(googleVoiceList(googleJson, ['fr-FR', 'en']).map((x) => x.lang), ['en-GB', 'en-US', 'fr-CA']);
  // No voices in the user languages: all the Standard ones, rather than none.
  assert.equal(googleVoiceList(googleJson, ['ja-JP']).length, 3);
  assert.deepEqual(googleVoiceList(null), []);
});

test('Google voices make audio, so they give exact lengths and export, as Piper does', () => {
  const [g] = googleVoiceList(googleJson, ['en']);
  assert.equal(makesAudio(g), true);
  assert.equal(makesAudio(piperVoiceList({ 'en_GB-alba-medium': 1 })[0]), true);
  assert.equal(makesAudio(v('Zed', 'en-US', true)), false);
  assert.equal(makesAudio(null), false);
  const groups = groupVoices([g, v('Google UK', 'en-GB', false)]);
  assert.deepEqual(groups[2][1], [g]);
  assert.deepEqual(groups[4][1].map((x) => x.name), ['Google UK']);
});

test('a Google reading sends the text, voice and speed, with the key in a header, not the address', () => {
  const [g] = googleVoiceList(googleJson, ['en']);
  const { url, init } = googleRequest('A door opens.', g, 1.15, 'AIzaTEST');
  assert.equal(url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
  assert.ok(!url.includes('AIza'));
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-goog-api-key'], 'AIzaTEST');
  // Only Scribecue's address goes with it, for keys restricted to its website, and no cookies.
  assert.equal(init.referrerPolicy, 'strict-origin');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(JSON.parse(init.body), {
    input: { text: 'A door opens.' },
    voice: { languageCode: 'en-GB', name: 'en-GB-Standard-A' },
    audioConfig: { audioEncoding: 'LINEAR16', speakingRate: 1.15 },
  });
});

test('Google errors are explained', async () => {
  const res = (status, message) => ({ status, json: async () => ({ error: { message } }) });
  assert.match(await googleFailure(res(400, 'API key not valid. Please pass a valid API key.')), /didn’t accept the key/);
  assert.match(await googleFailure(res(403, 'Cloud Text-to-Speech API has not been used in project 1')), /^Google refused: Cloud Text-to-Speech/);
  assert.match(await googleFailure(res(403, 'Requests from referer https://example.com/ are blocked.')), /restricted to other websites/);
  assert.match(await googleFailure(res(429, 'Quota exceeded')), /too many readings/);
  assert.equal(await googleFailure({ status: 500, json: async () => { throw new Error('x'); } }), 'Google answered 500');
});

test('saved readings over the limit go, the ones used longest ago first', () => {
  const e = (key, bytes, at) => ({ key, bytes, at });
  const entries = [e('new', 40, 300), e('old', 50, 100), e('mid', 30, 200)];
  assert.deepEqual(overCap(entries, 200), []);
  assert.deepEqual(overCap(entries, 120), []);
  assert.deepEqual(overCap(entries, 100), ['old']);
  assert.deepEqual(overCap(entries, 60), ['old', 'mid']);
  assert.deepEqual(overCap(entries, 0), ['old', 'mid', 'new']);
  assert.deepEqual(overCap([], 0), []);
});

test('Piper and Kokoro readings go before Google ones, which cost money to make again', () => {
  const e = (key, bytes, at) => ({ key, bytes, at });
  const entries = [e('google:en-US-Standard-C|1|Old', 50, 100), e('kokoro:af_heart|1|New', 40, 300), e('piper:en_US-lessac-medium|1|Mid', 30, 200)];
  assert.deepEqual(overCap(entries, 60), ['piper:en_US-lessac-medium|1|Mid', 'kokoro:af_heart|1|New']);
  assert.deepEqual(overCap(entries, 0), ['piper:en_US-lessac-medium|1|Mid', 'kokoro:af_heart|1|New', 'google:en-US-Standard-C|1|Old']);
});

test('favourite voices: pinning adds to the end, pinning again takes it out', () => {
  assert.deepEqual(toggleFavourite([], 'piper:a'), ['piper:a']);
  assert.deepEqual(toggleFavourite(['piper:a'], 'google:b'), ['piper:a', 'google:b']);
  assert.deepEqual(toggleFavourite(['piper:a', 'google:b'], 'piper:a'), ['google:b']);
});

test('favourites that are not available right now are kept, without a voice', () => {
  const list = [v('Zed', 'en-US', true), v('Anna', 'en-US', true)];
  assert.deepEqual(favouriteVoices(['Anna', 'google:gone', 'Zed'], list).map((f) => [f.uri, f.voice?.name ?? null]),
    [['Anna', 'Anna'], ['google:gone', null], ['Zed', 'Zed']]);
  assert.deepEqual(favouriteVoices([], list), []);
});

test('favourites start empty', () => {
  assert.deepEqual(tts.favourites, []);
});

test('the base speed is 50% to 150%, and readings are made at it times their speed', () => {
  assert.equal(toBase(1.05), 1.05);
  assert.equal(toBase(1.054), 1.05);
  for (const odd of [0.49, 1.51, NaN, '1', undefined]) assert.equal(toBase(odd), 1);
  assert.equal(atBase(1.15, 1), 1.15, 'at 100% speeds are unchanged, so earlier readings still match');
  assert.equal(atBase(1.15, 1.05), 1.2075);
  assert.equal(atBase(0.7, 0.5), 0.35);
  assert.equal(tts.base, 1);
});

test('an old overall speed becomes the base speed, as near as it can be', () => {
  assert.equal(baseFromSpeed(1.15), 1.15);
  assert.equal(baseFromSpeed(0.7), 0.7);
  assert.equal(baseFromSpeed(2), 1.5, 'the base speed goes no higher than 150%');
  assert.equal(baseFromSpeed(1.15, 1.05), 1.21);
  assert.equal(tts.speed, undefined, 'there is no overall speed any more');
});

test('a voice that isn\'t available is named from its id', () => {
  assert.equal(voiceLabel('google:en-US-Standard-C'), 'Google Standard C (en-US)');
  assert.equal(voiceLabel('google:fil-PH-Standard-A'), 'Google Standard A (fil-PH)');
  assert.equal(voiceLabel('piper:en_US-lessac-medium'), 'Lessac (en-US)');
  assert.equal(voiceLabel('kokoro:bf_emma'), 'Kokoro Emma (en-GB)');
  assert.equal(voiceLabel('kokoro:zz_nobody'), 'Kokoro zz_nobody');
  assert.equal(voiceLabel('com.apple.voice.compact.en-US.Samantha'), 'Samantha');
  assert.equal(voiceLabel('Google US English'), 'Google US English');
});

test('a missing voice comes with what to do about it', () => {
  assert.match(missingVoiceAdvice('google:en-US-Standard-C'), /Add your Google Cloud key/);
  assert.match(missingVoiceAdvice('google:en-US-Standard-C', { googleKey: true }), /key doesn’t offer it/);
  assert.match(missingVoiceAdvice('piper:en_US-lessac-medium', { hosted: true }), /Download it/);
  assert.match(missingVoiceAdvice('piper:en_US-lessac-medium'), /Piper isn’t running/);
  assert.match(missingVoiceAdvice('kokoro:af_heart'), /Kokoro isn’t running/);
  assert.match(missingVoiceAdvice('kokoro:af_heart', { hosted: true }), /Docker version/);
  assert.match(missingVoiceAdvice('Samantha'), /isn’t on this computer/);
});

test('nothing in tts.js hides the worker’s ask, which the web version uses to reach Piper', async () => {
  // A local "ask" in loadPiper once made the web version's ask('status') throw, so its
  // Piper voices disappeared.
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../app/js/tts.js', import.meta.url), 'utf8'));
  assert.deepEqual(src.match(/\b(?:const|let|var)\s+ask\b|\(\s*ask\s*[,)]/g), null);
  assert.equal(src.match(/^function ask\(/gm)?.length, 1);
});

// Heart (Kokoro) reading one line: its length goes in steps, not smoothly, with speed.
const heart = { 0.8: 6.38, 0.85: 5.74, 0.9: 5.44, 0.94: 5.36, 0.95: 5.25, 1: 4.99, 1.05: 4.9, 1.1: 4.8, 1.15: 4.69, 1.3: 4.25 };
const readHeart = (...speeds) => speeds.map((speed) => ({ speed, secs: heart[speed] }));

test('fitting tries a new guess, then halfway between the closest readings either side', () => {
  assert.equal(nextFitSpeed(readHeart(1), 5.3, 0.95), 0.95);
  // The guess was read already: between 1 (4.99, fits) and 0.85 (5.74, too long).
  assert.equal(nextFitSpeed(readHeart(1, 0.85), 5.3, 0.85, 0.03), 0.93);
  assert.equal(nextFitSpeed(readHeart(1, 0.85, 0.9, 0.95), 5.3, 0.9, 0.03), 0.93);
  // Nothing left between 0.95 (fits) and 0.94 (too long), so it settles on the best fit.
  assert.equal(nextFitSpeed(readHeart(1, 0.85, 0.94, 0.95), 5.3, 0.94, 0.03), 0.95);
});

test('fitting stops once a reading is close enough, and never guesses outside what’s known', () => {
  // 0.95 reads 5.25, within 0.06 of 5.3: no more tries, whatever the guess.
  assert.equal(nextFitSpeed(readHeart(1, 0.85, 0.95), 5.3, 0.97, 0.06), 0.95);
  // A block shrunk to 2.5 s, read by Kokoro near its fastest, where readings barely change:
  // a guess slower than a reading that's already too long (1.48) is not tried.
  const fast = [{ speed: 1, secs: 4.16 }, { speed: 1.95, secs: 2.517 }, { speed: 1.97, secs: 2.496 }, { speed: 2, secs: 2.453 }];
  assert.equal(nextFitSpeed(fast, 2.5, 1.48, 0.01), 1.97);
  assert.equal(nextFitSpeed(fast.slice(0, 1).concat(fast.slice(3)), 2.5, 1.48, 0.01), 1.48);
  // Nor one faster than a reading that already fits.
  assert.equal(nextFitSpeed(readHeart(1, 0.85), 5.3, 1.1, 0.03), 0.93);
});

test('fitting settles on the reading that fills the block best without running over', () => {
  assert.equal(bestFit(readHeart(1, 0.9, 0.95), 5.3, 0.03), 0.95); // 5.25 fits; 5.44 runs over
  assert.equal(bestFit(readHeart(1, 0.9, 0.95), 5.45, 0.03), 0.9); // 5.44 fits now
  assert.equal(bestFit(readHeart(1, 1.3), 4, 0.03), 1.3); // none fits: the shortest
  // Speeds before the base speed come back to the block's own 1% steps.
  assert.equal(bestFit([{ speed: 1.155 / 1.05, secs: 3 }], 3.1), 1.1);
  assert.equal(bestFit([], 3), null);
});

test('readings by voices with different rates are brought to one rate for the export', () => {
  const s = Int16Array.from([0, 100, 200, 300]);
  assert.equal(resample(s, 22050, 22050), s);
  const up = resample(s, 2, 4);
  assert.equal(up.length, 8);
  assert.deepEqual([...up.slice(0, 7)], [0, 50, 100, 150, 200, 250, 300]);
  assert.deepEqual([...resample(Int16Array.from([0, 10, 20, 30]), 4, 2)], [0, 20]);
  assert.equal(resample(new Int16Array(22050), 22050, 24000).length, 24000);
});
