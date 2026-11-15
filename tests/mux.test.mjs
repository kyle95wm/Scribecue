// The full mix in the video without ffmpeg: muxplan.js, and mux-worker.js run under Node with
// Mediabunny as the browser loads it. Node has no AAC encoder of its own, so this also tries
// the WebAssembly one that browsers without AAC get. tiny.mp4: 2 s of H.264, with two AAC
// tracks, the second marked French.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInThisContext } from 'node:vm';
import { createRequire } from 'node:module';
import { OUT_FORMATS, canMux, mixCodec, mixMetadata, wavInfo, nextStream, copiedMetadata } from '../app/js/muxplan.js';
import { CMD_VIDEOS } from '../app/js/ffcmd.js';
import { PICKERS, videoOut } from '../app/js/pickers.js';

const app = (f) => new URL(`../app/${f}`, import.meta.url);
let sink = () => {};
globalThis.self = globalThis;
// Under Node, the AAC encoder runs in a worker thread, which it finds with require.
globalThis.require = createRequire(import.meta.url);
globalThis.postMessage = (m) => sink(m);
globalThis.importScripts = (...fs) => { for (const f of fs) runInThisContext(readFileSync(new URL(f, app('js/')), 'utf8'), { filename: f }); };
await import('../app/js/mux-worker.js');
const M = globalThis.Mediabunny;

// A 16-bit WAV, optionally with a LIST chunk before the samples, as ffmpeg writes.
function wav(secs, { channels = 2, rate = 48000, list = false, bits = 16, format = 1 } = {}) {
  const frames = Math.round(secs * rate), data = frames * channels * 2, extra = list ? 12 : 0;
  const dv = new DataView(new ArrayBuffer(44 + extra + data));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + extra + data, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, format, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * channels * 2, true); dv.setUint16(32, channels * 2, true); dv.setUint16(34, bits, true);
  if (list) { str(36, 'LIST'); dv.setUint32(40, 4, true); str(44, 'INFO'); }
  str(36 + extra, 'data'); dv.setUint32(40 + extra, data, true);
  for (let i = 0; i < frames * channels; i++) dv.setInt16(44 + extra + i * 2, Math.round(8000 * Math.sin(i / channels * 0.06)), true);
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

// A file handle like the save picker's, writing into memory.
function handle() {
  let bytes = new Uint8Array(0), closed = false;
  return {
    createWritable: async () => new WritableStream({
      write({ data, position }) {
        if (position + data.length > bytes.length) { const b = new Uint8Array(position + data.length); b.set(bytes); bytes = b; }
        bytes.set(data, position);
      },
      close() { closed = true; },
    }),
    file: () => new Blob([bytes]),
    closed: () => closed,
  };
}

const run = (job) => new Promise((ok) => {
  const progress = [];
  sink = (m) => { if (m.type === 'progress') progress.push(m.done); else ok({ ...m, progress }); };
  self.onmessage({ data: job });
});
const tiny = () => new File([readFileSync(new URL('tiny.mp4', import.meta.url))], 'tiny.mp4');
const read = async (blob) => {
  const input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
  return Promise.all((await input.getTracks()).map(async (t) => ({ type: t.type, codec: t.codec, lang: t.languageCode,
    name: t.name, packets: (await new M.EncodedPacketSink(t).getFirstPacket()) ? 1 : 0, secs: await t.computeDuration() })));
};

test('it works with the videos ffmpeg commands are given for', () => {
  assert.deepEqual(Object.keys(OUT_FORMATS).sort(), [...CMD_VIDEOS].sort());
  for (const f of Object.values(OUT_FORMATS)) assert.equal(typeof M[f], 'function');
  assert.ok(canMux('mkv'));
  assert.ok(!canMux('ts'));
  assert.ok(!canMux('constructor'));
});

test('the mix is AAC as ffmpeg makes it, or 48 kHz Opus in a WebM', () => {
  assert.deepEqual(mixCodec('mp4'), { codec: 'aac', bitrate: 256000 });
  assert.deepEqual(mixCodec('webm'), { codec: 'opus', bitrate: 192000, sampleRate: 48000 });
});

test('an extra track is marked as audio description; in place of the sound, it is the default', () => {
  assert.deepEqual(mixMetadata(false), { name: 'Audio description', disposition: { default: false, visuallyImpaired: true } });
  assert.deepEqual(mixMetadata(true), { disposition: { default: true } });
});

