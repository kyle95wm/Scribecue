import test from 'node:test';
import assert from 'node:assert/strict';
import { waveKey, packPeaks, unpackPeaks } from '../app/js/wavestore.js';

test('a waveform is kept by the file, its track and the peak rate', () => {
  const file = { name: 'ep1.mkv', size: 123, lastModified: 456 };
  assert.equal(waveKey(file, 2, 200), 'ep1.mkv|123|456|2|200');
  // Another file with the same name, or another track, doesn't share it.
  assert.notEqual(waveKey({ ...file, lastModified: 789 }, 2, 200), waveKey(file, 2, 200));
  assert.notEqual(waveKey(file, 1, 200), waveKey(file, 2, 200));
});

test('peaks come back as they were, near enough to draw', () => {
  const peaks = Float32Array.from([0, 0.001, 0.25, 0.5, 0.0123, 0.5]);
  const packed = packPeaks(peaks, 5, 0.5); // the last isn't part of the waveform yet
  assert.equal(packed.levels.length, 5);
  const back = unpackPeaks(packed);
  assert.equal(back.peakLen, 5);
  assert.equal(back.peakMax, 0.5);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(back.peaks[i] - peaks[i]) < 0.5 / 65535);
});

test('a silent track packs to silence', () => {
  const back = unpackPeaks(packPeaks(new Float32Array(3), 3, 0));
  assert.deepEqual([...back.peaks], [0, 0, 0]);
});
