// Extended audio description: the programme stops at a block's start while the block is
// read, then carries on. A block can be marked, or the whole project.

// How far past its start a block still gets its pause. Past that, as when playing from the
// middle of a block, it plays on unread. Wide enough for a slow frame not to miss it.
export const HOLD_WINDOW = 0.5;

export const isExtended = (c, all = false) => !!c && (all || c.extended === true);

// Whether reaching t in a block starting at start pauses for its reading. heard: it has just
// been read, so the block plays on.
export const holdsAt = (start, t, heard = false) => !heard && t >= start && t - start < HOLD_WINDOW;

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
