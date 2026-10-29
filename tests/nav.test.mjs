import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockFromPlayhead, BACK_GRACE, nudgeFor, NUDGE_START, takeFrom } from '../app/js/nav.js';

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
