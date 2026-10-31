// Waveforms kept in the browser, so reopening a video, or reloading, doesn't build its
// waveform again. Kept by the file's name, size and date, and the track, as 16-bit levels
// against the loudest: about 3 MB for a two-hour film. The ones used longest ago go first.

const DB = 'scribecue-waves', STORE = 'waves';
export const KEEP = 20;

export const waveKey = (file, track, rate) => `${file.name}|${file.size}|${file.lastModified}|${track}|${rate}`;

// Float peaks to what's stored, and back. Levels are against the loudest, so quiet
// passages keep their detail.
export function packPeaks(peaks, len, max) {
  const out = new Uint16Array(len);
  if (max > 0) for (let i = 0; i < len; i++) out[i] = Math.round(Math.min(1, peaks[i] / max) * 65535);
  return { levels: out, max };
}
export function unpackPeaks({ levels, max }) {
  const peaks = new Float32Array(levels.length);
  for (let i = 0; i < levels.length; i++) peaks[i] = (levels[i] / 65535) * max;
  return { peaks, peakLen: levels.length, peakMax: max };
}

const open = () => new Promise((ok, fail) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('used', 'used');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const done = (q) => new Promise((ok, fail) => { q.onsuccess = () => ok(q.result); q.onerror = () => fail(q.error); });

// { peaks, peakLen, peakMax }, or null if this waveform isn't kept.
export async function loadWave(key) {
  try {
    const db = await open();
    const e = await done(db.transaction(STORE).objectStore(STORE).get(key));
    if (!e) return null;
    e.used = Date.now();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(e);
    return unpackPeaks(e);
  } catch { return null; }
}

export async function saveWave(key, peaks, len, max) {
  try {
    const db = await open();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    st.put({ key, used: Date.now(), ...packPeaks(peaks, len, max) });
    // Past KEEP, the ones used longest ago go, found by when they were used without
    // reading the waveforms themselves.
    let extra = (await done(st.count())) - KEEP;
    if (extra <= 0) return;
    const c = st.index('used').openKeyCursor();
    c.onsuccess = () => {
      if (!c.result || extra-- <= 0) return;
      st.delete(c.result.primaryKey);
      c.result.continue();
    };
  } catch { /* storage full or blocked: it's built again next time */ }
}
