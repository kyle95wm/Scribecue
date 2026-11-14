// Bookmarks are the writer's own notes at times in the programme: who appears when, where
// an act starts, where they left off. They show in Write and Transcribe only, and never go
// into a QC package.
export const bookmarksAllowed = (mode) => mode === 'write' || mode === 'transcribe';

// Each kind has its own colour, a token in style.css.
export const KINDS = [
  { id: 'note', label: 'Note', token: '--bm-note' },
  { id: 'character', label: 'Character', token: '--bm-character' },
  { id: 'scene', label: 'Scene', token: '--bm-scene' },
  { id: 'left', label: 'Left off here', token: '--bm-left' },
];
const KIND_IDS = new Set(KINDS.map((k) => k.id));
export const kindLabel = (id) => KINDS.find((k) => k.id === id)?.label || 'Note';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const newBookmarkId = () => crypto.randomUUID();
export const TITLE_MAX = 200, NOTES_MAX = 4000;

// A list of bookmarks as saved: each with an id, a time, a title, notes and a kind, in time
// order. Anything else is dropped; a repeated id gets a new one.
export function cleanBookmarks(value, makeId = newBookmarkId) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((b) => b && typeof b.time === 'number' && Number.isFinite(b.time) && b.time >= 0)
    .map((b) => {
      let id = typeof b.id === 'string' && ID.test(b.id) && !seen.has(b.id) ? b.id : '';
      while (!id || seen.has(id)) id = makeId();
      seen.add(id);
      return {
        id, time: b.time,
        title: typeof b.title === 'string' ? b.title.trim().slice(0, TITLE_MAX) : '',
        notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, NOTES_MAX) : '',
        kind: KIND_IDS.has(b.kind) ? b.kind : 'note',
      };
    })
    .sort((a, z) => a.time - z.time || a.id.localeCompare(z.id));
}

// Frazier's markers have no kind, so one is guessed from the title. Anything unclear is a
// Note, easy to change afterwards.
export function guessKind(title) {
  const t = String(title || '').trim();
  if (/\bleft off\b/i.test(t)) return 'left';
  if (/^(movie|film|programme|program|show) (start|begins)$|^(opening|end|closing)? ?credits$|^(intro|opening|intermission|interval|finale|epilogue|prologue)$|\b(act|scene|chapter|part)\b/i.test(t)) return 'scene';
  return 'note';
}

// The markers in a Frazier .adc script, as bookmarks: { start (ms), title, notes }.
export function adcBookmarks(text) {
  let doc;
  try { doc = typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) : text; } catch { return []; }
  if (!Array.isArray(doc?.markers)) return [];
  return cleanBookmarks(doc.markers
    .filter((m) => m && Number.isFinite(m.start) && m.start >= 0)
    .map((m) => {
      const title = typeof m.title === 'string' ? m.title : '';
      return { time: m.start / 1000, title, notes: typeof m.notes === 'string' ? m.notes : '', kind: guessKind(title) };
    }));
}

// Bookmarks to add to a list, leaving out any already there: the same title (whatever its
// case) within 10 ms. Importing the same file again adds nothing.
export function newBookmarks(list, incoming) {
  const same = (a, b) => Math.abs(a.time - b.time) < 0.01 && a.title.toLowerCase() === b.title.toLowerCase();
  const out = [];
  for (const b of incoming) if (![...list, ...out].some((x) => same(x, b))) out.push(b);
  return out;
}

// What a bookmark is called where its title is empty.
export const shownTitle = (b) => b.title || `Untitled ${kindLabel(b.kind).toLowerCase()}`;

// The bookmark nearest a time, within `slack` seconds, from a list in time order.
export function bookmarkNear(list, time, slack) {
  let best = null, d = slack;
  for (const b of list) {
    const e = Math.abs(b.time - time);
    if (e <= d) { best = b; d = e; }
    if (b.time > time + slack) break;
  }
  return best;
}
