// Who last changed each block. Every change is noted quietly, but it's only shown once
// more than one person has worked on the project, so a project of your own looks the same.
import { cleanName, validEditorId } from './profile.js';

// What counts as changing a block in Write and QC. Comments, readings and Record mode's
// pickups have their own records.
const SCRIPT = ['start', 'end', 'text', 'speed', 'voice', 'dip', 'dipBy', 'vol', 'auto', 'fit', 'pinned', 'say', 'extended', 'notes'];
export const blockSig = (b) => JSON.stringify(SCRIPT.map((k) => b[k] ?? null));

// `edited` on a block: { by: name, at: ISO time, who: browser id }. `by` may be missing.
export function cleanEdited(value) {
  if (!value || typeof value !== 'object' || !validEditorId(value.who)) return null;
  if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) return null;
  const by = cleanName(value.by);
  return { ...(by ? { by } : {}), at: value.at, who: value.who };
}

// Notes `stamp` on each block whose script changed since `sigs` last saw it. Blocks it hasn't
// seen are new, so they count too. `only` limits the check to one block, by uid.
// Returns how many blocks were stamped.
export function stampEdits(blocks, sigs, stamp, only = null) {
  let n = 0;
  for (const b of only == null ? blocks : blocks.filter((c) => c.uid === only)) {
    const sig = blockSig(b);
    if (sigs.get(b.uid) === sig) continue;
    sigs.set(b.uid, sig);
    b.edited = { ...stamp };
    n++;
  }
  return n;
}
// Remembers the blocks as they are, without stamping: after opening a file or undoing.
export function seedEdits(blocks, sigs) {
  sigs.clear();
  for (const b of blocks) sigs.set(b.uid, blockSig(b));
}

// How many people changed these blocks. The same name is one person on any computer, and a
// browser that has used a name counts as that person, even for changes made before it had one.
export function editorCount(blocks) {
  const named = new Map();
  for (const b of blocks) if (b.edited?.by) named.set(b.edited.who, b.edited.by);
  const people = new Set();
  for (const b of blocks) {
    const e = b.edited;
    if (e) people.add(e.by || named.get(e.who) ? `n:${e.by || named.get(e.who)}` : `i:${e.who}`);
  }
  return people.size;
}

// The line under an open block, or '' when there's nothing worth showing.
const shortTime = (at) => {
  const d = new Date(at);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
};
export function editedLine(edited, people, when = shortTime) {
  if (people < 2 || !edited) return '';
  return `Edited by ${edited.by || 'No name'} · ${when(edited.at)}`;
}
