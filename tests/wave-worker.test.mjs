// Runs the waveform worker under Node on WAV files built in memory, so no media
// files or browser are needed. WAV is read without AudioDecoder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
      if (['done', 'tracks', 'clip', 'subs', 'error', 'unsupported'].includes(m.type)) resolve({ end: m, msgs, peaks, max });
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

test('a build waits while held, and carries on when let go', async () => {
  self.onmessage({ data: { cmd: 'pace', pace: 'hold' } });
  let finished = false;
  const built = run({ cmd: 'build', file: wav(), rate: 200 }).then((r) => { finished = true; return r; });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(finished, false, 'nothing is read while the video seeks');
  self.onmessage({ data: { cmd: 'pace', pace: 'slow' } });
  const { end, max } = await built;
  assert.equal(end.type, 'done', 'it still finishes while the video plays');
  assert.ok(max > 0.4);
  self.onmessage({ data: { cmd: 'pace', pace: 'go' } });
});

// ---- subtitle tracks, in small files built here

const bytes = (...parts) => {
  const all = parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : [...p]));
  return Uint8Array.from(all);
};
// Matroska: an ID, its size in 8 bytes, its content.
const idBytes = (id) => { const b = []; for (let v = id; v > 0; v = Math.floor(v / 256)) b.unshift(v % 256); return b; };
const el = (id, ...content) => {
  const body = bytes(...content);
  const size = [0x01, 0, 0, 0, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255];
  return bytes(idBytes(id), size, body);
};
const block = (track, rel, text) => bytes([0x80 | track, (rel >> 8) & 255, rel & 255, 0], text);

function mkvFile(subCodec, payloads, flags = []) {
  const head = el(0x1a45dfa3, el(0x4282, 'matroska'));
  const tracks = el(0x1654ae6b,
    el(0xae, el(0xd7, [1]), el(0x83, [1]), el(0x86, 'V_VP9')),
    el(0xae, el(0xd7, [2]), el(0x83, [17]), el(0x86, subCodec), el(0x22b59c, 'eng'), el(0x536e, 'English'), ...flags));
  const groups = payloads.map(([ms, dur, text]) => el(0xa0, el(0xa1, block(2, ms, text)), el(0x9b, [(dur >> 8) & 255, dur & 255])));
  const cluster = el(0x1f43b675, el(0xe7, [0]),
    el(0xa3, block(1, 0, 'video frame')), // not a subtitle
    el(0xa0, el(0xa1, block(1, 1, 'more video')), el(0x9b, [0x40, 0])), // and its length isn't a line's
    ...groups);
  return new File([bytes(head, el(0x18538067, tracks, cluster))], 'test.mkv');
}

const probeSubs = async (file) => (await run({ cmd: 'probe', file })).end.subs;
const readSubs = (file, track = 0) => run({ cmd: 'subs', file, track });

test('lists a Matroska file’s subtitle tracks', async () => {
  const [t] = await probeSubs(mkvFile('S_TEXT/UTF8', [], [el(0x55aa, [1]), el(0x55ab, [1])]));
  assert.deepEqual(t, { codec: 'SRT', text: true, scan: true, lang: 'eng', name: 'English', default: true, forced: true, hearing: true });
  const [p] = await probeSubs(mkvFile('S_HDMV/PGS', []));
  assert.equal(p.codec, 'PGS');
  assert.equal(p.text, false);
});

test('reads a Matroska subtitle track, with each line’s length', async () => {
  const { end } = await readSubs(mkvFile('S_TEXT/UTF8', [[1000, 2000, 'Héllo'], [4000, 500, 'There']]));
  assert.equal(end.type, 'subs');
  assert.deepEqual(end.cues, [{ start: 1, end: 3, text: 'Héllo' }, { start: 4, end: 4.5, text: 'There' }]);
});

test('reads ASS and WebM subtitles’ words', async () => {
  const ass = await readSubs(mkvFile('S_TEXT/ASS', [[0, 100, '3,0,Default,,0,0,0,,Well, hello']]));
  assert.equal(ass.end.cues[0].text, 'Well, hello');
  const webm = await readSubs(mkvFile('D_WEBVTT/SUBTITLES', [[0, 100, '\nline:90%\nHello\nthere']]));
  assert.equal(webm.end.cues[0].text, 'Hello\nthere');
});

