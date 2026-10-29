import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakable, blockLabel } from '../app/js/a11y.js';

test('key symbols are read as words', () => {
  assert.equal(speakable('Undo with ⌘Z'), 'Undo with Command Z');
  assert.equal(speakable('⌥⇧H opens it'), 'Option Shift H opens it');
  assert.equal(speakable('⌥⇧H opens it', false), 'Alt Shift H opens it');
  assert.equal(speakable('Block #3 marked — type it, then ↵ or Esc to carry on'), 'Block #3 marked, type it, then Enter or Esc to carry on');
  assert.equal(speakable('Start of this block (⌥⇧←)'), 'Start of this block (Option Shift Left arrow)');
  assert.equal(speakable('text → IN → OUT'), 'text Right arrow IN Right arrow OUT');
});

test('a block in the list is read with its number, time, length and text', () => {
  assert.equal(blockLabel({ n: 3, start: '00:00:20.000', secs: '3.80', text: 'A pale <i>blue</i> streak.' }),
    'Block 3, at 00:00:20.000, 3.80 seconds: A pale blue streak.');
  assert.equal(blockLabel({ n: 6, start: '00:00:47.000', secs: '2.50', text: '' }), 'Block 6, at 00:00:47.000, 2.50 seconds: empty');
  assert.match(blockLabel({ n: 1, start: '00:00:01.000', secs: '1.00', text: 'Long line', tooLong: true }), /too long to read in time/);
});
