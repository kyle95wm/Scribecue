import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeIds, moveLimit, dragTicked, parseAmount, blockList } from '../app/js/bulk.js';

const cues = [
  { id: 1, start: 0, end: 2 },
  { id: 2, start: 3, end: 5 },
  { id: 3, start: 6, end: 8 },
  { id: 4, start: 10, end: 12 },
];

test('a Shift+click ticks every block between, either way round', () => {
  assert.deepEqual(rangeIds(cues, 2, 4), [2, 3, 4]);
  assert.deepEqual(rangeIds(cues, 4, 2), [2, 3, 4]);
  assert.deepEqual(rangeIds(cues, 99, 3), [3]);
  assert.deepEqual(rangeIds(cues, 1, 99), []);
});

test('ticked blocks move all the way when there is room', () => {
  assert.equal(moveLimit(cues, new Set([3]), 1, 20), 1);
  assert.equal(moveLimit(cues, new Set([3]), -0.5, 20), -0.5);
});

test('ticked blocks stop short of blocks that are not ticked', () => {
  assert.equal(moveLimit(cues, new Set([3]), 5, 20), 2); // block 4 starts at 10
  assert.equal(moveLimit(cues, new Set([3]), -5, 20), -1); // block 2 ends at 5
  // Two runs: the one with less room decides for both, so the gaps stay as they were.
  assert.equal(moveLimit(cues, new Set([1, 3]), 5, 20), 1);
});

test('blocks next to each other move as one', () => {
  assert.equal(moveLimit(cues, new Set([2, 3]), 5, 20), 2);
  assert.equal(moveLimit(cues, new Set([2, 3]), -5, 20), -1);
});

test('ticked blocks stay inside the video', () => {
  assert.equal(moveLimit(cues, new Set([1]), -3, 20), 0);
  assert.equal(moveLimit(cues, new Set([4]), 30, 20), 8);
  assert.equal(moveLimit(cues, new Set(), 3, 20), 0);
});

test('blocks that already overlap a neighbour do not make it worse', () => {
  const over = [{ id: 1, start: 0, end: 4 }, { id: 2, start: 3, end: 5 }, { id: 3, start: 9, end: 10 }];
  assert.equal(moveLimit(over, new Set([2]), -2, 20), 0);
  assert.equal(moveLimit(over, new Set([2]), 6, 20), 4);
});

test('how far to move reads seconds, minutes and timecode, without a sign', () => {
  assert.equal(parseAmount('1.5'), 1.5);
  assert.equal(parseAmount('−2'), 2);
  assert.equal(parseAmount('+0,5'), 0.5);
  assert.equal(parseAmount('1:02'), 62);
  assert.equal(parseAmount('00:00:01:12', 25), 1.48);
  assert.ok(Number.isNaN(parseAmount('0')));
  assert.ok(Number.isNaN(parseAmount('soon')));
});

test('the ticked blocks are listed by number', () => {
  assert.equal(blockList(cues, new Set([2])), '#2');
  assert.equal(blockList(cues, new Set([1, 3])), '#1 and #3');
  assert.equal(blockList(cues, new Set([1, 2, 3, 4])), '#1, #2, #3 and #4');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: i, start: i, end: i + 0.5 }));
  assert.equal(blockList(many, new Set(many.map((c) => c.id))), '#1, #2, #3 and 9 more');
});

test('dragging ticked blocks follows the pointer from where the drag began', () => {
  const blocks = cues.map((c) => ({ ...c }));
  const ticked = new Set([2, 3]);
  const from = blocks.filter((c) => ticked.has(c.id)).map((c) => ({ c, s: c.start, e: c.end }));
  assert.equal(dragTicked(blocks, ticked, from, 0.5, 20), 0.5);
  assert.deepEqual(blocks.map((c) => c.start), [0, 3.5, 6.5, 10]);
  // Past block 4, they stop short of it; back again, they follow the pointer, not where they stopped.
  assert.equal(dragTicked(blocks, ticked, from, 9, 20), 2);
  assert.deepEqual(blocks.map((c) => [c.start, c.end]), [[0, 2], [5, 7], [8, 10], [10, 12]]);
  assert.equal(dragTicked(blocks, ticked, from, -0.25, 20), -0.25);
  assert.deepEqual(blocks.map((c) => c.start), [0, 2.75, 5.75, 10]);
  assert.equal(dragTicked(blocks, ticked, from, 0, 20), 0);
  assert.deepEqual(blocks, cues);
});
