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
  assert.deepEqual(keys.signed.update('r', 'script', data, 'dev', 2), relay.signed.update('r', 'script', data, 'dev', 2));
  assert.deepEqual(keys.signed.snapshot('r', 'script', 4, data, 'dev', 2), relay.signed.snapshot('r', 'script', 4, data, 'dev', 2));
  assert.notDeepEqual(keys.signed.update('r', 'script', data, 'dev', 2), keys.signed.update('r', 'script', data), 'numbered and old forms differ');
  assert.equal(keys.DEVICES, relay.LIMITS.devices);
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

test('changes sealed before keys had numbers still open; newer keys are added, never lost', async () => {
  const room = 'AAAAAAAAAAAAAAAAAAAAAA', k1 = keys.newProjectKey(), k2 = keys.newProjectKey();
  // As sealed before: iv and ciphertext, bound to room and document only.
  const raw = await crypto.subtle.importKey('raw', keys.unb64(k1), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`scribecue-change:${room}:script`) }, raw, new Uint8Array([1, 2, 3])));
  const c = await keys.projectCipher(k1, room);
  assert.deepEqual([...await c.open('script', new Uint8Array([...iv, ...ct]))], [1, 2, 3]);
  c.setKeys([k1, k2]);
  const sealed = await c.seal('script', new Uint8Array([4]));
  assert.equal(sealed[0], 2);
  c.setKeys([k1]); // an older list changes nothing
  assert.equal(c.count, 2);
  assert.deepEqual([...await c.open('script', sealed)], [4]);
  await assert.rejects(() => c.open('comments', sealed), 'bound to its document');
});

test('wrapped keys open only with the right wrapping key, room and link', async () => {
  const room = 'AAAAAAAAAAAAAAAAAAAAAA', w = keys.newProjectKey(), all = [keys.newProjectKey(), keys.newProjectKey(), keys.newProjectKey()];
  const wrapped = await keys.wrapKeys(room, 'ed1', w, all, 1);
  assert.deepEqual(await keys.unwrapKeys(room, 'ed1', w, wrapped, [all[0]]), all);
  assert.deepEqual(await keys.unwrapKeys(room, 'ed2', w, wrapped, [all[0]]), [all[0]], 'another link');
  assert.deepEqual(await keys.unwrapKeys(room, 'ed1', keys.newProjectKey(), wrapped, [all[0]]), [all[0]], 'another key');
  assert.deepEqual(await keys.unwrapKeys(room, 'ed1', w, 'junk', [all[0]]), [all[0]]);
});