test('a subtitle read rests while it’s told to hold', async () => {
  self.onmessage({ data: { cmd: 'pace', pace: 'hold' } });
  let finished = false;
  const reading = readSubs(mkvFile('S_TEXT/UTF8', [[1000, 2000, 'Hello']])).then((r) => { finished = true; return r; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(finished, false, 'nothing is read while the video plays');
  self.onmessage({ data: { cmd: 'pace', pace: 'go' } });
  assert.equal((await reading).end.cues.length, 1);
});

test('won’t read pictures as words', async () => {
  const { end } = await readSubs(mkvFile('S_HDMV/PGS', [[0, 100, 'xx']]));
  assert.equal(end.type, 'unsupported');
});

// MP4: size, type, content.
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type, ...content) => { const body = bytes(...content); return bytes(u32(body.length + 8), type, body); };
const zero = (n) => new Array(n).fill(0);

function mp4Trak({ id, handler, entry, samples, base, tref = [] }) {
  // samples: [[duration, bytes]], one to a chunk, from offset base; 1000 ticks a second
  const offsets = [];
  let at = base;
  for (const [, b] of samples) { offsets.push(at); at += b.length; }
  const stbl = box('stbl',
    box('stsd', zero(4), u32(1), box(entry, zero(8))),
    box('stts', zero(4), u32(samples.length), samples.flatMap(([d]) => [...u32(1), ...u32(d)])),
    box('stsc', zero(4), u32(1), u32(1), u32(1), u32(1)),
    box('stsz', zero(4), u32(0), u32(samples.length), samples.flatMap(([, b]) => u32(b.length))),
    box('stco', zero(4), u32(samples.length), offsets.flatMap((o) => u32(o))));
  return box('trak',
    box('tkhd', zero(4), zero(8), u32(id), zero(68)),
    ...tref,
    box('mdia',
      box('mdhd', zero(12), u32(1000), zero(4), [0x15, 0xc7], zero(2)), // "eng"
      box('hdlr', zero(8), handler, zero(12), 'SubtitleHandler', [0]),
      box('minf', stbl)));
}

function mp4File(entry, lines, { handler = 'sbtl', extra = [] } = {}) {
  const ftyp = box('ftyp', 'isom', zero(4));
  const samples = lines.map(([d, b]) => [d, bytes(b)]);
  const size = (base) => box('moov', box('mvhd', zero(12), u32(1000), zero(84)), mp4Trak({ id: 1, handler, entry, samples, base }), ...extra).length;
  const base = ftyp.length + size(0) + 8;
  const moov = box('moov', box('mvhd', zero(12), u32(1000), zero(84)), mp4Trak({ id: 1, handler, entry, samples, base }), ...extra);
  return new File([bytes(ftyp, moov, box('mdat', ...samples.map(([, b]) => b)))], 'test.mp4');
}
const tx3g = (s) => { const b = new TextEncoder().encode(s); return bytes([b.length >> 8, b.length & 255], b); };

test('reads an MP4 text track, leaving out the pauses', async () => {
  const file = mp4File('tx3g', [[1000, tx3g('')], [2000, tx3g('Hello')], [500, tx3g('')], [1500, bytes(tx3g('There'), [0, 0, 0, 8], 'styl')]]);
  const [t] = await probeSubs(file);
  assert.equal(t.text, true);
  assert.equal(t.lang, 'eng');
  assert.equal(t.name, '');
  assert.equal(t.scan, false, 'an MP4’s index leads straight to the lines');
  const { end } = await readSubs(file);
  assert.deepEqual(end.cues, [{ start: 1, end: 3, text: 'Hello' }, { start: 3.5, end: 5, text: 'There' }]);
});

test('reads MP4 WebVTT', async () => {
  const cue = box('vttc', box('payl', 'Hello'));
  const { end } = await readSubs(mp4File('wvtt', [[1000, box('vtte')], [2000, cue]]));
  assert.deepEqual(end.cues, [{ start: 1, end: 3, text: 'Hello' }]);
});

test('leaves out an MP4 chapter track', async () => {
  const pointer = box('trak', box('tkhd', zero(4), zero(8), u32(9), zero(68)), box('tref', box('chap', u32(1))));
  assert.deepEqual(await probeSubs(mp4File('text', [[1000, tx3g('Chapter 1')]], { handler: 'text', extra: [pointer] })), []);
});

test('says closed captions in an MP4 can’t be read', async () => {
  const [t] = await probeSubs(mp4File('c608', [], { handler: 'clcp' }));
  assert.equal(t.codec, 'CEA-608');
  assert.equal(t.text, false);
});

// A Matroska file with one E-AC-3 track: tone.eac3, seven 32 ms frames of a 1 kHz tone.
function eac3File() {
  const bytes = readFileSync(new URL('./tone.eac3', import.meta.url));
  const size = (n) => [0x10 | (n >> 24), (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const el = (id, body) => [...id, ...size(body.length), ...body];
  const str = (s) => [...s].map((c) => c.charCodeAt(0));
  const f64 = (x) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x); return [...new Uint8Array(dv.buffer)]; };
  const track = el([0xae], [...el([0xd7], [1]), ...el([0x83], [2]), ...el([0x86], str('A_EAC3')),
    ...el([0xe1], [...el([0xb5], f64(48000)), ...el([0x9f], [2])])]);
  const blocks = [];
  for (let k = 0; k < 7; k++) blocks.push(...el([0xa3], [0x81, 0, k * 32, 0x80, ...bytes.subarray(k * 384, (k + 1) * 384)]));
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], [...el([0xe7], [0]), ...blocks]);
  const segment = el([0x18, 0x53, 0x80, 0x67], [...el([0x16, 0x54, 0xae, 0x6b], track), ...cluster]);
  return new File([new Uint8Array([...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], str('webm'))), ...segment])], 'test.mkv');
}

