// Portable QC files contain a project and individually sliced WAV readings. No video
// or voice credentials are included. The manifest is at the end, so export can stream.
import { fromProject } from './project.js';
export const REVIEW_EXT = '.scribecueqc';
const MAGIC = 'SCQC0001', FOOTER = 12, MAX_MANIFEST = 16 * 1024 * 1024;
const bytes = (s) => new TextEncoder().encode(s);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export const isReview = (name) => String(name).toLowerCase().endsWith(REVIEW_EXT);
export const readingKey = (b, s = {}) => JSON.stringify([b.text, b.say || [], b.speed || 1,
  b.voice || s.ttsVoice || '', s.ttsBase ?? 1, s.ttsSkipNotes === true]);
export function hasReviewText(block, settings = {}) {
  let text = String(block.text || '').replace(/<[^>]*>|\{[^}]*\}/g, '');
  if (settings.ttsSkipNotes) text = text.replace(/\[[^\]]*\]/g, ' ');
  return !!text.trim();
}
export function voiceReport(blocks, settings, available) {
  const byId = new Map(available.map((v) => [v.id, v]));
  const used = new Map();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]; if (!hasReviewText(b, settings)) continue;
    const id = b.voice || settings.ttsVoice || '';
    if (!used.has(id)) used.set(id, { id, available: byId.has(id), exportable: !!byId.get(id)?.exportable, blocks: [] });
    used.get(id).blocks.push(i + 1);
  }
  return [...used.values()];
}
// Early packages included timeline times in the key. Audio can move independently.
const audioKey = (key) => {
  try { const parts = JSON.parse(key); return Array.isArray(parts) && parts.length === 8 ? JSON.stringify(parts.slice(2)) : key; }
  catch { return key; }
};
export function previousReading(review, block) {
  return review?.byOffset?.get(block.qcReading) || null;
}
export function reviewReading(review, block, settings) {
  if (!review) return null;
  const key = readingKey(block, settings), previous = previousReading(review, block);
  if (previous) return audioKey(previous.key) === key ? previous : null;
  return review.index.get(key) || null;
}
function trailer(length) {
  const out = new Uint8Array(FOOTER);
  new DataView(out.buffer).setUint32(0, length, true); out.set(bytes(MAGIC), 4); return out;
}
function manifestParts(project, readings) {
  const json = bytes(JSON.stringify({ review: 1, project, readings }));
  if (json.byteLength > MAX_MANIFEST) throw new Error('This review has too much project information');
  return [json, trailer(json.byteLength)];
}
export function resaveReview(review, project) {
  return new Blob([review.file.slice(0, review.audioEnd), ...manifestParts(project, review.readings)], { type: 'application/octet-stream' });
}
export async function readReview(file) {
  if (file.size < 20) throw new Error('This isn’t a Scribecue QC package');
  const footer = new Uint8Array(await file.slice(-FOOTER).arrayBuffer());
  if (new TextDecoder().decode(footer.slice(4)) !== MAGIC || await file.slice(0, 8).text() !== MAGIC) throw new Error('This isn’t a Scribecue QC package');
  const length = new DataView(footer.buffer).getUint32(0, true), end = file.size - FOOTER;
  if (!length || length > MAX_MANIFEST || end - length < 8) throw new Error('The QC package is damaged');
  const audioEnd = end - length;
  let m; try { m = JSON.parse(await file.slice(audioEnd, end).text()); } catch { throw new Error('The QC package is damaged'); }
  if (m.review !== 1) throw new Error('This QC package needs a newer Scribecue version');
  const parsed = fromProject(m.project); // Check the script before exposing any audio.
  if (!Array.isArray(m.readings) || m.readings.length > 100000) throw new Error('The QC readings are damaged');
  let at = 8;
  const index = new Map(), byOffset = new Map();
  for (const r of m.readings) {
    if (!r || typeof r.key !== 'string' || !Number.isSafeInteger(r.offset) || !Number.isSafeInteger(r.bytes) ||
      r.offset !== at || r.bytes < 44 || r.offset + r.bytes > audioEnd || !finite(r.secs) || r.secs <= 0 || typeof r.voice !== 'string') throw new Error('The QC readings are damaged');
    index.set(audioKey(r.key), r); byOffset.set(r.offset, r); at += r.bytes;
  }
  if (at !== audioEnd) throw new Error('The QC readings are damaged');
  return { file, project: m.project, parsed, readings: m.readings, audioEnd, index, byOffset };
}
// Package metadata is parsed and checked off the page for long reviews.
export async function openReview(file) {
  if (typeof Worker === 'undefined') return readReview(file);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./qc-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.review); };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'The QC package could not be opened')); };
    worker.postMessage(file);
  });
}
// sink: optional disk writer with write/close/abort/file. Without one, Blob parts are
// still individual readings, never a decoded full-film track.
export async function buildReview(project, make, { sink = null, progress = () => {}, signal } = {}) {
  project = { ...project, blocks: project.blocks.map(({ qcReading, ...b }) => b) };
  const parts = [], readings = [];
  const write = async (part) => { if (sink) await sink.write(part); else parts.push(part); };
  let offset = 8;
  try {
    await write(bytes(MAGIC));
    for (let i = 0; i < project.blocks.length; i++) {
      if (signal?.aborted) throw new Error('QC export stopped');
      const b = project.blocks[i]; progress(i, project.blocks.length);
      if (hasReviewText(b, project.settings)) {
        const made = await make(b, i);
        if (signal?.aborted) throw new Error('QC export stopped');
        if (!made) throw new Error('A reading could not be packaged');
        if (made) {
          if (typeof made.voice !== 'string' || !(made.blob instanceof Blob) || made.blob.size < 44 || !finite(made.secs) || made.secs <= 0) throw new Error('A reading could not be packaged');
          readings.push({ key: readingKey(b, project.settings), offset, bytes: made.blob.size, secs: made.secs, voice: made.voice });
          await write(made.blob); offset += made.blob.size;
        }
      }
      // Yield between readings even if they were already cached.
      await new Promise((r) => setTimeout(r, 0));
    }
    if (signal?.aborted) throw new Error('QC export stopped');
    for (const part of manifestParts(project, readings)) await write(part);
    if (signal?.aborted) throw new Error('QC export stopped');
    progress(project.blocks.length, project.blocks.length);
    if (sink) { await sink.close(); return sink.file(); }
    return new Blob(parts, { type: 'application/octet-stream' });
  } catch (e) { if (sink) await sink.abort().catch(() => {}); throw e; }
}

// Keep the package in browser recovery without loading or decoding its audio.
export async function storedReview(value, key = 'current') {
  return new Promise((resolve) => {
    try {
      const q = indexedDB.open('scribecue-qc', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('packages');
      q.onerror = () => resolve(null);
      q.onsuccess = () => {
        const db = q.result;
        try {
        const tx = db.transaction('packages', value === undefined ? 'readonly' : 'readwrite');
        const store = tx.objectStore('packages');
        const r = value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value, key);
        let out = null; r.onsuccess = () => { out = value === undefined ? r.result : true; };
        tx.oncomplete = () => { db.close(); resolve(out); }; tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
        } catch { db.close(); resolve(null); }
      };
    } catch { resolve(null); }
  });
}
export async function reviewSink() {
  if (!navigator.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  const name = 'qc-export-' + crypto.randomUUID();
  const handle = await root.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  return { write: (part) => writer.write(part), close: () => writer.close(),
    abort: async () => { try { await writer.abort(); } finally { await root.removeEntry(name).catch(() => {}); } },
    file: () => handle.getFile(), clean: () => root.removeEntry(name).catch(() => {}) };
}
