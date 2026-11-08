import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SharedProject, retype, linkTabs } from '../app/js/shared.js';
import { cleanComments } from '../app/js/comments.js';
import * as Y from '../app/vendor/yjs.js';

const uid = (n) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
const blocks = () => [
  { uid: uid(1), start: 1, end: 3, text: 'Mara opens a door.', voice: 'v1', comments: cleanComments([{ text: 'Colour?', author: 'Sam', created: '2026-11-08T00:00:00Z' }]) },
  { uid: uid(2), start: 5, end: 7, text: 'She steps outside.', auto: true, notes: 'Softly', edited: { by: 'Kyle', at: '2026-11-08T00:00:00Z', who: 'kyle-browser-1' } },
];
const timeline = () => cleanComments([{ text: 'Music too loud', author: 'Sam', created: '2026-11-08T00:01:00Z', time: 4 }], true);
// Two people, each with their own copy, passing updates both ways.
const pair = () => {
  const a = new SharedProject(), b = new SharedProject();
  a.doc.on('update', (u, origin) => { if (origin !== 'remote') b.apply(u); });
  b.doc.on('update', (u, origin) => { if (origin !== 'remote') a.apply(u); });
  return [a, b];
};

test('a project goes in and comes back out the same, leaving local-only parts behind', () => {
  const s = new SharedProject(), list = blocks();
  list[0].pickup = { note: 'again' }; list[0].qcReading = 99; list[0].id = 7; list[1].fit = false;
  s.write(list, timeline());
  const out = s.read();
  assert.deepEqual(out.blocks, blocks().map(({ ...b }) => b));
  assert.deepEqual(out.comments, timeline());
  assert.equal(s.write(list, timeline()), 0, 'writing it again changes nothing');
});

test('edits reach the other copy; only others’ changes are reported', () => {
  const [a, b] = pair(), seen = [], mine = [];
  b.observe((uids, tl) => seen.push([uids, tl]));
  a.observe((uids) => mine.push(uids));
  a.write(blocks(), timeline());
  assert.deepEqual(b.read(), a.read());
  assert.equal(mine.length, 0, 'your own edits are not reported back');
  seen.length = 0;
  const list = a.read().blocks; list[1].text = 'She steps out.'; list[1].start = 4.5;
  a.write(list, timeline(), [uid(2)]);
  assert.deepEqual(seen, [[[uid(2)], false]]);
  assert.equal(b.read().blocks[1].text, 'She steps out.');
});

test('two people typing in the same block keep both their words', () => {
  const [a, b] = pair();
  a.write(blocks(), []);
  // Offline from each other for a moment: both edit block 1, then swap updates.
  const a2 = new SharedProject(), b2 = new SharedProject();
  a2.apply(a.update()); b2.apply(a.update());
  const one = a2.read().blocks, two = b2.read().blocks;
  one[0].text = 'Mara slowly opens a door.'; two[0].text = 'Mara opens a red door.';
  a2.write(one, [], [uid(1)]); b2.write(two, [], [uid(1)]);
  a2.apply(b2.update()); b2.apply(a2.update());
  assert.equal(a2.read().blocks[0].text, 'Mara slowly opens a red door.');
  assert.deepEqual(a2.read(), b2.read());
});

test('blocks and comments that go are removed on both sides; comments added on both are kept', () => {
  const [a, b] = pair();
  a.write(blocks(), timeline());
  const list = b.read().blocks.slice(0, 1);
  list[0].comments = [...list[0].comments, ...cleanComments([{ text: 'Second', author: 'Kyle', created: '2026-11-08T00:02:00Z' }])];
  b.write(list, []);
  assert.deepEqual(a.read().blocks.map((x) => x.uid), [uid(1)]);
  assert.deepEqual(a.read().blocks[0].comments.map((c) => c.text), ['Colour?', 'Second']);
  assert.deepEqual(a.read().comments, [], 'the timeline comment went with the whole-project write');
  // Writing one block leaves the rest, and timeline comments, alone.
  a.write(blocks(), timeline());
  const one = a.read().blocks.filter((x) => x.uid === uid(2));
  one[0].text = 'Changed';
  b.write(one, [], [uid(2)]);
  assert.equal(a.read().blocks.length, 2);
  assert.equal(a.read().comments.length, 1);
});

test('retype changes text at one place', () => {
  const doc = new Y.Doc(), t = doc.getText('t');
  t.insert(0, 'The cat sat.');
  const ops = [];
  t.observe((e) => ops.push(e.delta));
  retype(t, 'The black cat sat.');
  assert.equal(t.toString(), 'The black cat sat.');
  assert.deepEqual(ops[0], [{ retain: 4 }, { insert: 'black ' }]);
  retype(t, '');
  assert.equal(t.toString(), '');
});

