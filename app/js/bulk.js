// Ticking several blocks in the list to change them at once: what the ticks cover, and how
// far ticked blocks can move. The page's side is in app.js.

import { parseTC } from './formats.js';

// The ids of the blocks from one to the other, either way round, both included.
export function rangeIds(cues, fromId, toId) {
  let a = cues.findIndex((c) => c.id === fromId), b = cues.findIndex((c) => c.id === toId);
  if (b < 0) return [];
  if (a < 0) a = b;
  if (a > b) [a, b] = [b, a];
  return cues.slice(a, b + 1).map((c) => c.id);
}

// How far the ticked blocks can move by d seconds without newly running into a block that
// isn't ticked, or going before 0 or past the end. Blocks next to each other move as one,
// so the gaps between ticked blocks stay as they were. Returns d, or less of it.
export function moveLimit(cues, ticked, d, end = 0) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < cues.length; i++) {
    if (!ticked.has(cues[i].id)) continue;
    let j = i, start = cues[i].start, last = cues[i].end;
    while (j + 1 < cues.length && ticked.has(cues[j + 1].id)) { j++; start = Math.min(start, cues[j].start); last = Math.max(last, cues[j].end); }
    const p = cues[i - 1], n = cues[j + 1];
    const from = p ? Math.min(p.end, start) : 0;
    const to = n ? Math.max(n.start, last) : Math.max(end, last);
    lo = Math.max(lo, from - start);
    hi = Math.min(hi, to - last);
    i = j;
  }
  if (lo === -Infinity) return 0;
  return Math.min(Math.max(d, lo), hi);
}

// Moves the ticked blocks d seconds, or as far as moveLimit lets them, as Move… and the
// nudge keys do. Returns how far they moved.
export function moveTicked(cues, ticked, d, end = 0) {
  d = moveLimit(cues, ticked, d, end);
  if (d) for (const c of cues) if (ticked.has(c.id)) { c.start += d; c.end += d; }
  return d;
}

// Dragging ticked blocks on the timeline: puts each back where the drag began, then moves
// them all dt seconds, or as far as moveLimit lets them. Working from where they began means
// dragging back after they've stopped short follows the pointer again. from: { c: the block,
// s and e: where it was }. Returns how far they moved.
export function dragTicked(cues, ticked, from, dt, end = 0) {
  for (const { c, s, e } of from) { c.start = s; c.end = e; }
  const d = moveLimit(cues, ticked, dt, end);
  for (const { c } of from) { c.start += d; c.end += d; }
  return d;
}

// How far to move, as typed: seconds ("1.5"), minutes and seconds ("1:02") or a timecode.
// No sign: Earlier and Later say which way. Returns seconds, or NaN.
export function parseAmount(str, fps = 25) {
  const s = String(str).trim().replace(/^[+−-]/, '');
  const t = parseTC(s, fps);
  return t > 0 ? t : NaN;
}

// The ticked blocks' numbers for a message: "#3, #4 and #9", or "#3, #4, #9 and 9 more".
export function blockList(cues, ticked, most = 3) {
  const nums = [];
  cues.forEach((c, i) => { if (ticked.has(c.id)) nums.push(`#${i + 1}`); });
  if (nums.length <= 1) return nums.join('');
  if (nums.length <= most + 1) return `${nums.slice(0, -1).join(', ')} and ${nums.at(-1)}`;
  return `${nums.slice(0, most).join(', ')} and ${nums.length - most} more`;
}
