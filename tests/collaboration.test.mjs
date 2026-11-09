import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjects, allows, makesFiles } from '../app/js/collaboration.js';
import { toProject, newIdentity } from '../app/js/project.js';

const fixture = () => toProject({ projectId: newIdentity(), blocks: [
  { uid: newIdentity(), start: 1, end: 2, text: 'First' },
  { uid: newIdentity(), start: 3, end: 4, text: 'Second' },
], settings: { mode: 'write', ttsBase: 1 } });
const copies = () => { const base = fixture(); return [base, structuredClone(base), structuredClone(base)]; };

test('independent block edits merge by identity even when blocks move', () => {
  const [b, l, r] = copies();
  l.blocks[0].text = 'Local wording';
  r.blocks[1].text = 'Remote wording'; r.blocks[1].start = 0; r.blocks[1].end = 1;
  const before = structuredClone([b, l, r]);
  const result = mergeProjects(b, l, r);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.project.blocks.map((x) => x.text), ['Remote wording', 'Local wording']);
  assert.deepEqual([b, l, r], before, 'inputs stay intact');
  result.project.blocks[0].text = 'Changed result';
  assert.equal(r.blocks[1].text, 'Remote wording', 'result owns its data');
});

test('concurrent edits and deletion versus editing require a decision, never an applicable partial merge', () => {
  for (const remove of [false, true]) {
    const [b, l, r] = copies();
    if (remove) l.blocks.shift(); else l.blocks[0].text = 'Local';
    r.blocks[0].text = 'Remote';
    const result = mergeProjects(b, l, r);
    assert.equal(result.project, null);
    assert.deepEqual(result.conflicts, [{ kind: 'block', uid: b.blocks[0].uid }]);
    assert.deepEqual(mergeProjects(b, r, l).conflicts, result.conflicts);
  }
});

test('unchanged deletions, identical edits, and independent additions merge safely', () => {
  const [b, l, r] = copies();
  l.blocks.shift();
  l.blocks[0].text = r.blocks[1].text = 'Agreed';
  const added = { uid: newIdentity(), start: 6, end: 7, text: 'New' };
  r.blocks.push(added);
  const result = mergeProjects(b, l, r);
  assert.deepEqual(result.project.blocks, [l.blocks[0], added]);
  r.blocks.shift();
  assert.deepEqual(mergeProjects(b, l, r).project.blocks, result.project.blocks);
});

test('different additions with the same identity conflict', () => {
  const [b, l, r] = copies();
  const added = { uid: newIdentity(), start: 6, end: 7, text: 'New' };
  l.blocks.push(added); r.blocks.push({ ...added, text: 'Different' });
  assert.equal(mergeProjects(b, l, r).project, null);
});

test('notes, comments, settings, media and recording versions cannot silently overwrite each other', () => {
  for (const field of ['notes', 'comments', 'settings', 'media', 'recording']) {
    if (field === 'comments') continue; // merged one by one: see the next test
    const [b, l, r] = copies();
    const values = {
      notes: ['Local', 'Remote'],
      comments: [[{ text: 'Local', time: 1 }], [{ text: 'Remote', time: 2 }]],
      settings: [{ ttsBase: 1.1 }, { ttsBase: 1.2 }],
      media: [{ name: 'local.mp4' }, { name: 'remote.mp4' }],
      recording: [{ id: 'abcdefgh12345678', version: 1 }, { id: 'abcdefgh12345678', version: 2 }],
    };
    [l[field], r[field]] = values[field];
    assert.deepEqual(mergeProjects(b, l, r), { project: null, conflicts: [{ kind: 'project', field }], changes: [] });
    const ours = mergeProjects(b, b, r).project[field], theirs = mergeProjects(b, r, b).project[field];
    if (field === 'settings') { delete ours.mode; delete theirs.mode; }
    assert.deepEqual(ours, theirs);
  }
});

