import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanComments, commentEntries } from '../app/js/comments.js';
import { toProject, fromProject } from '../app/js/project.js';
const note = { text: 'Check the name.', author: 'Sam', created: '2026-10-31T12:00:00Z', resolved: false };

test('multiple block and timeline comments survive a project handoff, including resolved comments', () => {
  const blocks = [{ start: 10, end: 14, text: 'Mara arrives.', comments: [note, { ...note, text: 'Fixed.', resolved: true }] }];
  const comments = [{ ...note, time: 30 }, { ...note, time: 0 }];
  const saved = JSON.parse(JSON.stringify(toProject({ blocks, comments })));
  const opened = fromProject(saved);
  assert.deepEqual(opened.blocks, blocks);
  assert.deepEqual(opened.comments, comments);
  assert.deepEqual(fromProject(toProject(opened)).comments, comments);
});

test('block comments follow block timing and ordering; timeline comments keep their time', () => {
  const block = { start: 10, end: 12, comments: [note] };
  const timed = [{ ...note, time: 15 }];
  assert.deepEqual(commentEntries([block], timed).map((e) => e.time), [10, 15]);
  block.start = 20;
  const entries = commentEntries([block], timed);
  assert.deepEqual(entries.map((e) => e.time), [15, 20]);
  assert.equal(entries[1].block, block);
  assert.equal(entries[1].comment, note);
  assert.equal(entries[1].index, 0);
});

test('old projects need no comments; empty fields are omitted on save', () => {
  assert.deepEqual(fromProject({ scribecue: 1, blocks: [] }).comments, []);
  assert.ok(!('comments' in toProject({ blocks: [] })));
  assert.ok(!('comments' in toProject({ blocks: [{ start: 0, end: 1, text: '' }] }).blocks[0]));
});

test('malformed comments are discarded and optional fields repaired', () => {
  assert.deepEqual(cleanComments([null, {}, { text: ' ' }, { text: 3 }, { text: ' Check ', author: 42, resolved: 'yes' }]),
    [{ text: 'Check', author: '', created: '', resolved: false }]);
  assert.deepEqual(cleanComments([{ ...note, time: -1 }, { ...note, time: NaN }, { ...note, time: Infinity }, { ...note, time: '3' }, { ...note, time: 0 }], true), [{ ...note, time: 0 }]);
  assert.deepEqual(cleanComments({}), []);
});

test('comments-only projects can be handed over without blocks', () => {
  const project = fromProject(toProject({ blocks: [], comments: [{ ...note, time: 7200 }] }));
  assert.deepEqual(project.blocks, []);
  assert.equal(project.comments[0].time, 7200);
});
