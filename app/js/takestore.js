// Where a narrator's takes are kept. Each take is a 24-bit WAV, about 8.6 MB a minute.
// In Docker with the takes container, they're on disk there; otherwise in the browser's
// own storage (IndexedDB), where clearing the site's data loses them.
import { HOSTED } from './config.js';

// ---- in the browser

const DB = 'scribecue-takes', STORE = 'takes';

const open = () => new Promise((ok, fail) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('rec', 'rec');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const done = (q) => new Promise((ok, fail) => { q.onsuccess = () => ok(q.result); q.onerror = () => fail(q.error); });
const finish = (tx) => new Promise((ok, fail) => { tx.oncomplete = () => ok(); tx.onerror = tx.onabort = () => fail(tx.error); });

// Takes of the same block and side (the original, or its alt) have one chosen between them.
const sameSide = (a, z) => a.block === z.block && (typeof a.alt === 'string') === (typeof z.alt === 'string');

const browser = {
  where: 'browser',
  async list(rec) {
    const db = await open();
    return done(db.transaction(STORE).objectStore(STORE).index('rec').getAll(rec));
  },
  async save(take, choose) {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    if (choose) {
      for (const t of await done(st.index('rec').getAll(take.rec))) {
        if (sameSide(t, take) && t.chosen) { t.chosen = false; st.put(t); }
      }
    }
    st.put({ ...take, chosen: choose || !!take.chosen });
    await finish(tx);
  },
  async choose(rec, id) {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    const all = await done(st.index('rec').getAll(rec));
    const pick = all.find((t) => t.id === id);
    if (!pick) return;
    for (const t of all) if (sameSide(t, pick) && t.chosen !== (t.id === id)) { t.chosen = t.id === id; st.put(t); }
    await finish(tx);
  },
  async edit(rec, id, edit) {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    const t = await done(st.get(id));
    if (t) st.put({ ...t, edit });
    await finish(tx);
  },
  async remove(rec, id) {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await finish(tx);
  },
  async relink(rec, changes) {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    for (const { id, block, start, line, chosen, alt } of changes) {
      const t = await done(st.get(id));
      if (t?.rec !== rec) continue;
      const { alt: was, ...rest } = t;
      const keep = alt === undefined ? was : alt;
      st.put({ ...rest, block, start, line, chosen: chosen && block >= 0, ...(typeof keep === 'string' ? { alt: keep } : {}) });
    }
    await finish(tx);
  },
  async move(rec, to) {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    const all = await done(st.index('rec').getAll(rec));
    for (const t of all) st.put({ ...t, rec: to });
    await finish(tx);
    return all.length;
  },
  audio: async (t) => t.wav,
  async clear() {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await finish(tx);
  },
  // Reads the keys and sizes, not the sound.
  async info() {
    const db = await open();
    let count = 0, bytes = 0;
    await new Promise((ok, fail) => {
      const q = db.transaction(STORE).objectStore(STORE).openCursor();
      q.onsuccess = () => { const c = q.result; if (!c) return ok(); count++; bytes += c.value.wav?.size || 0; c.continue(); };
      q.onerror = () => fail(q.error);
    });
    return { count, bytes };
  },
};

// ---- in Docker, in the takes container (takes/server.py)

const answer = async (r) => {
  if (r.ok) return r;
  let why = '';
  try { why = (await r.json()).error; } catch { /* no details */ }
  throw new Error(why || `the takes container answered ${r.status}`);
};
const url = (rec, id = '') => `takes/r/${rec}${id ? '/' + id : ''}`;
// Headers carry only ASCII: anything else in a block's text goes as JSON's \u escapes.
const ascii = (o) => JSON.stringify(o).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const docker = {
  where: 'docker',
  async list(rec) {
    const all = await (await answer(await fetch(url(rec), { cache: 'no-store' }))).json();
    return all.map((t) => ({ ...t, rec, peak: t.peak ?? -Infinity, punch: t.punch ?? undefined, edit: t.edit ?? undefined, line: t.line ?? undefined, ver: t.ver ?? undefined, alt: t.alt ?? undefined }));
  },
  async save(take, choose) {
    const { block, start, duration, peak, made, punch, line, ver, alt } = take;
    await answer(await fetch(url(take.rec, take.id), {
      method: 'PUT', body: take.wav,
      headers: { 'X-Take': ascii({ block, start, duration, peak: Number.isFinite(peak) ? peak : null, made, punch, line, ver, alt, choose }) },
    }));
  },
  async relink(rec, changes) { await answer(await fetch(url(rec) + '/relink', { method: 'POST', body: JSON.stringify(changes) })); },
  async move(rec, to) { return (await (await answer(await fetch(url(rec) + '/move', { method: 'POST', body: JSON.stringify({ to }) }))).json()).moved; },
  async choose(rec, id) { await answer(await fetch(url(rec, id) + '/choose', { method: 'POST' })); },
  async edit(rec, id, edit) { await answer(await fetch(url(rec, id) + '/edit', { method: 'POST', body: JSON.stringify(edit) })); },
  async remove(rec, id) { await answer(await fetch(url(rec, id), { method: 'DELETE' })); },
  audio: async (t) => (await answer(await fetch(url(t.rec, t.id)))).blob(),
  async clear() { await answer(await fetch('takes/all', { method: 'DELETE' })); },
  async info() {
    const s = await (await answer(await fetch('takes/status', { cache: 'no-store' }))).json();
    return { count: s.takes, bytes: s.bytes };
  },
};

// Which one: asked once, when takes are first needed. The web version has no containers.
let picked = null;
const store = () => (picked ||= HOSTED ? Promise.resolve(browser)
  : fetch('takes/status', { cache: 'no-store' }).then((r) => (r.ok ? docker : browser), () => browser));

// 'docker' or 'browser'.
export const takesWhere = async () => (await store()).where;

// Every take of a recording: { id, rec, block, start, duration, peak, chosen, made, punch?,
// edit?, line?, ver?, alt? }, and in the browser, wav as well. alt is the wording of a take of
// the block's alt (see isAlt in recording.js). takeAudio() gets the sound either
// way. line is the block it was read for, and ver the recording file's version then; block
// is −1 for a take whose line isn't in the script any more (see relink in recording.js).
export const listTakes = async (rec) => (await store()).list(rec);

// Saves a take ({ ..., wav }), and makes it the one chosen for its block, or its block's
// alt, when `choose` is set.
export const saveTake = async (take, choose = true) => (await store()).save(take, choose);

// Chooses one take for its block, or its block's alt, so the others there aren't.
export const chooseTake = async (rec, id) => (await store()).choose(rec, id);

// Moves and trims a take: edit is { shift, head, tail } (see placed() in recording.js).
export const editTake = async (rec, id, edit) => (await store()).edit(rec, id, edit);

export const deleteTake = async (rec, id) => (await store()).remove(rec, id);

// Saves takes matched to a new version of the script: [{ id, block, start, line, chosen, alt }].
export const relinkTakes = async (rec, changes) => changes.length && (await store()).relink(rec, changes);

// Moves every take of one recording to another, such as its project: how many moved.
export const moveTakes = async (rec, to) => (await store()).move(rec, to);

// Deletes every take of every recording, with or without its recording file.
export const clearTakes = async () => (await store()).clear();

// The take's WAV, as a Blob.
export const takeAudio = async (t) => (await store()).audio(t);

// How many takes there are, all recordings together, the bytes they use, and where they
// are, for Storage in Settings.
export async function takesInfo() {
  const s = await store();
  try { return { ...(await s.info()), where: s.where }; } catch { return { count: 0, bytes: 0, where: s.where }; }
}
