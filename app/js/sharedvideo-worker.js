// The heavy part of sharing a video (sharedvideo.js), off the page:
//
// - { op: 'put', file, key, n, session, token }: seals upload request n's pieces of `file`
//   and sends them to Drive's upload session. Answers { op: 'put', n, status, id, error, reason }.
//   Sending from here means the page never copies the bytes.
// - { op: 'fetch', url, key, info }: downloads the sealed video into the browser's own
//   storage, opening each piece as it comes, carrying on from what's already there. Answers
//   { op: 'progress', done, size } now and then, and { op: 'fetched' }, or { op: 'failed',
//   code, status }.
// - { op: 'stop' }: stops a download. What's in stays, for next time.
//
// Only one piece of the video is held at a time, so a long film never has to fit in memory.
import { PLAIN, SEALED, DIR, DONE, piece, pieceCount, sealedSize, uploadPieces, seal, open, importKey, resumeFrom } from './sharedvideo.js';

const keys = new Map();
const keyFor = async (text) => { if (!keys.has(text)) keys.set(text, await importKey(text)); return keys.get(text); };
let stopper = null;

self.onmessage = async ({ data: m }) => {
  if (m.op === 'stop') { stopper?.abort(); return; }
  if (m.op === 'put') {
    let bytes;
    try { bytes = await sealed(m.file, m.key, m.n); }
    catch (e) { postMessage({ op: 'put', n: m.n, status: 0, error: e.name === 'NotReadableError' || e.name === 'NotFoundError' ? 'unreadable' : 'seal' }); return; }
    const { at } = uploadPieces(m.n, m.file.size), total = sealedSize(m.file.size);
    try {
      const r = await fetch(m.session, { method: 'PUT', body: bytes, headers: { authorization: `Bearer ${m.token}`, 'content-range': `bytes ${at}-${at + bytes.length - 1}/${total}` } });
      const id = r.status === 200 || r.status === 201 ? (await r.json().catch(() => ({}))).id || '' : '';
      // Why Drive refused, such as storageQuotaExceeded when the account is full.
      const reason = r.ok || r.status === 308 ? '' : (await r.text().catch(() => '')).slice(0, 2000);
      postMessage({ op: 'put', n: m.n, status: r.status, id, reason });
    } catch { postMessage({ op: 'put', n: m.n, status: 0, error: 'offline' }); }
    return;
  }
  if (m.op === 'fetch') {
    stopper = new AbortController();
    try { await fetchVideo(m, stopper.signal); postMessage({ op: 'fetched' }); }
    catch (e) {
      if (e.name === 'AbortError') postMessage({ op: 'stopped' });
      else postMessage({ op: 'failed', code: e.code || 'network', status: e.status || 0, message: String(e?.message || e) });
    } finally { stopper = null; }
  }
};

async function sealed(file, keyText, n) {
  const key = await keyFor(keyText), { from, to, at, end } = uploadPieces(n, file.size);
  const out = new Uint8Array(end - at);
  for (let i = from; i < to; i++) {
    const p = piece(i, file.size);
    const plain = new Uint8Array(await file.slice(p.start, p.start + p.plain).arrayBuffer());
    out.set(await seal(key, i, p.last, plain), p.at - at);
  }
  return out;
}

class Failed extends Error { constructor(code, status = 0) { super(code); this.code = code; this.status = status; } }

async function folder(id, create) {
  const root = await navigator.storage.getDirectory();
  const all = await root.getDirectoryHandle(DIR, { create });
  return all.getDirectoryHandle(id, { create });
}

async function fetchVideo({ url, key: keyText, info }, signal) {
  const key = await keyFor(keyText), size = info.size, count = pieceCount(size);
  const dir = await folder(info.id, true);
  const fh = await dir.getFileHandle(info.name, { create: true });
  if (!fh.createSyncAccessHandle) throw new Failed('unsupported');
  const out = await fh.createSyncAccessHandle();
  try {
    let next = resumeFrom(out.getSize(), size);
    out.truncate(Math.min(out.getSize(), next * PLAIN));
    let lastSaid = 0, tries = 0;
    const say = (force) => {
      const now = Date.now();
      if (!force && now - lastSaid < 250) return;
      lastSaid = now;
      postMessage({ op: 'progress', done: Math.min(size, next * PLAIN), size });
    };
    say(true);
    while (next < count) {
      try {
        await download(next);
      } catch (e) {
        if (e.name === 'AbortError' || e instanceof Failed || ++tries > 5) throw e;
        await new Promise((r) => setTimeout(r, 1000 * tries)); // the network dropped: carry on from where it got to
      }
    }
    out.truncate(size);
    out.flush();
    async function download(from) {
      const r = await fetch(url, { headers: from ? { Range: `bytes=${from * SEALED}-` } : {}, signal });
      if (r.status === 403 || r.status === 404 || r.status === 401 || r.status === 400) throw new Failed(r.status === 404 ? 'gone' : 'refused', r.status);
      if (!r.ok) throw new Error(`Google Drive said ${r.status}`);
      let skip = from && r.status !== 206 ? from * SEALED : 0; // a whole file, where a range was asked for
      const reader = r.body.getReader();
      let buf = new Uint8Array(SEALED), have = 0;
      const p = () => piece(next, size);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let bytes = value;
        if (skip) { const s = Math.min(skip, bytes.length); skip -= s; bytes = bytes.subarray(s); }
        while (bytes.length && next < count) {
          const want = p().sealed - have, take = Math.min(want, bytes.length);
          buf.set(bytes.subarray(0, take), have);
          have += take; bytes = bytes.subarray(take);
          if (have === p().sealed) {
            let plain;
            try { plain = await open(key, next, p().last, buf.subarray(0, have)); } catch { throw new Failed('damaged'); }
            out.write(plain, { at: p().start });
            next++; have = 0; tries = 0;
            if (next % 8 === 0) out.flush();
            say(next === count);
          }
        }
      }
      if (next < count) throw new Error('the download ended early');
      buf = null;
    }
  } finally {
    out.close();
  }
  // Marked whole, so it's used next time without checking it again.
  const done = await (await dir.getFileHandle(DONE, { create: true })).createSyncAccessHandle();
  done.close();
}
