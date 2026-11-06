import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExtended, blockToHold, stillHeard, extendedSecs, addedTime, HOLD_WINDOW } from '../app/js/extended.js';

test('a block is extended when marked, or when the whole project is', () => {
  assert.equal(isExtended({ extended: true }), true);
  assert.equal(isExtended({}), false);
  assert.equal(isExtended({}, true), true);
  assert.equal(isExtended(null, true), false);
  assert.equal(isExtended(undefined), false);
});

const held = (blocks, prevT, t, jumped = false, skip = null) => blockToHold(blocks, prevT, t, jumped, (b) => b.extended && b !== skip)?.start;
const script = [{ start: 5 }, { start: 10, extended: true }, { start: 10.2, extended: true }, { start: 20, extended: true }];

test('a block pauses as the playhead reaches it', () => {
  assert.equal(held(script, 9.98, 10), 10);
  assert.equal(held(script, 9.98, 9.99), undefined);
  assert.equal(held(script, 4.9, 5.1), undefined); // not an extended block
});

test('a slow frame stepping right over a marker still pauses there', () => {
  assert.equal(held(script, 19.5, 20.8), 20);
  assert.equal(held(script, 9, 12), 10); // the first of those it passed
});

test('once read, the next one close by still pauses, and it does not pause again', () => {
  assert.equal(held(script, 10.01, 10.02), undefined);
  assert.equal(held(script, 10, 10.05, false, script[1]), undefined);
  assert.equal(held(script, 10.15, 10.25, false, script[1]), 10.2);
  assert.equal(held(script, 10.2, 10.3, false, script[2]), undefined);
  assert.equal(stillHeard(10, 10.2), true);
  assert.equal(stillHeard(10, 10 + HOLD_WINDOW), false);
  assert.equal(stillHeard(10, 9.9), false); // jumped back before it
});

test('a jump pauses only if it lands just after a block', () => {
  assert.equal(held(script, 2, 20.3, true), 20);
  assert.equal(held(script, 2, 21, true), undefined);
  assert.equal(held(script, 30, 20.1, true), 20);
  assert.equal(held(script, 2, 15, true), undefined); // jumped over blocks
});

test('the pauses add up, marked blocks or every block', () => {
  const blocks = [{ extended: true, s: 3 }, { s: 5 }, { extended: true, s: 2.5, rough: true }];
  const lengthOf = (b) => ({ secs: b.s, exact: !b.rough });
  assert.deepEqual(extendedSecs(blocks, false, lengthOf), { secs: 5.5, blocks: 2, exact: false });
  assert.deepEqual(extendedSecs(blocks, true, lengthOf), { secs: 10.5, blocks: 3, exact: false });
  assert.deepEqual(extendedSecs(blocks.slice(0, 2), false, lengthOf), { secs: 3, blocks: 1, exact: true });
  assert.deepEqual(extendedSecs([], true, lengthOf), { secs: 0, blocks: 0, exact: true });
});

test('added time reads as a running time', () => {
  assert.equal(addedTime(8), '0:08');
  assert.equal(addedTime(125.4), '2:05');
  assert.equal(addedTime(3725), '1:02:05');
});
