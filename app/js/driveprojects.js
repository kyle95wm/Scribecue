// Projects in Google Drive: the parts that need no browser or network, so they can be tested.
// The Drive calls are in googledrive.js.

export const FOLDER = 'Scribecue';
// Marks a file as a Scribecue project, so the list finds it among the app's files.
export const MARK = { key: 'scribecue', value: 'project' };
const EXT = '.scribecue';

// A name for a copy that none of `taken` has: "Pilot.scribecue" → "Pilot (2).scribecue".
export function copyName(name, taken) {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  const ext = name.toLowerCase().endsWith(EXT) ? name.slice(-EXT.length) : '';
  const base = name.slice(0, name.length - ext.length).replace(/ \(\d+\)$/, '');
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const next = `${base} (${n})${ext}`;
    if (!lower.has(next.toLowerCase())) return next;
  }
}

// The list Open from Google Drive shows, newest first: the name has every word typed.
export function filterProjects(files, text = '') {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return files
    .filter((f) => words.every((w) => f.name.toLowerCase().includes(w)))
    .sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : a.modifiedTime > b.modifiedTime ? -1 : 0));
}

// What a Drive project is kept as in this browser, to save to it again after a reload.
export const isDriveRef = (v) => !!v && v.kind === 'drive' && typeof v.id === 'string' && typeof v.name === 'string';
export const driveRef = (h) => ({ kind: 'drive', id: h.id, name: h.name, revision: h.revision || '' });

// Whether the copy in Drive changed since this browser last read or wrote it.
export const changedElsewhere = (known, now) => !!known && !!now && known !== now;

// Where a new project's first save goes, as the setting "Save new projects" says: 'ask',
// 'local' or 'drive'. Drive only counts when it's connected for projects; otherwise saving
// works as it always did. A setting synced from a browser with Drive falls back the same way.
export const SAVE_NEW = 'saveNew';
export const SAVE_NEW_CHOICES = ['ask', 'local', 'drive'];
export function firstSaveGoes(setting, driveReady) {
  if (!driveReady) return 'local';
  return SAVE_NEW_CHOICES.includes(setting) ? setting : 'ask';
}

// The name someone typed for a new project, made safe as a file name, without the extension.
// Falls back to `fallback` when nothing usable is left.
export function projectName(typed, fallback, ext = EXT) {
  let n = String(typed ?? '').replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.toLowerCase().endsWith(ext.toLowerCase())) n = n.slice(0, -ext.length).trim();
  n = n.replace(/^\.+|\.+$/g, '').trim().slice(0, 120).trim();
  return n || fallback;
}
