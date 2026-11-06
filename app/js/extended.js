// Extended audio description: the programme stops at a block's start while the block is
// read, then carries on. A block can be marked, or the whole project.

// How far past a block's start a jump can land and still get its pause.
export const HOLD_WINDOW = 0.5;

export const isExtended = (c, all = false) => !!c && (all || c.extended === true);

// An extended block takes no time of the programme's: it's a short marker on the timeline,
// which a slow frame can step right over. So rather than the block under the playhead, this
// finds the first one passed since the last frame, or just before a jump's landing place.
// blocks: sorted by start. wanted(block): whether it pauses, and hasn't just been read.
export function blockToHold(blocks, prevT, t, jumped, wanted) {
  let lo = 0, hi = blocks.length - 1, last = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (blocks[m].start <= t) { last = m; lo = m + 1; } else hi = m - 1;
  }
  let found = null;
  for (let k = last; k >= 0; k--) {
    const { start } = blocks[k];
    if (jumped ? t - start >= HOLD_WINDOW : start < prevT) break;
    if (wanted(blocks[k])) found = blocks[k];
  }
  return found;
}

// Whether a block just read is still close enough to pause again, so it has to be skipped.
export const stillHeard = (start, t) => t >= start && t - start < HOLD_WINDOW;

// How long the pauses add up to. blocks: those with something to read. lengthOf(block):
// { secs, exact }, as tts.js gives it.
export function extendedSecs(blocks, all, lengthOf) {
  let secs = 0, count = 0, exact = true;
  for (const b of blocks) {
    if (!isExtended(b, all)) continue;
    const l = lengthOf(b);
    secs += l.secs;
    exact &&= l.exact;
    count++;
  }
  return { secs, blocks: count, exact };
}

// The timeline an export follows, from how long each reading is. items: sorted by start,
// { start, secs, extended }. Gives where each one now starts, the pauses as [{ at, secs }]
// in the programme's own time, and how long they add up to.
export function extendedTimeline(items) {
  const pauses = [];
  let added = 0;
  const starts = items.map(({ start, secs, extended }) => {
    const at = start + added;
    if (extended && secs > 0) { pauses.push({ at: start, secs }); added += secs; }
    return at;
  });
  return { starts, pauses, added };
}

// A script for SRT or WebVTT, whose blocks have to show how long they really last, while an
// extended block on the timeline is only a marker. With withPauses the times are those of
// the extended video, where the blocks are ordinary ones, so nothing pauses a second time.
// Otherwise a block keeps its place and is marked, ending where its reading does or at the
// next block. lengthOf(block): how long it reads, or 0 with nothing to read.
export function timedScript(cues, all, lengthOf, withPauses) {
  const reads = (c) => (isExtended(c, all) ? lengthOf(c) : 0);
  const { starts } = extendedTimeline(cues.map((c) => ({ start: c.start, secs: reads(c), extended: withPauses && isExtended(c, all) })));
  return cues.map((c, k) => {
    const secs = reads(c), { extended, ...rest } = c;
    if (withPauses) return { ...rest, start: starts[k], end: starts[k] + (secs || c.end - c.start) };
    if (!isExtended(c, all)) return c;
    const next = cues[k + 1]?.start ?? Infinity;
    return { ...rest, extended: true, end: secs ? Math.max(c.end, Math.min(c.start + secs, next)) : c.end };
  });
}

const csvCell = (v) => `"${String(v).replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`;

// The pauses as a CSV, to place them in another editor. rows: [{ block, programme, extended,
// secs, text }], the two times as text.
export function pauseList(rows) {
  const head = 'Block,Programme time,Extended time,Pause (seconds),Text';
  return [head, ...rows.map((r) => [r.block, r.programme, r.extended, r.secs.toFixed(3), csvCell(r.text)].join(','))].join('\r\n') + '\r\n';
}

// 2:05, or 1:02:05.
export function addedTime(secs) {
  const s = Math.round(secs), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
