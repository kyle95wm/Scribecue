// Laying readings out as the description track, as track-worker.js does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layTrack, layTrackBlob, trackParts, mixTrack, pcmToWav, writeWav, TRACK_PEAK_DB, TRACK_MAX_DB } from '../app/js/audio.js';

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

test('a reading’s volume carries into the track, and a loud one brings it all down together', () => {
  const r = (start, gain) => ({ start, samples: tone(0.5, 22050), rate: 22050, secs: 0.5, gain });
  const top = (s, a, b) => s.subarray(a * 22050, b * 22050).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const quiet = layTrack([r(0, 1), r(1, 0.5)], 2).samples;
  assert.ok(Math.abs(top(quiet, 1, 1.5) / top(quiet, 0, 0.5) - 0.5) < 0.01, 'half as loud');
  const loud = layTrack([r(0, 1), r(1, 2)], 2).samples;
  assert.ok(Math.abs(top(loud, 1, 1.5) / top(loud, 0, 0.5) - 2) < 0.01, 'twice as loud');
  assert.ok(top(loud, 0, 2) <= 32767 * 10 ** (TRACK_MAX_DB / 20) + 1, 'still under −6 dBFS');
});

test('no readings: a silent track of the length asked', () => {
  const { samples, rate } = layTrack([], 2);
  assert.equal(rate, 22050);
  assert.equal(samples.length, 44100);
});

test('a track made in pieces is the same as one made whole', async () => {
  // Readings across the joins between pieces, overlapping, and starting before the track.
  const r = (start, n, v, gain) => ({ start, samples: new Int16Array(n).map((_, i) => Math.round(v * Math.sin(i / 3))), gain });
  const items = [r(-0.2, 40, 20000), r(0.9, 60, 30000), r(1.1, 30, 8000, 2), r(4.8, 100, 32000)];
  const whole = [...trackParts(items, 20, 6, TRACK_PEAK_DB, TRACK_MAX_DB, 100)];
  assert.equal(whole.length, 1);
  const pieces = [...trackParts(items, 20, 6, TRACK_PEAK_DB, TRACK_MAX_DB, 1)];
  assert.equal(pieces.length, 6);
  assert.deepEqual(Array.from(pieces.flatMap((p) => [...p])), Array.from(whole[0]));
  assert.deepEqual(mixTrack(items, 20, 6), whole[0]);
});

test('the track as a Blob matches, and makes the same WAV', async () => {
  const readings = [{ start: 0.5, samples: new Int16Array(4000).fill(9000), rate: 8000, secs: 0.5 }];
  const { samples, rate } = layTrack(readings, 2);
  const { pcm, rate: same, overlaps } = layTrackBlob(readings, 2);
  assert.equal(same, rate);
  assert.equal(overlaps, 0);
  assert.deepEqual(new Int16Array(await pcm.arrayBuffer()), samples);
  assert.deepEqual(await pcmToWav(pcm, rate).arrayBuffer(), await writeWav(samples, rate).arrayBuffer());
});
