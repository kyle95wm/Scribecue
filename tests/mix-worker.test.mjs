// The full mix, made by the mixer worker under Node from WAV programmes built in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { stepDip, dipLevel, DIPS, FADES } from '../app/js/tts.js';
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
// Readings: mono 16-bit at 22050 Hz, a tone at amp between each [start, end].
function readings(secs, spans, amp = 0.3, rate = 22050) {
  const s = new Int16Array(Math.round(secs * rate));
  for (const [a, b] of spans) for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) s[i] = Math.round(amp * 32767 * Math.sin(2 * Math.PI * 1000 * i / rate));
  return s;
}

function mix(file, opts) {
  const job = { cmd: 'mix', file, track: 0, desc: new Int16Array(0), descRate: 22050, spans: [], dipDb: 10, fade: 0.25, video: 1, reading: 1, kbps: 0, ...opts };
  return new Promise((resolve) => {
    sink = (m) => { if (m.type !== 'progress') resolve(m); };
    self.onmessage({ data: job });
  });
}
// The stereo WAV the mixer made, as { rate, l, r } in −1..1.
async function decode(blob) {
  const dv = new DataView(await blob.arrayBuffer());
  assert.equal(dv.getUint16(22, true), 2, 'stereo');
  const rate = dv.getUint32(24, true), n = dv.getUint32(40, true) / 4;
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = dv.getInt16(44 + i * 4, true) / 32768; r[i] = dv.getInt16(46 + i * 4, true) / 32768; }
  return { rate, l, r };
}
const peak = (d, a, b) => { let m = 0; for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) m = Math.max(m, Math.abs(d[i])); return m; };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(4)}, expected ${b.toFixed(4)}`);

test('the programme goes down by the dip while a reading plays, over the fade, and back up', async () => {
  const m = await mix(programme(4, 2, sine(0.5)), { spans: [[1, 2]], desc: new Int16Array(22050 * 2) });
  assert.equal(m.type, 'mix');
  const { rate, l, r } = await decode(m.blob);
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
  const desc = readings(4, [[1.5, 2.5]], 0.3);
  const m = await mix(programme(4, 1, sine(0.2)), { spans: [[1.5, 2.5]], desc, dipDb: 0, reading: 0.5 });
  const { l, r } = await decode(m.blob);
  near(peak(l, 0.5, 1.4), 0.2, 0.002, 'programme alone (mono to both sides)');
  near(peak(r, 0.5, 1.4), 0.2, 0.002, 'right');
  near(peak(l, 1.6, 2.4), 0.2 + 0.15, 0.01, 'programme and reading at half level');
  near(peak(l, 2.6, 3.9), 0.2, 0.002, 'after');
});

test('the mix slider’s levels apply to the programme', async () => {
  const { l } = await decode((await mix(programme(1, 2, sine(0.5)), { video: 0.5 })).blob);
  near(peak(l, 0.1, 0.9), 0.25, 0.002, 'programme at half');
});

test('peaks stay under −1 dBFS, without changing the level elsewhere', async () => {
  const desc = readings(3, [[1, 2]], 0.9);
  const m = await mix(programme(3, 2, sine(0.95)), { spans: [[1, 2]], desc, dipDb: 0 });
  const { l } = await decode(m.blob);
  assert.ok(peak(l, 0, 3) <= 10 ** (-1 / 20) + 1e-3, `peak ${peak(l, 0, 3)}`);
  near(peak(l, 0.1, 0.6), 0.891, 0.01, 'a loud programme is held at the ceiling');
  near(peak(l, 2.4, 2.9), 0.891, 0.01, 'and lets go after');
  const quiet = await decode((await mix(programme(1, 2, sine(0.3)), {})).blob);
  near(peak(quiet.l, 0.1, 0.9), 0.3, 0.002, 'a quiet programme is untouched');
});

test('readings past the end of the programme are kept whole', async () => {
  const desc = readings(5, [[3, 4.5]]);
  const { l } = await decode((await mix(programme(3, 2, () => 0), { spans: [[3, 4.5]], desc })).blob);
  assert.ok(l.length >= 4.5 * 48000);
  near(peak(l, 3.5, 4.4), 0.3, 0.01, 'the reading after the end');
});

test('5.1 is folded to stereo, without the LFE', async () => {
  const sides = [0.2, 0, 0.1, 0.5, 0, 0]; // L, R, C, LFE, Ls, Rs
  const { l, r } = await decode((await mix(programme(1, 6, (c, t) => sides[c] * Math.sin(2 * Math.PI * 440 * t)), {})).blob);
  near(peak(l, 0.1, 0.9), 0.2 + 0.1 * Math.SQRT1_2, 0.003, 'left: L and centre');
  near(peak(r, 0.1, 0.9), 0.1 * Math.SQRT1_2, 0.003, 'right: centre only');
});

test('as an MP3', async () => {
  const m = await mix(programme(2, 2, sine(0.3)), { kbps: 192 });
  assert.equal(m.blob.type, 'audio/mpeg');
  const b = new Uint8Array(await m.blob.arrayBuffer());
  assert.ok(b[0] === 0xff && (b[1] & 0xe0) === 0xe0, 'starts with an MP3 frame');
  const want = 2 * 192000 / 8;
  assert.ok(Math.abs(b.length - want) < want * 0.15, `${b.length} bytes`);
  const odd = await mix(programme(1, 2, sine(0.3), 22050), { kbps: 192 });
  assert.equal(odd.type, 'unsupported');
});

test('playback dips the same way: the same steps and levels', () => {
  let f = 0;
  for (let k = 0; k < 15; k++) f = stepDip(f, 1, 1 / 60, 0.25);
  near(f, 1, 1e-9, 'all the way down after the fade');
  for (let k = 0; k < 7; k++) f = stepDip(f, 0, 1 / 60, 0.25);
  near(f, 1 - 7 / 15, 1e-9, 'partway back up');
  near(dipLevel(1, 10), 10 ** (-10 / 20), 1e-12, 'level');
  assert.equal(dipLevel(0, 20), 1);
  assert.ok(DIPS.includes(10) && FADES.includes(0.25));
});

test('the settings offer the dips, fades and formats there are', () => {
  const html = readFileSync(app('index.html'), 'utf8');
  const values = (id) => [...html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1].matchAll(/value="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(values('ttsDipDb').map(Number), DIPS);
  assert.deepEqual(values('ttsDipFade').map(Number), FADES);
  assert.deepEqual(values('ttsMixAs'), Object.keys(MIX_FORMATS));
});
