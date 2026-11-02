// Where a narrator's takes are kept. Each take is a 24-bit WAV, about 8.6 MB a minute.
// A recording open in Record mode keeps them in its session (session.js): a folder the
// narrator chose, or, where a page can't open one, the browser's own folder (OPFS).
// Before sessions, they were kept in the browser's IndexedDB, or in Docker with the takes
// container: those are still read, and moved into a session when it opens.
import { SESSION_FILE, TAKES_DIR, takeFile, takeIdOf, toSession, fromSession, rebuild, choose, sameSide, takeNote, forRecord } from './session.js';
import { withTakeNote, readTakeNote, plainTake } from './bwf.js';
import { blobCrc } from './zip.js';
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
const legacy = () => (picked ||= HOSTED ? Promise.resolve(browser)
  : fetch('takes/status', { cache: 'no-store' }).then((r) => (r.ok ? docker : browser), () => browser));

// ---- in a session folder

const NOT_FOUND = (e) => e?.name === 'NotFoundError';
async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
  try { await w.write(data); await w.close(); } catch (e) { await w.abort().catch(() => {}); throw e; }
  return fh;
}
const readJson = async (dir, name) => {
  try { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()); } catch (e) { if (NOT_FOUND(e)) return null; throw e; }
};

// Opens the session in dir for the recording whose takes are kept under key, making it if
// the folder is new. recording: the recording file, as toRecordingFile made it, saved in
// the session as its current one. Throws if the folder holds another recording's session.
// Resolves to the store, with { where, name, key, drafts, found, missing }: found, takes
// brought back from WAVs session.json didn't list; missing, takes whose WAV has gone.
export async function openSession(dir, { key, recording, where = 'folder', app = '' }) {
  const json = await readJson(dir, SESSION_FILE);
  const was = json ? fromSession(json) : null;
  if (was && was.key !== key) throw new Error(`${dir.name} holds the takes of another recording`);
  const takesDir = await dir.getDirectoryHandle(TAKES_DIR, { create: true });
  const files = [];
  const listed = new Set((was?.takes || []).map((t) => t.id));
  for await (const [name, h] of takesDir.entries()) {
    const id = takeIdOf(name);
    if (h.kind !== 'file' || !id) continue;
    files.push({ id, note: listed.has(id) ? null : await readTakeNote(await h.getFile()) });
  }
  const { takes, found, missing } = rebuild(was?.takes || [], files);
  let drafts = was?.drafts || {}, stamp = 0;
  recording ||= was?.recording;
  if (!recording) throw new Error('the recording file is missing');
  const index = (list = takes) => JSON.stringify(toSession({ key, recording, takes: list, drafts, app }), null, 1);
  // session.json is written after every change, one write at a time, and changes made while
  // one is waiting go in it. If another copy of Scribecue changed it since (a synced folder),
  // its takes that this one doesn't know come in first.
  let chain = Promise.resolve(), queued = null;
  const save = () => queued ||= (chain = chain.catch(() => {}).then(async () => {
    queued = null;
    try {
      const f = await (await dir.getFileHandle(SESSION_FILE)).getFile();
      if (stamp && f.lastModified !== stamp) {
        const theirs = fromSession(JSON.parse(await f.text()));
        const mine = new Set(takes.map((t) => t.id));
        for (const t of theirs.takes) if (!mine.has(t.id)) takes.push(t);
      }
    } catch { /* not there yet, or not readable: write ours */ }
    stamp = (await (await writeFile(dir, SESSION_FILE, index())).getFile()).lastModified;
  }));
  const find = (id) => takes.find((t) => t.id === id);
  const s = {
    where, key, name: dir.name, found, missing,
    get drafts() { return drafts; },
    async setDrafts(d) { drafts = d; await save(); },
    async setRecording(r) { recording = r; await save(); },
    list: async () => takes.filter((t) => !t.deleted).map((t) => forRecord(t, key)),
    // A take saved again by its id replaces it; without its wav, only its details change.
    async save(take, chooseIt) {
      const t = { ...take, chosen: !!(chooseIt || take.chosen) }, was = find(t.id);
      const { wav: _, rec, ...kept } = t;
      if (take.wav) {
        const wav = await withTakeNote(take.wav, takeNote(t));
        await writeFile(takesDir, takeFile(t.id), wav);
        kept.size = wav.size; kept.crc = await blobCrc(wav);
      } else if (was) { kept.size = was.size; kept.crc = was.crc; }
      else throw new Error('the take has no sound');
      if (was) takes.splice(takes.indexOf(was), 1);
      takes.push(kept);
      if (kept.chosen) choose(takes, kept);
      await save();
    },
    async choose(rec, id) { const t = find(id); if (t) { choose(takes, t); await save(); } },
    async edit(rec, id, e) { const t = find(id); if (t) { t.edit = e; await save(); } },
    // Deleting only marks a take, until purge(): restore() brings it back till then.
    async remove(rec, id) { const t = find(id); if (t) { t.deleted = true; t.chosen = false; await save(); } },
    async restore(rec, id) { const t = find(id); if (t?.deleted) { delete t.deleted; await save(); } return !!t; },
    // Deletes the WAVs of the takes marked deleted, for good.
    async purge() {
      const gone = takes.filter((t) => t.deleted);
      if (!gone.length) return 0;
      for (const t of gone) {
        try { await takesDir.removeEntry(takeFile(t.id)); } catch (e) { if (!NOT_FOUND(e)) throw e; }
        takes.splice(takes.indexOf(t), 1);
      }
      await save();
      return gone.length;
    },
    async relink(rec, changes) {
      for (const { id, block, start, line, chosen, alt } of changes) {
        const t = find(id);
        if (!t) continue;
        Object.assign(t, { block, start, line, chosen: chosen && block >= 0 });
        if (alt === null) delete t.alt; else if (typeof alt === 'string') t.alt = alt;
      }
      await save();
    },
    // Copies every take kept under `from` before sessions (IndexedDB or the takes container)
    // into this session, then deletes them there: how many. progress(done, total).
    async adopt(from, progress = () => {}) {
      const old = await legacy(), theirs = await old.list(from).catch(() => []);
      let n = 0;
      for (const t of theirs) {
        if (!find(t.id)) {
          const wav = await old.audio(t);
          const { wav: _, rec, ...meta } = t;
          await s.save({ ...meta, wav }, false);
          const kept = find(t.id);
          kept.chosen = !!t.chosen && t.block >= 0;
          if (t.edit) kept.edit = t.edit;
        }
        await save();
        await old.remove(from, t.id);
        progress(++n, theirs.length);
      }
      return n;
    },
    async move(rec, to) { return to === key ? s.adopt(rec) : 0; },
    audio: async (t) => plainTake(await (await takesDir.getFileHandle(takeFile(t.id))).getFile()),
    // The session's files, for packaging: [{ name, blob, crc? }], session.json first. keep:
    // the ids of the takes to include, or null for all. Deleted takes are left out.
    async files(keep = null) {
      const list = takes.filter((t) => !t.deleted && (!keep || keep.has(t.id)));
      const out = [{ name: SESSION_FILE, blob: new Blob([index(list)], { type: 'application/json' }) }];
      for (const t of list) {
        const blob = await (await takesDir.getFileHandle(takeFile(t.id))).getFile();
        out.push({ name: `${TAKES_DIR}/${takeFile(t.id)}`, blob, ...(t.size === blob.size && t.crc != null ? { crc: t.crc } : {}) });
      }
      return out;
    },
    flush: () => save(),
    // After Settings deleted the takes kept in the browser, this one's among them.
    reset() { takes.length = 0; },
  };
  await s.purge(); // takes deleted when Scribecue last stopped before the recording closed
  await save();
  return s;
}

