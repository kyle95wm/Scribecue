// No-go zones: stretches of the programme where description can't go, such as a
// broadcaster's ad breaks. Blocks stop at their edges, and jump past them when dragged past the
// middle or pressed on (see crossLimit and jumpZone in bulk.js). They show
// in Write and Transcribe only, and stay in the project: no export or share carries them.

import { parseTC } from './formats.js';

export const zonesAllowed = (mode) => mode === 'write' || mode === 'transcribe';
export const LABEL_MAX = 100;
export const MIN_ZONE = 0.04; // a frame or so: anything shorter is dropped

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const newZoneId = () => crypto.randomUUID();

// A list of zones as saved: each with an id, a start, an end and a label, in time order.
// Anything malformed is dropped; a repeated id gets a new one.
export function cleanZones(value, makeId = newZoneId) {
  const seen = new Set();
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  return (Array.isArray(value) ? value : [])
    .filter((z) => z && num(z.start) && num(z.end) && z.start >= 0 && z.end - z.start >= MIN_ZONE)
    .map((z) => {
      let id = typeof z.id === 'string' && ID.test(z.id) && !seen.has(z.id) ? z.id : '';
      while (!id || seen.has(id)) id = makeId();
      seen.add(id);
      return { id, start: z.start, end: z.end, label: typeof z.label === 'string' ? z.label.trim().slice(0, LABEL_MAX) : '' };
    })
    .sort((a, z) => a.start - z.start || a.id.localeCompare(z.id));
}

// The zone at time t, if any. A zone's edges are outside it, so a block can touch them.
export const zoneAt = (zones, t) => zones.find((z) => t > z.start + 1e-6 && t < z.end - 1e-6) || null;

// Whether a stretch from a to b runs into a zone.
export const inZone = (zones, a, b) => zones.some((z) => a < z.end - 1e-6 && b > z.start + 1e-6);

// How far a block from start to end can go, earlier and later, before it runs into a zone:
// { lo, hi }. A zone it already overlaps doesn't stop it, so a block that was there before
// the zone can still be moved out.
export function zoneLimits(zones, start, end) {
  let lo = -Infinity, hi = Infinity;
  for (const z of zones) {
    if (z.end <= start + 1e-6) lo = Math.max(lo, z.end);
    else if (z.start >= end - 1e-6) hi = Math.min(hi, z.start);
  }
  return { lo, hi };
}

// ---------------------------------------------------------------- importing a segment list

// A broadcaster's segment list, such as
//   Seg 1
//   IN: 00:00:00:00
//   (Description can come in after 00:00:02:00)
//   OUT: 00:12:30:10
//   (Description must conclude by 00:12:29:15)
// Each segment is a window description may use: from "come in after" (or IN) to
// "conclude by" (or OUT). Returns { segments: [{ name, start, end }], skipped }, with
// repeated segments left out and the rest in time order. skipped counts lines that looked
// like a time but couldn't be read.
const TC = /\d+:\d{1,2}:\d{1,2}(?:[:;.]\d{1,3})?/;
export function parseSegments(text, fps = 25) {
  const found = [];
  let cur = null, skipped = 0;
  const begin = (name = '') => { if (cur) found.push(cur); cur = { name, in: null, out: null, after: null, by: null }; };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(TC);
    if (!m) {
      // A line with no time names the next segment, if it's short enough to be a name.
      if (line.length <= 40) begin(line.replace(/[:\-–—]+$/, '').trim());
      continue;
    }
    const t = parseTC(m[0], fps);
    if (!Number.isFinite(t)) { skipped++; continue; }
    const before = line.slice(0, m.index);
    const kind = /\bafter\b|\bfrom\b|\bstart/i.test(before) ? 'after'
      : /conclude|\bby\b|\bbefore\b|\buntil\b|\bend/i.test(before) ? 'by'
        : /\bout\b/i.test(before) ? 'out'
          : /\bin\b/i.test(before) ? 'in' : null;
    if (!kind) { skipped++; continue; }
    // A second IN without a name between starts a new segment.
    if (!cur || (kind === 'in' && cur.in != null) || (kind === 'after' && cur.after != null)) begin(cur && !cur.in && !cur.after ? cur.name : '');
    cur[kind] = t;
  }
  if (cur) found.push(cur);

  const seen = new Set(), segments = [];
  for (const s of found) {
    const start = s.after ?? s.in, end = s.by ?? s.out;
    if (start == null || end == null || !(end > start)) continue;
    const key = `${start.toFixed(3)}-${end.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push({ name: s.name, start, end, out: s.out ?? end });
  }
  segments.sort((a, b) => a.start - b.start);
  segments.forEach((s, i) => { if (!s.name) s.name = `Segment ${i + 1}`; });
  return { segments, skipped };
}

// The zones around a list of segments: from the programme's start to the first, between
// each one and the next, and from the last to the end. end: the programme's length, or 0
// if it isn't known, when the last segment's OUT ends the tail.
export function zonesFromSegments(segments, end = 0) {
  if (!segments.length) return [];
  const out = [], add = (start, stop, label) => { if (stop - start >= MIN_ZONE) out.push({ start, end: stop, label }); };
  add(0, segments[0].start, `Before ${segments[0].name}`);
  let reach = segments[0].end, last = segments[0];
  for (const s of segments.slice(1)) {
    if (s.start > reach) add(reach, s.start, `Between ${last.name} and ${s.name}`);
    if (s.end > reach) { reach = s.end; last = s; }
  }
  const tail = end > 0 ? end : Math.max(...segments.map((s) => s.out));
  add(reach, tail, `After ${last.name}`);
  return cleanZones(out);
}

// How many blocks run into a zone.
export const blocksInZones = (cues, zones) => (zones.length ? cues.filter((c) => inZone(zones, c.start, c.end)).length : 0);