test('1,500 blocks over two hours go in quickly enough to split into steps', () => {
  const list = Array.from({ length: 1500 }, (_, i) => ({ uid: crypto.randomUUID(), start: i * 4.8, end: i * 4.8 + 3, text: `Block ${i} describes the scene in some detail.` }));
  const s = new SharedProject(), t = performance.now();
  s.write(list, []);
  const ms = performance.now() - t;
  assert.equal(s.read().blocks.length, 1500);
  assert.ok(ms < 1000, `took ${Math.round(ms)} ms`);
  assert.ok(s.update().length < 400_000, `update is ${s.update().length} bytes`);
});

test('a tab that opens takes the copy another tab already has, then edits flow both ways', async () => {
  const name = crypto.randomUUID(), tick = () => new Promise((r) => setTimeout(r, 20));
  const a = new SharedProject(), la = linkTabs(a, name, { wait: 30 });
  assert.equal(await la.ready, false, 'nobody else had it open');
  a.write(blocks(), timeline());
  const b = new SharedProject(), lb = linkTabs(b, name, { wait: 500 });
  assert.equal(await lb.ready, true);
  assert.deepEqual(b.read(), a.read());
  const seen = [];
  a.observe((uids) => seen.push(...uids));
  const list = b.read().blocks; list[0].text = 'Mara opens a blue door.';
  b.write(list, timeline(), [uid(1)]);
  await tick();
  assert.equal(a.read().blocks[0].text, 'Mara opens a blue door.');
  assert.deepEqual(seen, [uid(1)]);
  // Typing in the same block from both tabs at once keeps both.
  const one = a.read().blocks, two = b.read().blocks;
  one[0].text = 'Mara slowly opens a blue door.'; two[0].text = 'Mara opens a blue door again.';
  a.write(one, [], [uid(1)]); b.write(two, [], [uid(1)]);
  await tick();
  assert.equal(a.read().blocks[0].text, 'Mara slowly opens a blue door again.');
  assert.deepEqual(a.read(), b.read());
  // Other projects, and damaged messages, are ignored.
  const other = new SharedProject(), lo = linkTabs(other, crypto.randomUUID(), { wait: 30 });
  assert.equal(await lo.ready, false);
  const raw = new BroadcastChannel(`scribecue-shared:${name}`);
  raw.postMessage({ type: 'update', update: new Uint8Array([1, 2, 3]) }); raw.postMessage('nonsense');
  await tick();
  assert.deepEqual(a.read(), b.read());
  for (const l of [la, lb, lo]) l.stop();
  raw.close();
});

test('a tab still waiting never hands on its empty copy', async () => {
  const name = crypto.randomUUID();
  const a = new SharedProject(), la = linkTabs(a, name, { wait: 300 });
  const b = new SharedProject(), lb = linkTabs(b, name, { wait: 30 });
  assert.equal(await lb.ready, false, 'a has nothing to hand on yet');
  la.stop(); lb.stop();
});

test('undo takes back only your own changes, step by step, and redo puts them back', () => {
  const [a, b] = pair();
  a.write(blocks(), timeline());
  const undo = a.undoer();
  // Step 1: A types in block 1, in several writes, as typing does.
  undo.step();
  for (const text of ['Mara opens a door slowly.', 'Mara opens a door slowly, smiling.']) {
    const list = a.read().blocks; list[0].text = text; a.write(list, timeline(), [uid(1)]);
  }
  // B types in the same block, and moves block 2.
  let list = b.read().blocks; list[0].text = 'Now Mara opens a door slowly, smiling.'; list[1].start = 4;
  b.write(list, timeline());
  // Step 2: A deletes block 2.
  undo.step();
  a.write(a.read().blocks.slice(0, 1), timeline());
  assert.equal(undo.depth(), 2);

  assert.ok(undo.undo());
  assert.deepEqual(b.read().blocks.map((x) => [x.uid, x.start]), [[uid(1), 1], [uid(2), 4]], 'block 2 is back, where B moved it');
  assert.ok(undo.undo());
  assert.equal(b.read().blocks[0].text, 'Now Mara opens a door.', 'A’s typing went as one step; B’s word stayed');
  assert.equal(undo.undo(), false, 'nothing else of A’s to undo');
  assert.equal(undo.depth(), 0);

  assert.ok(undo.redo());
  assert.equal(b.read().blocks[0].text, 'Now Mara opens a door slowly, smiling.');
  assert.ok(undo.redo());
  assert.equal(b.read().blocks.length, 1);
  assert.deepEqual(a.read(), b.read());
});

test('undo of a comment leaves others’ comments alone', () => {
  const [a, b] = pair();
  a.write(blocks(), timeline());
  const undo = a.undoer();
  undo.step();
  {
    const l = a.read().blocks;
    l[1].comments = cleanComments([{ text: 'Too fast', author: 'Kyle', created: '2026-11-08T00:03:00Z' }]);
    a.write(l, timeline(), [uid(2)]);
  }
  const l = b.read().blocks;
  l[1].comments = [...l[1].comments, ...cleanComments([{ text: 'Agreed', author: 'Sam', created: '2026-11-08T00:04:00Z' }])];
  b.write(l, timeline(), [uid(2)]);
  undo.undo();
  assert.deepEqual(b.read().blocks[1].comments.map((c) => c.text), ['Agreed']);
});
