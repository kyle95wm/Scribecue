// The person's own name, if they choose to keep one in Settings. It fills in the name on
// comments. It stays in this browser and is never sent anywhere unless a comment carries it.
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
