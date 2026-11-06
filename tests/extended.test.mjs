import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExtended, holdsAt, extendedSecs, addedTime, HOLD_WINDOW } from '../app/js/extended.js';

test('a block is extended when marked, or when the whole project is', () => {
  assert.equal(isExtended({ extended: true }), true);
  assert.equal(isExtended({}), false);
  assert.equal(isExtended({}, true), true);
  assert.equal(isExtended(null, true), false);
  assert.equal(isExtended(undefined), false);
});

test('a block pauses as the playhead reaches its start, and only then', () => {
  assert.equal(holdsAt(10, 10), true);
  assert.equal(holdsAt(10, 10.02), true);
  assert.equal(holdsAt(10, 10 + HOLD_WINDOW - 0.01), true); // a slow frame went past it
  assert.equal(holdsAt(10, 9.99), false);
  assert.equal(holdsAt(10, 12), false); // played from the middle of the block
});

test('once read, the block plays on without pausing again', () => {
  assert.equal(holdsAt(10, 10.02, true), false);
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
