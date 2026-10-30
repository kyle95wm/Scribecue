import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matcher, count, replaceIn, nextMatch } from '../app/js/findreplace.js';

const cues = [{ text: 'Tom waves. TOM smiles.' }, { text: 'Tomorrow, Tom leaves.' }, { text: 'Maya nods.' }];

test('finds what was typed, ignoring case unless asked', () => {
  assert.deepEqual(count(cues, matcher('tom')), { matches: 4, blocks: 2 });
  assert.deepEqual(count(cues, matcher('Tom', { matchCase: true })), { matches: 3, blocks: 2 });
  assert.deepEqual(count(cues, matcher('tom', { wholeWords: true })), { matches: 3, blocks: 2 }, 'not inside Tomorrow');
  assert.deepEqual(count(cues, matcher('Tom', { matchCase: true, wholeWords: true })), { matches: 2, blocks: 2 });
  assert.deepEqual(count(cues, matcher('')), { matches: 0, blocks: 0 });
});

test('treats what was typed as plain text, not a pattern', () => {
  assert.deepEqual(count([{ text: 'Wait... (beat) okay.' }], matcher('...')), { matches: 1, blocks: 1 });
  assert.equal(replaceIn('A (beat) B', matcher('(beat)'), '$1'), 'A $1 B', 'the replacement goes in as typed');
});

test('replaces every match, keeping the rest of the text', () => {
  assert.equal(replaceIn('Tom waves. TOM smiles.', matcher('tom', { wholeWords: true }), 'Theo'), 'Theo waves. Theo smiles.');
  assert.equal(replaceIn('Tomorrow, Tom leaves.', matcher('Tom', { matchCase: true, wholeWords: true }), 'Theo'), 'Tomorrow, Theo leaves.');
  assert.equal(replaceIn('Zoë and zoë', matcher('ZOË'), 'Zoe'), 'Zoe and Zoe', 'accents and case');
});

test('steps to the next block with a match, going round', () => {
  const re = matcher('tom');
  assert.equal(nextMatch(cues, re, 0), 1);
  assert.equal(nextMatch(cues, re, 1), 0);
  assert.equal(nextMatch(cues, matcher('maya'), -1), 2);
  assert.equal(nextMatch(cues, matcher('nobody'), 0), -1);
});
