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

// Where the playhead goes when a block is closed with Esc or Enter. replay: the Replay
// setting. clicked: the block was clicked open, so the playhead hasn't been to it yet.
// 'heard' is where hearing the block starts, 'start' is its start, null stays put.
export const afterEdit = (replay, clicked) => (replay ? 'heard' : clicked ? 'start' : null);

// Keeping a copied audio track in step with the video (see syncAlt in app.js). Small
// gaps close by playing the track a little faster or slower. The nudge is a fixed step,
// started only once the gap is noticeable and stopped once it has closed, so the speed
// changes rarely. Firefox doesn't get nudges at all: it restarts its audio on every
// change, and that stutters, and can fall further behind and set off more jumps.
export const nudges = (browser) => browser !== 'Firefox';
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

// Return to start (a setting), as in a sound editor: stopping puts the playhead back where
// that playback began, so play starts there again. on: the setting. start: where playback
// began, or null. t: the playhead now. Returns where the playhead goes on stopping.
export const stopAt = (on, start, t) => (on && start != null ? start : t);
// Return to start is for recording: it only works in Record mode.
export const returnsToStart = (on, mode) => !!on && mode === 'record';

// Lead-in (a setting): hearing a block again starts this many seconds before it, so you
// hear what leads into it. 0 starts at the block.
export const LEAD_MAX = 30;
// What's typed or stored, as a tenth of a second from 0 to LEAD_MAX. Anything else is 0.
export const cleanLead = (v) => {
  const n = Math.round(parseFloat(v) * 10) / 10;
  return n > 0 ? Math.min(n, LEAD_MAX) : 0;
};
// Where hearing a block that starts at `start` begins.
export const leadFrom = (start, lead) => Math.max(0, start - lead);

// Dragging the playhead over a long film: each new seek cancels the last, so where a jump
// is slow to decode the picture never catches up until you stop. While the video is
// seeking, only the latest place is kept, and it's gone to once the seek lands, so the
// picture follows the drag. Letting go goes to the last place straight away, as before.
// seeking: whether the video is seeking. go(t): seeks.
export function scrubber(seeking, go) {
  let next = null;
  return {
    get target() { return next; },
    to(t) { if (seeking()) next = t; else { next = null; go(t); } },
    seeked() { this.done(); },
    done() { if (next == null) return; const t = next; next = null; go(t); },
    clear() { next = null; },
  };
}