test('comments merge one by one; only two different changes to the same comment need a choice', () => {
  const [b, l, r] = copies();
  const shared = { id: '11111111-1111-4111-8111-111111111111', text: 'Shared', time: 1 };
  for (const p of [b, l, r]) p.comments = [structuredClone(shared)];
  l.comments.push({ text: 'Local', time: 2 });
  r.comments.push({ text: 'Remote', time: 3 });
  r.comments[0].resolved = true;
  const merged = mergeProjects(b, l, r);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.project.comments.map((c) => [c.text, c.resolved]), [['Shared', true], ['Local', false], ['Remote', false]]);
  // Deleted on one side, untouched on the other: it goes.
  const gone = structuredClone(r); gone.comments = [];
  assert.deepEqual(mergeProjects(b, l, gone).project.comments.map((c) => c.text), ['Local']);
  // Both changed the same comment: the whole list needs a choice, as before.
  l.comments[0].text = 'Local wording';
  assert.deepEqual(mergeProjects(b, l, r).conflicts, [{ kind: 'project', field: 'comments' }]);
});

test('save time, property order and personal view or mode do not create conflicts', () => {
  const [b, l, r] = copies();
  l.settings.mode = 'qc'; r.settings.mode = 'transcribe'; r.settings.ttsBase = 1.2;
  l.saved = 'later'; r.saved = 'another time'; l.view = { playhead: 40 };
  r.blocks[0] = Object.fromEntries(Object.entries(r.blocks[0]).reverse());
  const result = mergeProjects(b, l, r);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.project.settings, { ttsBase: 1.2, mode: 'qc' });
  assert.deepEqual(result.project.view, l.view);
});

test('unrelated, legacy and ambiguous snapshots are refused', () => {
  const [b, l, r] = copies();
  assert.throws(() => mergeProjects(b, l, fixture()), /different projects/);
  delete r.blocks[0].uid;
  assert.throws(() => mergeProjects(b, l, r), /identity/);
  r.blocks = [l.blocks[0], l.blocks[0]];
  assert.throws(() => mergeProjects(b, l, r), /same identity/);
  assert.throws(() => mergeProjects({ ...b, projectId: null }, l, l), /before sharing/);
});

test('role policy distinguishes viewing, reviewing, editing, recording and ownership', () => {
  const actions = ['read', 'comment', 'edit', 'record', 'manage'];
  assert.deepEqual(actions.map((a) => allows('view', a)), [true, false, false, false, false]);
  assert.deepEqual(actions.map((a) => allows('review', a)), [true, true, false, false, false]);
  assert.deepEqual(actions.map((a) => allows('edit', a)), [true, true, true, false, false]);
  assert.deepEqual(actions.map((a) => allows('record', a)), [true, false, false, true, false]);
  assert.ok(actions.every((a) => allows('owner', a)));
  for (const role of ['admin', '__proto__', 'toString', '', null]) assert.equal(allows(role, 'read'), false);
  assert.equal(allows('owner', 'unknown'), false);
});

test('merge output contains project fields rather than arbitrary local settings or credentials', () => {
  const [b, l, r] = copies();
  l.providerKey = 'local-secret'; l.settings.providerKey = 'settings-secret';
  r.blocks[0].text = 'Remote change';
  const result = mergeProjects(b, l, r);
  assert.equal(result.project.blocks[0].text, 'Remote change');
  assert.ok(!('providerKey' in result.project));
  assert.ok(!('providerKey' in result.project.settings));
});

test('empty projects merge and large comparisons report monotonic progress', () => {
  const b = toProject({ projectId: newIdentity(), blocks: [] });
  const updates = [];
  assert.deepEqual(mergeProjects(b, b, b, (...args) => updates.push(args)).project.blocks, []);
  assert.deepEqual(updates, [[0, 0]]);
  b.blocks = Array.from({ length: 1500 }, (_, i) => ({ uid: newIdentity(), start: i * 4.8, end: i * 4.8 + 2, text: `Block ${i}` }));
  updates.length = 0;
  assert.equal(mergeProjects(b, b, b, (...args) => updates.push(args)).project.blocks.length, 1500);
  assert.deepEqual(updates.at(-1), [1500, 1500]);
  assert.ok(updates.length > 1);
  assert.ok(updates.every(([done, total], i) => total === 1500 && (i === 0 || done >= updates[i - 1][0])));
});

test('only the owner of a shared project saves or exports it', () => {
  assert.equal(makesFiles(null), true, 'a project of its own');
  assert.equal(makesFiles(undefined), true);
  assert.equal(makesFiles({ link: 'owner', role: 'owner' }), true);
  for (const role of ['edit', 'review', 'comment']) assert.equal(makesFiles({ link: 'abc123', role }), false, role);
});
