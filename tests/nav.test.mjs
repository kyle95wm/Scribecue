import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterEdit, blockFromPlayhead, blockUnder, BACK_GRACE, nudgeFor, nudges, NUDGE_START, takeFrom, stopAt, returnsToStart, scrubber, cleanLead, leadFrom, LEAD_MAX } from '../app/js/nav.js';

const cues = [{ start: 2, end: 5 }, { start: 10, end: 14 }, { start: 20, end: 22 }];

test('back goes to the start of the block being played, then to the one before', () => {
  assert.equal(blockFromPlayhead(cues, 12, -1, true), 1); // inside block 2: its start
  assert.equal(blockFromPlayhead(cues, 10, -1, false), 0); // paused at its start: block 1
  assert.equal(blockFromPlayhead(cues, 10 + BACK_GRACE / 2, -1, true), 0); // just pressed, still playing
  assert.equal(blockFromPlayhead(cues, 10.5, -1, false), 1); // paused a little in: its start
  assert.equal(blockFromPlayhead(cues, 16, -1, true), 1); // in the gap after: the block before it
  assert.equal(blockFromPlayhead(cues, 2, -1, false), -1); // at the first block's start
  assert.equal(blockFromPlayhead(cues, 1, -1, true), -1); // before any block
});

test('closing a block moves the playhead with Replay, or if the block was clicked open', () => {
  assert.equal(afterEdit(true, true), 'heard');
  assert.equal(afterEdit(true, false), 'heard');
  assert.equal(afterEdit(false, true), 'start');
  assert.equal(afterEdit(false, false), null);
});

test('next goes to the next block after the playhead', () => {
  assert.equal(blockFromPlayhead(cues, 0, 1), 0);
  assert.equal(blockFromPlayhead(cues, 3, 1), 1); // inside block 1
  assert.equal(blockFromPlayhead(cues, 10, 1), 2); // at block 2's start: the one after
  assert.equal(blockFromPlayhead(cues, 21, 1), -1);
  assert.equal(blockFromPlayhead([], 0, 1), -1);
});

test('a copied track is nudged rarely, in fixed steps, to stay in step', () => {
  // Small jitter, as currentTime readings have, changes nothing.
  for (const d of [0, 0.02, -0.03, 0.039]) assert.equal(nudgeFor(d, 0), 0);
  // Ahead: slow down; behind: speed up.
  assert.equal(nudgeFor(0.06, 0), -1);
  assert.equal(nudgeFor(-0.06, 0), 1);
  // Keeps going until close, then stops.
  assert.equal(nudgeFor(0.03, -1), -1);
  assert.equal(nudgeFor(0.005, -1), 0);
  // Overshooting to the other side stops it too, rather than swinging back and forth.
  assert.equal(nudgeFor(-0.02, -1), 0);
  // A gap closing at 4% per tick of 0.1 s changes the speed twice: on and off.
  let drift = 0.12, n = 0, changes = 0;
  for (let i = 0; i < 100; i++) {
    const next = nudgeFor(drift + (i % 2 ? 0.008 : -0.008), n); // with jitter
    if (next !== n) changes++;
    n = next;
    drift += 0.1 * 0.04 * n;
  }
  assert.equal(changes, 2);
  assert.ok(Math.abs(drift) < NUDGE_START);
});

test('a take of your own read starts from the playhead inside the block, like punching in', () => {
  // Block 5–8 s. After a breath the playhead rests at the end so far: carry on from there.
  assert.equal(takeFrom(6.4, 5, 6.4), 6.4);
  // Stepped back to redo the rest from just before a flub.
  assert.equal(takeFrom(5.9, 5, 6.4), 5.9);
  // At the block's start (G), before it or past its end: start over.
  assert.equal(takeFrom(5, 5, 8), 5);
  assert.equal(takeFrom(3, 5, 8), 5);
  assert.equal(takeFrom(9, 5, 8), 5);
});

test('return to start: stopping goes back to where playback began', () => {
  assert.equal(stopAt(true, 5, 15), 5); // played from 5, stopped at 15
  assert.equal(stopAt(true, 0, 15), 0); // from the very start
  assert.equal(stopAt(false, 5, 15), 15); // the setting is off: stays where it stopped
  assert.equal(stopAt(true, null, 15), 15); // nothing to go back to
  // Only in Record mode.
  assert.equal(returnsToStart(true, 'record'), true);
  for (const mode of ['write', 'transcribe', 'qc']) assert.equal(returnsToStart(true, mode), false);
  assert.equal(returnsToStart(false, 'record'), false);
});

test('a drag waits for each seek to land, then goes to the latest place', () => {
  let seeking = false;
  const went = [];
  const s = scrubber(() => seeking, (t) => { went.push(t); seeking = true; });
  s.to(10);
  s.to(20); s.to(30);
  assert.deepEqual(went, [10], 'later places wait while the video seeks');
  assert.equal(s.target, 30);
  seeking = false; s.seeked();
  assert.deepEqual(went, [10, 30], 'only the latest place is gone to');
  assert.equal(s.target, null);
  seeking = false; s.seeked();
  assert.deepEqual(went, [10, 30], 'nothing waiting: nothing to do');
  seeking = true; s.to(40); s.clear(); seeking = false; s.seeked();
  assert.deepEqual(went, [10, 30], 'a click or key clears what was waiting');
  seeking = true; s.to(50); s.done();
  assert.deepEqual(went, [10, 30, 50], 'letting go goes to the last place without waiting');
});

test('Firefox doesn’t get nudges, as a speed change restarts its audio', () => {
  assert.equal(nudges('Firefox'), false);
  for (const b of ['Chrome', 'Edge', 'Safari', 'Brave']) assert.equal(nudges(b), true);
});

test('a lead-in of 0 starts at the block, and others before it', () => {
  assert.equal(leadFrom(10, 0), 10);
  assert.equal(leadFrom(10, 2.5), 7.5);
  assert.equal(leadFrom(1, 3), 0); // never before the video starts
  assert.equal(leadFrom(0, 3), 0); // a block at the very start has no lead-in
});

test('the lead-in setting keeps what makes sense', () => {
  assert.equal(cleanLead('2'), 2);
  assert.equal(cleanLead('1.5'), 1.5);
  assert.equal(cleanLead(1.26), 1.3);
  assert.equal(cleanLead(LEAD_MAX + 5), LEAD_MAX);
  for (const v of ['', null, undefined, 'abc', '-3', '0', 0]) assert.equal(cleanLead(v), 0);
});

test('Enter takes a playhead just before a block start as on that block', () => {
  const touching = [{ start: 3.04, end: 5.12 }, { start: 5.12, end: 7.32 }];
  const gap = [{ start: 3.04, end: 5.1 }, { start: 5.12, end: 7.32 }];
  const at = (list) => (t) => list.find((c) => c.start <= t && c.end > t) || null;
  const half = 1 / 25 / 2;
  // a browser reporting 5.1199 for a seek to 5.12
  assert.equal(blockUnder(5.1199, at(touching), half), touching[1]); // not the block before
  assert.equal(blockUnder(5.1199, at(gap), half), gap[1]); // not "no room" in the gap
  assert.equal(blockUnder(5.12, at(touching), half), touching[1]);
  assert.equal(blockUnder(4, at(touching), half), touching[0]); // well inside a block
  assert.equal(blockUnder(5.105, at(gap), half), gap[1]); // within half a frame
  assert.equal(blockUnder(5.09, at(gap), half), gap[0]);
  assert.equal(blockUnder(8, at(touching), half), null); // past the end: a new block
});
