import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bookmarksAllowed, cleanBookmarks, guessKind, adcBookmarks, newBookmarks, bookmarkNear, shownTitle, KINDS } from '../app/js/bookmarks.js';
import { toProject, fromProject, newIdentity } from '../app/js/project.js';
import { mergeProjects } from '../app/js/collaboration.js';
import { buildReview, readReview } from '../app/js/qc.js';
import { SharedProject } from '../app/js/shared.js';
import { GROUPS, REC_LOCKED } from '../app/js/keymap.js';

const id = (n) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
const mark = (n, time, title, kind = 'note', notes = '') => ({ id: id(n), time, title, notes, kind });

test('bookmarks are for Write and Transcribe only', () => {
  assert.deepEqual(['write', 'transcribe', 'qc', 'record'].map(bookmarksAllowed), [true, true, false, false]);
});

test('cleaning keeps good bookmarks in time order and drops the rest', () => {
  let n = 10;
  const out = cleanBookmarks([
    mark(1, 30, '  Act 2 ', 'scene'),
    { time: -1, title: 'before the start' },
    { time: 'soon', title: 'no time' },
    null,
    { id: id(1), time: 5, title: 'same id', kind: 'villain', extra: 1 },
  ], () => id(n++));
  assert.deepEqual(out, [
    { id: id(10), time: 5, title: 'same id', notes: '', kind: 'note' },
    { id: id(1), time: 30, title: 'Act 2', notes: '', kind: 'scene' },
  ]);
  assert.deepEqual(cleanBookmarks('nonsense'), []);
});

test('every kind has a colour token', () => {
  const css = readFileSync(new URL('../app/css/style.css', import.meta.url), 'utf8');
  for (const k of KINDS) assert.match(css, new RegExp(`${k.token}:`), k.id);
});

test('kinds are guessed from Frazier marker titles', () => {
  const cases = { 'Left off here': 'left', 'left off here': 'left', 'Movie Start': 'scene', Credits: 'scene', 'Club Dance Scene': 'scene',
    'Act 2': 'scene', Murray: 'note', "Tucci's Party": 'note', 'SING!': 'note', 'Partridge': 'note' };
  for (const [title, kind] of Object.entries(cases)) assert.equal(guessKind(title), kind, title);
});

test('a Frazier script’s markers become bookmarks, with their notes', () => {
  const adc = JSON.stringify({ cue_points: [], markers: [
    { id: 2, start: 380193, title: 'Rosie and Teresa', notes: 'Rosie - Hanna’s Mom\nMrs. Tucci (center)', tag: '' },
    { id: 1, start: 183300, title: 'Movie Start', notes: '', tag: '' },
    { id: 3, start: 1925195, title: 'Left off here', notes: '', tag: '' },
    { id: 4, title: 'no start' },
  ] });
  const out = adcBookmarks('﻿' + adc);
  assert.deepEqual(out.map(({ id, ...b }) => b), [
    { time: 183.3, title: 'Movie Start', notes: '', kind: 'scene' },
    { time: 380.193, title: 'Rosie and Teresa', notes: 'Rosie - Hanna’s Mom\nMrs. Tucci (center)', kind: 'note' },
    { time: 1925.195, title: 'Left off here', notes: '', kind: 'left' },
  ]);
  assert.deepEqual(adcBookmarks('{"cue_points":[]}'), []);
  assert.deepEqual(adcBookmarks('not json'), []);
});

test('importing again adds only markers that aren’t here', () => {
  const here = [mark(1, 183.3, 'Movie Start', 'scene'), mark(2, 221.319, 'Murray')];
  const incoming = cleanBookmarks([{ time: 183.302, title: 'movie start' }, { time: 221.319, title: 'Murray' }, { time: 284.657, title: 'Hannah' }, { time: 284.657, title: 'Hannah' }]);
  assert.deepEqual(newBookmarks(here, incoming).map((b) => b.title), ['Hannah']);
});

