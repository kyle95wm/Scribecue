import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEEDS, DEFAULT_CPS, pickVoices, groupVoices, estimate, spoken, tts, isSpeed, speedLabel,
  piperVoiceList, readWav, writeWav, mixTrack, onlyNotes, TRACK_PEAK_DB, TRACK_MAX_DB } from '../app/js/tts.js';

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
    ['Piper: natural voices on this computer', 'On this computer', 'Online: the text is sent to the provider']);
  assert.deepEqual(groups[0][1].map((x) => x.name), ['Alba', 'Lessac']);
  assert.deepEqual(groups[1][1].map((x) => x.name), ['Anna', 'Zed', 'Alex', 'Amélie']);
  assert.deepEqual(groups[2][1].map((x) => x.name), ['Google UK']);
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
