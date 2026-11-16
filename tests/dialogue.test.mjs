import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDialogue, cleanLine, isSoundOnly, gapsOf, gapFrom, freeGaps, placeInGap, speechIn, bestTrack, drawDialogue, MIN_GAP, MIN_ROOM, GAP_MARGIN,
  lineKey, editLines, cleanLaneEdits, retimeLine, lineAt, spansOf, MIN_LINE } from '../app/js/dialogue.js';

test('takes the styling out of a subtitle', () => {
  assert.equal(cleanLine('{\\an8}<i>Hello</i>\\Nthere'), 'Hello there');
  assert.equal(cleanLine('Fish &amp; chips\n- Yes'), 'Fish & chips - Yes');
  assert.equal(cleanLine('{\\p1}m 0 0 l 10 10{\\p0}'), '');
});

test('tells sound notes from speech', () => {
  for (const s of ['[door slams]', '(sighs)', '♪ ♪', '- [gasps]', 'MAN: (sighs)']) assert.ok(isSoundOnly(s), s);
  for (const s of ['Hello', '[sighs] Fine.', 'Dr. Lee: Sit down.']) assert.ok(!isSoundOnly(s), s);
});

test('song lyrics are not speech', () => {
  for (const s of ['♪ Happy birthday ♪', '- ♪ All your darkness...♪', '♪ Brace yourself world, it\'s about to blow your mind ♪', '♪ Still going']) assert.ok(isSoundOnly(s), s);
});

test('keeps only the words, without sound notes or speaker labels', () => {
  const text = (t) => buildDialogue([{ start: 0, end: 2, text: t }]).lines.map((l) => l.text);
  assert.deepEqual(text('[whispering]\nIt was just a dream.'), ['It was just a dream.']);
  assert.deepEqual(text('- [louder] Hi,\nI\'m Rachel.'), ['Hi, I\'m Rachel.']);
  assert.deepEqual(text('JOHN (ON PHONE): Where are you?'), ['Where are you?']);
  assert.deepEqual(text('- Really?\n- [whispering] Yes.'), ['Really? - Yes.']);
  assert.deepEqual(text('- You still haven\'t finished\nunpacking?'), ['You still haven\'t finished unpacking?']);
});

