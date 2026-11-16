import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareText, shareNames, readState, readRemote, merge, localValues, writeValues, applyPending, isShare } from '../app/js/drivesync.js';
import { combineShares } from '../app/js/driveshares.js';
import { startSharing, addLink, removeLink } from '../app/js/sharing.js';

const opts = { iterations: 1 };
function store(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => ['scribecue.' + k, v]));
  return {
    m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
  };
}
const text = (r) => shareText(JSON.stringify(r));
const remote = (settings) => readRemote({ scribecue: 'sync', version: 1, saved: 1, settings });
const synced = (seen) => readState(JSON.stringify({ seen }));
const owner = () => startSharing('p1', 'wss://relay.test', { edit: 'secret-one' }, opts).then((r) => ({ ...r, created: true, title: 'Pilot' }));
const joined = (keys) => ({ relay: 'wss://relay.test', room: 'room1', link: 'L1', secret: 's', role: 'edit', priv: 'k', ownerPub: 'o', projectKey: keys[0], keys, w: 'w', project: 'p2' });

test('a shared project syncs without when it was last opened, which stays as it is here', () => {
  const s = store({ 'share.p1': JSON.stringify({ room: 'r', opened: 5, n: 1 }), lead: '2' });
  assert.deepEqual(shareNames(s), ['share.p1']);
  assert.equal(localValues(s, ['share.p1'])['share.p1'], '{"n":1,"room":"r"}');
  writeValues(s, { 'share.p1': '{"n":2,"room":"r"}' });
  assert.deepEqual(JSON.parse(s.getItem('scribecue.share.p1')), { n: 2, room: 'r', opened: 5 });
});

test('the same record gives the same text, whatever order it was kept in', () => {
  assert.equal(shareText('{"b":1,"a":{"d":2,"c":3}}'), shareText('{"a":{"c":3,"d":2},"b":1}'));
});

test('only shared projects’ names are taken from Drive besides settings', () => {
  const r = remote({ 'share.p1': { v: '{}', at: 1 }, 'share.a/b': { v: '{}', at: 1 }, 'share.p2': { v: null, at: 2 } });
  assert.deepEqual(Object.keys(r.settings).sort(), ['share.p1', 'share.p2']);
  assert.ok(isShare('share.0b5c-1f') && !isShare('share.') && !isShare('shares'));
});

test('a new browser gets the shared projects in Drive, and adds its own', async () => {
  const mine = text(await owner()), theirs = text(joined(['a']));
  const r = merge({ local: { 'share.p1': mine }, state: readState(null), remote: remote({ 'share.p2': { v: theirs, at: 5 } }), now: 100, combine: combineShares });
  assert.deepEqual(r.apply, { 'share.p2': theirs });
  assert.deepEqual(r.file.settings['share.p1'], { v: mine, at: 100 });
  assert.equal(r.upload, true);
});

test('the owner’s links changed in two browsers between syncs: both are kept', async () => {
  const base = await owner();
  const here = await addLink(base, 'review', 'secret-two', opts);
  const there = await addLink(base, 'comment', 'secret-three', opts);
  const seen = { 'share.p1': { v: text(base), at: 10 } };
  const r = merge({ local: { 'share.p1': text(here) }, state: synced(seen), remote: remote({ 'share.p1': { v: text(there), at: 20 } }), now: 30, combine: combineShares });
  const out = JSON.parse(r.apply['share.p1']);
  assert.deepEqual(out.links.filter((l) => !l.off).map((l) => l.role).sort(), ['comment', 'edit', 'review']);
  assert.ok(out.n > here.n && out.n > there.n);
  assert.equal(out.title, 'Pilot');
  assert.equal(out.created, true);
  assert.equal(r.upload, true);
  assert.deepEqual(r.file.settings['share.p1'], { v: r.apply['share.p1'], at: 30 });
});

test('a link turned off in one browser stays off when the other made a link', async () => {
  const base = await owner();
  const edit = base.links[0].id;
  const here = removeLink(base, edit);
  const there = await addLink(base, 'review', 'secret-two', opts);
  const out = JSON.parse(combineShares('share.p1', text(here), text(there)));
  assert.equal(out.links.find((l) => l.id === edit).off, true);
  assert.ok(out.links.some((l) => l.role === 'review' && !l.off));
});

test('an older copy of the owner’s links never replaces a newer one', async () => {
  const base = await owner();
  const newer = await addLink(base, 'review', 'secret-two', opts);
  assert.equal(combineShares('share.p1', text(base), text(newer)), text(newer));
  assert.equal(combineShares('share.p1', text(newer), text(base)), text(newer));
});

test('a joined project keeps the copy with more project keys', () => {
  const a = text(joined(['k1'])), b = text(joined(['k1', 'k2']));
  assert.equal(combineShares('share.p2', a, b), b);
  assert.equal(combineShares('share.p2', b, a), b);
});

test('a project shared again keeps the owner’s copy', async () => {
  const mine = await owner();
  assert.equal(combineShares('share.p1', text(joined(['k'])), text(mine)), text(mine));
});

test('a shared project removed elsewhere is removed here, unless this browser never synced it', () => {
  const v = text(joined(['k1']));
  const seen = { 'share.p2': { v, at: 10 } };
  const gone = remote({ 'share.p2': { v: null, at: 20 } });
  const r1 = merge({ local: { 'share.p2': v }, state: synced(seen), remote: gone, now: 30, combine: combineShares });
  assert.deepEqual(r1.apply, { 'share.p2': null });
  const r2 = merge({ local: { 'share.p2': v }, state: readState(null), remote: gone, now: 30, combine: combineShares });
  assert.deepEqual(r2.apply, {});
  assert.deepEqual(r2.file.settings['share.p2'], { v, at: 30 });
});

test('a held shared project is used as Scribecue opens, keeping when it was opened here', () => {
  const s = store({ 'share.p2': JSON.stringify({ room: 'r', n: 1, opened: 7 }) });
  const state = { seen: { 'share.p2': { v: '{"n":1,"room":"r"}', at: 1 } }, pending: { 'share.p2': '{"n":2,"room":"r"}' } };
  assert.deepEqual(applyPending(s, state), ['share.p2']);
  assert.deepEqual(JSON.parse(s.getItem('scribecue.share.p2')), { n: 2, room: 'r', opened: 7 });
});
