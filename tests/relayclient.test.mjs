import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as keys from '../app/js/sharekeys.js';
import { RelayClient, fetchBox } from '../app/js/relayclient.js';
import { SharedProject } from '../app/js/shared.js';
import { Room, PROTOCOL, LIMITS } from '../relay/src/room.js';

const fast = { iterations: 1000 };
const clients = [];
afterEach(() => { for (const c of clients.splice(0)) c.stop(); });
const uid = (n) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
const blocks = () => [
  { uid: uid(1), start: 1, end: 3, text: 'Mara opens a door.' },
  { uid: uid(2), start: 5, end: 7, text: 'She steps outside.' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what = String(fn)) {
  for (let i = 0; i < 400; i++) { if (await fn()) return; await sleep(5); }
  throw new Error('Timed out: ' + what);
}

// The relay's rules in memory, behind a stand-in for WebSocket.
function network() {
  const rooms = new Map(), stores = new Map(), open = new Set();
  const memory = () => {
    const m = new Map();
    return {
      m,
      async get(k) { return structuredClone(m.get(k)); },
      async put(k, v) { if (typeof k === 'string') m.set(k, structuredClone(v)); else for (const [a, b] of Object.entries(k)) m.set(a, structuredClone(b)); },
      async delete(k) { for (const a of [k].flat()) m.delete(a); },
      async list({ prefix = '', start = '', end = '￿' } = {}) { return new Map([...m].filter(([a]) => a.startsWith(prefix) && a >= start && a < end).sort(([a], [b]) => (a < b ? -1 : 1)).map(([a, b]) => [a, structuredClone(b)])); },
      async deleteAll() { m.clear(); },
      async setAlarm() {},
    };
  };
  const roomFor = (id) => {
    if (!rooms.has(id)) { stores.set(id, memory()); rooms.set(id, new Room({ id, storage: stores.get(id), sockets: () => [...open].filter((s) => s.id === id) })); }
    return rooms.get(id);
  };
  class FakeSocket {
    constructor(url) {
      const id = url.split('/').pop(), room = roomFor(id), client = this;
      this.server = { id, state: {}, send: (t) => queueMicrotask(() => client.closed || client.onmessage?.({ data: t })), close: () => queueMicrotask(() => client.close()) };
      this.room = room; open.add(this.server);
      setTimeout(() => room.open(this.server));
    }
    send(t) { if (this.closed) throw new Error('closed'); net.biggest = Math.max(net.biggest, t.length); net.hook?.(t, this.room); this.room.message(this.server, t); }
    close() { if (this.closed) return; this.closed = true; open.delete(this.server); this.room.close(this.server); setTimeout(() => this.onclose?.({})); }
  }
  const net = { WebSocket: FakeSocket, stores, rooms, biggest: 0, hook: null, drop: () => { for (const s of [...open]) s.close(); } };
  return net;
}

async function share() {
  const net = network(), owner = await keys.newOwner();
  const edit = await keys.newLink(owner, 'edit', 'pw', fast), comment = await keys.newLink(owner, 'comment', 'pw', fast);
  const list = [edit, comment];
  const statuses = [];
  const make = (shared, who, extra = {}) => { const c = new RelayClient({ url: 'ws://relay', room: owner.room, who, shared, WebSocket: net.WebSocket, flushMs: 5, retryMs: 10, onStatus: (s, d) => statuses.push([who.link, s, d]), ...extra }).start(); clients.push(c); return c; };
  const mine = new SharedProject();
  mine.write(blocks(), []);
  const o = make(mine, { link: 'owner', priv: owner.ownerPriv, ownerPub: owner.ownerPub, keys: owner.keys, w: owner.ow }, { create: await keys.signLinks(owner, 1, list) });
  await until(() => o.status === 'online' && !o.unsent(), 'owner online with the script sent');
  const join = async (link, extra) => {
    const opened = await keys.openBox({ room: owner.room, ...link }, 'pw', fast);
    const s = new SharedProject();
    const c = make(s, { link: link.id, ...opened }, extra);
    await until(() => c.status === 'online', 'joined');
    return { s, c };
  };
  return { net, owner, edit, comment, list, mine, o, join, make, statuses };
}

test('a link joins, catches up, and changes pass both ways', async () => {
  const { mine, o, join, edit } = await share();
  const { s, c } = await join(edit);
  assert.deepEqual(s.read(), mine.read());
  const list = s.read().blocks; list[0].text = 'Mara opens a red door.';
  s.write(list, [], [uid(1)]);
  await until(() => mine.read().blocks[0].text === 'Mara opens a red door.');
  const back = mine.read().blocks; back[1].start = 4;
  mine.write(back, []);
  await until(() => s.read().blocks[1].start === 4);
  assert.deepEqual(s.read(), mine.read());
  c.stop(); o.stop();
});

test('a block being typed reaches others once it’s done; comments and their typing still arrive', async () => {
  const { mine, o, join, edit } = await share();
  const { s, c } = await join(edit);
  c.hold(true);
  const list = s.read().blocks;
  for (const t of ['Mara opens a r door.', 'Mara opens a re door.', 'Mara opens a red door.']) { list[0].text = t; s.write(list, [], [uid(1)]); await sleep(20); }
  list[1].comments = [{ id: crypto.randomUUID(), text: 'Too fast?', author: 'Sam', created: '2026-11-08T00:00:00Z' }];
  s.write(list, [], [uid(2)]);
  await until(() => mine.read().blocks[1].comments?.length === 1, 'the comment arrives');
  // The owner changes the same block meanwhile: it reaches the one typing, and both stay.
  const theirs = mine.read().blocks; theirs[0].text = 'Mara opens a door. Rain.';
  mine.write(theirs, [], [uid(1)]);
  await until(() => s.read().blocks[0].text.includes('Rain'), 'the owner’s change arrives while typing');
  await sleep(50);
  assert.equal(mine.read().blocks[0].text, 'Mara opens a door. Rain.', 'nothing typed has left yet');
  assert.equal(await c.compact(), false, 'no whole copy goes with the typing in it');
  c.hold(false);
  await until(() => mine.read().blocks[0].text === 'Mara opens a red door. Rain.', 'the typing arrives once done');
  assert.deepEqual(s.read(), mine.read());
  c.stop(); o.stop();
});

test('a comment link changes comments only; its block edits never leave', async () => {
  const { mine, o, join, comment, net, owner } = await share();
  const { s, c } = await join(comment);
  const list = s.read().blocks;
  list[0].text = 'Changed by the commenter';
  list[1].comments = [{ id: crypto.randomUUID(), text: 'Too fast?', author: 'Sam', created: '2026-11-08T00:00:00Z' }];
  s.write(list, []);
  await until(() => mine.read().blocks[1].comments?.length === 1, 'the comment arrives');
  await sleep(50);
  assert.equal(mine.read().blocks[0].text, 'Mara opens a door.');
  const stored = [...net.stores.get(owner.room).m.values()].filter((v) => v.doc);
  assert.ok(stored.every((v) => v.doc === 'comments' || v.by === 'owner'), 'nothing from the commenter in the script');
  c.stop(); o.stop();
});

test('changes made while offline arrive once it reconnects', async () => {
  const { mine, o, join, edit, net, statuses } = await share();
  const { s, c } = await join(edit);
  net.drop();
  await until(() => c.status === 'offline');
  const list = s.read().blocks; list[0].text = 'Written on the train.';
  s.write(list, [], [uid(1)]);
  const offlineAt = performance.now();
  await until(() => c.status === 'online' && !c.unsent(), 'back online with it sent');
  assert.ok(c.sentAt > offlineAt, 'it says when the relay last had everything');
  await until(() => mine.read().blocks[0].text === 'Written on the train.');
  assert.ok(statuses.some(([, st]) => st === 'offline'));
  c.stop(); o.stop();
});

test('coming back online tries again at once, not after the wait between tries', async () => {
  const { join, edit, net } = await share();
  const { c } = await join(edit, { retryMs: 60_000 });
  net.drop();
  await until(() => c.status === 'offline');
  c.reconnect();
  await until(() => c.status === 'online', 'online again well before a minute');
  c.reconnect(); // online already: nothing happens
  assert.equal(c.status, 'online');
});

test('a connection that hangs is given up on and tried again', async () => {
  const { join, edit, net } = await share();
  let hang = 1;
  class Flaky extends net.WebSocket { constructor(url) { if (hang-- > 0) return { send() { throw new Error('closed'); }, close() {} }; super(url); } }
  const { c } = await join(edit, { WebSocket: Flaky, connectMs: 30 });
  assert.equal(c.status, 'online');
  assert.equal(hang, -1, 'a second try connected');
});

test('the relay keeps only the latest whole copy and the changes after it', async () => {
  const { mine, o, join, edit, net, owner } = await share();
  const { s, c } = await join(edit, { snapshotEvery: 5 });
  for (let i = 0; i < 12; i++) {
    const list = s.read().blocks; list[0].text = `Take ${i}.`;
    s.write(list, [], [uid(1)]);
    await until(() => !c.unsent());
  }
  await until(() => net.stores.get(owner.room).m.has('snap:script'), 'a snapshot');
  const updates = [...net.stores.get(owner.room).m.keys()].filter((k) => k.startsWith('u:'));
  assert.ok(updates.length < 10, `${updates.length} changes kept`);
  // Someone new gets all of it.
  const late = await join(edit);
  await until(() => late.s.read().blocks[0].text === 'Take 11.');
  assert.deepEqual(late.s.read(), mine.read());
  for (const x of [c, late.c, o]) x.stop();
});

test('turning a link off ends it; a damaged or unsigned change is ignored', async () => {
  const { mine, o, join, edit, comment, owner } = await share();
  const { c } = await join(edit);
  const other = await join(comment);
  o.ws.send(JSON.stringify({ type: 'links', id: 99, links: await keys.signLinks(owner, 2, [comment]) }));
  await until(() => c.status === 'ended');
  // A change signed with the owner's key but not encrypted: checked, then dropped.
  const raw = new TextEncoder().encode('not encrypted');
  const sign = await keys.signer(owner.ownerPriv);
  o.ws.send(JSON.stringify({ type: 'update', doc: 'script', id: 100, data: keys.b64(raw), sig: await sign(keys.signed.update(owner.room, 'script', raw)) }));
  await sleep(50);
  assert.deepEqual(other.s.read(), mine.read());
  assert.equal(other.c.status, 'online');
  o.stop(); other.c.stop();
});

test('changes made through a link before it’s turned off reach those who open it later', async () => {
  const { mine, o, join, edit, owner, list } = await share();
  const { s, c } = await join(edit);
  const l = s.read().blocks; l[0].text = 'Written before the link went off.';
  s.write(l, [], [uid(1)]);
  await until(() => !c.unsent() && mine.read().blocks[0].text === l[0].text, 'the owner has it');
  // Turned off, as the app does it: still on the list, marked off, with the last number the
  // owner had from it.
  assert.deepEqual(o.seen[edit.id], { [c.dev]: c.n });
  const off = list.map((x) => (x === edit ? { id: x.id, role: x.role, pub: x.pub, off: true, upTo: { ...o.seen[edit.id] } } : x));
  await o.sendLinks(await keys.signLinks(owner, 2, off));
  await until(() => c.status === 'ended');
  const late = await join(list[1]);
  await until(() => late.s.read().blocks[0].text === 'Written before the link went off.', 'the comment link has it');
  assert.deepEqual(late.s.read(), mine.read());
});

test('a link turned off counts only up to its last number, and each number once', async () => {
  const { mine, o, join, make, edit, owner, list, net } = await share();
  const { s, c } = await join(edit);
  const l = s.read().blocks; l[0].text = 'Written before the link went off.';
  s.write(l, [], [uid(1)]);
  await until(() => !c.unsent() && mine.read().blocks[0].text === l[0].text, 'the owner has it');
  const off = list.map((x) => (x === edit ? { id: x.id, role: x.role, pub: x.pub, off: true, upTo: { ...o.seen[edit.id] } } : x));
  await o.sendLinks(await keys.signLinks(owner, 2, off));
  await until(() => c.status === 'ended');
  // Changes signed with the link's key after it went off, as someone who kept the key might
  // have the relay add them.
  const { priv } = await keys.openBox({ room: owner.room, ...edit }, 'pw', fast);
  const sign = await keys.signer(priv), cipher = await keys.projectCipher(owner.keys, owner.room);
  const store = net.stores.get(owner.room).m, meta = store.get('meta');
  const forge = async (text, dev, n) => {
    const x = new SharedProject();
    x.apply('script', mine.update('script'));
    const b = x.read().blocks; b[1].text = text;
    x.write(b, [], [uid(2)]);
    const data = await cipher.seal('script', x.update('script'));
    const sig = await sign(keys.signed.update(owner.room, 'script', data, dev, n));
    meta.seq++;
    store.set('u:' + String(meta.seq).padStart(15, '0'), { doc: 'script', by: edit.id, ...(dev ? { dev, n } : {}), sig, data: keys.b64(data), size: data.length });
  };
  await forge('Numbered after it went off.', c.dev, c.n + 1);
  await forge('From a browser it never used.', 'AAAAAAAAAAAA', 1);
  await forge('In the form from before numbers.');
  await forge('The same number, a different change.', c.dev, c.n);
  const late = await join(list[1]);
  await sleep(30);
  assert.equal(late.s.read().blocks[0].text, 'Written before the link went off.', 'what came before counts');
  assert.equal(late.s.read().blocks[1].text, 'She steps outside.', 'none of the later ones count');
  assert.deepEqual(late.s.read(), mine.read());
  // The owner, opening the project again with nothing kept, doesn't take them either.
  const back = new SharedProject();
  const o2 = make(back, { link: 'owner', priv: owner.ownerPriv, ownerPub: owner.ownerPub, keys: owner.keys, w: owner.ow });
  await until(() => o2.status === 'online', 'the owner is back');
  await sleep(30);
  assert.deepEqual(back.read(), mine.read());
});

test('turning a link off adds a project key that only the links still on get', async () => {
  const { mine, o, join, edit, comment, owner, list, net } = await share();
  const { c: gone } = await join(edit);
  const stays = await join(comment);
  // Turned off, with a new project key, as the app does it.
  const next = { ...owner, keys: [...owner.keys, keys.newProjectKey()] };
  const off = list.map((x) => (x === edit ? { id: x.id, role: x.role, pub: x.pub, off: true } : x));
  await o.sendLinks(await keys.signLinks(next, 2, off));
  await until(() => gone.status === 'ended' && o.cipher.count === 2 && stays.c.cipher.count === 2, 'the new key reached the owner and the link still on');
  // The owner's next change uses it: the link still on reads it; the old key doesn't open it.
  const l = mine.read().blocks; l[1].text = 'After the link went off.';
  mine.write(l, [], [uid(2)]);
  await until(() => stays.s.read().blocks[1].text === 'After the link went off.', 'the link still on has it');
  const store = net.stores.get(owner.room).m, last = [...store.keys()].filter((k) => k.startsWith('u:')).sort().at(-1);
  const sealed = keys.unb64(store.get(last).data);
  assert.equal(sealed[0], 2, 'sealed with the second key');
  const old = await keys.projectCipher(owner.keys, owner.room);
  await assert.rejects(() => old.open(store.get(last).doc, sealed));
  // A link made now gets every key in its box, so it reads all of it.
  const later = await keys.newLink(next, 'review', 'pw', fast);
  await o.sendLinks(await keys.signLinks(next, 3, [...off, later]));
  const late = await join(later);
  await until(() => late.s.read().blocks[1].text === 'After the link went off.', 'a new link reads it');
  assert.deepEqual(late.s.read(), mine.read());
});

test('a change sealed with a key not yet here waits for it, rather than being lost', async () => {
  const { mine, o, join, edit, owner, list } = await share();
  const { s, c } = await join(edit);
  const next = { ...owner, keys: [...owner.keys, keys.newProjectKey()] };
  // A list without the new key for the edit link, as for a link made before keys could change.
  const bare = list.map((x) => ({ ...x, w: undefined }));
  await o.sendLinks(await keys.signLinks(next, 2, bare));
  await until(() => o.cipher.count === 2);
  const l = mine.read().blocks; l[0].text = 'Sealed with the second key.';
  mine.write(l, [], [uid(1)]);
  await until(() => c.held.length === 1, 'the edit link holds it');
  assert.equal(c.safeSeq, c.held[0].seq - 1, 'kept as not yet had');
  assert.notEqual(s.read().blocks[0].text, 'Sealed with the second key.');
  await o.sendLinks(await keys.signLinks(next, 3, list));
  await until(() => s.read().blocks[0].text === 'Sealed with the second key.', 'opened once the key came');
  assert.equal(c.held.length, 0);
  assert.equal(c.safeSeq, c.seq);
});

test('people see who else is here and where, and see them go', async () => {
  const { o, join, edit, comment, owner, list } = await share();
  const seen = new Map();
  const watch = (name) => (people) => seen.set(name, people);
  const a = await join(edit, { onPresence: watch('edit') });
  const b = await join(comment, { onPresence: watch('comment') });
  a.c.setPresence({ name: 'Sam', mode: 'write', block: uid(1), editing: true });
  b.c.setPresence({ name: 'Ana', mode: 'qc', block: uid(2), editing: false, extra: 'x'.repeat(100) });
  await until(() => seen.get('edit')?.length === 1 && seen.get('comment')?.length === 1, 'each sees the other');
  assert.deepEqual(seen.get('edit').map(({ name, mode, block, editing, by, role }) => ({ name, mode, block, editing, by, role })), [{ name: 'Ana', mode: 'qc', block: uid(2), editing: false, by: comment.id, role: 'comment' }]);
  assert.equal(seen.get('comment')[0].name, 'Sam');
  // Moving on shows at once.
  a.c.setPresence({ name: 'Sam', mode: 'write', block: uid(2), editing: false });
  await until(() => seen.get('comment')[0].block === uid(2), 'the move');
  // Turning the comment link off: the others stop showing it.
  await o.sendLinks(await keys.signLinks(owner, 2, [edit]));
  await until(() => seen.get('edit').length === 0, 'gone once its link is off');
  // Leaving: shown as gone at once, not after a minute.
  b.c.stop();
  const c = await join(list[0], { onPresence: watch('again') });
  c.c.setPresence({ name: 'Sam on a laptop', mode: 'write', block: '', editing: false });
  await until(() => seen.get('edit').some((p) => p.name === 'Sam on a laptop'), 'a second tab of one link is someone else here');
  c.c.stop();
  await until(() => !seen.get('edit').some((p) => p.name === 'Sam on a laptop'), 'gone when its connection closes');
});

test('a link the owner adds is accepted at once by the owner’s side', async () => {
  const { mine, o, join, owner, list } = await share();
  const review = await keys.newLink({ ...owner }, 'review', 'pw', fast);
  await o.sendLinks(await keys.signLinks(owner, 2, [...list, review]));
  const { s } = await join(review);
  const l = s.read().blocks;
  l[0].comments = [{ id: crypto.randomUUID(), text: 'From the new link', author: 'Ann', created: '2026-11-08T00:00:00Z' }];
  s.write(l, [], [uid(1)], { script: false });
  await until(() => mine.read().blocks[0].comments?.length === 1, 'the owner takes the new link’s comment');
});

test('once the owner seals a link turned off, its old changes are gone and nothing from it counts', async () => {
  const { mine, o, join, edit, owner, list, net } = await share();
  const { s, c } = await join(edit);
  for (const text of ['First take.', 'Second take.']) {
    const l = s.read().blocks; l[0].text = text;
    s.write(l, [], [uid(1)]);
    await until(() => !c.unsent() && mine.read().blocks[0].text === text, 'the owner has it');
  }
  const store = net.stores.get(owner.room).m;
  const fromLink = () => [...store.entries()].filter(([k, v]) => k.startsWith('u:') && v.by === edit.id).length;
  assert.ok(fromLink() >= 2);
  const off = list.map((x) => (x === edit ? { id: x.id, role: x.role, pub: x.pub, off: true, upTo: { ...o.seen[edit.id] } } : x));
  assert.equal(await o.sendLinks(await keys.signLinks(owner, 2, off)), true, 'the relay took the list');
  assert.equal(await o.compact(), true, 'the relay took the whole copy');
  assert.equal(fromLink(), 0, 'the link’s changes are gone from the relay');
  assert.equal(store.get('snap:script').by, 'owner');
  const sealed = off.map((x) => (x.off ? { ...x, sealed: true } : x));
  assert.equal(await o.sendLinks(await keys.signLinks(owner, 3, sealed)), true);
  // A change under a number it really used, now with other words: before sealing it would
  // count for someone who never saw the first; now nothing from the link does.
  const { priv } = await keys.openBox({ room: owner.room, ...edit }, 'pw', fast);
  const sign = await keys.signer(priv), cipher = await keys.projectCipher(owner.keys, owner.room);
  const x = new SharedProject();
  x.apply('script', mine.update('script'));
  const b = x.read().blocks; b[1].text = 'Slipped in later.';
  x.write(b, [], [uid(2)]);
  const data = await cipher.seal('script', x.update('script'));
  const n = o.seen[edit.id][c.dev];
  const meta = store.get('meta'); meta.seq++;
  store.set('u:' + String(meta.seq).padStart(15, '0'), { doc: 'script', by: edit.id, dev: c.dev, n, sig: await sign(keys.signed.update(owner.room, 'script', data, c.dev, n)), data: keys.b64(data), size: data.length });
  const late = await join(list[1]);
  await sleep(30);
  assert.equal(late.s.read().blocks[0].text, 'Second take.', 'the owner’s copy has what the link did');
  assert.equal(late.s.read().blocks[1].text, 'She steps outside.', 'the change slipped in doesn’t count');
  assert.deepEqual(late.s.read(), mine.read());
  // Sealing again with nothing new is fine: the same point replaces the last copy.
  assert.equal(await o.compact(), true);
});

// A script longer than the relay takes in one message: 3,000 blocks of 1,000 characters.
const longScript = () => Array.from({ length: 3000 }, (_, i) => ({ uid: uid(10_000 + i), start: i * 5, end: i * 5 + 3, text: Array.from({ length: 1000 }, (_, j) => 'abcdefghijklmnopqrstuvwxyz '[(i * 31 + j * 7 + (j >> 3)) % 27]).join('') }));

test('a script too long for one message goes in parts, both ways, and still works with a relay on version 2', async () => {
  const { mine, o, join, edit, net } = await share();
  net.biggest = 0;
  mine.write(longScript(), []);
  await until(() => !o.unsent(), 'the long script sent');
  assert.ok(net.biggest <= 300_000, 'each message sent is short');
  assert.ok([...[...net.stores.values()][0].m.keys()].some((k) => k.startsWith('p:')), 'the relay keeps it in pieces');
  const { s } = await join(edit);
  await until(() => s.read().blocks.length === 3000, 'the joiner has it all');
  assert.deepEqual(s.read(), mine.read());
  // A relay on version 2 gets it whole, as before, so a short change still goes.
  const was = { ...PROTOCOL };
  try {
    PROTOCOL.max = 2;
    net.drop();
    const { s: older } = await join(edit);
    await until(() => older.read().blocks.length === 3000, 'joined through a relay on version 2');
    const list = older.read().blocks; list[0].text = 'Short and sweet.';
    older.write(list, [], [list[0].uid]);
    await until(() => mine.read().blocks[0].text === 'Short and sweet.', 'a change through it arrives');
  } finally { Object.assign(PROTOCOL, was); }
});

test('a long change whose parts the relay loses goes again; one the relay can’t take says so', async () => {
  const { mine, o, net, statuses } = await share();
  let lost = false;
  net.hook = (t, room) => { if (!lost && t.includes('"type":"part"') && t.includes('"i":1,')) { lost = true; room.partial.clear(); } };
  mine.write(longScript(), []);
  await until(() => lost && !o.unsent(), 'sent again after a part went missing');
  net.hook = null;
  const was = LIMITS.whole;
  LIMITS.whole = 1000;
  try {
    const list = mine.read().blocks.map((b) => ({ ...b, text: b.text.toUpperCase() }));
    mine.write(list, []);
    await until(() => statuses.some(([, , d]) => d === 'too-big'), 'told it’s too big');
    assert.equal(o.status, 'online', 'still connected');
    assert.ok(o.unsent(), 'the change waits here');
  } finally { LIMITS.whole = was; }
});

test('a relay or browser on another version stops trying, and says which needs updating', async () => {
  const { o, join, edit, owner, mine, net } = await share();
  const was = { ...PROTOCOL };
  try {
    // A relay that needs this browser to be newer.
    PROTOCOL.min = keys.PROTOCOL + 1; PROTOCOL.max = keys.PROTOCOL + 1;
    await assert.rejects(fetchBox('ws://relay', owner.room, edit.id, { WebSocket: net.WebSocket }), /old-app/);
    o.reconnect(); net.drop();
    await until(() => o.status === 'old-app', 'the owner is told to update');
    // An older relay, from before this browser's version.
    PROTOCOL.min = 1; PROTOCOL.max = keys.PROTOCOL_MIN - 1;
    await assert.rejects(fetchBox('ws://relay', owner.room, edit.id, { WebSocket: net.WebSocket }), /old-relay/);
    const statuses = [];
    const opened = await keys.openBox({ room: owner.room, ...edit }, 'pw', fast);
    const c = new RelayClient({ url: 'ws://relay', room: owner.room, who: { link: edit.id, ...opened }, shared: new SharedProject(), WebSocket: net.WebSocket, retryMs: 10, onStatus: (s) => statuses.push(s) }).start();
    clients.push(c);
    await until(() => c.status === 'old-relay', 'the relay is out of date');
    await sleep(50);
    assert.deepEqual(statuses, ['connecting', 'old-relay'], 'it doesn’t try again');
    assert.ok(mine.read().blocks.length, 'the copy is still there');
  } finally { Object.assign(PROTOCOL, was); }
});
