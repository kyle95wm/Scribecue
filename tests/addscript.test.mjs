import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDABLE, readScript, pickBlocks, span, endsAt, shiftScript, mergeScenes, mergeWords, countOverlaps, leftOutNote, scriptLabel } from '../app/js/addscript.js';
import { toProject } from '../app/js/project.js';

const SRT = '1\n00:00:05,000 --> 00:00:07,000\nA door opens.\n\n2\n00:00:10,000 --> 00:00:12,500\nShe waves.\n';
let n = 0;
const ids = { makeBookmarkId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, makeCommentId: () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };

test('scripts and projects can be added; videos and packages can’t', () => {
  for (const name of ['ep1.srt', 'ep1.VTT', 'ep1.adc', 'ep1.txt', 'Ep 1.scribecue']) assert.ok(ADDABLE.test(name), name);
  for (const name of ['ep1.mp4', 'ep1.scribecueqc', 'ep1.scribecuerec', 'ep1.zip']) assert.ok(!ADDABLE.test(name), name);
  assert.equal(scriptLabel('Show S01E02.srt'), 'Show S01E02');
});

test('an SRT script is read with its blocks only', () => {
  const s = readScript('ep1.srt', SRT);
  assert.equal(s.blocks.length, 2);
  assert.deepEqual(span(s), { first: 5, last: 12.5 });
  assert.equal(endsAt(s, 100), 112.5);
  assert.deepEqual([s.bookmarks, s.comments, s.scenes, s.words, s.left], [[], [], [], [], []]);
});

test('a file with no blocks says so', () => {
  assert.throws(() => readScript('empty.srt', 'nothing here'), /no blocks/);
  assert.throws(() => readScript('bad.scribecue', '{not json'), /damaged/);
});

const project = () => JSON.stringify(toProject({
  blocks: [
    { start: 1, end: 3, text: 'Night.', uid: '11111111-1111-4111-8111-111111111111', qcReading: 16, voice: 'piper:x', speed: 1.2, pickup: { note: 'louder' },
      comments: [{ id: '22222222-2222-4222-8222-222222222222', text: 'Fine', author: 'A', created: '2026-01-01' }] },
    { start: 4, end: 6, text: 'Day.' },
  ],
  bookmarks: [{ id: '33333333-3333-4333-8333-333333333333', time: 2, title: 'Opening titles', notes: '', kind: 'scene' }],
  comments: [{ id: '44444444-4444-4444-8444-444444444444', text: 'Check', author: 'B', created: '2026-01-02', time: 5 }],
  scenes: [{ start: 0, end: 4, text: 'Night falls.' }, { start: 4, end: 8, text: '' }],
  words: ['Zorblax'],
  recording: { id: 'abcdef0123456789', version: 2 },
  settings: { ttsVoice: 'piper:main', ttsBase: 1.1 },
}));

test('a project brings its blocks, bookmarks, comments, scenes and words, not its own identity', () => {
  const s = readScript('Ep 2.scribecue', project());
  assert.equal(s.blocks.length, 2);
  const b = s.blocks[0];
  assert.equal(b.uid, undefined);
  assert.equal(b.qcReading, undefined);
  assert.equal(b.voice, 'piper:x');
  assert.equal(b.speed, 1.2);
  assert.deepEqual(b.pickup, { note: 'louder' });
  assert.equal(s.bookmarks.length, 1);
  assert.equal(s.comments.length, 1);
  assert.equal(s.scenes.length, 2);
  assert.deepEqual(s.words, ['Zorblax']);
  assert.ok(s.left.includes('recordings'));
  assert.ok(s.left.includes('review'));
  assert.match(leftOutNote([s]), /^Recordings and takes and QC review history stay with their project/);
  assert.equal(leftOutNote([readScript('a.srt', SRT)]), '');
});

