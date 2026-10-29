// Runs Piper for the web version of Scribecue (see piper-engine.js), away from the page
// so reading a block never holds up the video or typing. It also downloads the engine
// and voices from Scribecue's own site and keeps them in the browser's storage, so they
// download once and then work offline.
//
// Messages in: { id, op: 'status' | 'download' | 'remove' | 'synthesize', ... }.
// Messages out: { id, ok, result | error }, and { op: 'progress', voice, loaded, total }
// while downloading.
import { createEngine } from './piper-engine.js';

const BASE = new URL('../piper/', import.meta.url);
const STORE = 'piper-voices'; // not "scribecue-…", which new versions clear out
const ENGINE = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
  'piper_phonemize.mjs', 'piper_phonemize.wasm', 'piper_phonemize.data'];
const voiceFiles = (v) => [`${v}.onnx.json`, `${v}.onnx`];
const url = (name) => new URL(name, BASE).href;

const store = () => caches.open(STORE);
const has = async (names) => {
  const c = await store();
  for (const n of names) if (!(await c.match(url(n)))) return false;
  return true;
};
const read = async (name) => {
  const r = await (await store()).match(url(name));
  if (!r) throw new Error(`${name} isn’t downloaded`);
  return r;
};

// The voices on offer, with sizes, and which are downloaded already.
async function status() {
  const r = await fetch(url('voices.json'), { cache: 'no-cache' }).catch(() => null);
  const list = r?.ok ? await r.json() : null;
  const c = await store();
  const downloaded = [];
  for (const k of await c.keys()) {
    const m = k.url.match(/([^/]+)\.onnx$/);
    if (m && await c.match(url(`${m[1]}.onnx.json`))) downloaded.push(decodeURIComponent(m[1]));
  }
  return { offered: list?.voices || null, engine: list?.engine || 0, engineReady: await has(ENGINE), downloaded };
}

// Downloads what this voice needs that isn't stored yet, reporting progress as it goes.
async function download(voice, report) {
  const c = await store();
  const need = [];
  for (const n of [...ENGINE, ...voiceFiles(voice)]) if (!(await c.match(url(n)))) need.push(n);
  const heads = await Promise.all(need.map((n) => fetch(url(n), { cache: 'no-cache' })));
  heads.forEach((r, i) => { if (!r.ok) throw new Error(`couldn’t download ${need[i]} (${r.status})`); });
  // Sizes from the voice list, since a compressed download's own length is the smaller
  // compressed one.
  const { offered, engine: engineSize } = await status();
  let total = (need.some((n) => ENGINE.includes(n)) ? engineSize : 0) + (need.some((n) => n.endsWith('.onnx')) ? offered?.[voice] || 0 : 0);
  let loaded = 0;
  for (let i = 0; i < need.length; i++) {
    const parts = [];
    const reader = heads[i].body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      total = Math.max(total, loaded);
      report(loaded, total);
    }
    const type = heads[i].headers.get('content-type') || 'application/octet-stream';
    await c.put(url(need[i]), new Response(new Blob(parts, { type }), { headers: { 'Content-Type': type } }));
  }
  report(total, total);
}

async function remove(voice) {
  const c = await store();
  for (const n of voiceFiles(voice)) await c.delete(url(n));
  engine?.then((e) => e.removeVoice(voice), () => {});
  // The engine goes too once no voice is left to use it.
  if (!(await status()).downloaded.length) for (const n of ENGINE) await c.delete(url(n));
}

let engine = null;
function loadEngine() {
  engine ||= (async () => {
    const buf = async (n) => (await read(n)).arrayBuffer();
    const [ort, phon] = await Promise.all([import(url('ort.wasm.min.mjs')), import(url('piper_phonemize.mjs'))]);
    ort.env.wasm.wasmPaths = { mjs: url('ort-wasm-simd-threaded.mjs'), wasm: url('ort-wasm-simd-threaded.wasm') };
    return createEngine({
      ort, createPhonemize: phon.default,
      phonemizeWasm: await buf('piper_phonemize.wasm'), phonemizeData: await buf('piper_phonemize.data'),
      ortWasm: await buf('ort-wasm-simd-threaded.wasm'),
    });
  })();
  engine.catch(() => { engine = null; });
  return engine;
}

async function synthesize({ voice, text, speed }) {
  const e = await loadEngine();
  if (!e.hasVoice(voice)) {
    const [model, config] = await Promise.all([read(`${voice}.onnx`).then((r) => r.arrayBuffer()), read(`${voice}.onnx.json`).then((r) => r.json())]);
    await e.addVoice(voice, model, config);
  }
  return e.synthesize(voice, text, speed);
}

// Loads the engine and a voice ahead of the first reading, which would otherwise wait for it.
async function warm({ voice }) {
  await synthesize({ voice, text: '.', speed: 1 }).catch(() => {});
}

// One download or reading at a time: the engine has a single thread. The page sends one
// job at a time and keeps the rest in order itself, since a reading holds this thread
// and requests sent meanwhile would only be seen once it's done.
const jobs = [];
let running = false;
async function pump() {
  if (running) return;
  running = true;
  while (jobs.length) {
    const { m, run } = jobs.shift();
    await run().then(
      (result) => self.postMessage({ id: m.id, ok: true, result }, result instanceof ArrayBuffer ? [result] : []),
      (err) => self.postMessage({ id: m.id, ok: false, error: String(err?.message || err) }),
    );
  }
  running = false;
}
self.addEventListener('message', ({ data: m }) => {
  const run = {
    status: () => status(),
    download: () => download(m.voice, (loaded, total) => self.postMessage({ op: 'progress', voice: m.voice, loaded, total })),
    remove: () => remove(m.voice),
    synthesize: () => synthesize(m),
    warm: () => warm(m),
  }[m.op] || (() => Promise.reject(new Error(`unknown request ${m.op}`)));
  // Checking what's downloaded doesn't wait for a download or reading to finish.
  if (m.op === 'status') {
    status().then((result) => self.postMessage({ id: m.id, ok: true, result }), (err) => self.postMessage({ id: m.id, ok: false, error: String(err?.message || err) }));
    return;
  }
  jobs.push({ m, run });
  pump();
});
