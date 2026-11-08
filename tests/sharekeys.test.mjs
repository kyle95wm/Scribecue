import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as keys from '../app/js/sharekeys.js';
import * as relay from '../relay/src/room.js';

const fast = { iterations: 1000 };

test('a link opens with its password, and not with another', async () => {
  const owner = await keys.newOwner();
  const link = await keys.newLink(owner, 'edit', 'blue door', fast);
  const opened = await keys.openBox({ room: owner.room, ...link }, 'blue door', fast);
  assert.deepEqual(opened.projectKey, owner.projectKey);
  assert.equal(opened.ownerPub, owner.ownerPub);
  await assert.rejects(keys.openBox({ room: owner.room, ...link }, 'red door', fast), /wrong-password/);
  // The box is for this link and role only.
  await assert.rejects(keys.openBox({ room: owner.room, ...link, role: 'comment' }, 'blue door', fast), /wrong-password/);
  await assert.rejects(keys.openBox({ room: owner.room, ...link, secret: owner.room }, 'blue door', fast), /wrong-password/);
});

test('links go into a URL after # and come back out', async () => {
  const owner = await keys.newOwner(), link = await keys.newLink(owner, 'comment', '', fast);
  const url = keys.linkUrl('https://scribecue.kyleadvoice.ca/?x=1#old', owner.room, link.id, link.secret);
  assert.match(url, /^https:\/\/scribecue\.kyleadvoice\.ca\/\?x=1#share=/);
  assert.deepEqual(keys.parseLink(new URL(url).hash), { room: owner.room, id: link.id, secret: link.secret });
  assert.equal(keys.parseLink('#share=short.bad.link'), null);
  assert.equal(keys.parseLink(''), null);
});

test('the signed list of links checks out here and on the relay', async () => {
  const owner = await keys.newOwner(), link = await keys.newLink(owner, 'review', 'pw', fast);
  const list = await keys.signLinks(owner, 3, [link]);
  assert.ok(!list.text.includes(link.secret), 'secrets stay with the owner');
  const here = await keys.readLinks(owner.room, owner.ownerPub, list);
  assert.equal(here.n, 3);
  assert.deepEqual(here.links.get(link.id), { role: 'review', pub: link.pub });
  const there = await relay.readLinks(owner.room, owner.ownerPub, list, relay.ed25519());
  assert.equal(there.links.get(link.id).role, 'review');
  const other = await keys.newOwner();
  await assert.rejects(keys.readLinks(owner.room, other.ownerPub, list));
});

test('what gets signed matches the relay, byte for byte', () => {
  const data = new Uint8Array([1, 2, 3]);
  assert.deepEqual(keys.signed.auth('r', 'n'), relay.signed.auth('r', 'n'));
  assert.deepEqual(keys.signed.update('r', 'script', data), relay.signed.update('r', 'script', data));
  assert.deepEqual(keys.signed.snapshot('r', 'script', 4, data), relay.signed.snapshot('r', 'script', 4, data));
  assert.deepEqual(keys.signed.links('t'), relay.signed.links('t'));
  assert.deepEqual(keys.WRITERS, relay.WRITERS);
  assert.deepEqual(keys.ROLES, relay.ROLES);
});

test('changes are encrypted for one room and document', async () => {
  const owner = await keys.newOwner(), c = await keys.projectCipher(owner.projectKey, owner.room);
  const data = new TextEncoder().encode('Mara opens a door.');
  const sealed = await c.seal('script', data);
  assert.ok(!Buffer.from(sealed).toString().includes('Mara'));
  assert.deepEqual(await c.open('script', sealed), data);
  await assert.rejects(c.open('comments', sealed));
  const elsewhere = await keys.projectCipher(owner.projectKey, (await keys.newOwner()).room);
  await assert.rejects(elsewhere.open('script', sealed));
  const sign = await keys.signer(owner.ownerPriv), verify = keys.verifier();
  const sig = await sign(sealed);
  assert.ok(await verify(owner.ownerPub, sig, sealed));
  assert.equal(await verify(owner.ownerPub, sig, data), false);
});
