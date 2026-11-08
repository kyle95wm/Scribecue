import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEdited, stampEdits, seedEdits, editorCount, editedLine, blockSig } from '../app/js/edits.js';
import { editorId, validEditorId } from '../app/js/profile.js';
import { mergeProjects } from '../app/js/collaboration.js';
import { toProject, fromProject, newIdentity } from '../app/js/project.js';

const AT = '2026-11-07T14:02:00.000Z';
const sam = { by: 'Sam', at: AT, who: 'browser-sam-1' };
const kyle = { by: 'Kyle', at: AT, who: 'browser-kyle-1' };
const blocks = () => [{ uid: 'a', start: 1, end: 2, text: 'One' }, { uid: 'b', start: 3, end: 4, text: 'Two' }];

test('only blocks whose script changed are stamped', () => {
  const list = blocks(), sigs = new Map();
  seedEdits(list, sigs);
  assert.equal(stampEdits(list, sigs, sam), 0, 'nothing changed yet');
  list[1].text = 'Two, reworded';
  list[0].comments = [{ text: 'A comment is not an edit' }];
  list[0].qcReading = 99;
  assert.equal(stampEdits(list, sigs, sam), 1);
  assert.deepEqual(list[1].edited, sam);
  assert.equal(list[0].edited, undefined);
  list.push({ uid: 'c', start: 5, end: 6, text: 'New block' });
  assert.equal(stampEdits(list, sigs, kyle, 'c'), 1, 'a new block counts as an edit');
  assert.deepEqual(list[2].edited, kyle);
  list[0].text = 'Changed'; list[1].text = 'Changed too';
  assert.equal(stampEdits(list, sigs, kyle, 'a'), 1, 'one block checks only that block');
  assert.equal(list[1].edited.by, 'Sam');
});

test('notes for the narrator count, Record mode pickups do not', () => {
  const b = { uid: 'a', start: 1, end: 2, text: 'One' };
  const sig = blockSig(b);
  assert.equal(blockSig({ ...b, pickup: { note: 'again' }, ownSecs: 2 }), sig);
  assert.notEqual(blockSig({ ...b, notes: 'Say it softly' }), sig);
});

test('a project of your own shows nothing until someone else changes it', () => {
  const list = blocks();
  list[0].edited = kyle; list[1].edited = { ...kyle, who: 'browser-kyle-2' };
  assert.equal(editorCount(list), 1, 'the same name on two computers is one person');
  assert.equal(editedLine(list[0].edited, editorCount(list)), '');
  list[1].edited = { at: AT, who: kyle.who };
  assert.equal(editorCount(list), 1, 'changes from before a name was set are still that browser');
  list[1].edited = sam;
  assert.equal(editorCount(list), 2);
  assert.equal(editedLine(sam, 2, () => '7 Nov'), 'Edited by Sam · 7 Nov');
  assert.equal(editedLine({ at: AT, who: 'someone-else' }, 2, () => '7 Nov'), 'Edited by No name · 7 Nov');
  assert.equal(editedLine(undefined, 2), '');
});

test('the edited note is checked when read', () => {
  assert.deepEqual(cleanEdited({ ...sam, by: '  Sam  ', extra: 1 }), sam);
  assert.deepEqual(cleanEdited({ at: AT, who: 'browser-sam-1', by: '' }), { at: AT, who: 'browser-sam-1' });
  for (const bad of [null, 'Sam', { ...sam, who: 'x' }, { ...sam, at: 'yesterday' }, { ...sam, who: '<b>' }]) assert.equal(cleanEdited(bad), null);
});

test('a browser keeps its id, and gets one for the visit when storage is blocked', () => {
  const m = new Map(), s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const id = editorId(s);
  assert.ok(validEditorId(id));
  assert.equal(editorId(s), id);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.ok(validEditorId(editorId(blocked)));
});

test('saved projects keep who last changed each block', () => {
  const p = toProject({ projectId: newIdentity(), blocks: [{ uid: newIdentity(), start: 1, end: 2, text: 'One', edited: sam }], settings: {} });
  assert.deepEqual(fromProject(JSON.parse(JSON.stringify(p))).blocks[0].edited, sam);
  const junk = toProject({ projectId: newIdentity(), blocks: [{ uid: newIdentity(), start: 1, end: 2, text: 'One', edited: { by: 'Sam' } }], settings: {} });
  assert.equal(junk.blocks[0].edited, undefined);
});

test('merging keeps the name of whoever changed the block that is kept', () => {
  const base = toProject({ projectId: newIdentity(), blocks: [
    { uid: newIdentity(), start: 1, end: 2, text: 'First', edited: kyle },
    { uid: newIdentity(), start: 3, end: 4, text: 'Second', edited: kyle },
  ], settings: {} });
  const l = structuredClone(base), r = structuredClone(base);
  r.blocks[0].text = 'Reviewed'; r.blocks[0].edited = sam;
  l.blocks[1].text = 'Rewritten'; l.blocks[1].edited = { ...kyle, at: '2026-11-08T09:00:00.000Z' };
  const result = mergeProjects(base, l, r);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.project.blocks.map((b) => b.edited.by), ['Sam', 'Kyle']);
  assert.equal(result.project.blocks[1].edited.at, '2026-11-08T09:00:00.000Z');
  // A different name alone is not a change to review.
  const named = structuredClone(base); named.blocks[0].edited = sam;
  const same = mergeProjects(base, structuredClone(base), named);
  assert.deepEqual(same.changes, []);
  assert.equal(same.project.blocks[0].edited.by, 'Kyle');
});
