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

// 2:05, or 1:02:05.
export function addedTime(secs) {
  const s = Math.round(secs), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