test('reads E-AC-3 without the browser’s decoders', async () => {
  const { end, peaks, max } = await run({ cmd: 'build', file: eac3File(), rate: 200 });
  assert.equal(end.type, 'done');
  assert.ok(Math.abs(peaks.length - 45) <= 2, `expected about 45 bins, got ${peaks.length}`);
  assert.ok(max > 0.05 && max <= 1.01, `peak level ${max}`);
});

test('cuts a clip out of E-AC-3', async () => {
  const { end } = await run({ cmd: 'clip', file: eac3File(), from: 0, to: 0.2 });
  assert.equal(end.type, 'clip');
  assert.ok(Math.abs(end.audio.length - 3200) <= 2, `got ${end.audio.length} samples`);
  assert.ok(end.audio.some((v) => Math.abs(v) > 0.02), 'the clip is silent');
});

test('a browser that can’t make Opus still gets the waveform, and says why there’s no sound', async () => {
  const { end, msgs, max } = await run({ cmd: 'build', file: eac3File(), rate: 200, mux: true });
  assert.equal(end.type, 'done');
  assert.ok(max > 0.05);
  assert.match(msgs.find((m) => m.type === 'audio').reason, /can’t make Opus/);
});

test('makes a stereo Opus M4A of E-AC-3, starting where the sound does', async () => {
  const seen = { frames: 0, channels: 0 };
  const opusHead = new Uint8Array([79, 112, 117, 115, 72, 101, 97, 100, 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]);
  globalThis.AudioData = class { constructor(o) { Object.assign(this, o); } close() {} };
  globalThis.AudioEncoder = class extends EventTarget {
    static isConfigSupported = async () => ({ supported: true });
    state = 'configured'; encodeQueueSize = 0;
    constructor({ output }) { super(); this.output = output; }
    configure(c) { assert.equal(c.codec, 'opus'); assert.equal(c.numberOfChannels, 2); }
    encode(a) {
      seen.frames += a.numberOfFrames;
      seen.channels = a.numberOfChannels;
      assert.ok(a.data.some((v) => v !== 0));
      const bytes = new Uint8Array([0xfc, 1, 2, 3]); // one 20 ms Opus frame
      this.output({ byteLength: 4, timestamp: a.timestamp, copyTo: (d) => d.set(bytes) }, { decoderConfig: { description: opusHead } });
    }
    flush() { return Promise.resolve(); }
    close() { this.state = 'closed'; }
  };
  try {
    const { end, msgs } = await run({ cmd: 'build', file: eac3File(), rate: 200, mux: true });
    assert.equal(end.type, 'done');
    const audio = msgs.find((m) => m.type === 'audio');
    assert.equal(audio.reason, undefined);
    assert.equal(audio.made, true);
    assert.match(audio.mime, /opus/);
    assert.equal(audio.start, 0);
    assert.equal(seen.channels, 2);
    assert.equal(seen.frames, 7 * 1536);
    const text = Buffer.from(await audio.blob.arrayBuffer()).toString('latin1');
    assert.ok(text.includes('Opus') && text.includes('dOps') && text.includes('mdat'));
  } finally {
    delete globalThis.AudioData;
    delete globalThis.AudioEncoder;
  }
});