test('sounds and songs before or after the words take part of the time', () => {
  const at = (t) => buildDialogue([{ start: 10, end: 13, text: t }]).lines.map((l) => [+l.start.toFixed(2), +l.end.toFixed(2), l.text]);
  // 17 characters of words, 9 of sound: the words get 17/26 of the 3 seconds.
  assert.deepEqual(at('It can\'t be real.\n[panting]'), [[10, 11.96, 'It can\'t be real.']]);
  assert.deepEqual(at('[overlapping chatter]\n- Who\'s that?'), [[11.97, 13, 'Who\'s that?']]);
  assert.deepEqual(at('Best day ever.\n- ♪ The world goes dancing ♪'), [[10, 11.05, 'Best day ever.']]);
  // A note before the words in the same turn says how they're said: no time of its own.
  assert.deepEqual(at('[sighs] Fine.'), [[10, 13, 'Fine.']]);
  // Words either side of a song are two lines.
  assert.deepEqual(at('Wait. ♪ la la ♪ Go.').map((l) => l[2]), ['Wait.', 'Go.']);
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

test('finds what’s left of the gaps once blocks are in them', () => {
  const gaps = [{ start: 0, end: 10 }, { start: 20, end: 30 }, { start: 40, end: 45 }];
  const blocks = [{ start: 1, end: 4 }, { start: 20, end: 30 }, { start: 41, end: 42 }];
  assert.deepEqual(freeGaps(gaps, blocks, 1.5), [{ start: 4, end: 10 }, { start: 42, end: 45 }]);
  assert.deepEqual(freeGaps(gaps, []), gaps);
  assert.deepEqual(freeGaps([{ start: 0, end: 10 }], [{ start: 4, end: 5 }], 3), [{ start: 0, end: 4 }, { start: 5, end: 10 }]);
});

test('skips a stretch too short to use, on either side of a block', () => {
  assert.deepEqual(freeGaps([{ start: 0, end: 10 }], [{ start: 1, end: 9 }], MIN_ROOM), []);
});

test('copes with a long block and a shorter one inside it', () => {
  const blocks = [{ start: 0, end: 25 }, { start: 2, end: 3 }, { start: 26, end: 27 }];
  assert.deepEqual(freeGaps([{ start: 1, end: 10 }, { start: 20, end: 40 }], blocks, 1.5), [{ start: 27, end: 40 }]);
});

test('a free gap can run on past a block that ends where it starts', () => {
  assert.deepEqual(freeGaps([{ start: 5, end: 10 }], [{ start: 1, end: 5 }]), [{ start: 5, end: 10 }]);
});

test('places a block just inside a gap, or from the playhead', () => {
  const gap = { start: 10, end: 20 };
  assert.deepEqual(placeInGap(gap), { start: 10 + GAP_MARGIN, end: 20 - GAP_MARGIN });
  assert.deepEqual(placeInGap(gap, 15), { start: 15, end: 20 - GAP_MARGIN });
  const { start, end } = placeInGap({ start: 10, end: 10.3 });
  assert.ok(end - start < 0.1, 'a very short gap leaves no room');
});

test('counts the speech under a block', () => {
  const spans = [[1, 3], [5, 6], [8, 12]];
  assert.equal(speechIn(spans, 3, 5), 0);
  assert.equal(speechIn(spans, 2, 5.5), 1.5);
  assert.equal(speechIn(spans, 0, 20), 7);
  assert.equal(speechIn(spans, 9, 10), 1);
  assert.equal(speechIn([], 0, 5), 0);
});

// ---------------------------------------------------------------- the writer's edits

const three = buildDialogue([
  { start: 1, end: 3, text: 'Hello.' },
  { start: 4, end: 6, text: 'Raindrops on roses' },
  { start: 7, end: 9, text: 'Goodbye.' },
]).lines;

test('a removed line leaves the lane, and its gap opens up', () => {
  const lines = editLines(three, { [lineKey(three[1])]: { cut: true } });
  assert.deepEqual(lines.map((l) => l.text), ['Hello.', 'Goodbye.']);
  assert.deepEqual(gapsOf(spansOf(lines), 10).map((g) => [g.start, g.end]), [[0, 1], [3, 7], [9, 10]]);
});

test('a trimmed line keeps its words and its key, and is marked as edited', () => {
  const k = lineKey(three[0]);
  const lines = editLines(three, { [k]: { start: 1.4, end: 2.5 } });
  assert.deepEqual(lines[0], { start: 1.4, end: 2.5, text: 'Hello.', k, edited: true });
  assert.equal(lines[1].edited, undefined);
  // Moved past the next line, it's sorted into place.
  assert.deepEqual(editLines(three, { [k]: { start: 9.5, end: 10 } }).map((l) => l.text), ['Raindrops on roses', 'Goodbye.', 'Hello.']);
});

test('edits for lines that aren’t there do nothing', () => {
  assert.deepEqual(editLines(three, { '99000|Nobody': { cut: true } }).map((l) => l.text), ['Hello.', 'Raindrops on roses', 'Goodbye.']);
  assert.equal(editLines(three).length, 3);
});

test('a line’s times stay in the programme and at least MIN_LINE long', () => {
  const l = { start: 4, end: 6 };
  assert.deepEqual(retimeLine(l, 'start', 5.5), { start: 5.5, end: 6 });
  assert.deepEqual(retimeLine(l, 'start', 7), { start: 6 - MIN_LINE, end: 6 });
  assert.deepEqual(retimeLine(l, 'start', -2), { start: 0, end: 6 });
  assert.deepEqual(retimeLine(l, 'end', 3), { start: 4, end: 4 + MIN_LINE });
  assert.deepEqual(retimeLine(l, 'end', 12, 10), { start: 4, end: 10 });
  assert.deepEqual(retimeLine(l, 'move', 9, 10), { start: 8, end: 10 });
  assert.deepEqual(retimeLine(l, 'move', -1, 10), { start: 0, end: 2 });
});

test('finds the line under a time', () => {
  const lines = [{ start: 1, end: 3 }, { start: 2, end: 5 }, { start: 6, end: 7 }];
  assert.equal(lineAt(lines, 2.5), lines[1]);
  assert.equal(lineAt(lines, 4), lines[1]);
  assert.equal(lineAt(lines, 1.5), lines[0]);
  assert.equal(lineAt(lines, 5.5), null);
  assert.equal(lineAt(lines, 0.5), null);
  assert.equal(lineAt([], 1), null);
});

test('drops malformed dialogue edits from a project', () => {
  assert.deepEqual(cleanLaneEdits(null), {});
  assert.deepEqual(cleanLaneEdits([1]), {});
  assert.deepEqual(cleanLaneEdits({
    'file|a.srt': {
      '1000|Hi': { cut: true },
      '2000|Bye': { start: 2.2, end: 3 },
      '3000|Short': { start: 3, end: 3.01 },
      '4000|Odd': { start: 'x', end: 5 },
      'no key': { cut: true },
    },
    heard: {},
    'track|0||': 'nope',
  }), { 'file|a.srt': { '1000|Hi': { cut: true }, '2000|Bye': { start: 2.2, end: 3 } } });
});
