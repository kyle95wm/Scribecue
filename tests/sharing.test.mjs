import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sharing from '../app/js/sharing.js';
import { readLinks, parseLink } from '../app/js/sharekeys.js';

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
  // Links turned off stay, marked off, with only what checks their earlier changes.
  const off = r.links.filter((l) => l.off);
  assert.deepEqual(off.map((l) => l.role).sort(), ['comment', 'edit']);
  for (const l of off) assert.deepEqual(Object.keys(l).sort(), ['id', 'off', 'pub', 'role']);
  const list = await readLinks(r.room, r.ownerPub, await sharing.signedLinks(r));
  assert.equal(list.n, 4);
  assert.deepEqual([...list.links.values()].filter((l) => !l.off).map((l) => l.role).sort(), ['edit', 'owner']);
  assert.equal(list.links.get(first).off, true);
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
