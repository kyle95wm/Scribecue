import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockFromPlayhead, BACK_GRACE } from '../app/js/nav.js';

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
