import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDialogue, cleanLine, isSoundOnly, gapsOf, gapFrom, bestTrack, drawDialogue, MIN_GAP } from '../app/js/dialogue.js';

test('takes the styling out of a subtitle', () => {
  assert.equal(cleanLine('{\\an8}<i>Hello</i>\\Nthere'), 'Hello there');
  assert.equal(cleanLine('Fish &amp; chips\n- Yes'), 'Fish & chips - Yes');
  assert.equal(cleanLine('{\\p1}m 0 0 l 10 10{\\p0}'), '');
});

test('tells sound notes from speech', () => {
  for (const s of ['[door slams]', '(sighs)', '♪ ♪', '- [gasps]', 'MAN: (sighs)']) assert.ok(isSoundOnly(s), s);
  for (const s of ['Hello', '[sighs] Fine.', '♪ Happy birthday ♪', 'Dr. Lee: Sit down.']) assert.ok(!isSoundOnly(s), s);
});

test('joins overlapping lines into one stretch of speech, and skips sound notes', () => {
  const { lines, spans } = buildDialogue([
    { start: 5, end: 6, text: 'Later' },
    { start: 1, end: 3, text: 'First' },
    { start: 2, end: 4, text: 'Over it' },
    { start: 4.5, end: 4.8, text: '[bang]' },
  ]);
  assert.deepEqual(lines.map((l) => l.text), ['First', 'Over it', 'Later']);
  assert.deepEqual(spans, [[1, 4], [5, 6]]);
});

test('drops styled copies of a line', () => {
  const { lines } = buildDialogue([{ start: 1, end: 2, text: 'Hi' }, { start: 1, end: 2, text: '{\\b1}Hi' }]);
  assert.equal(lines.length, 1);
});

test('gives a line with no length a usual one, up to the next line', () => {
  const { lines } = buildDialogue([{ start: 1, end: null, text: 'A' }, { start: 2, end: null, text: 'B' }, { start: 20, end: null, text: 'C' }]);
  assert.deepEqual(lines.map((l) => l.end), [2, 5, 23]);
});

test('finds the gaps, including before the first line and after the last', () => {
  assert.deepEqual(gapsOf([[2, 3], [3.5, 4], [10, 11]], 15), [{ start: 0, end: 2 }, { start: 4, end: 10 }, { start: 11, end: 15 }]);
  assert.deepEqual(gapsOf([], 15), [{ start: 0, end: 15 }]);
  assert.deepEqual(gapsOf([[0, 15]], 15), []);
  assert.ok(MIN_GAP > 0.5, 'a breath between lines isn’t a gap');
});

test('moves between gaps', () => {
  const gaps = [{ start: 0, end: 2 }, { start: 4, end: 10 }, { start: 11, end: 15 }];
  assert.equal(gapFrom(gaps, 5, 1).start, 11);
  assert.equal(gapFrom(gaps, 5, -1).start, 4);
  assert.equal(gapFrom(gaps, 4, -1).start, 0); // already at its start: the one before
  assert.equal(gapFrom(gaps, 4.01, 1).start, 11);
  assert.equal(gapFrom(gaps, 12, 1), null);
  assert.equal(gapFrom(gaps, 0, -1), null);
});

test('prefers a full track of words', () => {
  const t = (o) => ({ text: true, forced: false, default: false, ...o });
  assert.equal(bestTrack([t({ text: false, default: true }), t({ forced: true }), t({}), t({ default: true })]), 3);
  assert.equal(bestTrack([t({ forced: true }), t({}), t({})]), 1);
  assert.equal(bestTrack([t({ text: false })]), -1);
  assert.equal(bestTrack([t({ forced: true })]), -1);
  assert.equal(bestTrack([]), -1);
});

function pretendCanvas() {
  const calls = { bars: 0, words: [] };
  return { calls, g: { fillRect() { calls.bars++; }, fillText(s) { calls.words.push(s); }, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} } };
}
const C = { bar: 'b', text: 't', dim: 'd', panel: 'p' };
const d = buildDialogue([{ start: 10, end: 14, text: 'On screen' }, { start: 20, end: 21, text: 'Short' }, { start: 500, end: 504, text: 'Far off' }]);

test('draws only what’s on screen, zoomed in', () => {
  const { g, calls } = pretendCanvas();
  drawDialogue(g, 1000, 30, 0, 50, d, gapsOf(d.spans, 600), C);
  assert.deepEqual(calls.words, ['On screen', 'Short', '10.0 s', '6.0 s']); // the first and third fit
  assert.equal(calls.bars, 3); // the panel and two lines
});

test('zoomed out, a long film draws stretches of speech without their words', () => {
  const many = buildDialogue(Array.from({ length: 2000 }, (_, i) => ({ start: i * 3.6, end: i * 3.6 + 2, text: `Line ${i}` })));
  const { g, calls } = pretendCanvas();
  drawDialogue(g, 1500, 30, 0, 1500 / 7200, many, gapsOf(many.spans, 7200), C);
  assert.deepEqual(calls.words, []);
  assert.ok(calls.bars <= 2001);
});
