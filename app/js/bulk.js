// Ticking several blocks in the list to change them at once: what the ticks cover, and how
// far ticked blocks can move. The page's side is in app.js.

import { parseTC } from './formats.js';
import { zoneLimits } from './nogo.js';

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
// so the gaps between ticked blocks stay as they were. No-go zones stop them too.
// Returns d, or less of it.
export function moveLimit(cues, ticked, d, end = 0, zones = []) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < cues.length; i++) {
    if (!ticked.has(cues[i].id)) continue;
    let j = i, start = cues[i].start, last = cues[i].end;
    while (j + 1 < cues.length && ticked.has(cues[j + 1].id)) { j++; start = Math.min(start, cues[j].start); last = Math.max(last, cues[j].end); }
    const p = cues[i - 1], n = cues[j + 1];
    const from = p ? Math.min(p.end, start) : 0;
    const to = n ? Math.max(n.start, last) : Math.max(end, last);
    const z = zoneLimits(zones, start, last);
    lo = Math.max(lo, Math.max(from, z.lo) - start);
    hi = Math.min(hi, Math.min(to, z.hi) - last);
    i = j;
  }
  if (lo === -Infinity) return 0;
  return Math.min(Math.max(d, lo), hi);
}

// Moves the ticked blocks d seconds, or as far as moveLimit lets them, as Move… and the
// nudge keys do. Returns how far they moved.
// Crossing no-go zones. A block moved into a zone sits against its nearer edge, and once its
// middle passes the zone's middle it lands on the far side, if there's room there. Blocks
// that aren't ticked still stop it. The cues are where the move starts from.
const tickedOnes = (cues, ticked) => cues.filter((c) => ticked.has(c.id));
const overlaps = (z, a, b) => a < z.end - 1e-6 && b > z.start + 1e-6;
// The first ticked block that runs into a zone it wasn't already in, when moved by x.
function hit(blocks, zones, x) {
  for (const b of blocks) for (const z of zones) if (!overlaps(z, b.start, b.end) && overlaps(z, b.start + x, b.end + x)) return { b, z };
  return null;
}
// Moved by x, then on in direction dir (−1 or 1) until no ticked block is in a zone: how far
// that is, or null if a block that isn't ticked is in the way.
function settle(cues, ticked, x, dir, end, zones) {
  const blocks = tickedOnes(cues, ticked);
  for (let n = 0; n <= blocks.length * zones.length; n++) {
    const h = hit(blocks, zones, x);
    if (!h) return Math.abs(moveLimit(cues, ticked, x, end) - x) < 1e-9 ? x : null;
    x = dir > 0 ? h.z.end - h.b.start : h.z.start - h.b.end;
  }
  return null;
}
// How far the ticked blocks go when moved by d, as moveLimit, but able to cross zones.
export function crossLimit(cues, ticked, d, end = 0, zones = []) {
  const free = moveLimit(cues, ticked, d, end);
  const h = zones.length && hit(tickedOnes(cues, ticked), zones, free);
  if (!h) return free;
  const past = (h.b.start + h.b.end) / 2 + free > (h.z.start + h.z.end) / 2;
  return settle(cues, ticked, free, past ? 1 : -1, end, zones) ?? moveLimit(cues, ticked, d, end, zones);
}
// With the ticked blocks against a zone, how far to move them, in direction dir (−1 or 1),
// to land just past it: 0 if none is against one or there's no room beyond.
export function jumpZone(cues, ticked, dir, end = 0, zones = []) {
  for (const b of tickedOnes(cues, ticked)) {
    for (const z of zones) {
      const against = dir > 0 ? Math.abs(z.start - b.end) < 1e-6 : Math.abs(z.end - b.start) < 1e-6;
      if (against) return settle(cues, ticked, dir > 0 ? z.end - b.start : z.start - b.end, dir, end, zones) ?? 0;
    }
  }
  return 0;
}
export function moveTicked(cues, ticked, d, end = 0, zones = []) {
  d = moveLimit(cues, ticked, d, end, zones);
  if (d) for (const c of cues) if (ticked.has(c.id)) { c.start += d; c.end += d; }
  return d;
}

// Dragging ticked blocks on the timeline: puts each back where the drag began, then moves
// them all dt seconds, or as far as moveLimit lets them. Working from where they began means
// dragging back after they've stopped short follows the pointer again. from: { c: the block,
// s and e: where it was }. Returns how far they moved.
export function dragTicked(cues, ticked, from, dt, end = 0, zones = []) {
  for (const { c, s, e } of from) { c.start = s; c.end = e; }
  const d = crossLimit(cues, ticked, dt, end, zones);
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
