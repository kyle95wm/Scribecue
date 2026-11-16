// Recents: the project files opened or saved lately, newest first, to open again in a click.
// Each entry keeps the browser's link to the file (a FileSystemFileHandle), so it only works
// in browsers that have them. Removing an entry only takes it off the list.
// Plain functions, so they can be tested without a browser.
import { isReview } from './qc.js';
import { isRecordingFile } from './recording.js';
import { isSessionPackage } from './session.js';

export const MAX_RECENTS = 20;

// What each kind is called, one and many, in the order the filters show them.
export const KINDS = [
  ['project', 'Project', 'Projects'],
  ['qc', 'QC package', 'QC packages'],
  ['recording', 'Recording file', 'Recording files'],
  ['session', 'Session package', 'Session packages'],
];
export const kindLabel = (kind) => KINDS.find(([k]) => k === kind)?.[1] || 'Project';

export function kindOf(name) {
  if (isReview(name)) return 'qc';
  if (isRecordingFile(name)) return 'recording';
  if (isSessionPackage(name)) return 'session';
  return 'project';
}

// The list with this entry at the top. same(a, b) says whether two entries are one file;
// it's given, as only the browser can compare file links. Old entries past max drop off.
export function addRecent(list, entry, same, max = MAX_RECENTS) {
  return [entry, ...list.filter((e) => !same(e, entry))].slice(0, max);
}

// The entries a search and a kind leave: the name has every word typed, in any order.
export function filterRecents(list, { text = '', kind = 'all' } = {}) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((e) => (kind === 'all' || e.kind === kind)
    && words.every((w) => e.name.toLowerCase().includes(w)));
}

// When it was last opened or saved: a time today, "Yesterday" and a time, or a date.
export function whenText(at, now = Date.now()) {
  const d = new Date(at), today = new Date(now);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ago = Math.round((day(today) - day(d)) / 864e5);
  if (ago === 0) return time;
  if (ago === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }) });
}
