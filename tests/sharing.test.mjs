import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sharing from '../app/js/sharing.js';
import { readLinks, unwrapKeys, parseLink } from '../app/js/sharekeys.js';
import { readLinks as relayReadLinks, ed25519 } from '../relay/src/room.js';
import { readDays, expiryText, JOIN_TEXT } from '../app/js/sharedialog.js';

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

test('a link can expire after a number of days, and is then turned off with a new key', async () => {
  const now = Date.UTC(2026, 10, 8, 12), project = crypto.randomUUID();
  assert.equal(sharing.expiryIn(7, now), now + 7 * sharing.DAY);
  for (const bad of [null, 0, 1.5, sharing.MAX_DAYS + 1]) assert.equal(sharing.expiryIn(bad, now), null);
  let r = await sharing.startSharing(project, 'ws://relay', { edit: 'a' }, fast, { edit: now + sharing.DAY });
  r = await sharing.addLink(r, 'comment', 'b', fast, null, now + 3 * sharing.DAY);
  r = await sharing.addLink(r, 'review', 'c', fast);
  assert.equal(sharing.nextExpiry(r), now + sharing.DAY);
  // The relay reads when each expires from the owner's signed list; links without one never do.
  const signedList = await sharing.signedLinks(r);
  const relayList = await relayReadLinks(r.room, r.ownerPub, signedList, ed25519());
  assert.deepEqual([...relayList.links.values()].map((l) => [l.role, l.expires]), [['edit', now + sharing.DAY], ['comment', now + 3 * sharing.DAY], ['review', undefined]]);
  assert.equal((await readLinks(r.room, r.ownerPub, signedList)).links.get(r.links[0].id).expires, now + sharing.DAY, 'people in the project can see it too');
  // Not yet: nothing changes. After a day: the edit link goes off, with a new project key.
  assert.equal(sharing.expireLinks(r, now), r);
  assert.equal(sharing.linksOf(r, 'https://x.test/', now).length, 3);
  assert.equal(sharing.linksOf(r, 'https://x.test/', now + sharing.DAY).length, 2, 'an expired link no longer shows');
  const later = sharing.expireLinks(r, now + sharing.DAY, { [r.links[0].id]: { dev12345: 4 } });
  assert.equal(later.n, r.n + 1);
  assert.equal(later.keys.length, r.keys.length + 1);
  assert.deepEqual(later.links.map((l) => [l.role, !!l.off]), [['edit', true], ['comment', false], ['review', false]]);
  assert.deepEqual(later.links[0].upTo, { dev12345: 4 });
  assert.equal(later.links[0].expires, now + sharing.DAY, 'it keeps when it expired');
  assert.equal((await relayReadLinks(r.room, r.ownerPub, await sharing.signedLinks(later), ed25519())).links.get(r.links[0].id).expires, now + sharing.DAY);
  assert.equal(sharing.nextExpiry(later), now + 3 * sharing.DAY);
  assert.equal(sharing.nextExpiry(sharing.expireLinks(later, now + 3 * sharing.DAY)), null);
});

test('the days typed for a link are checked, and its expiry reads plainly', () => {
  assert.equal(readDays('', 365), null);
  assert.equal(readDays(' 7 ', 365), 7);
  for (const bad of ['0', '1.5', '366', 'soon', '-2']) assert.ok(Number.isNaN(readDays(bad, 365)), bad);
  const now = Date.UTC(2026, 10, 8, 12);
  assert.match(expiryText(now + 7 * 86_400_000, now), /^Expires .+, in 7 days$/);
  assert.match(expiryText(now + 86_400_000, now), /, in 1 day$/);
  assert.match(expiryText(now + 3_600_000, now), /, within a day$/);
});

