import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScan, inPause, GAP } from '../app/js/narrationscan.js';
import { buildBwf, narrationSound, readNote } from '../app/js/bwf.js';
import { narrationNote } from '../app/js/recording.js';

// A take: a tone that never hits zero, so the scan sees all of it as sound.
const tone = (secs, rate, level = 0.3) => Float32Array.from({ length: Math.round(secs * rate) }, (_, i) => level * (0.5 + 0.5 * Math.sin(i / 3)) + 0.01);

test('the scan finds each take in a narration WAV, where it was placed, and nothing else', async () => {
  const rate = 8000;
  const pauses = [{ at: 3, secs: 2.5 }];
  const note = narrationNote({ blocks: [{ start: 1, end: 2, text: 'One.' }, { start: 3, end: 3.5, text: 'Two.', extended: true }], pauses });
  const takes = [{ start: 1, samples: tone(0.8, rate) }, { start: 3, samples: tone(2.5, rate) }, { start: 7, samples: tone(0.5, rate) }];
  const wav = buildBwf({ takes, note, secs: 9, rate });
  assert.ok(await readNote(wav));
  const { at, len, rate: r } = await narrationSound(wav);
  assert.equal(r, rate);
  assert.equal(len, 9 * rate * 3);
  // In uneven pieces, as the worker's slices land, though always whole samples.
  const scan = createScan(r);
  const bytes = new Uint8Array(await wav.slice(at, at + len).arrayBuffer());
  for (let o = 0; o < bytes.length; o += 3 * 1237) scan.push(bytes.subarray(o, Math.min(bytes.length, o + 3 * 1237)));
  const runs = scan.end();
  assert.deepEqual(runs.map((x) => [x.start, x.samples.length]), takes.map((t) => [t.start, t.samples.length]));
  // 16-bit, as the mixer takes readings.
  assert.ok(runs[0].samples instanceof Int16Array);
  assert.ok(Math.abs(runs[0].samples[0] - Math.round(takes[0].samples[0] * 32767)) <= 1);
});

test('short silences inside a take keep it whole; longer ones split it', () => {
  const rate = 1000, b = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
  const samples = (list) => new Uint8Array(list.flatMap(b));
  const scan = createScan(rate, 0.01); // 10 samples
  scan.push(samples([0, 0, 500, 500, ...Array(8).fill(0), 500, ...Array(20).fill(0), 500, 0]));
  const runs = scan.end();
  assert.deepEqual(runs.map((r) => [r.start * rate, r.samples.length]), [[2, 11], [33, 1]]);
  assert.equal(GAP, 0.5);
});

test('a WAV that isn’t mono 24-bit isn’t taken for a narration', async () => {
  const h = new DataView(new ArrayBuffer(44));
  const s = (o, t) => [...t].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); h.setUint32(4, 36, true); s(8, 'WAVE'); s(12, 'fmt '); h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); h.setUint16(22, 2, true); h.setUint32(24, 48000, true); h.setUint16(34, 16, true);
  s(36, 'data'); h.setUint32(40, 0, true);
  await assert.rejects(narrationSound(new Blob([h.buffer])), /isn’t a narration WAV/);
  await assert.rejects(narrationSound(new Blob(['nope'])), /isn’t a WAV/);
});

test('the takes read while the picture is stopped are known by the pauses', () => {
  const pauses = [{ at: 10, secs: 4 }, { at: 20, secs: 2 }];
  // On the narration's timeline: the first pause is 10–14, the second 24–26.
  assert.equal(inPause(pauses, 9.9), false);
  assert.equal(inPause(pauses, 10), true);
  assert.equal(inPause(pauses, 13.9), true);
  assert.equal(inPause(pauses, 14), false);
  assert.equal(inPause(pauses, 20), false);
  assert.equal(inPause(pauses, 24.5), true);
  assert.equal(inPause(pauses, 26), false);
  assert.equal(inPause([], 5), false);
});
