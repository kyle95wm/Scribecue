import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExtended, blockToHold, stillHeard, extendedSecs, addedTime, extendedTimeline, timedScript, pauseList, HOLD_WINDOW } from '../app/js/extended.js';

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

test('each pause moves what comes after it, and nothing before', () => {
  const { starts, pauses, added } = extendedTimeline([
    { start: 2, secs: 1 }, { start: 5, secs: 3, extended: true }, { start: 5.05, secs: 1 }, { start: 9, secs: 2, extended: true }, { start: 20, secs: 1 },
  ]);
  assert.deepEqual(starts.map((s) => +s.toFixed(3)), [2, 5, 8.05, 12, 25]);
  assert.deepEqual(pauses, [{ at: 5, secs: 3 }, { at: 9, secs: 2 }]);
  assert.equal(added, 5);
});

test('two extended blocks at one moment read one after the other', () => {
  const { starts, added } = extendedTimeline([{ start: 5, secs: 3, extended: true }, { start: 5, secs: 2, extended: true }]);
  assert.deepEqual(starts, [5, 8]);
  assert.equal(added, 5);
});

test('blocks marked extended with no reading add nothing, and without marks nothing moves', () => {
  assert.deepEqual(extendedTimeline([{ start: 1, secs: 0, extended: true }, { start: 2, secs: 1 }]), { starts: [1, 2], pauses: [], added: 0 });
});

const lines = [
  { start: 1, end: 2, text: 'plain' },
  { start: 4, end: 4.1, text: 'held', extended: true },
  { start: 4.5, end: 6, text: 'after' },
];
const lengths = (c) => (c.text === 'held' ? 3 : 1);

test('on the extended timeline, a script shows real lengths and pauses nothing again', () => {
  const out = timedScript(lines, false, lengths, true);
  assert.deepEqual(out.map((c) => [c.start, c.end]), [[1, 2], [4, 7], [7.5, 9]]);
  assert.ok(out.every((c) => !('extended' in c)));
});

test('with the original timing, a block ends with its reading or at the next block, still marked', () => {
  const out = timedScript(lines, false, lengths, false);
  assert.deepEqual(out[0], lines[0]);
  assert.deepEqual([out[1].start, out[1].end, out[1].extended], [4, 4.5, true]);
  const alone = timedScript([lines[1]], false, lengths, false);
  assert.equal(alone[0].end, 7);
  assert.equal(lines[1].end, 4.1, 'the blocks themselves are left alone');
});

test('a whole project extended is marked in the script, as a reopened file has no other way to know', () => {
  const out = timedScript([{ start: 1, end: 1.1, text: 'a' }], true, () => 2, false);
  assert.equal(out[0].extended, true);
  assert.equal(out[0].end, 3);
});

test('a block with nothing to read keeps its length', () => {
  const blank = { start: 1, end: 3, text: '', extended: true };
  assert.deepEqual(timedScript([blank], false, () => 0, true).map((c) => [c.start, c.end]), [[1, 3]]);
  assert.equal(timedScript([blank], false, () => 0, false)[0].end, 3);
});

test('the pause list is a CSV a spreadsheet opens safely', () => {
  const csv = pauseList([{ block: 3, programme: '00:00:04.000', extended: '00:00:07.000', secs: 2.5, text: '=She says "go" now' }]);
  assert.equal(csv, `Block,Programme time,Extended time,Pause (seconds),Text\r\n3,00:00:04.000,00:00:07.000,2.500,"'=She says ""go"" now"\r\n`);
});
