// The dialogue lane: a video's subtitles as a read-only strip on the timeline, so the
// gaps where description fits can be seen. The lines are a reference, kept apart from
// the script: they're never blocks, and never exported.

// The shortest pause worth stopping at, in seconds. Shorter ones aren't marked either.
export const MIN_GAP = 1;
// The shortest free stretch that D stops at: enough for a few words.
export const MIN_ROOM = 1.5;
// Less speech under a block than this isn't worth a warning: subtitles often stay up a
// little after the words end.
export const MIN_CLASH = 0.3;
// How far a block made from a gap stays from what's either side of it, in seconds.
export const GAP_MARGIN = 0.2;
// A line with no length in the file lasts this long, or until the next line.
const DEFAULT_LINE = 3;

// A subtitle's words, without styling.
export function cleanLine(raw) {
  if (/\{[^}]*\\p[1-9]/.test(raw)) return ''; // an ASS drawing, not words
  return raw
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, ' ')
    .replace(/\\h/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Whether a line only describes a sound, as subtitles for deaf viewers do, such as
// "[door slams]", or "MAN: (sighs)". Nobody's speaking, so it doesn't fill a gap.
export function isSoundOnly(line) {
  const left = line.replace(/\[[^\]]*\]|\([^)]*\)|[♪♫#]/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '');
  return !left || (left !== line.trim() && /^[A-Z][A-Z '.-]*:$/.test(left));
}

// Subtitles -> what the lane draws: { lines: [{ start, end, text }], spans: [[start, end]] },
// in order. Spans are the stretches with someone speaking, with overlapping lines joined.
export function buildDialogue(raw) {
  const sorted = raw
    .map((c) => ({ start: c.start, end: c.end, text: cleanLine(c.text) }))
    .filter((c) => c.text && !isSoundOnly(c.text) && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start);
  const lines = [];
  sorted.forEach((c, i) => {
    const before = lines.at(-1);
    if (before && before.start === c.start && before.text === c.text) return; // a styled copy
    const next = sorted[i + 1]?.start ?? Infinity;
    if (!(c.end > c.start)) c.end = Math.max(c.start + 0.1, Math.min(c.start + DEFAULT_LINE, next));
    lines.push(c);
  });
  const spans = [];
  for (const { start, end } of lines) {
    const last = spans.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  }
  return { lines, spans };
}

// The gaps of at least MIN_GAP in a programme, as [{ start, end }].
export function gapsOf(spans, duration, min = MIN_GAP) {
  const gaps = [];
  let at = 0;
  for (const [start, end] of spans) {
    if (start - at >= min) gaps.push({ start: at, end: start });
    at = Math.max(at, end);
  }
  if (duration - at >= min) gaps.push({ start: at, end: duration });
  return gaps;
}

// The gap to go to from time t: dir 1, the next to start; dir -1, the last to start before
// t, so going back from inside a gap finds its start first. null if there isn't one.
export function gapFrom(gaps, t, dir) {
  const near = 0.02; // a seek lands a frame or so off
  if (dir > 0) return gaps.find((g) => g.start > t + near) || null;
  return gaps.findLast((g) => g.start < t - near) || null;
}

// The parts of the gaps that no block covers, of at least min. blocks: sorted by start.
export function freeGaps(gaps, blocks, min = MIN_ROOM) {
  const free = [];
  let k = 0;
  for (const g of gaps) {
    while (k < blocks.length && blocks[k].end <= g.start) k++;
    let at = g.start;
    for (let i = k; i < blocks.length && blocks[i].start < g.end; i++) {
      if (blocks[i].start - at >= min) free.push({ start: at, end: blocks[i].start });
      at = Math.max(at, blocks[i].end);
    }
    if (g.end - at >= min) free.push({ start: at, end: g.end });
  }
  return free;
}

// Where a block made in a free gap goes: from t, or just after the gap's start, to just
// before its end. Check it's long enough: a very short gap can leave nothing.
export function placeInGap(gap, t = gap.start, margin = GAP_MARGIN) {
  return { start: Math.max(gap.start + margin, t), end: gap.end - margin };
}

// How many seconds of speech fall between two times. Spans are sorted and don't overlap.
export function speechIn(spans, start, end) {
  let lo = 0, hi = spans.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (spans[m][1] <= start) lo = m + 1; else hi = m;
  }
  let secs = 0;
  for (let i = lo; i < spans.length && spans[i][0] < end; i++) {
    secs += Math.min(end, spans[i][1]) - Math.max(start, spans[i][0]);
  }
  return secs;
}

// Which subtitle track to show first: words rather than pictures, and all the dialogue
// rather than only forced lines. The one marked default, if any, or the first. -1 if none.
export function bestTrack(tracks) {
  const full = tracks.map((t, i) => ({ ...t, i })).filter((t) => t.text && !t.forced);
  return (full.find((t) => t.default) || full[0])?.i ?? -1;
}

// The first in a sorted list that's still on screen at t0. Lines can overlap, so it steps
// back past any that end after t0.
function firstOn(list, startOf, endOf, t0) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (startOf(list[m]) < t0) lo = m + 1; else hi = m;
  }
  while (lo > 0 && endOf(list[lo - 1]) > t0) lo--;
  return lo;
}

