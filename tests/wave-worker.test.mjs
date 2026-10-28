// Runs the waveform worker under Node on WAV files built in memory, so no media
// files or browser are needed. WAV is read without AudioDecoder.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let sink = () => {};
globalThis.self = globalThis;
globalThis.postMessage = (m) => sink(m);
await import('../app/js/wave-worker.js');

// 1 s silence, 1 s of a half-volume tone, 1 s silence.
function wav({ rate = 8000, channels = 1, seconds = [0, 0.5, 0] } = {}) {
  const frames = rate * seconds.length, data = frames * channels * 2;
  const dv = new DataView(new ArrayBuffer(44 + data));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * channels * 2, true); dv.setUint16(32, channels * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, data, true);
  for (let i = 0; i < frames; i++) {
    const amp = seconds[Math.floor(i / rate)];
    const v = Math.round(amp * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate));
    for (let c = 0; c < channels; c++) dv.setInt16(44 + (i * channels + c) * 2, v, true);
  }
  return new File([dv.buffer], 'test.wav', { type: 'audio/wav' });
}

function run(job) {
  return new Promise((resolve) => {
    let peaks = new Float32Array(0), max = 0;
    const msgs = [];
    sink = (m) => {
      msgs.push(m);
      if (m.type === 'peaks') {
        const need = m.from + m.data.length;
        if (need > peaks.length) { const g = new Float32Array(need); g.set(peaks); peaks = g; }
        peaks.set(m.data, m.from);
        max = Math.max(max, m.max);
      }
      if (['done', 'tracks', 'error', 'unsupported'].includes(m.type)) resolve({ end: m, msgs, peaks, max });
    };
    self.onmessage({ data: job });
  });
}

test('builds peaks that line up with the audio', async () => {
  const { end, peaks, max } = await run({ cmd: 'build', file: wav(), rate: 200 });
  assert.equal(end.type, 'done');
  assert.ok(Math.abs(peaks.length - 600) <= 2, `expected about 600 bins, got ${peaks.length}`);
  assert.ok(max > 0.45 && max < 0.55, `peak level ${max}`);
  const onset = peaks.findIndex((v) => v > max / 2);
  const offset = peaks.length - [...peaks].reverse().findIndex((v) => v > max / 2);
  assert.ok(Math.abs(onset - 200) <= 1, `sound starts at bin ${onset}, expected 200`);
  assert.ok(Math.abs(offset - 400) <= 1, `sound ends at bin ${offset}, expected 400`);
});

test('reads stereo files', async () => {
  const { end, peaks } = await run({ cmd: 'build', file: wav({ channels: 2 }), rate: 200 });
  assert.equal(end.type, 'done');
  assert.ok(Math.abs(peaks.length - 600) <= 2);
});

test('probing lists the audio track', async () => {
  const { end } = await run({ cmd: 'probe', file: wav() });
  assert.equal(end.type, 'tracks');
  assert.equal(end.tracks.length, 1);
});

test('copies the track out as playable WAV when asked', async () => {
  const { msgs } = await run({ cmd: 'build', file: wav(), rate: 200, mux: true });
  const audio = msgs.find((m) => m.type === 'audio');
  assert.ok(audio?.blob, `no audio blob: ${JSON.stringify(audio)}`);
  assert.equal(audio.mime, 'audio/wav');
  assert.equal(audio.blob.size, 44 + 8000 * 3 * 2);
});

test('reports files it cannot stream instead of failing', async () => {
  const { end } = await run({ cmd: 'build', file: new File([new Uint8Array(64).fill(7)], 'x.bin'), rate: 200 });
  assert.equal(end.type, 'unsupported');
});
