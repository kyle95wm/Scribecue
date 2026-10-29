// Runs Whisper speech to text for the web version of Scribecue, away from the page so
// transcribing never holds up the video or typing. It downloads transformers.js, its
// engine and an English Whisper model from Scribecue's own site (scripts/web-whisper.sh)
// and keeps them in the browser's storage, so they download once and then work offline.
//
// Messages in: { id, op: 'status' | 'download' | 'remove' | 'transcribe', ... }.
// Messages out: { id, ok, result | error }, and { op: 'progress', loaded, total } while
// downloading.

const BASE = new URL('../whisper/', import.meta.url);
const STORE = 'whisper-model'; // not "scribecue-…", which new versions clear out
const url = (name) => new URL(name, BASE).href;
const store = () => caches.open(STORE);

async function manifest() {
  const r = await fetch(url('whisper.json'), { cache: 'no-cache' }).catch(() => null);
  return r?.ok ? r.json() : null;
}

// What's on offer, and whether it's downloaded already. Without a connection, what's
// stored is all there is to go on.
async function status() {
  const c = await store();
  const list = await manifest();
  const stored = (await c.keys()).map((k) => k.url);
  const ready = list ? list.files.every((f) => stored.includes(url(f))) : stored.length > 0;
  return { offered: list ? { model: list.model, bytes: list.bytes } : null, ready };
}

async function download(report) {
  const list = await manifest();
  if (!list) throw new Error('Whisper isn’t available here');
  const c = await store();
  const need = [];
  for (const f of list.files) if (!(await c.match(url(f)))) need.push(f);
  let loaded = 0;
  for (const f of list.files) if (!need.includes(f)) loaded += +((await c.match(url(f))).headers.get('content-length') || 0);
  const total = list.bytes;
  for (const f of need) {
    const r = await fetch(url(f), { cache: 'no-cache' });
    if (!r.ok) throw new Error(`couldn’t download ${f} (${r.status})`);
    const parts = [];
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      report(Math.min(loaded, total), total);
    }
    const blob = new Blob(parts, { type: r.headers.get('content-type') || 'application/octet-stream' });
    await c.put(url(f), new Response(blob, { headers: { 'Content-Type': blob.type, 'Content-Length': String(blob.size) } }));
  }
  report(total, total);
}

async function remove() {
  pipe = null;
  await caches.delete(STORE);
}

// The model runs its encoder on the graphics chip where there is one, which is several
// times faster, and its decoder on the processor, which is faster for it at 8 bits.
let pipe = null;
function load() {
  pipe ||= (async () => {
    const list = await manifest();
    const model = list?.model || 'onnx-community/whisper-base.en';
    const read = async (n) => {
      const r = await (await store()).match(url(n));
      if (!r) throw new Error('Whisper isn’t downloaded');
      return r;
    };
    await read('transformers.min.js');
    const { pipeline, env } = await import(url('transformers.min.js'));
    // Everything comes from what's stored, never from Hugging Face.
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    env.remoteHost = url('models/');
    env.remotePathTemplate = '{model}/';
    env.fetch = async (u) => (await (await store()).match(String(u))) || new Response(null, { status: 404 });
    const wasm = env.backends.onnx.wasm;
    wasm.wasmPaths = { mjs: url('ort-wasm-simd-threaded.asyncify.mjs'), wasm: url('ort-wasm-simd-threaded.asyncify.wasm') };
    wasm.wasmBinary = await (await read('ort-wasm-simd-threaded.asyncify.wasm')).arrayBuffer();
    env.useWasmCache = false;
    const dtype = { encoder_model: 'fp32', decoder_model_merged: 'q8' };
    const gpu = await self.navigator.gpu?.requestAdapter().catch(() => null);
    if (gpu) {
      try {
        return await pipeline('automatic-speech-recognition', model, { dtype, device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' } });
      } catch { /* fall back to the processor */ }
    }
    return pipeline('automatic-speech-recognition', model, { dtype, device: 'wasm' });
  })();
  pipe.catch(() => { pipe = null; });
  return pipe;
}

async function transcribe({ audio }) {
  const p = await load();
  const out = await p(audio, { chunk_length_s: audio.length > 30 * 16000 ? 30 : 0, stride_length_s: 5 });
  return out.text || '';
}

// One job at a time, in order: a transcription keeps the engine busy.
let queue = Promise.resolve();
self.addEventListener('message', ({ data: m }) => {
  const reply = (p) => p.then(
    (result) => self.postMessage({ id: m.id, ok: true, result }),
    (err) => self.postMessage({ id: m.id, ok: false, error: String(err?.message || err) }),
  );
  if (m.op === 'status') return reply(status()); // doesn't wait for a download
  const run = {
    download: () => download((loaded, total) => self.postMessage({ op: 'progress', loaded, total })),
    remove: () => remove(),
    transcribe: () => transcribe(m),
    warm: () => load().then(() => true),
  }[m.op] || (() => Promise.reject(new Error(`unknown request ${m.op}`)));
  queue = queue.then(() => reply(run()));
});
