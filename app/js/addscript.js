// File → Add a script…: one or more scripts added to the open project, each moved to where
// it starts in this video, such as episodes of a series in a version that joins them.
// The page's side is in app.js.
import { parseSubs, parseAdc } from './formats.js';
import { fromProject, cleanWords, PROJECT_EXT } from './project.js';
import { adcBookmarks, cleanBookmarks, newBookmarkId } from './bookmarks.js';
import { cleanComments, newCommentId } from './comments.js';
import { cleanScenes } from './aiscript.js';

// What can be added: scripts, and Scribecue projects.
export const ADDABLE = /\.(srt|vtt|txt|adc|scribecue)$/i;

// A file's name without its extension, for the bookmark where it starts.
export const scriptLabel = (name) => String(name).replace(/\.[^.]+$/, '').trim() || String(name);

// Parts of a block that belong to the project it came from: its identity, its review
// readings and QC edit marks. Everything else comes along.
const OWN = ['uid', 'qcReading', 'edited'];

// A script read from a file: its blocks (as saved, in time order), and, from a project,
// its bookmarks, comments at times, scenes and names and terms. `left` names what a project
// had that isn't added. Throws when the file holds no blocks.
export function readScript(name, text) {
  const out = { name, blocks: [], bookmarks: [], comments: [], scenes: [], words: [], left: [] };
  if (name.toLowerCase().endsWith(PROJECT_EXT)) {
    let p;
    try { p = fromProject(JSON.parse(text)); } catch { throw new Error('the file is damaged'); }
    out.blocks = p.blocks.map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => !OWN.includes(k))));
    out.bookmarks = p.bookmarks;
    out.comments = p.comments;
    out.scenes = p.scenes || [];
    out.words = p.words;
    if (p.recording) out.left.push('recordings');
    if (p.reviewHistory || p.reviewAudio || p.blocks.some((b) => b.qcReading != null)) out.left.push('review');
  } else if (/\.adc$/i.test(name)) {
    out.blocks = parseAdc(text).cues;
    out.bookmarks = adcBookmarks(text);
  } else {
    out.blocks = parseSubs(text);
  }
  if (!out.blocks.length) throw new Error('it has no blocks');
  return out;
}

// Only some of a script's blocks, such as the credits: `keep` holds the indexes of the
// blocks to add. Times are moved so the first kept block is at 0, so "Starts at" is where
// it lands. Bookmarks, comments at times and scenes come along only from the first kept
// block's start to the last one's end. With every block kept, or no `keep`, the script is
// as it was, and its own time 0 stays where it starts.
export function pickBlocks(script, keep) {
  if (!keep || script.blocks.every((_, i) => keep.has(i))) return script;
  const blocks = script.blocks.filter((_, i) => keep.has(i));
  if (!blocks.length) return { ...script, blocks: [], bookmarks: [], comments: [], scenes: [] };
  const lo = Math.min(...blocks.map((b) => b.start)), hi = blocks.reduce((m, b) => Math.max(m, b.end), lo);
  const at = (t) => t - lo, inside = (t) => t >= lo && t <= hi;
  return {
    ...script,
    blocks: blocks.map((b) => ({ ...b, start: at(b.start), end: at(b.end) })),
    bookmarks: script.bookmarks.filter((m) => inside(m.time)).map((m) => ({ ...m, time: at(m.time) })),
    comments: script.comments.filter((c) => inside(c.time)).map((c) => ({ ...c, time: at(c.time) })),
    scenes: script.scenes.filter((s) => s.end > lo && s.start < hi)
      .map((s) => ({ ...s, start: at(Math.max(s.start, lo)), end: at(Math.min(s.end, hi)) })),
  };
}

// From the first block's start to the last block's end, in the script's own time.
export function span(script) {
  const b = script.blocks;
  return { first: b.length ? Math.min(...b.map((c) => c.start)) : 0, last: b.reduce((m, c) => Math.max(m, c.end), 0) };
}

// Where each script ends up in this video, given where each starts: the last block's end.
export const endsAt = (script, start) => start + span(script).last;

// A script moved to start at `by` seconds: its blocks, bookmarks, comments and scenes all
// move, and each bookmark and comment gets a new id, so adding the same file twice can't
// make two the same. A bookmark marks where it starts, named after the file.
export function shiftScript(script, by, { makeBookmarkId = newBookmarkId, makeCommentId = newCommentId } = {}) {
  const at = (t) => Math.max(0, t + by);
  const fresh = (list) => list.map((c) => ({ ...c, id: makeCommentId() }));
  const blocks = script.blocks.map((b) => ({
    ...b, start: at(b.start), end: at(b.end),
    ...(b.comments?.length ? { comments: fresh(cleanComments(b.comments)) } : {}),
  }));
  const bookmarks = cleanBookmarks([
    { time: at(0), title: scriptLabel(script.name), notes: '', kind: 'scene' },
    ...script.bookmarks.map((m) => ({ ...m, time: at(m.time), id: '' })),
  ], makeBookmarkId);
  const comments = fresh(cleanComments(script.comments, true).map((c) => ({ ...c, time: at(c.time) })));
  const scenes = cleanScenes(script.scenes.map((s) => ({ ...s, start: at(s.start), end: at(s.end) })));
  return { blocks, bookmarks, comments, scenes };
}

// Scenes after adding: each added script's scenes take the place of the stretch they cover,
// and scenes there were are cut back around it. `added` is a list of scene lists.
export function mergeScenes(existing, added) {
  let out = cleanScenes(existing);
  for (const list of added.map(cleanScenes).filter((l) => l.length)) {
    const lo = list[0].start, hi = Math.max(...list.map((s) => s.end));
    out = out.flatMap((s) => {
      if (s.end <= lo || s.start >= hi) return [s];
      const parts = [];
      if (s.start < lo) parts.push({ ...s, end: lo });
      if (s.end > hi) parts.push({ ...s, start: hi });
      return parts;
    });
    out = out.concat(list);
  }
  return cleanScenes(out);
}

// Names and terms of both, without repeats.
export const mergeWords = (words, added) => cleanWords([...words, ...added.flat()]);

// How many added blocks land on a block from somewhere else: one already there, or one from
// another added script. `groups` are lists of blocks; group 0 is the project's own. Blocks
// that only touch don't count.
export function countOverlaps(groups) {
  const all = groups.flatMap((list, g) => list.map((b) => ({ start: b.start, end: b.end, g })));
  all.sort((a, z) => a.start - z.start);
  const hit = new Set();
  let live = [];
  for (const b of all) {
    live = live.filter((o) => o.end > b.start);
    for (const o of live) {
      if (o.g === b.g) continue;
      if (b.g) hit.add(b);
      if (o.g) hit.add(o);
    }
    live.push(b);
  }
  return hit.size;
}

// What a project's file had that isn't added, for the Add window.
export function leftOutNote(scripts) {
  const has = (k) => scripts.some((s) => s.left.includes(k));
  const parts = [has('recordings') && 'recordings and takes', has('review') && 'QC review history'].filter(Boolean);
  return parts.length ? `${parts.join(' and ').replace(/^./, (c) => c.toUpperCase())} stay with ${scripts.filter((s) => s.left.length).length === 1 ? 'their project' : 'their projects'}: they were made against another video.` : '';
}