test('the WAV’s samples are found after any other chunk, and only 16-bit PCM is taken', async () => {
  const dv = async (b) => new DataView(await b.arrayBuffer());
  assert.deepEqual(wavInfo(await dv(wav(0.01))), { channels: 2, rate: 48000, start: 44, bytes: 1920 });
  assert.deepEqual(wavInfo(await dv(wav(0.01, { list: true, channels: 1, rate: 44100 }))), { channels: 1, rate: 44100, start: 56, bytes: 882 });
  await assert.rejects(async () => wavInfo(await dv(wav(0.01, { bits: 24 }))), /16-bit/);
  await assert.rejects(async () => wavInfo(await dv(wav(0.01, { format: 3 }))), /16-bit/);
  await assert.rejects(async () => wavInfo(new DataView(new ArrayBuffer(12))), /isn’t a WAV/);
});

test('the earliest stream goes next, and ended ones are skipped', () => {
  assert.equal(nextStream([2, 1, 3]), 1);
  assert.equal(nextStream([null, 5, 4]), 2);
  assert.equal(nextStream([0, 0]), 0);
  assert.equal(nextStream([null, null]), -1);
});

test('copied tracks keep their language, name, marks and rotation, but not "und"', () => {
  assert.deepEqual(copiedMetadata({ languageCode: 'und', name: null, disposition: { default: true }, rotation: 0 }), { disposition: { default: true } });
  assert.deepEqual(copiedMetadata({ languageCode: 'fra', name: 'VF', rotation: 90 }), { languageCode: 'fra', name: 'VF', rotation: 90 });
});

test('the save picker offers the video’s own type', () => {
  assert.equal(PICKERS.videoOut.kind, 'save');
  assert.deepEqual(videoOut('mkv'), [{ description: 'Video', accept: { 'video/x-matroska': ['.mkv'] } }]);
  assert.deepEqual(videoOut('mov'), [{ description: 'Video', accept: { 'video/quicktime': ['.mov'] } }]);
});

test('Mediabunny and its AAC encoder are 1.66.0, unchanged', () => {
  const sum = (f) => createHash('sha256').update(readFileSync(app(f))).digest('hex');
  assert.equal(sum('vendor/mediabunny.js'), '515308bfb924787acc9247f3f9da759ec78cce93b67a5037ed08f9ae46849ea1');
  assert.equal(sum('vendor/mediabunny-aac.js'), '5c336845cbd7eca2b9abfb080f696b10c2be9b53a23662c69d6da14083b2620a');
  const licence = readFileSync(app('vendor/mediabunny-LICENSE.txt'), 'utf8');
  assert.match(licence, /Mozilla Public License/);
  assert.match(licence, /Lesser General Public License/);
});

test('as an extra track: the picture and both sound tracks are copied, and the mix comes last', async () => {
  const out = handle();
  const r = await run({ video: tiny(), mix: wav(2, { list: true }), handle: out, ext: 'mp4', replace: false });
  assert.equal(r.type, 'done', r.message);
  assert.equal(r.wasmAac, true);
  assert.ok(out.closed());
  assert.ok(r.progress.length > 2 && r.progress.at(-1) > 0.9);
  const tracks = await read(out.file());
  assert.deepEqual(tracks.map((t) => [t.type, t.codec, t.lang, t.name]), [
    ['video', 'avc', 'und', null], ['audio', 'aac', 'und', null], ['audio', 'aac', 'fra', null], ['audio', 'aac', 'und', 'Audio description'],
  ]);
  for (const t of tracks) assert.ok(Math.abs(t.secs - 2) < 0.1, `${t.type} lasts ${t.secs}`);
});

test('in place of its sound: the picture and the mix only, in an MKV too', async () => {
  const out = handle();
  const r = await run({ video: tiny(), mix: wav(2), handle: out, ext: 'mkv', replace: true });
  assert.equal(r.type, 'done', r.message);
  const tracks = await read(out.file());
  assert.deepEqual(tracks.map((t) => [t.type, t.codec]), [['video', 'avc'], ['audio', 'aac']]);
});

test('a video whose picture the file type can’t hold says so', async () => {
  const r = await run({ video: tiny(), mix: wav(2), handle: handle(), ext: 'webm', replace: false });
  assert.equal(r.type, 'error');
  assert.match(r.message, /a \.webm file can’t hold its AVC picture/);
});
