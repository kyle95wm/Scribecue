// Previous and next block from the playhead, like a media player's buttons: going back
// first returns to the start of the block being played, and only goes to the block
// before it when the playhead is already at that start. While playing, "at the start"
// allows a second, so pressing twice quickly still steps back a block.

export const BACK_GRACE = 1; // seconds into a block, while playing
const AT = 0.05; // paused: this close to a start counts as at it

// cues: sorted by start. Returns the index to go to, or -1 when there's nothing that way.
export function blockFromPlayhead(cues, t, d, playing = false) {
  if (!cues.length) return -1;
  if (d > 0) return cues.findIndex((c) => c.start > t + AT);
  const cur = cues.findLastIndex((c) => c.start <= t + AT);
  if (cur < 0) return -1;
  return t - cues[cur].start > (playing ? BACK_GRACE : AT) ? cur : cur - 1;
}

// Keeping a copied audio track in step with the video (see syncAlt in app.js). Small
// gaps close by playing the track a little faster or slower. The nudge is a fixed step,
// started only once the gap is noticeable and stopped once it has closed, so the speed
// changes rarely: Firefox restarts its audio on every change, which stutters.
export const NUDGE_START = 0.04; // seconds apart before nudging
export const NUDGE_STOP = 0.01; // close enough to stop
export const NUDGE = 0.04; // 4% faster or slower

// drift: how far the track is ahead of the video, in seconds. nudging: -1 (slowing), 0
// or 1 (speeding up), as last returned. Returns what to do now.
export function nudgeFor(drift, nudging) {
  if (!nudging) return Math.abs(drift) > NUDGE_START ? (drift > 0 ? -1 : 1) : 0;
  // Stop once close, or once it has overshot to the other side.
  return Math.abs(drift) < NUDGE_STOP || Math.sign(drift) === nudging ? 0 : nudging;
}

// Where a take of your own read starts, holding H in Write mode, like punching in on a
// recording: from the playhead when it's inside the block (after a breath, or stepped
// back to redo the rest), and from the block's start otherwise.
export const takeFrom = (t, start, end) => (t > start + 0.01 && t <= end + 0.01 ? t : start);
