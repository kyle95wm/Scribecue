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
    close() { if (this.closed) return; this.closed = true; open.delete(this.server); setTimeout(() => this.onclose?.({})); }
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
  const o = make(mine, { link: 'owner', priv: owner.ownerPriv, ownerPub: owner.ownerPub, projectKey: owner.projectKey }, { create: await keys.signLinks(owner, 1, list) });
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