const FULL_DETAIL = 12;  // pixels a second, at least, to draw each line
const SHOW_TEXT = 40;    // pixels, at least, for a line to show its words
const SHOW_GAP = 46;     // pixels, at least, for a gap to show its length
const FONT = '11px ui-monospace, Menlo, monospace';

// g: the lane's canvas, already sized. C: { bar, text, dim, panel }, from the tokens in style.css.
export function drawDialogue(g, W, H, t0, pps, d, gaps, C) {
  g.fillStyle = C.panel;
  g.fillRect(0, 0, W, H);
  g.font = FONT;
  g.textBaseline = 'middle';
  const t1 = t0 + W / pps, y = 4, h = H - 8, mid = H / 2;
  if (d) {
    g.fillStyle = C.bar;
    if (pps < FULL_DETAIL) {
      for (let i = firstOn(d.spans, (s) => s[0], (s) => s[1], t0); i < d.spans.length && d.spans[i][0] <= t1; i++) {
        const [a, b] = d.spans[i];
        g.fillRect((a - t0) * pps, y, Math.max(1, (b - a) * pps), h);
      }
    } else {
      for (let i = firstOn(d.lines, (l) => l.start, (l) => l.end, t0); i < d.lines.length && d.lines[i].start <= t1; i++) {
        const l = d.lines[i], x = (l.start - t0) * pps, w = Math.max(1, (l.end - l.start) * pps);
        g.fillStyle = C.bar;
        g.fillRect(x, y, w, h);
        if (w < SHOW_TEXT) continue;
        g.save();
        g.beginPath();
        g.rect(x + 4, 0, w - 8, H);
        g.clip();
        g.fillStyle = C.text;
        g.fillText(l.text, x + 6, mid);
        g.restore();
      }
    }
  }
  g.fillStyle = C.dim;
  g.textAlign = 'center';
  for (let i = firstOn(gaps, (s) => s.start, (s) => s.end, t0); i < gaps.length && gaps[i].start <= t1; i++) {
    const { start, end } = gaps[i], w = (end - start) * pps;
    if (w >= SHOW_GAP) g.fillText(`${(end - start).toFixed(1)} s`, ((start + end) / 2 - t0) * pps, mid);
  }
  g.textAlign = 'left';
}

// ---------------------------------------------------------------- kept in the browser

// What each video showed: its lines and where they came from, so reopening one doesn't
// read the file again, and a subtitle file loaded for it comes back. By the video's name,
// size and date. The ones used longest ago go first.
const DB = 'scribecue-dialogue', STORE = 'dialogue';
const KEEP = 40;

export const dialogueKey = (file) => `${file.name}|${file.size}|${file.lastModified}`;

const open = () => new Promise((ok, fail) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('used', 'used');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const done = (q) => new Promise((ok, fail) => { q.onsuccess = () => ok(q.result); q.onerror = () => fail(q.error); });

// { choice, label, lines }, or null if nothing's kept for this video.
export async function loadDialogue(key) {
  try {
    const db = await open();
    const e = await done(db.transaction(STORE).objectStore(STORE).get(key));
    if (e) { e.used = Date.now(); db.transaction(STORE, 'readwrite').objectStore(STORE).put(e); }
    db.close();
    return e || null;
  } catch { return null; }
}

export async function saveDialogue(key, entry) {
  try {
    const db = await open();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    st.put({ key, used: Date.now(), ...entry });
    let extra = (await done(st.count())) - KEEP;
    if (extra > 0) {
      const c = st.index('used').openKeyCursor();
      c.onsuccess = () => {
        if (!c.result || extra-- <= 0) return;
        st.delete(c.result.primaryKey);
        c.result.continue();
      };
    }
    db.close();
  } catch { /* storage full or blocked: it's read again next time */ }
}
