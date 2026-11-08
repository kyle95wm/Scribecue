import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sharing from '../app/js/sharing.js';
import { readLinks, unwrapKeys, parseLink } from '../app/js/sharekeys.js';

const fast = { iterations: 1000 };
function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

test('the owner shares, adds and replaces links, and turns one off', async () => {
  const project = crypto.randomUUID();
  let r = await sharing.startSharing(project, 'ws://relay', { edit: 'a' }, fast);
  assert.deepEqual(r.links.map((l) => l.role), ['edit']);
  r = await sharing.addLink(r, 'comment', 'b', fast);
  const first = r.links.find((l) => l.role === 'edit').id;
  r = await sharing.addLink(r, 'edit', 'c', fast);
  const on = () => r.links.filter((l) => !l.off);
  assert.deepEqual(on().map((l) => l.role).sort(), ['comment', 'edit']);
  assert.notEqual(on().find((l) => l.role === 'edit').id, first, 'a new edit link replaces the old');
  r = sharing.removeLink(r, on().find((l) => l.role === 'comment').id);
  assert.equal(r.n, 4);
  assert.equal(r.keys.length, 3, 'replacing a link and turning one off each add a project key');
  // Links turned off stay, marked off, with only what checks their earlier changes.
  const off = r.links.filter((l) => l.off);
  assert.deepEqual(off.map((l) => l.role).sort(), ['comment', 'edit']);
  for (const l of off) assert.deepEqual(Object.keys(l).sort(), ['id', 'off', 'pub', 'role', 'upTo']);
  const list = await readLinks(r.room, r.ownerPub, await sharing.signedLinks(r));
  assert.equal(list.n, 4);
  assert.deepEqual([...list.links.values()].filter((l) => !l.off).map((l) => l.role).sort(), ['edit', 'owner']);
  assert.equal(list.links.get(first).off, true);
  // The link still on gets the keys its box lacks; the owner gets all of them.
  const ed = on().find((l) => l.role === 'edit');
  assert.deepEqual(Object.keys(list.wraps).sort(), ['owner', ed.id].sort());
  assert.deepEqual(await unwrapKeys(r.room, ed.id, ed.w, list.wraps[ed.id], r.keys.slice(0, ed.from)), r.keys);
  assert.equal(sharing.linksOf(r, 'https://example.test/app/').length, 1, 'only links that are on show');
  const [url] = sharing.linksOf(r, 'https://example.test/app/');
  assert.equal(parseLink(new URL(url.url).hash).room, r.room);
});

test('joining opens the box with the password, and is kept by project', async () => {
  const project = crypto.randomUUID(), storage = memory();
  const r = await sharing.startSharing(project, 'ws://relay', { review: 'pw' }, fast);
  const [l] = sharing.linksOf(r, 'https://example.test/');
  const link = r.links[0];
  const fetch = async (relay, room, id) => {
    assert.deepEqual([relay, room, id], ['ws://relay', r.room, link.id]);
    return { role: link.role, box: link.box };
  };
  await assert.rejects(sharing.joinShare(new URL(l.url).hash, 'nope', 'ws://relay', { fetch, ...fast }), /wrong-password/);
  await assert.rejects(sharing.joinShare('#nothing', 'pw', 'ws://relay', { fetch, ...fast }), /bad-link/);
  const joined = await sharing.joinShare(new URL(l.url).hash, 'pw', 'ws://relay', { fetch, ...fast });
  assert.equal(joined.role, 'review');
  assert.equal(joined.project, project, 'the joiner takes the project’s id');
  assert.equal(joined.projectKey, r.projectKey);
  sharing.setShare(project, joined, storage);
  assert.deepEqual(sharing.getShare(project, storage), joined);
  assert.equal(sharing.shareForRoom(r.room, storage).project, project);
  assert.equal(sharing.shareForRoom('other', storage), null);
  sharing.dropShare(project, storage);
  assert.equal(sharing.getShare(project, storage), null);
  assert.equal(sharing.relayUrl(storage), sharing.DEFAULT_RELAY);
  storage.setItem('scribecue.relay', 'wss://share.example');
  assert.equal(sharing.relayUrl(storage), 'wss://share.example');
});

test('a link turned off keeps the last number of each of its browsers', async () => {
  let r = await sharing.startSharing(crypto.randomUUID(), 'ws://relay', { edit: 'a', comment: 'b' }, fast);
  const [ed, co] = r.links;
  const seen = { [ed.id]: { devA: 7, devB: 2 } };
  r = sharing.removeLink(r, ed.id, seen);
  seen[ed.id].devA = 9; // later changes don't move it
  assert.deepEqual(r.links.find((l) => l.id === ed.id).upTo, { devA: 7, devB: 2 });
  // Offline: filled in when the connection is up to date, before the list goes out.
  r = sharing.removeLink(r, co.id);
  assert.equal(r.links.find((l) => l.id === co.id).upTo, null);
  const settled = sharing.settle(r, { [co.id]: { devC: 4 } });
  assert.deepEqual(settled.links.find((l) => l.id === co.id).upTo, { devC: 4 });
  assert.deepEqual(settled.links.find((l) => l.id === ed.id).upTo, { devA: 7, devB: 2 });
  assert.equal(sharing.settle(settled, {}), settled, 'nothing left to fill in');
  const list = await readLinks(r.room, r.ownerPub, await sharing.signedLinks(settled));
  assert.deepEqual(list.links.get(co.id).upTo, { devC: 4 });
  // Signed before it was filled in, as when making the room: nothing from it counts.
  assert.deepEqual((await readLinks(r.room, r.ownerPub, await sharing.signedLinks(r))).links.get(co.id).upTo, {});
});

test('links turned off are sealed once their last numbers are known', async () => {
  let r = await sharing.startSharing(crypto.randomUUID(), 'ws://relay', { edit: 'a', comment: 'b', review: 'c' }, fast);
  const [ed, co] = r.links;
  r = sharing.removeLink(r, ed.id, {});
  r = sharing.removeLink(r, co.id); // offline: not yet
  assert.deepEqual(sharing.unsealed(r), [ed.id]);
  const n = r.n;
  r = sharing.sealLinks(r, [ed.id]);
  assert.equal(r.n, n + 1);
  assert.deepEqual(sharing.unsealed(r), []);
  assert.deepEqual(sharing.unsealed(sharing.settle(r, {})), [co.id]);
  const list = await readLinks(r.room, r.ownerPub, await sharing.signedLinks(r));
  assert.equal(list.links.get(ed.id).sealed, true);
  assert.equal(list.links.get(co.id).sealed, undefined);
});
