// Recording sessions: a narrator's work on one recording, in a folder of its own, so it can
// be copied to another computer and opened there. The folder holds session.json, with the
// recording file and every take's details, and takes/, with a WAV for each take. Each WAV
// also carries its own details (withTakeNote in bwf.js), so session.json can be rebuilt.
// Plain functions, so they can be tested without a browser. The design is
// docs/development/portable-sessions.md.

export const SESSION_FORMAT = 1;
export const SESSION_FILE = 'session.json';
export const TAKES_DIR = 'takes';
// One file holding a whole session, to send or move: a zip of the folder.
export const SESSION_EXT = '.scribecuesession';
export const isSessionPackage = (name) => /\.scribecuesession$/i.test(name);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const takeFile = (id) => `${id}.wav`;
export const takeIdOf = (name) => (/^(.+)\.wav$/i.exec(name)?.[1] ?? '').toLowerCase();
const MAX_TEXT = 5000, MAX_EDIT = 20000;

const line = (v) => (v && num(v.start) && num(v.end) && typeof v.text === 'string' && v.text.length <= MAX_TEXT
  ? { start: v.start, end: v.end, text: v.text } : null);
const edit = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try { return JSON.stringify(v).length <= MAX_EDIT ? JSON.parse(JSON.stringify(v)) : null; } catch { return null; }
};

// A take's details, as kept in session.json, or null if they don't make sense. The same
// fields takestore.js gives Record mode: { id, block, start, duration, peak, chosen, made,
// punch?, edit?, line?, ver?, alt? }, and the WAV's size and checksum, for packaging.
export function cleanTake(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !ID.test(t.id)) return null;
  if (!Number.isInteger(t.block) || t.block < -1 || !num(t.start) || !num(t.duration) || t.duration < 0 || !num(t.made)) return null;
  return {
    id: t.id, block: t.block, start: t.start, duration: t.duration,
    peak: num(t.peak) ? t.peak : -Infinity,
    chosen: t.chosen === true && t.block >= 0,
    made: t.made,
    ...(num(t.punch) ? { punch: t.punch } : {}),
    ...(edit(t.edit) ? { edit: edit(t.edit) } : {}),
    ...(line(t.line) ? { line: line(t.line) } : {}),
    ...(Number.isInteger(t.ver) && t.ver >= 0 ? { ver: t.ver } : {}),
    ...(typeof t.alt === 'string' && t.alt.length <= MAX_TEXT ? { alt: t.alt } : {}),
    ...(Number.isSafeInteger(t.size) && t.size > 0 ? { size: t.size } : {}),
    ...(Number.isInteger(t.crc) && t.crc >= 0 && t.crc <= 0xffffffff ? { crc: t.crc } : {}),
    // Deleted, but its WAV is kept until the recording closes, so it can be brought back.
    ...(t.deleted === true ? { deleted: true } : {}),
  };
}

// What a take's WAV carries about itself: what it was when recorded, and whether it was
// chosen then. Edits and later choices are only in session.json.
export const takeNote = (t) => {
  const c = cleanTake(t);
  if (!c) return null;
  const { size, crc, chosen, deleted, edit: _, ...rest } = c;
  return { scribecueTake: 1, ...rest, choose: chosen };
};

// Alt wording typed for blocks of this recording, by altKey (see record.js).
const cleanDrafts = (d) => Object.fromEntries(Object.entries(d && typeof d === 'object' && !Array.isArray(d) ? d : {})
  .filter(([k, v]) => typeof k === 'string' && k.length <= 200 && typeof v === 'string' && v.length <= MAX_TEXT));

// session.json. recording: the recording file, as toRecordingFile made it. key: where its
// takes are kept (takesKey in recording.js), so a folder can't be used for another recording.
export function toSession({ key, recording, takes = [], drafts = {}, app = '' }) {
  return {
    scribecueSession: SESSION_FORMAT,
    app,
    saved: new Date().toISOString(),
    key,
    recording,
    drafts: cleanDrafts(drafts),
    takes: takes.map(cleanTake).filter(Boolean).map((t) => (t.peak === -Infinity ? { ...t, peak: null } : t)),
  };
}

// Reads a parsed session.json. Throws an Error in words for the narrator. The recording
// file inside is left for fromRecordingFile to check.
export function fromSession(json) {
  if (!json || typeof json !== 'object' || !('scribecueSession' in json)) throw new Error('this isn’t a Scribecue recording session');
  if (!num(json.scribecueSession) || json.scribecueSession > SESSION_FORMAT) {
    throw new Error('it was saved by a newer version of Scribecue. Update Scribecue to open it');
  }
  if (typeof json.key !== 'string' || !json.key || !json.recording || typeof json.recording !== 'object') throw new Error('the session is damaged');
  const seen = new Set();
  const takes = (Array.isArray(json.takes) ? json.takes : []).map(cleanTake).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
  return { key: json.key, recording: json.recording, drafts: cleanDrafts(json.drafts), takes };
}

// Takes of the same block and side (the original, or its alt) have one chosen between them.
export const sameSide = (a, z) => a.block === z.block && (typeof a.alt === 'string') === (typeof z.alt === 'string');

// Makes take `pick` the chosen one of its block and side, in place.
export function choose(takes, pick) {
  for (const t of takes) if (sameSide(t, pick)) t.chosen = t === pick && t.block >= 0;
}

// The takes of a session from what's in its folder. indexed: session.json's takes. files:
// the take WAVs there, [{ id, note }], note being readTakeNote's, read only for WAVs the
// index doesn't list. A take whose WAV has gone is left out; a WAV the index doesn't list,
// such as one saved just before Scribecue stopped, is added from its own details.
// Returns { takes, found, missing }: how many were added, and how many left out.
export function rebuild(indexed, files) {
  const there = new Set(files.map((f) => f.id));
  const takes = indexed.filter((t) => there.has(t.id)).map((t) => ({ ...t }));
  const known = new Set(takes.map((t) => t.id));
  let found = 0;
  for (const f of [...files].sort((a, z) => (a.note?.made ?? 0) - (z.note?.made ?? 0))) {
    if (known.has(f.id) || f.note?.scribecueTake !== 1) continue;
    const t = cleanTake({ ...f.note, id: f.id, chosen: false });
    if (!t) continue;
    takes.push(t); known.add(t.id); found++;
    if (f.note.choose) choose(takes, t);
  }
  return { takes, found, missing: indexed.length - (takes.length - found) };
}

// A take's details as Record mode has them, with a take of no peak given its -Infinity back.
export const forRecord = (t, rec) => ({ ...t, rec, peak: num(t.peak) ? t.peak : -Infinity });
