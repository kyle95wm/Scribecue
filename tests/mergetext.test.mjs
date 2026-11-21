import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinSentences } from '../app/js/mergetext.js';

test('a block ending in a full stop and a space takes the next one straight after', () => {
  assert.equal(joinSentences('She waits. ', 'A car pulls up.'), 'She waits. A car pulls up.');
});

test('a full stop with no space after it gets one', () => {
  assert.equal(joinSentences('She waits.', 'A car pulls up.'), 'She waits. A car pulls up.');
});

test('a block with no full stop gets one, then a space', () => {
  assert.equal(joinSentences('She waits', 'A car pulls up.'), 'She waits. A car pulls up.');
});

test('a comma, semicolon or colon at the end becomes the full stop', () => {
  assert.equal(joinSentences('She waits,', 'A car pulls up.'), 'She waits. A car pulls up.');
  assert.equal(joinSentences('She waits;', 'A car.'), 'She waits. A car.');
  assert.equal(joinSentences('She sees: ', 'A car.'), 'She sees. A car.');
});

test('questions, exclamations and ellipses already end a sentence', () => {
  assert.equal(joinSentences('Who is it?', 'Tom.'), 'Who is it? Tom.');
  assert.equal(joinSentences('Run!', 'They run.'), 'Run! They run.');
  assert.equal(joinSentences('She waits…', 'Nothing.'), 'She waits… Nothing.');
  assert.equal(joinSentences('A sign: "Closed."', 'She leaves.'), 'A sign: "Closed." She leaves.');
});

test('stray spaces and line breaks at the join go', () => {
  assert.equal(joinSentences('She waits.\n', '\n A car pulls up.'), 'She waits. A car pulls up.');
  assert.equal(joinSentences('She waits.  ', 'A car.'), 'She waits. A car.');
});

test('lines inside a block stay as they are', () => {
  assert.equal(joinSentences('One.\nTwo', 'Three.'), 'One.\nTwo. Three.');
});

test('an empty block adds nothing', () => {
  assert.equal(joinSentences('', 'A car pulls up.'), 'A car pulls up.');
  assert.equal(joinSentences('She waits', ''), 'She waits');
  assert.equal(joinSentences('', ''), '');
  assert.equal(joinSentences(undefined, 'A car.'), 'A car.');
});
