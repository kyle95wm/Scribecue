import { cleanComments } from './comments.js';

// Scribecue project files (.scribecue): a whole piece of work in one JSON file, so you
// can keep several projects and pick up where you left off. SRT and VTT exports are for
// handing scripts off; a project also keeps block speeds, "sounds like" words and auto ends, the mode and its
// settings, where you were, and which video it belongs to.

export const PROJECT_EXT = '.scribecue';
export const PROJECT_FORMAT = 1;

// Persistent identities are separate from the editor's temporary numeric ids.
export const validIdentity = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export const newIdentity = () => crypto.randomUUID();

// Checkpoint payloads are immutable JSON strings. Keeping them opaque here avoids
// parsing every old script during autosave. The comparison worker verifies their hashes.
export const HISTORY_LIMIT = 4, HISTORY_CHARS = 1024 * 1024;
export const validRevision = (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
export function cleanReviewHistory(value) {
  if (value == null) return null;
  if (value.version !== 1 || !Array.isArray(value.checkpoints) || !value.checkpoints.length || value.checkpoints.length > HISTORY_LIMIT) {
    throw new Error('This QC package has unsupported revision history');
  }
  let size = 0; const seen = new Set();
  const checkpoints = value.checkpoints.map((c) => {
    if (!c || !validRevision(c.id) || seen.has(c.id) || typeof c.snapshot !== 'string' ||
      !Array.isArray(c.parents) || c.parents.length > 2 || c.parents.some((id) => !validRevision(id) || id === c.id)) {
      throw new Error('The QC review history is damaged');
    }
    seen.add(c.id); size += c.snapshot.length;
    if (size > HISTORY_CHARS) throw new Error('The QC review history is too large');
    return { id: c.id, parents: [...c.parents], snapshot: c.snapshot };
  });
  return { version: 1, checkpoints };
}

// A reference to verified original readings, never an editing permission.
export function cleanReviewAudio(value) {
  if (value == null) return null;
  if (!validRevision(value.baselineId)) throw new Error('The original readings reference is damaged');
  return { baselineId: value.baselineId };
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
// A block's "sounds like" words, [[written, said], …], with anything malformed dropped.
export const cleanSay = (say) => (Array.isArray(say) ? say : [])
  .filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && p[0].trim() && p[1].trim())
  .map(([w, s]) => [w.trim(), s.trim()]);

// state: { blocks, media, settings, view, app, notes }. Returns the object to save as JSON.
// notes: what the writer tells AI help about the programme (characters, setting, style).
export function toProject({ blocks, media = null, settings = {}, view = {}, app = '', notes = '', words = [], comments = [], recording = null, projectId = null, reviewHistory = null, reviewAudio = null }) {
  return {
    scribecue: PROJECT_FORMAT,
    ...(validIdentity(projectId) ? { projectId } : {}),
    ...(reviewHistory != null ? { reviewHistory: cleanReviewHistory(reviewHistory) } : {}),
    ...(reviewAudio != null ? { reviewAudio: cleanReviewAudio(reviewAudio) } : {}),
    app,
    saved: new Date().toISOString(),
    ...(notes.trim() ? { notes } : {}),
    ...(cleanWords(words).length ? { words: cleanWords(words) } : {}),
    ...(cleanComments(comments, true).length ? { comments: cleanComments(comments, true) } : {}),
    media: media && media.name ? { name: media.name, size: media.size ?? null, duration: num(media.duration) ? media.duration : null } : null,
    ...(cleanRecording(recording) ? { recording: cleanRecording(recording) } : {}),
    settings,
    view,
    blocks: blocks.map(({ uid, start, end, text, speed, voice, dip, dipBy, vol, auto, fit, pinned, say, comments, qcReading, pickup, extended, notes }) => ({
      ...(validIdentity(uid) ? { uid } : {}),
      start, end, text,
      ...(cleanNotes(notes) ? { notes: cleanNotes(notes) } : {}),
      ...(cleanPickup(pickup) ? { pickup: cleanPickup(pickup) } : {}),
      ...(extended === true ? { extended: true } : {}),
      ...(Number.isSafeInteger(qcReading) && qcReading >= 8 ? { qcReading } : {}),
      ...(cleanComments(comments).length ? { comments: cleanComments(comments) } : {}),
      ...(speed ? { speed } : {}),
      ...(voice ? { voice } : {}),
      ...(num(dip) ? { dip } : {}),
      ...(num(dipBy) && dipBy ? { dipBy } : {}),
      ...(num(vol) ? { vol } : {}),
      ...(cleanSay(say).length ? { say: cleanSay(say) } : {}),
      ...(auto ? { auto: true } : {}),
      ...(fit ? { fit: true } : {}),
      ...(pinned ? { pinned: true } : {}),
    })),
  };
}

// Reads a parsed project file, checking it as it goes. Throws an Error that says what's
// wrong, in words for the person opening it.
export function fromProject(json) {
  if (!json || typeof json !== 'object' || !('scribecue' in json)) throw new Error('this isn’t a Scribecue project file');
  if (!num(json.scribecue) || json.scribecue > PROJECT_FORMAT) {
    throw new Error('it was saved by a newer version of Scribecue. Update Scribecue to open it');
  }
  if (!Array.isArray(json.blocks)) throw new Error('it has no blocks');
  const blocks = [], identities = new Set();
  for (const b of json.blocks) {
    if (!b || !num(b.start) || !num(b.end)) continue;
    if (validIdentity(b.uid)) {
      if (identities.has(b.uid)) throw new Error('two blocks have the same identity');
      identities.add(b.uid);
    }
    blocks.push({
      ...(validIdentity(b.uid) ? { uid: b.uid } : {}),
      ...(cleanComments(b.comments).length ? { comments: cleanComments(b.comments) } : {}),
      ...(Number.isSafeInteger(b.qcReading) && b.qcReading >= 8 ? { qcReading: b.qcReading } : {}),
      start: Math.max(0, b.start),
      end: Math.max(b.start, b.end),
      text: typeof b.text === 'string' ? b.text : '',
      ...(cleanNotes(b.notes) ? { notes: cleanNotes(b.notes) } : {}),
      ...(num(b.speed) ? { speed: b.speed } : {}),
      ...(typeof b.voice === 'string' && b.voice ? { voice: b.voice.slice(0, 300) } : {}),
      // An exact dip, from before 0.61, or none (0); the editor makes it relative.
      ...(num(b.dip) && b.dip >= 0 && b.dip <= 40 ? { dip: b.dip } : {}),
      ...(Number.isInteger(b.dipBy) && b.dipBy && Math.abs(b.dipBy) <= 40 ? { dipBy: b.dipBy } : {}),
      ...(Number.isInteger(b.vol) && b.vol >= 25 && b.vol <= 200 ? { vol: b.vol } : {}),
      ...(cleanSay(b.say).length ? { say: cleanSay(b.say) } : {}),
      ...(b.auto === true ? { auto: true } : {}),
      ...(b.fit === true ? { fit: true } : {}),
      ...(b.pinned === true ? { pinned: true } : {}),
      ...(cleanPickup(b.pickup) ? { pickup: cleanPickup(b.pickup) } : {}),
      ...(b.extended === true ? { extended: true } : {}),
    });
  }
  blocks.sort((a, z) => a.start - z.start);
  const m = json.media;
  const s = json.settings && typeof json.settings === 'object' ? json.settings : {};
  const v = json.view && typeof json.view === 'object' ? json.view : {};
  return {
    blocks,
    ...(validIdentity(json.projectId) ? { projectId: json.projectId } : {}),
    ...(json.reviewHistory != null ? { reviewHistory: cleanReviewHistory(json.reviewHistory) } : {}),
    ...(json.reviewAudio != null ? { reviewAudio: cleanReviewAudio(json.reviewAudio) } : {}),
    recording: cleanRecording(json.recording),
    comments: cleanComments(json.comments, true),
    notes: typeof json.notes === 'string' ? json.notes : '',
    words: cleanWords(json.words),
    media: m && typeof m.name === 'string' ? { name: m.name, size: num(m.size) ? m.size : null, duration: num(m.duration) ? m.duration : null } : null,
    settings: {
      ...(s.mode === 'write' || s.mode === 'transcribe' || s.mode === 'qc' ? { mode: s.mode } : {}),
      ...(num(s.offset) ? { offset: s.offset } : {}),
      ...(num(s.ttsSpeed) ? { ttsSpeed: s.ttsSpeed } : {}),
      ...(num(s.ttsBase) ? { ttsBase: s.ttsBase } : {}),
      ...(typeof s.ttsVoice === 'string' && s.ttsVoice ? { ttsVoice: s.ttsVoice } : {}),
      // How the programme dips under readings, and the Video / TTS slider, which block
      // dips and volumes build on.
      ...(typeof s.ttsSkipNotes === 'boolean' ? { ttsSkipNotes: s.ttsSkipNotes } : {}),
      ...(typeof s.ttsDuck === 'boolean' ? { ttsDuck: s.ttsDuck } : {}),
      ...(Number.isInteger(s.ttsDipDb) && s.ttsDipDb >= 1 && s.ttsDipDb <= 40 ? { ttsDipDb: s.ttsDipDb } : {}),
      ...(num(s.ttsDipFade) && s.ttsDipFade >= 0 && s.ttsDipFade <= 2 ? { ttsDipFade: s.ttsDipFade } : {}),
      ...(num(s.ttsMix) && s.ttsMix >= -1 && s.ttsMix <= 1 ? { ttsMix: s.ttsMix } : {}),
      ...(s.extendedAll === true ? { extendedAll: true } : {}),
    },
    view: {
      ...(num(v.playhead) ? { playhead: Math.max(0, v.playhead) } : {}),
      ...(Number.isInteger(v.selected) ? { selected: v.selected } : {}),
    },
  };
}

// The names and terms added to this project, so the spelling check accepts them.
export const cleanWords = (w) => [...new Set((Array.isArray(w) ? w : [])
  .filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 100)))].slice(0, 5000);

// A block's notes for the narrator, such as how to say a name. Never read aloud.
export const cleanNotes = (n) => (typeof n === 'string' && n.trim() ? n.slice(0, 2000) : '');

// A block marked for the narrator to record again: { note }, the note maybe empty.
export const cleanPickup = (p) => (p && typeof p === 'object' ? { note: typeof p.note === 'string' ? p.note.slice(0, 500) : '' } : null);

// The project's recording files: { id, version, sent }, where sent is the lines of the last
// one, so the next can ask for the lines changed since. See toRecordingFile.
export function cleanRecording(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^[a-z0-9]{16}$/.test(r.id)) return null;
  const sent = Array.isArray(r.sent) ? r.sent.filter((b) => b && num(b.start) && num(b.end) && typeof b.text === 'string').map(({ start, end, text }) => ({ start, end, text })) : [];
  return { id: r.id, version: Number.isInteger(r.version) && r.version > 0 ? r.version : 0, sent };
}

// The video saved with a project matches the one opened when name and size agree.
export const sameMedia = (saved, file) => !saved || (saved.name === file.name && (saved.size == null || saved.size === file.size));
