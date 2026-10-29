// Scribecue project files (.scribecue): a whole piece of work in one JSON file, so you
// can keep several projects and pick up where you left off. SRT and VTT exports are for
// handing scripts off; a project also keeps block speeds, "sounds like" words and auto ends, the mode and its
// settings, where you were, and which video it belongs to.

export const PROJECT_EXT = '.scribecue';
export const PROJECT_FORMAT = 1;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
// A block's "sounds like" words, [[written, said], …], with anything malformed dropped.
export const cleanSay = (say) => (Array.isArray(say) ? say : [])
  .filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && p[0].trim() && p[1].trim())
  .map(([w, s]) => [w.trim(), s.trim()]);

// state: { blocks, media, settings, view, app, notes }. Returns the object to save as JSON.
// notes: what the writer tells AI help about the programme (characters, setting, style).
export function toProject({ blocks, media = null, settings = {}, view = {}, app = '', notes = '' }) {
  return {
    scribecue: PROJECT_FORMAT,
    app,
    saved: new Date().toISOString(),
    ...(notes.trim() ? { notes } : {}),
    media: media && media.name ? { name: media.name, size: media.size ?? null, duration: num(media.duration) ? media.duration : null } : null,
    settings,
    view,
    blocks: blocks.map(({ start, end, text, speed, auto, fit, pinned, say }) => ({
      start, end, text,
      ...(speed ? { speed } : {}),
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
  const blocks = [];
  for (const b of json.blocks) {
    if (!b || !num(b.start) || !num(b.end)) continue;
    blocks.push({
      start: Math.max(0, b.start),
      end: Math.max(b.start, b.end),
      text: typeof b.text === 'string' ? b.text : '',
      ...(num(b.speed) ? { speed: b.speed } : {}),
      ...(cleanSay(b.say).length ? { say: cleanSay(b.say) } : {}),
      ...(b.auto === true ? { auto: true } : {}),
      ...(b.fit === true ? { fit: true } : {}),
      ...(b.pinned === true ? { pinned: true } : {}),
    });
  }
  blocks.sort((a, z) => a.start - z.start);
  const m = json.media;
  const s = json.settings && typeof json.settings === 'object' ? json.settings : {};
  const v = json.view && typeof json.view === 'object' ? json.view : {};
  return {
    blocks,
    notes: typeof json.notes === 'string' ? json.notes : '',
    media: m && typeof m.name === 'string' ? { name: m.name, size: num(m.size) ? m.size : null, duration: num(m.duration) ? m.duration : null } : null,
    settings: {
      ...(s.mode === 'write' || s.mode === 'transcribe' ? { mode: s.mode } : {}),
      ...(num(s.offset) ? { offset: s.offset } : {}),
      ...(num(s.ttsSpeed) ? { ttsSpeed: s.ttsSpeed } : {}),
      ...(typeof s.ttsVoice === 'string' && s.ttsVoice ? { ttsVoice: s.ttsVoice } : {}),
    },
    view: {
      ...(num(v.playhead) ? { playhead: Math.max(0, v.playhead) } : {}),
      ...(Number.isInteger(v.selected) ? { selected: v.selected } : {}),
    },
  };
}

// The video saved with a project matches the one opened when name and size agree.
export const sameMedia = (saved, file) => !saved || (saved.name === file.name && (saved.size == null || saved.size === file.size));
