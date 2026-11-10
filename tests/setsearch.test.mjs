import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, queryWords, searchEntries, snippet, marks } from '../app/js/setsearch.js';

const E = [
  { section: 'general', title: 'General', heading: 'Your name', text: 'Goes on your comments and on the blocks you change.' },
  { section: 'editing', title: 'Editing', heading: 'Hearing a block again', text: 'Replay: after editing a block, go back to its start. Lead-in seconds.' },
  { section: 'editing', title: 'Editing', heading: 'Spelling and grammar', text: 'Check before exporting. American British Canadian.' },
  { section: 'voices', title: 'Online voices', heading: 'Google Cloud voices', text: 'Google’s Standard voices, with your own Google Cloud key.' },
  { section: 'voices', title: 'Online voices', heading: 'Amazon Polly voices', text: 'Access key, secret key and region.' },
  { section: 'diagnostics', title: 'Diagnostics', heading: 'Diagnostics', text: 'Send this with a problem report.' },
  { section: 'keys', title: 'Keyboard shortcuts', heading: 'Loop this block', text: 'Playback. L', minor: true },
];
const found = (q) => searchEntries(E, q).map((e) => e.heading);

test('folds case, accents and apostrophes', () => {
  assert.equal(fold('Café DON’T'), 'cafe dont');
  assert.deepEqual(queryWords('  Lead-in, Ctrl+F '), ['lead', 'in', 'ctrl', 'f']);
});

test('finds every word of the query, at the start of words', () => {
  assert.deepEqual(found('key'), ['Google Cloud voices', 'Amazon Polly voices']);
  assert.deepEqual(found('polly key'), ['Amazon Polly voices']);
  assert.deepEqual(found('lead-in'), ['Hearing a block again']);
  assert.deepEqual(found('ice'), [], 'not the middle of a word, such as "voices"');
  assert.deepEqual(found('   '), []);
  assert.deepEqual(found('dont'), []);
});

test('a heading beats the words under it, and shortcuts come after settings', () => {
  assert.deepEqual(found('block'), ['Hearing a block again', 'Loop this block', 'Your name']);
  assert.deepEqual(found('voices').slice(0, 2), ['Google Cloud voices', 'Amazon Polly voices']);
  assert.equal(found('diag')[0], 'Diagnostics');
});

test('a section’s own name finds it', () => {
  assert.deepEqual(found('editing'), ['Hearing a block again', 'Spelling and grammar']);
});

test('keeps to the limit', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ section: 's', title: 'S', heading: `Voice ${i}`, text: '' }));
  assert.equal(searchEntries(many, 'voice').length, 30);
  assert.equal(searchEntries(many, 'voice', { limit: 5 }).length, 5);
});

test('a snippet shows the words around what was found', () => {
  const text = 'Words before. '.repeat(20) + 'Use a key that can only reach Polly. ' + 'Words after. '.repeat(20);
  const s = snippet(text, 'reach');
  assert.match(s, /^…/);
  assert.match(s, /…$/);
  assert.ok(s.includes('reach Polly'));
  assert.ok(s.length <= 112);
  assert.equal(snippet('Short text.', 'short'), 'Short text.');
  assert.equal(snippet('Short text.', 'nothing'), '');
  assert.equal(snippet('Café’s menu and more', 'menu'), 'Café’s menu and more', 'accents don’t shift where it is');
});

test('marks where the words start, in the original text', () => {
  assert.deepEqual(marks('Google’s Standard voices', 'voi goog'), [
    { text: 'Goog', hit: true }, { text: 'le’s Standard ', hit: false }, { text: 'voi', hit: true }, { text: 'ces', hit: false },
  ]);
  assert.deepEqual(marks('Don’t read notes', 'dont'), [{ text: 'Don’t', hit: true }, { text: ' read notes', hit: false }]);
  assert.deepEqual(marks('Nothing here', ''), [{ text: 'Nothing here', hit: false }]);
});