test('a recovery link opens the project as its owner, with every link, and stays up to date', async () => {
  const project = crypto.randomUUID();
  let r = await sharing.startSharing(project, 'ws://relay', { edit: 'a' }, fast);
  r = sharing.removeLink(r, r.links[0].id, {}); // a second project key, and a link turned off
  r = await sharing.addLink(r, 'comment', 'b', fast, null, Date.now() + sharing.DAY);
  r.created = true;
  r = await sharing.addRecovery(r, 'long enough password', fast);
  const url = sharing.recoveryUrl(r, 'https://example.test/');
  const hash = new URL(url).hash;
  assert.equal(parseLink(hash).id, r.recovery.id);
  // The relay serves the box from the owner's signed list, with the list.
  let signedList = await sharing.signedLinks(r);
  const relayList = await relayReadLinks(r.room, r.ownerPub, signedList, ed25519());
  assert.equal(relayList.recovery.id, r.recovery.id);
  assert.ok(!signedList.text.includes(r.priv) && !signedList.text.includes(r.recovery.secret), 'nothing secret is in the clear');
  const fetch = async () => ({ role: 'owner', box: relayList.recovery.box, links: signedList });
  await assert.rejects(sharing.joinShare(hash, 'wrong password', 'ws://relay', { fetch, ...fast }), /wrong-password/);
  const back = await sharing.joinShare(hash, 'long enough password', 'ws://relay', { fetch, ...fast });
  for (const k of ['room', 'link', 'role', 'priv', 'ownerPub', 'keys', 'ow', 'project', 'n', 'links', 'recovery']) assert.deepEqual(back[k], r[k], k);
  assert.equal(sharing.linksOf(back, 'https://x.test/')[0].url, sharing.linksOf(r, 'https://x.test/')[0].url, 'the link to copy is the same');
  // A list not signed by the owner in the box is refused.
  const other = await sharing.startSharing(project, 'ws://relay', {}, fast);
  const forged = await sharing.signedLinks({ ...other, room: r.room });
  await assert.rejects(sharing.joinShare(hash, 'long enough password', 'ws://relay', { fetch: async () => ({ role: 'owner', box: relayList.recovery.box, links: forged }), ...fast }));
  // The recovered browser makes a link; the first catches up, secret included.
  const made = await sharing.addLink(back, 'review', 'c', fast);
  signedList = await sharing.signedLinks(made);
  const caught = (await sharing.rebaseLinks(r, signedList)).record;
  assert.equal(caught.n, made.n);
  assert.deepEqual(sharing.linksOf(caught, 'https://x.test/').map((l) => l.url).sort(), sharing.linksOf(made, 'https://x.test/').map((l) => l.url).sort());
  assert.equal(await sharing.rebaseLinks(made, signedList), null, 'nothing newer');
  // Turned off: the list no longer has it.
  const off = sharing.removeRecovery(made);
  assert.equal(off.recovery, undefined);
  assert.equal(off.n, made.n + 1);
  assert.equal((await relayReadLinks(r.room, r.ownerPub, await sharing.signedLinks(off), ed25519())).recovery, null);
});

test('links made at a localhost address, as in Docker, open the web version', () => {
  const { linkBase, linksGoToWeb, WEB_APP, DEFAULT_RELAY } = sharing;
  for (const here of ['http://localhost:8484/', 'http://127.0.0.1:8484/?x=1#share=a.b.c', 'http://[::1]:8484/', 'http://scribecue.localhost/']) {
    assert.equal(linkBase(here, DEFAULT_RELAY), WEB_APP, here);
    assert.equal(linksGoToWeb(here, DEFAULT_RELAY), true, here);
  }
  // An address others may reach, and the web version itself, keep their own.
  for (const here of ['http://studio.lan:8484/', 'https://scribecue.example.org/', WEB_APP + '#share=a.b.c']) {
    assert.equal(linkBase(here, DEFAULT_RELAY), here, here);
    assert.equal(linksGoToWeb(here, DEFAULT_RELAY), false, here);
  }
  // With a relay of its own, the web version wouldn't find the project, so links stay here.
  assert.equal(linkBase('http://localhost:8484/', 'ws://127.0.0.1:8787'), 'http://localhost:8484/');
  assert.equal(linkBase('not a url', DEFAULT_RELAY), 'not a url');
  // Only the start of the link changes: the part after # is the same.
  const r = { room: 'R'.repeat(22), links: [{ id: 'I'.repeat(12), secret: 'S'.repeat(22), role: 'edit' }] };
  const [web] = sharing.linksOf(r, linkBase('http://localhost:8484/', DEFAULT_RELAY));
  const [here] = sharing.linksOf(r, 'http://localhost:8484/');
  assert.ok(web.url.startsWith(WEB_APP + '#share='));
  assert.equal(web.url.split('#')[1], here.url.split('#')[1]);
});

test('a new link to a project kept here replaces the old one, unless it’s the owner’s', () => {
  const l = { room: 'r', id: 'new', secret: 's' };
  const guest = (project = 'p') => ({ project, record: { room: 'r', link: 'old', role: 'comment' } });
  assert.equal(sharing.linkAction(null, 'p', l), 'join', 'a project not kept here');
  assert.equal(sharing.linkAction(guest(), 'p', l), 'switch', 'another link to the project open here');
  assert.equal(sharing.linkAction(guest('other'), 'p', l), 'switch', 'another link to a project kept here');
  assert.equal(sharing.linkAction(guest(), 'p', { ...l, id: 'old' }), 'same', 'the link it’s open with');
  assert.equal(sharing.linkAction(guest('other'), 'p', { ...l, id: 'old' }), 'reopen', 'the same link, to a project kept here: no password');
  const owner = { project: 'p', record: { room: 'r', link: 'owner', role: 'owner' } };
  assert.equal(sharing.linkAction(owner, 'p', l), 'own', 'the owner stays the owner');
  assert.equal(sharing.linkAction(owner, 'other', l), 'own', 'even with another project open');
});