// The folder a session goes in, from the one the narrator chose: that one if it holds the
// session already or is empty, else a new folder in it, named sub.
export async function sessionFolder(dir, sub) {
  for await (const [name, h] of dir.entries()) {
    if (name === SESSION_FILE && h.kind === 'file') return dir;
    if (!name.startsWith('.')) return dir.getDirectoryHandle(sub.replace(/[\\/:*?"<>|]/g, '-'), { create: true });
  }
  return dir;
}

// Puts a session package's files into dir: files as readZip gives them. A session already
// there for the same recording keeps its own takes and choices, and gains the package's
// other takes. Throws if dir holds another recording's session. progress(done, total).
export async function unpackSession(dir, files, progress = () => {}) {
  const index = files.find((f) => f.name === SESSION_FILE);
  const theirs = fromSession(JSON.parse(await index.blob.text()));
  const json = await readJson(dir, SESSION_FILE);
  const mine = json ? fromSession(json) : null;
  if (mine && mine.key !== theirs.key) throw new Error(`${dir.name} holds the takes of another recording`);
  const takesDir = await dir.getDirectoryHandle(TAKES_DIR, { create: true });
  const wavs = files.filter((f) => f.name.startsWith(`${TAKES_DIR}/`) && takeIdOf(f.name.slice(TAKES_DIR.length + 1)));
  const total = wavs.reduce((n, f) => n + f.blob.size, 0);
  let done = 0;
  for (const f of wavs) {
    const name = f.name.slice(TAKES_DIR.length + 1);
    let have = null;
    try { have = await (await takesDir.getFileHandle(name)).getFile(); } catch (e) { if (!NOT_FOUND(e)) throw e; }
    if (have?.size !== f.blob.size) await writeFile(takesDir, name, f.blob);
    done += f.blob.size; progress(done, total);
  }
  const known = new Set((mine?.takes || []).map((t) => t.id));
  const takes = [...(mine?.takes || []), ...theirs.takes.filter((t) => !known.has(t.id))];
  await writeFile(dir, SESSION_FILE, JSON.stringify(toSession({ key: theirs.key, recording: mine?.recording || theirs.recording,
    takes, drafts: { ...theirs.drafts, ...mine?.drafts } }), null, 1));
  return theirs;
}

// Deletes the session kept in the browser under key, once it's been moved to a folder.
export async function forgetBrowserFolder(key) {
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(SESSIONS);
    await root.removeEntry(key, { recursive: true });
  } catch (e) { if (!NOT_FOUND(e)) throw e; }
}

// Whether a page can keep a session in the browser's own folder: it needs to write there.
export const canKeepInBrowser = (w = globalThis) => typeof w.navigator?.storage?.getDirectory === 'function'
  && typeof w.FileSystemFileHandle?.prototype?.createWritable === 'function';
// Whether a page can open a folder on disk: Chrome and Edge.
export const canUseFolders = (w = globalThis) => typeof w.showDirectoryPicker === 'function' && canKeepInBrowser(w);

const SESSIONS = 'sessions';
// The folder in the browser's own storage for the session kept under key.
export async function browserFolder(key) {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(SESSIONS, { create: true });
  return root.getDirectoryHandle(key, { create: true });
}

// The session folder chosen for each recording, remembered between reloads in IndexedDB
// with the project file's handle (see handleStore in app.js): a directory handle, or
// 'browser' for one kept in the browser.
const handles = () => new Promise((ok, fail) => {
  const r = indexedDB.open('scribecue', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
export async function rememberedSession(key) {
  try {
    const db = await handles();
    return await new Promise((ok) => { const q = db.transaction('files').objectStore('files').get(`session:${key}`); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); });
  } catch { return null; }
}
export async function rememberSession(key, h) {
  try {
    const db = await handles();
    const tx = db.transaction('files', 'readwrite'), st = tx.objectStore('files');
    h ? st.put(h, `session:${key}`) : st.delete(`session:${key}`);
    await finish(tx);
  } catch { /* not remembered: the narrator chooses it again */ }
}

// The session open in Record mode, or null. Takes of any other recording are found where
// they were kept before sessions.
let session = null;
export const useSession = (s) => { session = s; };
export const currentSession = () => session;
const store = async (rec) => (session && rec === session.key ? session : legacy());

// Every take of a recording: { id, rec, block, start, duration, peak, chosen, made, punch?,
// edit?, line?, ver?, alt? }, and in the browser, wav as well. alt is the wording of a take of
// the block's alt (see isAlt in recording.js). takeAudio() gets the sound either
// way. line is the block it was read for, and ver the recording file's version then; block
// is −1 for a take whose line isn't in the script any more (see relink in recording.js).
export const listTakes = async (rec) => (await store(rec)).list(rec);

// Saves a take ({ ..., wav }), and makes it the one chosen for its block, or its block's
// alt, when `choose` is set.
export const saveTake = async (take, choose = true) => (await store(take.rec)).save(take, choose);

// Chooses one take for its block, or its block's alt, so the others there aren't.
export const chooseTake = async (rec, id) => (await store(rec)).choose(rec, id);

// Moves and trims a take: edit is { shift, head, tail } (see placed() in recording.js).
export const editTake = async (rec, id, edit) => (await store(rec)).edit(rec, id, edit);

export const deleteTake = async (rec, id) => (await store(rec)).remove(rec, id);

// Saves takes matched to a new version of the script: [{ id, block, start, line, chosen, alt }].
export const relinkTakes = async (rec, changes) => changes.length && (await store(rec)).relink(rec, changes);

// Moves every take of one recording to another, such as its project: how many moved.
export const moveTakes = async (rec, to) => (session && to === session.key ? session : await legacy()).move(rec, to);

// Brings back a take deleted since its recording opened: false if it can't be. Only a
// session can: elsewhere, a deleted take is gone.
export const restoreTake = async (rec, id) => !!(session && rec === session.key && await session.restore(rec, id));

// The take's WAV, as a Blob.
export const takeAudio = async (t) => (await store(t.rec)).audio(t);

// 'folder', 'browser' or 'docker': where the open session's takes are, or else where takes
// were kept before sessions.
export const takesWhere = async () => (session || await legacy()).where;

// Sessions kept in the browser, by their session.json: [{ count, bytes }].
async function browserSessions() {
  const out = [];
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(SESSIONS);
    for await (const [, dir] of root.entries()) {
      if (dir.kind !== 'directory') continue;
      const json = await readJson(dir, SESSION_FILE).catch(() => null);
      const takes = json ? fromSession(json).takes : [];
      out.push({ count: takes.length, bytes: takes.reduce((n, t) => n + (t.size || 0), 0) });
    }
  } catch { /* none */ }
  return out;
}

// Deletes every take kept in the browser or in Docker, from every recording. Sessions in
// folders on disk are the narrator's own files, and stay.
export async function clearTakes() {
  await browser.clear();
  if ((await legacy()).where === 'docker') await docker.clear();
  try { await (await navigator.storage.getDirectory()).removeEntry(SESSIONS, { recursive: true }); } catch (e) { if (!NOT_FOUND(e)) throw e; }
  if (session?.where === 'browser') session.reset();
}

// How many takes are kept in the browser, all recordings together, and the bytes they use,
// for Storage in Settings; or, with none there, how many in Docker.
export async function takesInfo() {
  let count = 0, bytes = 0;
  try { ({ count, bytes } = await browser.info()); } catch { /* none */ }
  for (const s of await browserSessions()) { count += s.count; bytes += s.bytes; }
  if (count) return { count, bytes, where: 'browser' };
  const old = await legacy();
  if (old.where !== 'docker') return { count: 0, bytes: 0, where: 'browser' };
  try { return { ...(await docker.info()), where: 'docker' }; } catch { return { count: 0, bytes: 0, where: 'docker' }; }
}
