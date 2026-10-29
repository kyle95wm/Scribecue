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
      if (['done', 'tracks', 'clip', 'error', 'unsupported'].includes(m.type)) resolve({ end: m, msgs, peaks, max });
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

// The loudness of a clip over a stretch of it, in seconds.
const level = (a, from, to) => {
  let m = 0;
  for (let i = Math.round(from * 16000); i < Math.round(to * 16000); i++) m = Math.max(m, Math.abs(a[i]));
  return m;
};

test('cuts out a clip at 16 kHz mono for speech to text', async () => {
  for (const [rate, channels] of [[8000, 1], [48000, 2], [44100, 1]]) {
    const { end } = await run({ cmd: 'clip', file: wav({ rate, channels }), from: 0.5, to: 2.5 });
    assert.equal(end.type, 'clip', `${rate} Hz: ${end.message}`);
    assert.equal(end.audio.length, 32000);
    // The tone runs from 1 s to 2 s of the file: 0.5 s to 1.5 s of the clip.
    assert.ok(level(end.audio, 0, 0.45) < 0.01, `${rate} Hz: silence before the tone`);
    assert.ok(level(end.audio, 0.55, 1.45) > 0.4, `${rate} Hz: the tone, at ${level(end.audio, 0.55, 1.45)}`);
    assert.ok(level(end.audio, 1.55, 2) < 0.01, `${rate} Hz: silence after the tone`);
  }
});

test('a clip past the end of the audio is silent there', async () => {
  const { end } = await run({ cmd: 'clip', file: wav(), from: 2, to: 4 });
  assert.equal(end.type, 'clip');
  assert.equal(end.audio.length, 32000);
  assert.ok(level(end.audio, 0, 2) < 0.01);
});

// A stand-in for WebCodecs' AudioDecoder, which Node doesn't have: each 20 ms Opus frame
// "decodes" to 20 ms of a tone at 48 kHz. It counts decoders that are never closed.
const open = new Set();
class FakeDecoder {
  static isConfigSupported = async () => ({ supported: true });
  constructor({ output }) { this.output = output; this.state = 'unconfigured'; this.decodeQueueSize = 0; open.add(this); }
  configure() { this.state = 'configured'; }
  decode(chunk) {
    const n = 960;
    this.output({
      timestamp: chunk.timestamp, numberOfFrames: n, numberOfChannels: 1, sampleRate: 48000, format: 'f32-planar',
      copyTo: (dst) => { for (let i = 0; i < n; i++) dst[i] = 0.5 * Math.sin(i / 5); },
      close() {},
    });
  }
  async flush() {}
  close() { this.state = 'closed'; open.delete(this); }
}

// A Matroska file with one Opus track and `seconds` of 20 ms frames, one cluster a second.
function mkv(seconds) {
  const size = (n) => { const b = [0x01, 0, 0, 0, 0, 0, 0, 0]; for (let i = 7; i > 0; i--) { b[i] = n & 255; n = Math.floor(n / 256); } return b; };
  const el = (id, body) => [...id, ...size(body.length), ...body];
  const uint = (n, len = 4) => Array.from({ length: len }, (_, i) => (n >> (8 * (len - 1 - i))) & 255);
  const str = (s) => [...s].map((c) => c.charCodeAt(0));
  const f64 = (x) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x); return [...new Uint8Array(dv.buffer)]; };
  const track = el([0xae], [...el([0xd7], [1]), ...el([0x83], [2]), ...el([0x86], str('A_OPUS')),
    ...el([0xe1], [...el([0xb5], f64(48000)), ...el([0x9f], [1])])]);
  const clusters = [];
  for (let s = 0; s < seconds; s++) {
    const blocks = [];
    for (let k = 0; k < 50; k++) blocks.push(...el([0xa3], [0x81, ...uint(k * 20, 2), 0x80, 1, 2, 3]));
    clusters.push(...el([0x1f, 0x43, 0xb6, 0x75], [...el([0xe7], uint(s * 1000)), ...blocks]));
  }
  const segment = el([0x18, 0x53, 0x80, 0x67], [...el([0x16, 0x54, 0xae, 0x6b], track), ...clusters]);
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], str('webm')));
  return new File([new Uint8Array([...header, ...segment])], 'test.mkv');
}

test('a clip of compressed audio closes every decoder it opens', async () => {
  globalThis.AudioDecoder = FakeDecoder;
  globalThis.EncodedAudioChunk = class { constructor(o) { Object.assign(this, o); } };
  try {
    for (let i = 0; i < 3; i++) {
      const { end } = await run({ cmd: 'clip', file: mkv(60), from: 40 + i, to: 42 + i });
      assert.equal(end.type, 'clip', end.message);
      assert.equal(end.audio.length, 32000);
      assert.ok(level(end.audio, 0, 2) > 0.4, 'the clip has the audio in it');
      assert.equal(open.size, 0, `${open.size} decoder(s) left open after clip ${i + 1}`);
    }
    // Building the waveform closes its decoder too.
    const { end } = await run({ cmd: 'build', file: mkv(3), rate: 200 });
    assert.equal(end.type, 'done', end.message);
    assert.equal(open.size, 0);
  } finally {
    delete globalThis.AudioDecoder;
    delete globalThis.EncodedAudioChunk;
  }
});
