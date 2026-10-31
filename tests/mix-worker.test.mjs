// The full mix, made by the mixer worker under Node from WAV programmes built in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { stepDip, dipLevel, isDip, typedDip, DIPS, MAX_DIP, FADES, LOUDNESS } from '../app/js/tts.js';
import { MIX_FORMATS } from '../app/js/mp3.js';

const app = (f) => new URL(`../app/${f}`, import.meta.url);
let sink = () => {};
globalThis.self = globalThis;
globalThis.postMessage = (m) => sink(m);
globalThis.importScripts = (...fs) => { for (const f of fs) runInThisContext(readFileSync(new URL(f, app('js/')), 'utf8'), { filename: f }); };
await import('../app/js/mix-worker.js');

// A WAV programme: fn(channel, seconds) gives each sample.
function programme(secs, channels, fn, rate = 48000) {
  const frames = Math.round(secs * rate), data = frames * channels * 2;
  const dv = new DataView(new ArrayBuffer(44 + data));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * channels * 2, true); dv.setUint16(32, channels * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, data, true);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) dv.setInt16(44 + (i * channels + c) * 2, Math.round(fn(c, i / rate) * 32767), true);
  return new File([dv.buffer], 'programme.wav', { type: 'audio/wav' });
}
const sine = (amp, hz = 440) => (c, t) => amp * Math.sin(2 * Math.PI * hz * t);
// Readings for the mixer, one for each [start, end, dB], as a tone at amp (or silence),
// mono 16-bit at 22050 Hz, as the page sends them.
function readings(spans, amp = 0, dip = 10, rate = 22050) {
  return spans.map(([a, b, db = dip]) => ({
    start: a, rate, dip: db,
    samples: Int16Array.from({ length: Math.round((b - a) * rate) }, (_, i) => Math.round(amp * 32767 * Math.sin(2 * Math.PI * 1000 * i / rate))),
  }));
}

