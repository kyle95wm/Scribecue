// The person's own name, if they choose to keep one in Settings. It fills in the name on
// comments and on the blocks they change. It stays in this browser and only leaves it in
// a project, package or comment that carries it.
const KEY = 'scribecue.reviewer';
export const NAME_MAX = 100;
export const cleanName = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
export function savedName(storage = globalThis.localStorage) {
  try { return cleanName(storage?.getItem(KEY)); } catch { return ''; }
}
export function saveName(value, storage = globalThis.localStorage) {
  const name = cleanName(value);
  try { if (name) storage?.setItem(KEY, name); else storage?.removeItem(KEY); } catch { /* optional */ }
  return name;
}

// A random id for this browser, so changes by someone with no name can still be told apart
// from someone else's. It names no one. If storage is blocked, it lasts for this visit.
const ID_KEY = 'scribecue.editor';
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const validEditorId = (value) => typeof value === 'string' && ID_RE.test(value);
let visitId = '';
export function editorId(storage = globalThis.localStorage) {
  try {
    const kept = storage?.getItem(ID_KEY);
    if (validEditorId(kept)) return kept;
  } catch { /* blocked */ }
  visitId ||= Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  try { storage?.setItem(ID_KEY, visitId); } catch { /* blocked */ }
  return visitId;
}
