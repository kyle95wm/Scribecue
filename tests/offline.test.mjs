import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineLabel, checklist, wipeWarning } from '../app/js/offline.js';

test('the bottom bar says when you’re offline, and in the web version when it isn’t ready', () => {
  assert.deepEqual(offlineLabel({ hosted: true, offline: true, ready: true }), { text: 'offline', on: true });
  assert.deepEqual(offlineLabel({ hosted: false, offline: true }), { text: 'offline', on: true });
  assert.equal(offlineLabel({ hosted: false, offline: false }), null, 'Docker works offline anyway, and storage is in Settings');
  assert.equal(offlineLabel({ hosted: true, offline: false, ready: true }), null, 'nothing to say when it’s ready');
  assert.equal(offlineLabel({ hosted: true, offline: false, ready: false }).text, 'not ready offline');
});

test('the checklist says what’s ready and offers what isn’t', () => {
  const rows = checklist({ hosted: true, appKept: true, guides: true, voices: ['Lessac'], whisper: false, persisted: false, usage: 250e6 });
  const by = Object.fromEntries(rows.map((r) => [r[1], r]));
  assert.equal(by['Scribecue itself'][0], true);
  assert.match(by['Piper voices'][2], /Lessac/);
  assert.deepEqual([by['Whisper, for speech to text'][0], by['Whisper, for speech to text'][3]], [false, 'whisper']);
  assert.deepEqual([by['Kept safe'][0], by['Kept safe'][3]], [false, 'persist']);
  assert.match(by['Space used'][2], /250 MB/);
  const first = checklist({ hosted: true, appKept: false, guides: false, voices: [], whisper: false, persisted: null, usage: 0 });
  assert.match(first[0][2], /reload once while online/);
  assert.ok(!first.some((r) => r[1] === 'Kept safe'), 'no row when the browser can’t say');
  // Docker runs from this computer: there's nothing to get ready, only storage.
  const docker = checklist({ hosted: false, appKept: false, guides: true, voices: [], whisper: true, persisted: false, usage: 5e6 });
  assert.deepEqual(docker.map((r) => r[1]), ['Kept safe', 'Space used']);
  assert.match(checklist({ hosted: false, persisted: true, usage: 300e3 }).at(-1)[2], /Less than 1 MB/);
});

test('the warning before removing everything says what would be lost', () => {
  assert.equal(wipeWarning({ unsaved: 0, offline: false, hosted: true }), 'This can’t be undone. Afterwards Scribecue opens as if for the first time.');
  assert.match(wipeWarning({ unsaved: 12, offline: false, hosted: true }), /12 blocks aren’t saved in a project file and will be lost/);
  assert.match(wipeWarning({ unsaved: 1, offline: false, hosted: true }), /1 block isn’t saved/);
  assert.match(wipeWarning({ unsaved: 0, offline: true, hosted: true }), /won’t open again until you’re back online/);
  assert.doesNotMatch(wipeWarning({ unsaved: 0, offline: true, hosted: false }), /back online/, 'Docker opens from this computer');
});

test('when the browser won’t keep storage, the row says what keeps work safe anyway', () => {
  const row = (o) => checklist({ hosted: false, persisted: false, usage: 0, ...o }).find((r) => r[1] === 'Kept safe');
  assert.match(row({})[2], /saving your work as a project keeps it safe/);
  const no = row({ refused: true });
  assert.match(no[2], /The browser said no/);
  assert.match(no[2], /autosaves/);
  assert.equal(no[3], 'persist', 'it can ask again');
  assert.doesNotMatch(no[2], /Installing/);
});

test('saved readings show, with a way to clear them, only when there are some', () => {
  const base = { hosted: false, persisted: true, usage: 5e6 };
  assert.ok(!checklist({ ...base, readings: { count: 0, bytes: 0 } }).some((r) => r[1] === 'Saved readings'));
  assert.ok(!checklist(base).some((r) => r[1] === 'Saved readings'));
  const row = checklist({ ...base, readings: { count: 212, bytes: 31.4e6 } }).find((r) => r[1] === 'Saved readings');
  assert.match(row[2], /^212 lines, 31 MB\./);
  assert.equal(row[3], 'readings');
  assert.match(checklist({ ...base, readings: { count: 1, bytes: 9e4 } }).find((r) => r[1] === 'Saved readings')[2], /^1 line, less than 1 MB/);
  // Space used stays last.
  assert.equal(checklist({ ...base, readings: { count: 3, bytes: 1 } }).at(-1)[1], 'Space used');
});

test('recorded takes show in storage, and removing all data warns about them', () => {
  const rows = checklist({ hosted: false, persisted: true, usage: 0, takes: { count: 3, bytes: 26e6 } });
  const row = rows.find((r) => r[1] === 'Recorded takes');
  assert.match(row[2], /^3 takes, 26 MB\. .*clearing its data for Scribecue loses them/);
  assert.ok(!checklist({ hosted: false, persisted: true, usage: 0, takes: { count: 0, bytes: 0 } }).some((r) => r[1] === 'Recorded takes'));
  assert.match(wipeWarning({ unsaved: 0, offline: false, hosted: true, takes: 1 }), /1 recorded take will be lost\. Export the narration WAV first/);
  assert.doesNotMatch(wipeWarning({ unsaved: 0, offline: false, hosted: true }), /take/);
});

test('takes kept in Docker say so, and removing browser data leaves them out', () => {
  const rows = checklist({ hosted: false, persisted: true, usage: 0, takes: { count: 2, bytes: 9e6, where: 'docker' } });
  assert.match(rows.find((r) => r[1] === 'Recorded takes')[2], /^2 takes, 9 MB\. Kept in Docker, so clearing the browser doesn’t touch them/);
});
