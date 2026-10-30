import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEEDS, DEFAULT_CPS, pickVoices, groupVoices, estimate, spoken, tts, isSpeed, speedLabel,
  piperVoiceList, readWav, writeWav, mixTrack, onlyNotes, TRACK_PEAK_DB, TRACK_MAX_DB, mixLevels,
  googleVoiceList, googleRequest, googleFailure, makesAudio, overCap,
  toggleFavourite, favouriteVoices } from '../app/js/tts.js';

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

test('the voice menu lists Piper, then voices on this computer, then online ones', () => {
  const piper = piperVoiceList({ 'en_GB-alba-medium': {}, 'en_US-lessac-medium': {} });
  const groups = groupVoices([...piper, ...pickVoices(voices, { online: true, lang: 'en-US' })]);
  assert.deepEqual(groups.map(([label]) => label),
    ['Piper: natural voices on this computer', 'Google Cloud: the text is sent to Google', 'On this computer',
      'Online: the text is sent to the provider']);
  assert.deepEqual(groups[0][1].map((x) => x.name), ['Alba', 'Lessac']);
  assert.deepEqual(groups[1][1], []);
  assert.deepEqual(groups[2][1].map((x) => x.name), ['Anna', 'Zed', 'Alex', 'Amélie']);
  assert.deepEqual(groups[3][1].map((x) => x.name), ['Google UK']);
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
  assert.deepEqual(groups[1][1], [g]);
  assert.deepEqual(groups[3][1].map((x) => x.name), ['Google UK']);
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
