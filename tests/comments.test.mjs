import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanComments, commentEntries, commentsAllowed, mergeComments, derivedCommentId } from '../app/js/comments.js';
const ids = (list) => list.map(({ id, ...c }) => c);
import { toProject, fromProject } from '../app/js/project.js';
const note = { text: 'Check the name.', author: 'Sam', created: '2026-10-31T12:00:00Z', resolved: false };

test('multiple block and timeline comments survive a project handoff, including resolved comments', () => {
  const blocks = [{ start: 10, end: 14, text: 'Mara arrives.', comments: [note, { ...note, text: 'Fixed.', resolved: true }] }];
  const comments = [{ ...note, time: 30 }, { ...note, time: 0 }];
  const saved = JSON.parse(JSON.stringify(toProject({ blocks, comments })));
  const opened = fromProject(saved);
  assert.deepEqual(opened.blocks.map((b) => ({ ...b, comments: ids(b.comments) })), blocks);
  assert.deepEqual(ids(opened.comments), comments);
  assert.deepEqual(fromProject(toProject(opened)).comments, opened.comments, 'ids stay the same through saves');
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
    [{ id: derivedCommentId({ text: 'Check', author: '', created: '', resolved: false }), text: 'Check', author: '', created: '', resolved: false }]);
  assert.deepEqual(ids(cleanComments([{ ...note, time: -1 }, { ...note, time: NaN }, { ...note, time: Infinity }, { ...note, time: '3' }, { ...note, time: 0 }], true)), [{ ...note, time: 0 }]);
  assert.deepEqual(cleanComments({}), []);
});

test('comments-only projects can be handed over without blocks', () => {
  const project = fromProject(toProject({ blocks: [], comments: [{ ...note, time: 7200 }] }));
  assert.deepEqual(project.blocks, []);
  assert.equal(project.comments[0].time, 7200);
});

test('comments work in Write and QC, not in Transcribe or Record', () => {
  assert.deepEqual(['write', 'qc', 'transcribe', 'record'].map(commentsAllowed), [true, true, false, false]);
});

test('every comment has an id; old ones get the same id on any computer, and repeats differ', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  assert.equal(cleanComments([{ ...note, id }])[0].id, id);
  const a = cleanComments([note, note]), b = cleanComments(JSON.parse(JSON.stringify([note, note])));
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id), 'derived from the comment, not random');
  assert.notEqual(a[0].id, a[1].id);
  assert.match(a[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const twice = cleanComments([{ ...note, id }, { ...note, text: 'Other', id }]);
  assert.notEqual(twice[0].id, twice[1].id, 'a copied id is replaced');
  assert.equal(cleanComments([{ ...note, id: 'not-an-id' }])[0].id, derivedCommentId(cleanComments([note])[0]));
});

test('comment lists merge one comment at a time', () => {
  const [x, y, z] = cleanComments([{ ...note, text: 'x' }, { ...note, text: 'y' }, { ...note, text: 'z' }]);
  assert.deepEqual(mergeComments([x], [x, y], [x, z]), [x, y, z], 'both additions kept');
  assert.deepEqual(mergeComments([x, y], [x], [x, y]), [x], 'a deletion on one side is taken');
  const done = { ...x, resolved: true };
  assert.deepEqual(mergeComments([x], [x], [done]), [done], 'a change on one side is taken');
  assert.deepEqual(mergeComments([x], [done], [done]), [done], 'the same change on both sides is fine');
  assert.equal(mergeComments([x], [{ ...x, text: 'mine' }], [{ ...x, text: 'yours' }]), null, 'different changes need a choice');
  assert.equal(mergeComments([x], [], [done]), null, 'deleted here, changed there needs a choice');
});
