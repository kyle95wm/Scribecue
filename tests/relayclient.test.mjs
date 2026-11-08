import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as keys from '../app/js/sharekeys.js';
import { RelayClient } from '../app/js/relayclient.js';
import { SharedProject } from '../app/js/shared.js';
import { Room } from '../relay/src/room.js';

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
    send(t) { if (this.closed) throw new Error('closed'); this.room.message(this.server, t); }
    close() { if (this.closed) return; this.closed = true; open.delete(this.server); this.room.close(this.server); setTimeout(() => this.onclose?.({})); }
  }
  return { WebSocket: FakeSocket, stores, drop: () => { for (const s of [...open]) s.close(); } };
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
  return { net, owner, edit, comment, list, mine, o, join, statuses };
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
  await until(() => c.status === 'online' && !c.unsent(), 'back online with it sent');
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
  // Turned off, as the app does it: still on the list, marked off.
  const off = list.map((x) => (x === edit ? { id: x.id, role: x.role, pub: x.pub, off: true } : x));
  await o.sendLinks(await keys.signLinks(owner, 2, off));
  await until(() => c.status === 'ended');
  const late = await join(list[1]);
  await until(() => late.s.read().blocks[0].text === 'Written before the link went off.', 'the comment link has it');
  assert.deepEqual(late.s.read(), mine.read());
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
