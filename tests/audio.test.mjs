// Laying readings out as the description track, as track-worker.js does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layTrack, TRACK_PEAK_DB, TRACK_MAX_DB } from '../app/js/audio.js';

const tone = (secs, rate) => Int16Array.from({ length: Math.round(secs * rate) }, (_, i) => Math.round(20000 * Math.sin(i / 3)));

test('readings by voices at different rates go in one track at the highest, each at its start', () => {
  const readings = [
    { start: 1, samples: tone(1, 22050), rate: 22050, secs: 1 },
    { start: 1.5, samples: tone(1, 24000), rate: 24000, secs: 1 },
    { start: 4, samples: tone(0.5, 22050), rate: 22050, secs: 0.5 },
  ];
  const { samples, rate, overlaps } = layTrack(readings, 3);
  assert.equal(rate, 24000);
  assert.equal(overlaps, 1, 'the first runs into the second');
  assert.equal(samples.length, 4.5 * 24000, 'as long as the last reading, past secs');
  assert.equal(samples[Math.round(0.9 * 24000)], 0, 'nothing before the first');
  const top = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const peak = (a, b) => top(samples.subarray(a * 24000, b * 24000));
  // Overlapping readings add up, so the whole track comes down to keep under −6 dBFS.
  assert.ok(peak(0, 4.5) <= 32767 * 10 ** (TRACK_MAX_DB / 20) + 1);
  assert.ok(peak(4, 4.5) > 0 && peak(4, 4.5) <= 32767 * 10 ** (TRACK_PEAK_DB / 20) + 1);
  const alone = layTrack([readings[2]], 0);
  assert.ok(Math.abs(top(alone.samples) - 32767 * 10 ** (TRACK_PEAK_DB / 20)) < 2, 'a reading on its own peaks at −8 dBFS');
});

test('no readings: a silent track of the length asked', () => {
  const { samples, rate } = layTrack([], 2);
  assert.equal(rate, 22050);
  assert.equal(samples.length, 44100);
});