test('finding the bookmark under the pointer, and a title for one without', () => {
  const list = [mark(1, 10, 'A'), mark(2, 10.4, 'B'), mark(3, 20, '', 'left')];
  assert.equal(bookmarkNear(list, 10.3, 0.2).title, 'B');
  assert.equal(bookmarkNear(list, 15, 0.2), null);
  assert.equal(shownTitle(list[2]), 'Untitled left off here');
});

test('bookmarks are saved with the project and survive a merge of two copies', () => {
  const marks = [mark(1, 12, 'Murray', 'character', 'Hannah’s dad')];
  const opened = fromProject(JSON.parse(JSON.stringify(toProject({ blocks: [], bookmarks: marks }))));
  assert.deepEqual(opened.bookmarks, marks);
  assert.equal('bookmarks' in toProject({ blocks: [] }), false, 'none: not written');

  const base = toProject({ projectId: newIdentity(), blocks: [{ uid: newIdentity(), start: 1, end: 2, text: 'First' }], bookmarks: marks, settings: {} });
  const local = structuredClone(base), remote = structuredClone(base);
  local.bookmarks.push(mark(2, 40, 'Left off here', 'left'));
  remote.bookmarks[0].title = 'Murray Kaplan';
  const result = mergeProjects(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.project.bookmarks.map((b) => b.title).sort(), ['Left off here', 'Murray Kaplan']);
});

test('a QC package leaves the bookmarks out', async () => {
  const p = toProject({ blocks: [{ start: 3, end: 6, text: 'Mara arrives.' }], bookmarks: [mark(1, 4, 'Mara')], settings: { mode: 'write', ttsBase: 1, ttsVoice: 'kokoro:bf_emma' } });
  const make = async (b) => ({ blob: new Blob([new Uint8Array(100)], { type: 'audio/wav' }), secs: b.end - b.start, voice: 'kokoro:bf_emma' });
  const r = await readReview(await buildReview(p, make));
  assert.equal('bookmarks' in r.project, false);
  assert.equal(fromProject(r.project).bookmarks.length, 0);
  assert.equal(p.bookmarks.length, 1, 'the project itself keeps them');
});

test('bookmarks reach the other people on a share link, with the script', () => {
  const a = new SharedProject(), b = new SharedProject(), seen = [];
  a.onUpdate((doc, u, origin) => { if (origin !== 'remote') b.apply(doc, u); });
  b.onUpdate((doc, u, origin) => { if (origin !== 'remote') a.apply(doc, u); });
  b.observe((uids, timeline, suggestions, marks) => seen.push(!!marks));
  const list = [mark(1, 12, 'Murray', 'character')];
  a.write([], [], null, { bookmarks: list });
  assert.deepEqual(b.readBookmarks(), list);
  assert.deepEqual(seen, [true]);
  assert.equal(a.write([], [], null, { bookmarks: list }), 0, 'writing it again changes nothing');
  a.write([], [], null, { bookmarks: [] });
  assert.deepEqual(b.readBookmarks(), []);
  // Those who can't edit the script don't change bookmarks.
  b.write([], [], null, { script: false, bookmarks: list });
  assert.deepEqual(a.readBookmarks(), []);
});

test('undo on a share link takes back one’s own bookmark', () => {
  const s = new SharedProject(), undo = s.undoer();
  const mark0 = undo.step();
  s.write([], [], null, { bookmarks: [mark(1, 5, 'Here')] });
  undo.undoTo(mark0);
  assert.deepEqual(s.readBookmarks(), []);
});

test('B and Alt+Shift+B, and neither works in Record mode', () => {
  const keys = Object.fromEntries(GROUPS.flatMap(([, list]) => list.map(([id, , k]) => [id, k])));
  assert.deepEqual(keys.bookmarkAdd, ['KeyB']);
  assert.deepEqual(keys.bookmarks, ['Alt+Shift+KeyB']);
  assert.ok(REC_LOCKED.has('bookmarkAdd') && REC_LOCKED.has('bookmarks'));
});