test('a link replacing another says so', () => {
  assert.match(JOIN_TEXT.switch.intro, /replaces/);
  assert.equal(JOIN_TEXT.switch.password, 'Password');
});

test('the shared projects kept here, by whose they are', () => {
  const data = {
    'scribecue.share.a': JSON.stringify({ link: 'owner', role: 'owner', room: 'r1', priv: 'k' }),
    'scribecue.share.b': JSON.stringify({ link: 'owner', role: 'owner', room: 'r2', priv: 'k', recovery: { id: 'x' } }),
    'scribecue.share.c': JSON.stringify({ link: 'l1', role: 'comment', room: 'r3', priv: 'k' }),
    'scribecue.v1': '{}',
  };
  const keys = Object.keys(data);
  const storage = { length: keys.length, key: (i) => keys[i], getItem: (k) => data[k] ?? null };
  assert.deepEqual(sharing.sharesHere(storage), { owned: 2, unrecovered: 1, joined: 1 });
  assert.deepEqual(sharing.sharesHere({ get length() { throw new Error('blocked'); } }), { owned: 0, unrecovered: 0, joined: 0 });
});

test('two of the owner’s browsers changing links apart keep both changes', async () => {
  const project = crypto.randomUUID();
  let base = await sharing.startSharing(project, 'ws://relay', { edit: 'a', review: 'b', comment: 'c' }, fast);
  base.created = true;
  base = await sharing.addRecovery(base, 'long enough password', fast);
  const id = (role) => base.links.find((l) => l.role === role && !l.off).id;
  const on = (r) => r.links.filter((l) => !l.off).map((l) => l.role).sort();
  // Each browser turns off a different link: the other's turn-off isn't lost, whichever is newer.
  const mini = sharing.sealLinks(sharing.removeLink(base, id('comment'), {}), [id('comment')]);
  const air = sharing.removeLink(base, id('review'));
  for (const [mine, theirs] of [[air, mini], [mini, air]]) {
    const read = await readLinks(base.room, base.ownerPub, await sharing.signedLinks(theirs));
    assert.ok(sharing.lacksFrom(mine, read), 'the relay’s list has a change this one lacks');
    const { record, changed, dropped } = sharing.mergeApart(mine, theirs);
    assert.ok(changed);
    assert.deepEqual(dropped, []);
    assert.deepEqual(on(record), ['edit'], 'both links are off');
    assert.ok(record.n > Math.max(mine.n, theirs.n), 'the combined list is the newest');
    assert.deepEqual(record.keys.slice(0, theirs.keys.length), theirs.keys, 'it carries on from the relay’s keys');
    assert.ok(record.keys.length > theirs.keys.length, 'with a new key the turned-off link never has');
    assert.ok(record.links.find((l) => l.id === id('comment')).sealed, 'the Mini’s sealed link stays sealed');
  }
  // Once combined, the other browser has nothing to add.
  const combined = sharing.mergeApart(air, mini).record;
  assert.equal(sharing.lacksFrom(combined, await readLinks(base.room, base.ownerPub, await sharing.signedLinks(mini))), false);
  assert.equal(sharing.mergeApart(mini, combined).changed, false, 'the other just takes it');
  // Through the signed list, as the app does it.
  const r = await sharing.rebaseLinks(air, await sharing.signedLinks(mini));
  assert.deepEqual(on(r.record), ['edit']);
  assert.equal(await sharing.rebaseLinks(combined, await sharing.signedLinks(mini)), null, 'nothing to catch up on');
});

test('a link made apart is kept, with the keys it lacks, unless the other made one for its role', async () => {
  const project = crypto.randomUUID();
  let base = await sharing.startSharing(project, 'ws://relay', { edit: 'a', comment: 'c' }, fast);
  base.created = true;
  const mini = sharing.removeLink(base, base.links.find((l) => l.role === 'edit').id, {}); // a new key here
  const air = await sharing.addLink(base, 'review', 'b', fast); // made with the keys from before
  const { record, changed } = sharing.mergeApart(air, mini);
  assert.ok(changed);
  const review = record.links.find((l) => l.role === 'review' && !l.off);
  assert.ok(review, 'the review link made apart is kept');
  assert.equal(review.from, base.keys.length, 'it’s sent the keys from where the two lists differ');
  assert.deepEqual(record.links.filter((l) => !l.off).map((l) => l.role).sort(), ['comment', 'review']);
  // Both made a review link apart: the relay's stays, and the one made here goes.
  const mini2 = await sharing.addLink(base, 'review', 'x', fast);
  const both = sharing.mergeApart(air, mini2);
  assert.equal(both.dropped.length, 1);
  assert.deepEqual(both.record.links.filter((l) => !l.off && l.role === 'review').map((l) => l.id), [mini2.links.find((l) => l.role === 'review').id]);
});