test('moving a script moves everything in it, with new ids and a bookmark where it starts', () => {
  const s = readScript('Ep 2.scribecue', project());
  const m = shiftScript(s, 100, ids);
  assert.deepEqual(m.blocks.map((b) => [b.start, b.end]), [[101, 103], [104, 106]]);
  assert.notEqual(m.blocks[0].comments[0].id, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(m.bookmarks.map((b) => [b.time, b.title, b.kind]), [[100, 'Ep 2', 'scene'], [102, 'Opening titles', 'scene']]);
  assert.ok(m.bookmarks.every((b) => b.id !== '33333333-3333-4333-8333-333333333333'));
  assert.deepEqual(m.comments.map((c) => c.time), [105]);
  assert.notEqual(m.comments[0].id, '44444444-4444-4444-8444-444444444444');
  assert.deepEqual(m.scenes.map((x) => [x.start, x.end]), [[100, 104], [104, 108]]);
  // The script itself is left as it was.
  assert.equal(s.blocks[0].start, 1);
});

test('a script moved earlier than 0 stops at 0', () => {
  const m = shiftScript(readScript('a.srt', SRT), -6, ids);
  assert.deepEqual(m.blocks.map((b) => b.start), [0, 4]);
});

test('added scenes take the place of the stretch they cover', () => {
  const had = [{ start: 0, end: 50, text: 'A' }, { start: 50, end: 150, text: 'B' }, { start: 150, end: 200, text: 'C' }];
  const out = mergeScenes(had, [[{ start: 100, end: 120, text: 'X' }, { start: 120, end: 160, text: 'Y' }]]);
  assert.deepEqual(out.map((x) => [x.start, x.end, x.text]), [[0, 50, 'A'], [50, 100, 'B'], [100, 120, 'X'], [120, 160, 'Y'], [160, 200, 'C']]);
  assert.deepEqual(mergeScenes(had, [[]]), had);
  assert.deepEqual(mergeScenes([], [[{ start: 5, end: 9, text: '' }]]).length, 1);
});

test('words merge without repeats', () => {
  assert.deepEqual(mergeWords(['Zorblax', 'Quill'], [['Quill', 'Mira'], []]), ['Zorblax', 'Quill', 'Mira']);
});

test('overlaps count added blocks landing on others, not blocks only touching', () => {
  const own = [{ start: 0, end: 10 }, { start: 20, end: 30 }];
  assert.equal(countOverlaps([own, [{ start: 10, end: 20 }]]), 0);
  assert.equal(countOverlaps([own, [{ start: 5, end: 12 }, { start: 40, end: 45 }]]), 1);
  // Two added scripts landing on each other count on both sides.
  assert.equal(countOverlaps([[], [{ start: 0, end: 10 }], [{ start: 9, end: 11 }]]), 2);
  // Blocks of one script overlapping each other were like that before.
  assert.equal(countOverlaps([[], [{ start: 0, end: 10 }, { start: 5, end: 8 }]]), 0);
});

test('choosing some blocks moves the first chosen one to 0, with what lies between', () => {
  const s = readScript('Ep 2.scribecue', project());
  assert.equal(pickBlocks(s, null), s);
  assert.equal(pickBlocks(s, new Set([0, 1])), s);
  const p = pickBlocks(s, new Set([1]));
  assert.deepEqual(p.blocks.map((b) => [b.start, b.end, b.text]), [[0, 2, 'Day.']]);
  // The comment at 5 is inside 4–6; the bookmark at 2 isn't.
  assert.deepEqual(p.comments.map((c) => c.time), [1]);
  assert.deepEqual(p.bookmarks, []);
  // Scenes are cut to the chosen stretch.
  assert.deepEqual(p.scenes.map((x) => [x.start, x.end]), [[0, 2]]);
  assert.deepEqual(span(p), { first: 0, last: 2 });
  assert.equal(endsAt(p, 100), 102);
  // "Starts at" is where the first chosen block lands.
  const m = shiftScript(p, 100, ids);
  assert.deepEqual(m.blocks.map((b) => b.start), [100]);
  assert.deepEqual(m.bookmarks.map((b) => [b.time, b.title]), [[100, 'Ep 2']]);
  assert.equal(s.blocks.length, 2, 'the script itself is left as it was');
});

test('chosen blocks keep their spacing; none chosen adds nothing', () => {
  const s = readScript('ep1.srt', SRT + '\n3\n00:00:20,000 --> 00:00:21,000\nCredits.\n');
  const p = pickBlocks(s, new Set([0, 2]));
  assert.deepEqual(p.blocks.map((b) => [b.start, b.end]), [[0, 2], [15, 16]]);
  assert.deepEqual(pickBlocks(s, new Set()).blocks, []);
});
