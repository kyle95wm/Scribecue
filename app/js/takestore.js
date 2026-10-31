// Takes kept in the browser's own storage (IndexedDB), by recording and block. Each take
// is a 24-bit WAV, about 8.6 MB a minute. Clearing the site's data loses them.

const DB = 'scribecue-takes', STORE = 'takes';

const open = () => new Promise((ok, fail) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('rec', 'rec');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const done = (q) => new Promise((ok, fail) => { q.onsuccess = () => ok(q.result); q.onerror = () => fail(q.error); });
const finish = (tx) => new Promise((ok, fail) => { tx.oncomplete = () => ok(); tx.onerror = tx.onabort = () => fail(tx.error); });

// Every take of a recording: { id, rec, block, start, duration, peak, chosen, made, wav }.
export async function listTakes(rec) {
  const db = await open();
  return done(db.transaction(STORE).objectStore(STORE).index('rec').getAll(rec));
}

// Saves a take, and makes it the one chosen for its block when `choose` is set.
export async function saveTake(take, choose = true) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
  if (choose) {
    for (const t of await done(st.index('rec').getAll(take.rec))) {
      if (t.block === take.block && t.chosen) { t.chosen = false; st.put(t); }
    }
  }
  st.put({ ...take, chosen: choose || !!take.chosen });
  await finish(tx);
}

// Chooses one take for its block, so the others aren't.
export async function chooseTake(rec, id) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
  const all = await done(st.index('rec').getAll(rec));
  const pick = all.find((t) => t.id === id);
  if (!pick) return;
  for (const t of all) if (t.block === pick.block && t.chosen !== (t.id === id)) { t.chosen = t.id === id; st.put(t); }
  await finish(tx);
}

export async function deleteTake(id) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await finish(tx);
}

// How many takes there are, all recordings together, and the bytes they use, for
// Offline and storage in Settings. Reads the keys and sizes, not the sound.
export async function takesInfo() {
  try {
    const db = await open();
    let count = 0, bytes = 0;
    await new Promise((ok, fail) => {
      const q = db.transaction(STORE).objectStore(STORE).openCursor();
      q.onsuccess = () => { const c = q.result; if (!c) return ok(); count++; bytes += c.value.wav?.size || 0; c.continue(); };
      q.onerror = () => fail(q.error);
    });
    return { count, bytes };
  } catch { return { count: 0, bytes: 0 }; }
}