function mix(file, opts) {
  const job = { cmd: 'mix', file, track: 0, readings: [], fade: 0.25, video: 1, reading: 1, kbps: 0, target: null, ceiling: -1, stems: false, ...opts };
  return new Promise((resolve) => {
    sink = (m) => { if (m.type !== 'progress') resolve(m); };
    self.onmessage({ data: job });
  });
}
// A WAV the mixer made, as { rate, channels, l, r } in −1..1. m: the mixer's answer, or a
// blob; part: which of its files.
async function decode(m, part = 'mix') {
  const blob = m instanceof Blob ? m : m.files.find((f) => f.part === part).blob;
  const dv = new DataView(await blob.arrayBuffer());
  const channels = dv.getUint16(22, true), rate = dv.getUint32(24, true), n = dv.getUint32(40, true) / 2 / channels;
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = dv.getInt16(44 + i * 2 * channels, true) / 32768;
    r[i] = channels === 2 ? dv.getInt16(46 + i * 4, true) / 32768 : l[i];
  }
  return { rate, channels, l, r };
}
const peak = (d, a, b) => { let m = 0; for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) m = Math.max(m, Math.abs(d[i])); return m; };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(4)}, expected ${b.toFixed(4)}`);

test('the programme goes down by the dip while a reading plays, over the fade, and back up', async () => {
  const m = await mix(programme(4, 2, sine(0.5)), { readings: readings([[1, 2]]) });
  assert.equal(m.type, 'mix');
  const { rate, l, r } = await decode(m);
  assert.equal(rate, 48000);
  assert.equal(l.length, 4 * 48000);
  const down = 0.5 * 10 ** (-10 / 20);
  near(peak(l, 0.2, 0.9), 0.5, 0.002, 'before');
  near(peak(l, 1.3, 1.9), down, 0.002, 'during');
  near(peak(r, 1.3, 1.9), down, 0.002, 'right side too');
  near(peak(l, 2.4, 3.9), 0.5, 0.002, 'after');
  // halfway down a quarter of a second in: 5 dB
  near(peak(l, 1.12, 1.13), 0.5 * 10 ** (-5 / 20), 0.01, 'halfway through the fade');
});

test('with the dip off, the programme stays where it is; the readings play at their time and level', async () => {
  const m = await mix(programme(4, 1, sine(0.2)), { readings: readings([[1.5, 2.5]], 0.3, 0), reading: 0.5 });
  const { l, r } = await decode(m);
  near(peak(l, 0.5, 1.4), 0.2, 0.002, 'programme alone (mono to both sides)');
  near(peak(r, 0.5, 1.4), 0.2, 0.002, 'right');
  near(peak(l, 1.6, 2.4), 0.2 + 0.15, 0.01, 'programme and reading at half level');
  near(peak(l, 2.6, 3.9), 0.2, 0.002, 'after');
});

test('the mix slider’s levels apply to the programme', async () => {
  const { l } = await decode(await mix(programme(1, 2, sine(0.5)), { video: 0.5 }));
  near(peak(l, 0.1, 0.9), 0.25, 0.002, 'programme at half');
});

test('peaks stay under −1 dBFS, without changing the level elsewhere', async () => {
  const m = await mix(programme(3, 2, sine(0.95)), { readings: readings([[1, 2]], 0.9, 0) });
  const { l } = await decode(m);
  assert.ok(peak(l, 0, 3) <= 10 ** (-1 / 20) + 1e-3, `peak ${peak(l, 0, 3)}`);
  near(peak(l, 0.1, 0.6), 0.891, 0.01, 'a loud programme is held at the ceiling');
  near(peak(l, 2.4, 2.9), 0.891, 0.01, 'and lets go after');
  const quiet = await decode(await mix(programme(1, 2, sine(0.3)), {}));
  near(peak(quiet.l, 0.1, 0.9), 0.3, 0.002, 'a quiet programme is untouched');
});

test('readings past the end of the programme are kept whole', async () => {
  const { l } = await decode(await mix(programme(3, 2, () => 0), { readings: readings([[3, 4.5]], 0.3) }));
  assert.ok(l.length >= 4.5 * 48000);
  near(peak(l, 3.5, 4.4), 0.3, 0.01, 'the reading after the end');
});

test('5.1 is folded to stereo, without the LFE', async () => {
  const sides = [0.2, 0, 0.1, 0.5, 0, 0]; // L, R, C, LFE, Ls, Rs
  const { l, r } = await decode(await mix(programme(1, 6, (c, t) => sides[c] * Math.sin(2 * Math.PI * 440 * t)), {}));
  near(peak(l, 0.1, 0.9), 0.2 + 0.1 * Math.SQRT1_2, 0.003, 'left: L and centre');
  near(peak(r, 0.1, 0.9), 0.1 * Math.SQRT1_2, 0.003, 'right: centre only');
});

test('as an MP3', async () => {
  const m = await mix(programme(2, 2, sine(0.3)), { kbps: 192 });
  const blob = m.files[0].blob;
  assert.equal(blob.type, 'audio/mpeg');
  const b = new Uint8Array(await blob.arrayBuffer());
  assert.ok(b[0] === 0xff && (b[1] & 0xe0) === 0xe0, 'starts with an MP3 frame');
  const want = 2 * 192000 / 8;
  assert.ok(Math.abs(b.length - want) < want * 0.15, `${b.length} bytes`);
  const odd = await mix(programme(1, 2, sine(0.3), 22050), { kbps: 192 });
  assert.equal(odd.type, 'unsupported');
});

test('each block can have its own dip, or none', async () => {
  const m = await mix(programme(5, 2, sine(0.5)), { readings: readings([[0.5, 1.5, 0], [2.5, 3.5, 20]]) });
  const { l } = await decode(m);
  near(peak(l, 0.8, 1.4), 0.5, 0.002, 'not lowered');
  near(peak(l, 3, 3.4), 0.05, 0.002, 'lowered 20 dB');
  near(peak(l, 4, 4.9), 0.5, 0.002, 'back up');
});

test('the dip moves from one block’s to the next without jumping', async () => {
  const m = await mix(programme(3, 2, sine(0.5)), { readings: readings([[0.5, 1.5, 6], [1.5, 2.5, 18]]) });
  const { l } = await decode(m);
  near(peak(l, 1.2, 1.45), 0.5 * 10 ** (-6 / 20), 0.002, 'first block');
  // from 6 to 18 dB takes two thirds of the fade
  near(peak(l, 1.5 + 0.25 * 2 / 3 + 0.02, 2.4), 0.5 * 10 ** (-18 / 20), 0.002, 'second block');
  const mid = peak(l, 1.58, 1.59);
  assert.ok(mid < 0.5 * 10 ** (-6 / 20) && mid > 0.5 * 10 ** (-18 / 20), `between: ${mid}`);
});

test('a loudness target brings the mix to it', async () => {
  // A 1 kHz tone in both channels at −20 dBFS measures about −20 LUFS.
  const as = await mix(programme(6, 2, sine(0.1, 1000)), {});
  near(as.loudness, -20, 0.1, 'measured as it comes');
  assert.equal(as.was, null);
  const m = await mix(programme(6, 2, sine(0.1, 1000)), { target: -23 });
  near(m.was, -20, 0.1, 'before');
  near(m.loudness, -23, 0.1, 'after');
  const { l } = await decode(m);
  near(peak(l, 1, 5), 0.1 * 10 ** (-3 / 20), 0.002, 'turned down 3 dB');
  // Brought up: the limiter keeps peaks under the ceiling.
  const up = await mix(programme(6, 2, sine(0.1, 1000)), { target: -5, ceiling: -2 });
  assert.ok(peak((await decode(up)).l, 0, 6) <= 10 ** (-2 / 20) + 1e-3);
  const quiet = await mix(programme(2, 2, () => 0), { target: -23 });
  assert.equal(quiet.type, 'mix', 'silence is left as it is');
});

test('stems: the lowered programme and the readings, which add up to the mix', async () => {
  const m = await mix(programme(3, 2, sine(0.4)), { readings: readings([[1, 2]], 0.3), stems: true });
  assert.deepEqual(m.files.map((f) => f.part), ['mix', 'programme', 'readings']);
  const mixed = await decode(m), prog = await decode(m, 'programme'), said = await decode(m, 'readings');
  assert.equal(prog.channels, 2);
  assert.equal(said.channels, 1);
  near(peak(prog.l, 1.3, 1.9), 0.4 * 10 ** (-10 / 20), 0.002, 'programme lowered');
  near(peak(said.l, 0.2, 0.9), 0, 0.001, 'no reading yet');
  near(peak(said.l, 1.2, 1.9), 0.3, 0.005, 'the reading');
  let worst = 0;
  for (let i = 0; i < mixed.l.length; i += 7) worst = Math.max(worst, Math.abs(mixed.l[i] - prog.l[i] - said.l[i]));
  assert.ok(worst < 0.001, `stems differ from the mix by ${worst}`);
});

test('playback dips the same way: the same steps and levels', () => {
  let db = 0;
  for (let k = 0; k < 15; k++) db = stepDip(db, 10, 1 / 60, 0.25);
  near(db, 10, 1e-9, 'all the way down after the fade');
  for (let k = 0; k < 7; k++) db = stepDip(db, 0, 1 / 60, 0.25, 10);
  near(db, 10 * (1 - 7 / 15), 1e-9, 'partway back up');
  assert.equal(stepDip(3, 10, 1 / 60, 0), 10, 'no fade: straight there');
  near(dipLevel(10), 10 ** (-10 / 20), 1e-12, 'level');
  assert.equal(dipLevel(0), 1);
  assert.ok(isDip(0) && isDip(15) && isDip(7) && isDip(40) && !isDip(41) && !isDip(-1) && !isDip(7.5) && !isDip('7') && !isDip(undefined));
});

test('a custom dip is a whole number of dB, up to 40', () => {
  assert.equal(MAX_DIP, 40);
  assert.equal(typedDip('12'), 12);
  assert.equal(typedDip(' 7.6 '), 8, 'rounded');
  assert.equal(typedDip('40'), 40);
  assert.equal(typedDip('41'), null);
  assert.equal(typedDip('0'), null, 'the settings need some dip: untick the box for none');
  assert.equal(typedDip('0', 0), 0, 'a block can have none');
  for (const bad of ['', '  ', 'loud', '-3', undefined, null]) assert.equal(typedDip(bad), null, String(bad));
});

test('a custom dip lowers the mix as far as asked', async () => {
  const m = await mix(programme(2, 2, sine(0.5)), { readings: readings([[0.2, 1.8]], 0, 10).map((r) => ({ ...r, dip: 32 })), fade: 0.1 });
  near(peak((await decode(m)).l, 1, 1.5), 0.5 * dipLevel(32), 0.002, '32 dB down');
});

test('the settings offer the dips, fades, formats and loudness targets there are', () => {
  const html = readFileSync(app('index.html'), 'utf8');
  const values = (id) => [...html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`))[1].matchAll(/value="([^"]*)"/g)].map((x) => x[1]);
  assert.deepEqual(values('ttsDipDb'), [...DIPS.map(String), 'custom']);
  assert.deepEqual(values('ttsDipFade').map(Number), FADES);
  assert.deepEqual(values('ttsMixAs'), Object.keys(MIX_FORMATS));
  assert.deepEqual(values('ttsLoudness'), Object.keys(LOUDNESS));
  // What ffmpeg makes (ffmpeg/server.py), and only while it's running.
  const server = readFileSync(new URL('../ffmpeg/server.py', import.meta.url), 'utf8');
  for (const [k, f] of Object.entries(MIX_FORMATS).filter(([, f]) => f.ffmpeg)) {
    assert.match(server, new RegExp(`"${f.ffmpeg}": \\(\\[.*\\], "${f.ext}"\\)`), k);
    assert.match(html, new RegExp(`<option value="${k}" class="ffonly" hidden>`), k);
  }
  assert.deepEqual(values('ttsMixInto'), ['', 'add', 'replace']);
});

test('for ffmpeg, the mix stays a WAV and the stems are still MP3s', async () => {
  const m = await mix(programme(1, 2, sine(0.3)), { readings: readings([[0.2, 0.6]], 0.2), kbps: 128, wavMix: true, stems: true });
  const types = Object.fromEntries(m.files.map((f) => [f.part, f.blob.type]));
  assert.deepEqual(types, { mix: 'audio/wav', programme: 'audio/mpeg', readings: 'audio/mpeg' });
  assert.equal((await decode(m)).rate, 48000);
});
