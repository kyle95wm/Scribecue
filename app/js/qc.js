// Portable QC files contain a project and individually sliced WAV readings. No video
// is included. An optional review key stays outside the project and its baseline.
import { collaborationJob } from './collaboration.js';
import { hashReading, prepareReviewBaseline } from './qcreview.js';
import { fromProject, validIdentity, validRevision } from './project.js';
import { speechSpec, speechKey, sameSpeech, rewriteOf, additionOf, rereads } from './qcspeech.js';
import { isPollyVoice, validPollyKey } from './polly.js';
export const REVIEW_EXT = '.scribecueqc';
const MAGIC = 'SCQC0001', FOOTER = 12, MAX_MANIFEST = 16 * 1024 * 1024;
const bytes = (s) => new TextEncoder().encode(s);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export const reviewAllowsEdits = (review) => review?.permissions?.allowEdits === true;
export const isReview = (name) => String(name).toLowerCase().endsWith(REVIEW_EXT);
export const readingKey = (b, s = {}) => JSON.stringify([b.text, b.say || [], b.speed || 1,
  b.voice || s.ttsVoice || '', s.ttsBase ?? 1, s.ttsSkipNotes === true]);
export function hasReviewText(block, settings = {}) {
  let text = String(block.text || '').replace(/<[^>]*>|\{[^}]*\}/g, '');
  if (settings.ttsSkipNotes) text = text.replace(/\[[^\]]*\]/g, ' ');
  return !!text.trim();
}
// Anyone can download a Piper voice, so a package leaves its audio out and the reviewer's
// computer reads those blocks. Google needs a key and Kokoro needs Docker, so theirs stays in.
export const readsLive = (block, settings = {}) => String(block.voice || settings.ttsVoice || '').startsWith('piper:');
export const liveBlock = (review, block, settings = {}) => !!review?.live && readsLive(block, settings) && hasReviewText(block, settings);
export const liveVoices = (review, blocks, settings = {}) => [...new Set(blocks.filter((b) => liveBlock(review, b, settings)).map((b) => b.voice || settings.ttsVoice))];
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
  return review?.byOffset?.get(block.qcReading) || review?.byUid?.get(block.uid) || null;
}
// Google and Polly readings compare the words actually spoken and the effective speed. A
// placement, gain, dip or formatting change cannot create a synthesis request.
export function playbackReading(review, block, settings) {
  const original = previousReading(review, block), key = readingKey(block, settings);
  const before = speechSpec(original?.key), after = speechSpec(key);
  if (rereads(before?.voice) && sameSpeech(before, after)) return original;
  const rewrite = rewriteOf(original, key);
  if (rewrite) return review.proposalIndex?.get(JSON.stringify([original.offset, speechKey(rewrite)])) || null;
  const found = reviewReading(review, block, settings), added = !original && !found && addedSpec(review, block, settings);
  return found || (added && review.proposalIndex?.get(JSON.stringify([block.uid, speechKey(added)]))) || null;
}
// A block added during review, in a package made for handoff: it can be read in one of the
// package's own Google or Polly voices.
export function addedSpec(review, block, settings) {
  if (!reviewAllowsEdits(review) || !review.byUid?.size || !validIdentity(block?.uid) || previousReading(review, block)) return null;
  return additionOf(review.rereadVoices, readingKey(block, settings));
}
// A reviewer chose another voice. Its audio can only come from a fresh package.
export function readingVoiceChanged(review, block, settings) {
  const original = previousReading(review, block);
  const before = speechSpec(original?.key)?.voice ?? original?.voice, after = speechSpec(readingKey(block, settings))?.voice;
  return !!original && !!before && !!after && before !== after;
}
export function rewriteSpec(review, block, settings) {
  if (!reviewAllowsEdits(review)) return null;
  const original = previousReading(review, block);
  return original ? rewriteOf(original, readingKey(block, settings)) : addedSpec(review, block, settings);
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
// access: the review keys, { googleKey, polly }, either or both.
function manifestParts(project, readings, allowEdits = false, baselineId = null, proposals = [], access = null, live = false) {
  const { reviewAudio, ...packageProject } = project;
  // Readings for added blocks need version 4, so older versions say to update rather than fail.
  // Version 6 is Polly's readings and keys, which older versions would call damaged.
  const version = access?.polly || proposals.some((r) => isPollyVoice(r.voice)) ? 6
    : live ? 5 : proposals.some((r) => r.originalOffset == null) ? 4 : proposals.length || access?.googleKey ? 3 : 2;
  const reviewKeys = access?.googleKey || access?.polly ? { ...(access.googleKey ? { googleKey: access.googleKey } : {}), ...(access.polly ? { polly: access.polly } : {}) } : null;
  const json = bytes(JSON.stringify({ review: version, ...(baselineId ? { reviewBaseline: baselineId } : {}), permissions: { allowEdits: allowEdits === true }, project: packageProject, readings,
    ...(proposals.length ? { proposals } : {}), ...(reviewKeys && allowEdits ? { reviewAccess: reviewKeys } : {}), ...(live ? { live: true } : {}) }));
  if (json.byteLength > MAX_MANIFEST) throw new Error('This review has too much project information');
  return [json, trailer(json.byteLength)];
}
export function resaveReview(review, project, { includeReviewKey = false } = {}) {
  return new Blob([review.file.slice(0, review.audioEnd), ...manifestParts(project, review.readings, reviewAllowsEdits(review), review.baselineId, review.proposals, includeReviewKey ? review.reviewAccess : null, review.live)], { type: 'application/octet-stream' });
}
export async function appendRewrite(review, project, block, made) {
  const spec = rewriteSpec(review, block, project.settings), original = previousReading(review, block);
  if (!spec || made.voice !== spec.voice || !(made.blob instanceof Blob) || made.blob.size < 44 || !(made.secs > 0)) throw new Error('This block cannot use a new reading');
  if (playbackReading(review, block, project.settings)) return review;
  const proposal = { ...(original ? { originalOffset: original.offset } : { blockUid: block.uid }), key: readingKey(block, project.settings), offset: review.audioEnd,
    bytes: made.blob.size, secs: made.secs, voice: spec.voice, sha: await hashReading(made.blob) };
  const file = new Blob([review.file.slice(0, review.audioEnd), made.blob,
    ...manifestParts(project, review.readings, true, review.baselineId, [...review.proposals, proposal], review.reviewAccess, review.live)], { type: 'application/octet-stream' });
  return openReview(file);
}
export async function readReview(file) {
  if (file.size < 20) throw new Error('This isn’t a Scribecue QC package');
  const footer = new Uint8Array(await file.slice(-FOOTER).arrayBuffer());
  if (new TextDecoder().decode(footer.slice(4)) !== MAGIC || await file.slice(0, 8).text() !== MAGIC) throw new Error('This isn’t a Scribecue QC package');
  const length = new DataView(footer.buffer).getUint32(0, true), end = file.size - FOOTER;
  if (!length || length > MAX_MANIFEST || end - length < 8) throw new Error('The QC package is damaged');
  const audioEnd = end - length;
  let m; try { m = JSON.parse(await file.slice(audioEnd, end).text()); } catch { throw new Error('The QC package is damaged'); }
  if (![1, 2, 3, 4, 5, 6].includes(m.review)) throw new Error('This QC package needs a newer Scribecue version');
  if (m.reviewBaseline != null && !validRevision(m.reviewBaseline)) throw new Error('The QC starting point is damaged');
  const parsed = fromProject(m.project); // Check the script before exposing any audio.
  if (!Array.isArray(m.readings) || m.readings.length > 100000) throw new Error('The QC readings are damaged');
  let at = 8;
  const index = new Map(), byOffset = new Map(), byUid = new Map();
  for (const r of m.readings) {
    if (!r || typeof r.key !== 'string' || !Number.isSafeInteger(r.offset) || !Number.isSafeInteger(r.bytes) ||
      r.offset !== at || r.bytes < 44 || r.offset + r.bytes > audioEnd || !finite(r.secs) || r.secs <= 0 || typeof r.voice !== 'string') throw new Error('The QC readings are damaged');
    index.set(audioKey(r.key), r); byOffset.set(r.offset, r); if (r.blockUid) byUid.set(r.blockUid, r); at += r.bytes;
  }
  const proposals = m.review >= 3 ? m.proposals || [] : [], proposalIndex = new Map();
  const rereadVoices = new Set(m.readings.map((r) => r.voice).filter(rereads));
  if (!Array.isArray(proposals) || proposals.length > 100000) throw new Error('The QC rewrites are damaged');
  for (const r of proposals) {
    const added = r?.originalOffset == null;
    const spec = !r ? null : !added ? rewriteOf(byOffset.get(r.originalOffset), r.key)
      : m.review >= 4 && byUid.size && validIdentity(r.blockUid) && !byUid.has(r.blockUid) ? additionOf(rereadVoices, r.key) : null;
    if (!spec || r.voice !== spec.voice || r.offset !== at || !Number.isSafeInteger(r.bytes) || r.bytes < 44 ||
      at + r.bytes > audioEnd || !finite(r.secs) || r.secs <= 0 || !validRevision(r.sha) || m.permissions?.allowEdits !== true) throw new Error('The QC rewrites are damaged');
    const key = JSON.stringify([added ? r.blockUid : r.originalOffset, speechKey(spec)]);
    if (proposalIndex.has(key)) throw new Error('The QC rewrites are damaged');
    proposalIndex.set(key, r); at += r.bytes;
  }
  if (at !== audioEnd) throw new Error('The QC readings are damaged');
  let reviewAccess = null;
  if (m.review >= 3 && m.reviewAccess != null) {
    const key = m.reviewAccess.googleKey, polly = m.reviewAccess.polly;
    const goodGoogle = typeof key === 'string' && !!key.trim() && key.length <= 512 && !/\s/.test(key);
    if (m.permissions?.allowEdits !== true || (key != null && !goodGoogle) || (polly != null && !(m.review >= 6 && validPollyKey(polly))) || (key == null && polly == null)) throw new Error('The QC review key is damaged');
    reviewAccess = { ...(key != null ? { googleKey: key } : {}), ...(polly != null ? { polly } : {}) };
  }
  return { file, live: m.review >= 5 && m.live === true, baselineId: m.reviewBaseline || null, project: m.project, parsed, readings: m.readings, proposals, proposalIndex, rereadVoices, reviewAccess, audioEnd, index, byOffset, byUid, permissions: { allowEdits: m.review >= 2 && m.permissions?.allowEdits === true } };
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
export async function buildReview(project, make, { sink = null, progress = () => {}, signal, allowEdits = false, handoff = false, googleReviewKey = '', pollyReviewKey = null } = {}) {
  if (googleReviewKey && (allowEdits !== true || typeof googleReviewKey !== 'string' || googleReviewKey.length > 512 || /\s/.test(googleReviewKey))) throw new Error('A review key needs an editable QC package and a valid key');
  if (pollyReviewKey && (allowEdits !== true || !validPollyKey(pollyReviewKey))) throw new Error('A review key needs an editable QC package and a valid key');
  project = { ...project, blocks: project.blocks.map(({ qcReading, ...b }) => b) };
  if (handoff && (!validIdentity(project.projectId) || project.blocks.some((b) => !validIdentity(b.uid)))) throw new Error('Save the project in this version before making a QC package');
  const parts = [], readings = [];
  let baselineId = null, live = false;
  const write = async (part) => { if (sink) await sink.write(part); else parts.push(part); };
  let offset = 8;
  try {
    await write(bytes(MAGIC));
    for (let i = 0; i < project.blocks.length; i++) {
      if (signal?.aborted) throw new Error('QC export stopped');
      const b = project.blocks[i]; progress(i, project.blocks.length);
      if (hasReviewText(b, project.settings) && readsLive(b, project.settings)) live = true;
      else if (hasReviewText(b, project.settings)) {
        const made = await make(b, i);
        if (signal?.aborted) throw new Error('QC export stopped');
        if (!made) throw new Error('A reading could not be packaged');
        if (made) {
          if (typeof made.voice !== 'string' || !(made.blob instanceof Blob) || made.blob.size < 44 || !finite(made.secs) || made.secs <= 0) throw new Error('A reading could not be packaged');
          readings.push({ key: readingKey(b, project.settings), offset, bytes: made.blob.size, secs: made.secs, voice: made.voice,
            ...(handoff ? { blockUid: b.uid, sha: await hashReading(made.blob) } : {}) });
          await write(made.blob); offset += made.blob.size;
        }
      }
      // Yield between readings even if they were already cached.
      await new Promise((r) => setTimeout(r, 0));
    }
    if (signal?.aborted) throw new Error('QC export stopped');
    if (handoff) {
      const prepared = typeof Worker === 'undefined' ? await prepareReviewBaseline(project, readings, allowEdits)
        : await collaborationJob({ task: 'prepareReview', project, readings, allowEdits }, { signal });
      project = prepared.project; baselineId = prepared.baselineId;
    }
    for (const part of manifestParts(project, readings, allowEdits, baselineId, [], { googleKey: googleReviewKey, polly: pollyReviewKey }, live)) await write(part);
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

// Original readings attached to an authoring project use their own recovery entry.
// The baseline id is a content reference, not an ownership or permission flag.
export const reviewAudioKey = (projectId, baselineId) => `audio:${projectId}:${baselineId}`;
