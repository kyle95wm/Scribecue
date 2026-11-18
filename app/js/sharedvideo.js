// A shared project's video: encrypted on the owner's computer, kept in the owner's Google
// Drive, and downloaded by the people it's shared with into their browser's own storage.
// No DOM or network here: tested in tests/sharedvideo.test.mjs. The work itself runs in
// sharedvideo-worker.js; uploading is in googledrive.js; app.js puts them together.
//
// The video is cut into pieces, each sealed with AES-256-GCM under a key of its own. A
// sealed piece is exactly SEALED bytes (the last may be shorter), so Drive's upload pieces,
// which must be whole multiples of 256 KiB, and download ranges both fall on piece edges.
// Each piece's nonce is its number, and its extra data says whether it's the last, so pieces
// can't be swapped, dropped or cut short without decrypting failing.
//
// The Drive file's id and the key travel in the shared project (shared.js, `video`), which
// is encrypted itself, so Google only holds data it can't read.

export const SEALED = 4 * 1024 * 1024; // a sealed piece, the tag included
export const TAG = 16;
export const PLAIN = SEALED - TAG; // a piece of the video
export const PER_UPLOAD = 4; // pieces sent to Drive in one request: 16 MiB
export const DIR = 'shared-videos'; // in the browser's own storage (OPFS)
export const DONE = '.done'; // written beside a video once all of it is in
export const EXT = '.scribecuevideo';

export const pieceCount = (size) => Math.max(1, Math.ceil(size / PLAIN));
export const sealedSize = (size) => size + TAG * pieceCount(size);
// Where a piece starts, in the video and in the sealed file, and how long it is in each.
export function piece(i, size) {
  const start = i * PLAIN, plain = Math.min(PLAIN, size - start);
  return { start, plain, at: i * SEALED, sealed: plain + TAG, last: i === pieceCount(size) - 1 };
}
// How many upload requests, and which pieces each carries.
export const uploadCount = (size) => Math.ceil(pieceCount(size) / PER_UPLOAD);
export function uploadPieces(n, size) {
  const from = n * PER_UPLOAD, to = Math.min(from + PER_UPLOAD, pieceCount(size));
  return { from, to, at: from * SEALED, end: piece(to - 1, size).at + piece(to - 1, size).sealed };
}

// The nonce: the piece's number, at the end of 12 bytes. Each video has its own key, so a
// number is never used twice under one key.
export function nonce(i) {
  const n = new Uint8Array(12), v = new DataView(n.buffer);
  v.setUint32(4, Math.floor(i / 2 ** 32));
  v.setUint32(8, i >>> 0);
  return n;
}
const enc = new TextEncoder();
export const extra = (i, last) => enc.encode(`scribecue-video:${i}:${last ? 'end' : 'more'}`);

export async function seal(key, i, last, bytes) {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(i), additionalData: extra(i, last) }, key, bytes));
}
export async function open(key, i, last, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(i), additionalData: extra(i, last) }, key, bytes));
}

export const b64u = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const newKey = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
export const importKey = (text) => crypto.subtle.importKey('raw', unb64u(text), 'AES-GCM', false, ['encrypt', 'decrypt']);

// What the shared project holds about its video, checked as it's read: anyone who can edit
// writes the same place.
const ID = /^[\w-]{10,200}$/, KEY = /^[\w-]{43}$/;
export function videoInfo({ id, key, name, size, type = '', duration = null }, at = Date.now()) {
  return { v: 1, id, key, name: cleanName(name), size, type: String(type).slice(0, 100), duration, at };
}
export function readVideoInfo(text) {
  let v;
  try { v = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
  if (!v || typeof v !== 'object' || v.v !== 1) return null;
  if (!ID.test(v.id) || !KEY.test(v.key)) return null;
  if (!Number.isSafeInteger(v.size) || v.size <= 0) return null;
  if (typeof v.name !== 'string' || !v.name.trim()) return null;
  return {
    v: 1, id: v.id, key: v.key, name: cleanName(v.name), size: v.size,
    type: typeof v.type === 'string' ? v.type.slice(0, 100) : '',
    duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null,
    at: Number.isSafeInteger(v.at) ? v.at : 0,
  };
}
// A name that's safe as a file name, in Drive and in the browser's storage.
export function cleanName(name) {
  const n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 200);
  return n || 'video';
}
export const sameVideo = (a, b) => !!a && !!b && a.id === b.id && a.key === b.key;
// Whether the video open now is the shared one, by name and size, as projects match videos.
export const isShared = (info, file) => !!info && !!file && cleanName(file.name) === info.name && file.size === info.size;

// Where a download carries on from, given how much of the video is already in: whole pieces
// only, since a piece is only written once it's decrypted.
export const resumeFrom = (written, size) => (written >= size ? pieceCount(size) : Math.floor(Math.max(0, written) / PLAIN));

// The space a download needs, and whether the browser says there's room, with some to spare.
export const SPARE = 500e6;
export function roomFor(size, written, estimate) {
  if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return true;
  return estimate.quota - estimate.usage >= size - Math.min(written, size) + SPARE;
}

// Whether the owner's Google Drive has room for a sealed video. `space`: { limit, usage }, or
// null when Drive didn't say. No limit, or not known: try, and Drive says if it's full.
export function driveRoom(need, space) {
  if (!space || !Number.isFinite(space.limit) || !Number.isFinite(space.usage)) return { ok: true, free: null };
  const free = Math.max(0, space.limit - space.usage);
  return { ok: need <= free, free };
}
export function fullText(need, free = null) {
  const left = free == null ? '' : free < 1e6 ? ', and it’s full' : `, and ${sizeText(free)} is free`;
  return `There isn’t room in your Google Drive. The video needs ${sizeText(need)}${left}. Free up space in Drive, or send a smaller copy, such as 720p`;
}

export const sizeText = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

// What to do about the shared video when the project opens, or when the video sent changes.
// `owner`: this is the owner's copy. `open`: the video open now, or null. `changed`: a
// different video has just been sent.
// - 'clear': no video sent; take back any offer.
// - 'have': the shared video is open already.
// - 'find': no video open; open the copy kept here (for the owner, their own file first),
//   or offer the download.
// - 'tell': another video is open and a new one was sent; say so.
// - 'leave': another video is open; leave it. The owner hears about it on opening one.
export function videoStep({ info, owner = false, open = null, changed = false }) {
  if (!info) return 'clear';
  if (open && isShared(info, open)) return 'have';
  if (!open) return 'find';
  return changed && !owner ? 'tell' : 'leave';
}
