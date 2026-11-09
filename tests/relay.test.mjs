import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, b64, unb64, signed, LIMITS, takeSlot, PROTOCOL, PART } from '../relay/src/room.js';

const subtle = crypto.subtle;
const noise = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7919 + (i >> 8)) & 255);
const ROOM = 'AAAAAAAAAAAAAAAAAAAAAA';
async function keys() {
  const k = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = b64(new Uint8Array(await subtle.exportKey('raw', k.publicKey)));
  return { pub, sign: async (bytes) => b64(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, k.privateKey, bytes))) };
}
// Durable Object storage as far as the room uses it, in memory.
function memory() {
  const m = new Map();
  return {
    m, alarm: null,
    async get(k) { return structuredClone(m.get(k)); },
    async put(k, v) { if (typeof k === 'string') m.set(k, structuredClone(v)); else for (const [a, b] of Object.entries(k)) m.set(a, structuredClone(b)); },
    async delete(k) { for (const a of [k].flat()) m.delete(a); },
    async list({ prefix = '', start = '', end = '￿' } = {}) { return new Map([...m].filter(([a]) => a.startsWith(prefix) && a >= start && a < end).sort(([a], [b]) => (a < b ? -1 : 1)).map(([a, b]) => [a, structuredClone(b)])); },
    async deleteAll() { m.clear(); },
    async setAlarm(t) { this.alarm = t; },
  };
}
function setup({ now = () => 1_000_000, mayCreate } = {}) {
  const storage = memory(), open = new Set();
  const room = new Room({ id: ROOM, storage, sockets: () => open, now, mayCreate });
  const connect = () => {
    const s = { got: [], closed: null, state: {}, send(t) { this.got.push(JSON.parse(t)); }, close(code, why) { this.closed = why; open.delete(this); } };
    open.add(s); room.open(s);
    s.say = async (m) => { s.got.length = 0; await room.message(s, JSON.stringify(m)); return s.got; };
    return s;
  };
  return { room, storage, connect };
}
const nonce = (s) => s.got.find((m) => m.type === 'challenge').nonce;
async function linksFor(owner, n, list) {
  const text = JSON.stringify({ room: ROOM, n, links: list });
  return { text, sig: await owner.sign(signed.links(text)) };
}
async function start(opts = {}) {
  const v = opts.v ?? 2;
  const env = setup(opts), owner = await keys(), editor = await keys(), commenter = await keys();
  const links = [{ id: 'ed1', role: 'edit', pub: editor.pub, box: 'box-ed' }, { id: 'co1', role: 'comment', pub: commenter.pub, box: 'box-co' }];
  const o = env.connect();
  const [welcome] = await o.say({ type: 'create', v, owner: owner.pub, sig: await owner.sign(signed.auth(ROOM, nonce(o))), links: await linksFor(owner, 1, links) });
  assert.equal(welcome.type, 'welcome');
  const join = async (link, k, jv = 2) => {
    const s = env.connect();
    const n = nonce(s);
    const [box] = await s.say({ type: 'box', v: jv, link });
    const [w] = await s.say({ type: 'auth', v: jv, link, sig: await k.sign(signed.auth(ROOM, n)) });
    return { s, box, w };
  };
  const update = async (s, k, doc, bytes) => s.say({ type: 'update', doc, id: 1, data: b64(bytes), sig: await k.sign(signed.update(ROOM, doc, bytes)) });
  return { ...env, owner, editor, commenter, links, o, join, update };
}

test('base64url goes both ways', () => {
  const bytes = noise(100_001);
  assert.deepEqual(unb64(b64(bytes)), bytes);
  assert.throws(() => unb64('not base64!'));
});

test('a link gets its box, signs in, and gets changes made before and after', async () => {
  const { join, update, o, owner, editor } = await start();
  assert.deepEqual((await update(o, owner, 'script', new Uint8Array([1, 2, 3])))[0], { type: 'ack', id: 1, seq: 1 });
  const { s, box, w } = await join('ed1', editor);
  assert.deepEqual(box, { type: 'box', link: 'ed1', role: 'edit', box: 'box-ed' });
  assert.equal(w.type, 'welcome'); assert.equal(w.role, 'edit'); assert.equal(w.seq, 1);
  const synced = await s.say({ type: 'sync', since: 0 });
  assert.deepEqual(synced.map((m) => [m.type, m.seq, m.by]), [['update', 1, 'owner'], ['synced', 1, undefined]]);
  assert.deepEqual(unb64(synced[0].data), new Uint8Array([1, 2, 3]));
  // Live: the editor's change reaches the owner, not the editor again.
  o.got.length = 0;
  await update(s, editor, 'script', new Uint8Array([4]));
  assert.deepEqual(o.got.map((m) => [m.type, m.seq, m.by, m.data]), [['update', 2, 'ed1', b64(new Uint8Array([4]))]]);
  assert.deepEqual(s.got.map((m) => m.type), ['ack']);
});

test('wrong keys, unknown links and missing sign-in are refused', async () => {
  const { join, connect, owner, editor, commenter } = await start();
  const { s, w } = await join('ed1', commenter);
  assert.deepEqual([w.code, s.closed], ['bad-signature', 'bad-signature']);
  const x = connect();
  assert.equal((await x.say({ type: 'box', v: 2, link: 'nope' }))[0].code, 'no-link');
  assert.equal((await x.say({ type: 'sync' }))[0].code, 'not-signed-in');
  // A second create can't take the room over.
  const y = connect();
  assert.equal((await y.say({ type: 'create', v: 2, owner: editor.pub, sig: await editor.sign(signed.auth(ROOM, nonce(y))), links: await linksFor(editor, 1, []) }))[0].code, 'room-exists');
  // A challenge is for one socket: another's signature doesn't fit.
  const a = connect(), b = connect();
  const [r] = await b.say({ type: 'auth', v: 2, link: 'owner', sig: await owner.sign(signed.auth(ROOM, nonce(a))) });
  assert.equal(r.code, 'bad-signature');
  assert.equal((await connect().say('nonsense'))[0].code, 'bad-message');
});

test('each link writes only what its role allows, with its own signature', async () => {
  const { join, update, commenter, editor } = await start();
  const { s } = await join('co1', commenter);
  assert.equal((await update(s, commenter, 'script', new Uint8Array([9])))[0].code, 'not-allowed');
  assert.equal((await update(s, commenter, 'review', new Uint8Array([9])))[0].code, 'not-allowed');
  assert.equal((await update(s, commenter, 'comments', new Uint8Array([9])))[0].type, 'ack');
  // Signed by someone else's key: refused, even for a document the link may write.
  assert.equal((await update(s, editor, 'comments', new Uint8Array([9])))[0].code, 'bad-signature');
  // A signature for other bytes doesn't fit.
  const sig = await commenter.sign(signed.update(ROOM, 'comments', new Uint8Array([1])));
  assert.equal((await s.say({ type: 'update', doc: 'comments', data: b64(new Uint8Array([2])), sig }))[0].code, 'bad-signature');
  assert.equal((await update(s, commenter, 'other', new Uint8Array([9])))[0].code, 'not-allowed');
});

test('a snapshot replaces the changes before it; later ones stay', async () => {
  const { join, update, o, owner, editor, storage } = await start();
  for (let i = 1; i <= 4; i++) await update(o, owner, i === 2 ? 'comments' : 'script', new Uint8Array([i]));
  const big = noise(250_000);
  const [ack] = await o.say({ type: 'snapshot', doc: 'script', upTo: 3, data: b64(big), sig: await owner.sign(signed.snapshot(ROOM, 'script', 3, big)) });
  assert.deepEqual(ack, { type: 'ack', id: null, seq: 3 });
  assert.deepEqual([...storage.m.keys()].filter((k) => k.startsWith('u:')).length, 2, 'the comment change and change 4 stay');
  const { s } = await join('ed1', editor);
  const got = await s.say({ type: 'sync', since: 0 });
  assert.deepEqual(got.map((m) => [m.type, m.doc, m.upTo ?? m.seq]), [['snapshot', 'script', 3], ['update', 'comments', 2], ['update', 'script', 4], ['synced', undefined, 4]]);
  assert.deepEqual(unb64(got[0].data), big);
  // Someone already up to change 3 gets only what came after.
  assert.deepEqual((await s.say({ type: 'sync', since: 3 })).map((m) => m.type), ['update', 'synced']);
  // An older snapshot, or one past the last change, is refused.
  const one = new Uint8Array([1]);
  assert.equal((await o.say({ type: 'snapshot', doc: 'script', upTo: 2, data: b64(one), sig: await owner.sign(signed.snapshot(ROOM, 'script', 2, one)) }))[0].code, 'stale-snapshot');
  assert.equal((await o.say({ type: 'snapshot', doc: 'script', upTo: 9, data: b64(one), sig: await owner.sign(signed.snapshot(ROOM, 'script', 9, one)) }))[0].code, 'stale-snapshot');
  // A smaller one later leaves no old parts behind, and the size adds up.
  const [ok] = await o.say({ type: 'snapshot', doc: 'script', upTo: 4, data: b64(one), sig: await owner.sign(signed.snapshot(ROOM, 'script', 4, one)) });
  assert.equal(ok.type, 'ack');
  assert.deepEqual([...storage.m.keys()].filter((k) => k.startsWith('snap:script:')), ['snap:script:0000']);
  assert.equal((await storage.get('meta')).bytes, 1 + 1, 'the snapshot and the comment change');
});

test('turning a link off closes its socket and stops it signing in', async () => {
  const { join, o, owner, editor, commenter, links } = await start();
  const ed = await join('ed1', editor), co = await join('co1', commenter);
  const [stale] = await o.say({ type: 'links', links: await linksFor(owner, 1, links.slice(1)) });
  assert.equal(stale.code, 'stale-links');
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 2, links.slice(1)) }))[0].type, 'ack');
  assert.equal(ed.s.closed, 'link-off');
  assert.equal(co.s.got.at(-1).type, 'links', 'others hear about the change');
  assert.equal(co.s.closed, null);
  assert.equal((await join('ed1', editor)).box.code, 'no-link');
  // Only the owner can change links, with the owner's signature.
  assert.equal((await co.s.say({ type: 'links', links: await linksFor(owner, 3, []) }))[0].code, 'not-allowed');
  assert.equal((await o.say({ type: 'links', links: await linksFor(commenter, 3, []) }))[0].code, 'bad-message');
});

test('a link marked off can’t sign in or get its box, but stays on the list', async () => {
  const { join, o, owner, editor, links } = await start();
  const ed = await join('ed1', editor);
  const off = [{ id: 'ed1', role: 'edit', pub: editor.pub, off: true }, links[1]];
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 2, off) }))[0].type, 'ack');
  assert.equal(ed.s.closed, 'link-off');
  const again = await join('ed1', editor);
  assert.equal(again.box.code, 'no-link');
  assert.equal(again.w.code, 'link-off');
  // Off links don't count towards the links that can be on at once.
  const many = Array.from({ length: LIMITS.links }, (_, i) => ({ id: 'x' + i, role: 'comment', pub: editor.pub, box: 'b' }));
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 3, [...off, ...many.slice(1)]) }))[0].type, 'ack');
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 4, [...off, ...many, links[1]]) }))[0].code, 'bad-message');
});

test('a socket from before a link went off is closed at its next message', async () => {
  const { join, update, o, owner, editor, links, storage } = await start();
  const ed = await join('ed1', editor);
  // As if the room slept and woke: the change reached storage, but not the socket.
  const meta = await storage.get('meta');
  meta.links = await linksFor(owner, 2, links.slice(1)); meta.n = 2;
  await storage.put('meta', meta);
  assert.equal((await update(ed.s, editor, 'script', new Uint8Array([1])))[0].code, 'link-off');
  assert.equal(ed.s.closed, 'link-off');
  assert.equal(o.closed, null);
});

test('a link that has expired can’t get its box or sign in, and its sockets close', async () => {
  let t = 1_000_000;
  const { join, update, o, owner, editor, commenter, links, connect } = await start({ now: () => t });
  const DAY = 86_400_000;
  const dated = [{ ...links[0], expires: t + DAY }, links[1]];
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 2, dated) }))[0].type, 'ack');
  const ed = await join('ed1', editor), co = await join('co1', commenter);
  assert.equal(ed.w.type, 'welcome', 'works until it expires');
  t += DAY;
  // An idle socket closes when something would reach it.
  await update(co.s, commenter, 'comments', new Uint8Array([1]));
  assert.equal(ed.s.closed, 'link-expired');
  assert.equal(co.s.closed, null);
  const again = await join('ed1', editor);
  assert.equal(again.box.code, 'link-expired');
  assert.equal(again.w.code, 'link-expired');
  // The owner can give it longer; a time that isn't one is refused.
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 3, [{ ...links[0], expires: t + DAY }, links[1]]) }))[0].type, 'ack');
  assert.equal((await join('ed1', editor)).w.type, 'welcome');
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 4, [{ ...links[0], expires: 'soon' }, links[1]]) }))[0].code, 'bad-message');
  // A socket that's been asleep closes at its next message.
  const late = await join('co1', commenter);
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 5, [links[0], { ...links[1], expires: t + 10 }]) }))[0].type, 'ack');
  t += 10;
  assert.equal((await update(late.s, commenter, 'comments', new Uint8Array([2])))[0].code, 'link-expired');
  // Once the owner turns it off, it still says it expired.
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 6, [{ id: 'ed1', role: 'edit', pub: editor.pub, off: true }, { id: 'co1', role: 'comment', pub: commenter.pub, off: true, expires: t }]) }))[0].type, 'ack');
  const x = connect();
  assert.equal((await x.say({ type: 'box', v: 2, link: 'co1' }))[0].code, 'link-expired');
  assert.equal((await x.say({ type: 'box', v: 2, link: 'ed1' }))[0].code, 'no-link');
});

test('the recovery link’s box comes with the signed list; it can’t take a link’s id', async () => {
  const { o, owner, links, connect } = await start();
  const withBox = await (async () => { const text = JSON.stringify({ room: ROOM, n: 2, recovery: { id: 'rec1', box: 'box-rec' }, links }); return { text, sig: await owner.sign(signed.links(text)) }; })();
  assert.equal((await o.say({ type: 'links', links: withBox }))[0].type, 'ack');
  const [box] = await connect().say({ type: 'box', v: 2, link: 'rec1' });
  assert.deepEqual(box, { type: 'box', link: 'rec1', role: 'owner', box: 'box-rec', links: withBox });
  const clash = await (async () => { const text = JSON.stringify({ room: ROOM, n: 3, recovery: { id: 'ed1', box: 'x' }, links }); return { text, sig: await owner.sign(signed.links(text)) }; })();
  assert.equal((await o.say({ type: 'links', links: clash }))[0].code, 'bad-message');
  const huge = await (async () => { const text = JSON.stringify({ room: ROOM, n: 3, recovery: { id: 'rec2', box: 'x'.repeat(LIMITS.recovery + 1) }, links }); return { text, sig: await owner.sign(signed.links(text)) }; })();
  assert.equal((await o.say({ type: 'links', links: huge }))[0].code, 'bad-message');
  // Turned off: its box is gone.
  assert.equal((await o.say({ type: 'links', links: await linksFor(owner, 3, links) }))[0].type, 'ack');
  assert.equal((await connect().say({ type: 'box', v: 2, link: 'rec1' }))[0].code, 'no-link');
});

test('making a room too often is refused, and nothing is kept', async () => {
  let asked = 0;
  const env = setup({ mayCreate: async (socket) => { asked++; return socket.address === 'calm'; } });
  const owner = await keys();
  const s = env.connect(); s.address = 'busy';
  const [refused] = await s.say({ type: 'create', v: 2, owner: owner.pub, sig: await owner.sign(signed.auth(ROOM, nonce(s))), links: await linksFor(owner, 1, []) });
  assert.equal(refused.code, 'busy');
  assert.equal(s.closed, 'busy');
  assert.equal(await env.storage.get('meta'), undefined);
  const t = env.connect(); t.address = 'calm';
  const [welcome] = await t.say({ type: 'create', v: 2, owner: owner.pub, sig: await owner.sign(signed.auth(ROOM, nonce(t))), links: await linksFor(owner, 1, []) });
  assert.equal(welcome.type, 'welcome');
  assert.equal(asked, 2);
});

test('presence passes to the others, unkept; a closed connection is said to be gone', async () => {
  const { join, o, editor, commenter, storage, room, connect } = await start();
  const ed = await join('ed1', editor), co = await join('co1', commenter);
  const before = storage.m.size;
  await ed.s.say({ type: 'presence', data: 'sealed-bytes' });
  const got = co.s.got.at(-1);
  assert.deepEqual({ ...got, sid: typeof got.sid }, { type: 'presence', sid: 'string', by: 'ed1', data: 'sealed-bytes' });
  assert.equal(o.got.at(-1).sid, got.sid, 'the owner gets it too');
  assert.equal(ed.s.got.length, 0, 'not back to the sender');
  assert.equal(storage.m.size, before, 'nothing kept');
  assert.notEqual(got.sid, (await (async () => { await co.s.say({ type: 'presence', data: 'x' }); return ed.s.got.at(-1).sid; })()), 'each connection has its own id');
  assert.equal((await ed.s.say({ type: 'presence', data: 'x'.repeat(LIMITS.presence + 1) }))[0].code, 'too-big');
  const stranger = connect();
  assert.equal((await stranger.say({ type: 'presence', data: 'x' }))[0].code, 'not-signed-in');
  room.close(ed.s);
  assert.deepEqual(co.s.got.at(-1), { type: 'gone', sid: got.sid });
  room.close(stranger); // never signed in: nothing to say
  assert.deepEqual(co.s.got.at(-1), { type: 'gone', sid: got.sid });
});

test('a full room refuses more; too big a message is refused', async () => {
  const { update, o, owner } = await start();
  const was = LIMITS.room;
  LIMITS.room = 10;
  try {
    assert.equal((await update(o, owner, 'script', new Uint8Array(8)))[0].type, 'ack');
    assert.equal((await update(o, owner, 'script', new Uint8Array(8)))[0].code, 'room-full');
  } finally { LIMITS.room = was; }
  assert.equal((await o.say({ type: 'update', data: 'x'.repeat(LIMITS.message) }))[0].code, 'too-big');
});

// A message in parts, as a version 3 browser sends a long one.
const inParts = (text, id = 1) => {
  const of = Math.ceil(text.length / PART);
  return Array.from({ length: of }, (_, i) => JSON.stringify({ type: 'part', id, i, of, text: text.slice(i * PART, (i + 1) * PART) }));
};
const together = (got) => got.filter((m) => m.type === 'part').map((m) => m.text).join('');

test('a long change comes in parts, is kept in pieces, and goes out in parts or whole', async () => {
  const { o, owner, editor, join, storage, room } = await start({ v: 3 });
  const bytes = noise(LIMITS.message), data = b64(bytes);
  const text = JSON.stringify({ type: 'update', doc: 'script', id: 7, data, sig: await owner.sign(signed.update(ROOM, 'script', bytes)) });
  const parts = inParts(text);
  assert.ok(text.length > LIMITS.message && parts.length > 2);
  o.got.length = 0;
  for (const p of parts.slice(0, -1)) await room.message(o, p);
  assert.deepEqual(o.got, [], 'nothing until the last part');
  await room.message(o, parts.at(-1));
  assert.deepEqual(o.got, [{ type: 'ack', id: 7, seq: 1 }]);
  assert.ok([...storage.m.keys()].filter((k) => k.startsWith('p:')).length > 1, 'kept in pieces');
  assert.ok([...storage.m.values()].every((v) => JSON.stringify(v).length < 200_000), 'each stored value is small');
  // A version 3 browser gets it back in parts, each short; a version 2 browser whole.
  const three = await join('ed1', editor, 3);
  const got = await three.s.say({ type: 'sync', since: 0 });
  assert.ok(got.filter((m) => m.type === 'part').length > 2 && got.every((m) => JSON.stringify(m).length < PART + 200));
  assert.equal(JSON.parse(together(got)).data, data);
  assert.equal(got.at(-1).type, 'synced');
  const two = await join('ed1', editor, 2);
  const whole = await two.s.say({ type: 'sync', since: 0 });
  assert.deepEqual(whole.map((m) => m.type), ['update', 'synced']);
  assert.equal(whole[0].data, data);
  // A whole copy after it drops its pieces.
  const small = new Uint8Array([1]);
  await o.say({ type: 'snapshot', doc: 'script', upTo: 1, id: 8, data: b64(small), sig: await owner.sign(signed.snapshot(ROOM, 'script', 1, small)) });
  assert.deepEqual([...storage.m.keys()].filter((k) => k.startsWith('p:')), [], 'the pieces went with the change');
});

test('a part out of order is refused; a long message too long in all is refused without closing', async () => {
  const { o, owner, room } = await start({ v: 3 });
  const bytes = noise(LIMITS.message);
  const text = JSON.stringify({ type: 'update', doc: 'script', id: 7, data: b64(bytes), sig: await owner.sign(signed.update(ROOM, 'script', bytes)) });
  const parts = inParts(text);
  assert.equal((await o.say({ type: 'part', id: 1, i: 1, of: parts.length, text: 'x' }))[0].code, 'part-lost');
  await room.message(o, parts[0]);
  o.got.length = 0;
  await room.message(o, parts[2]);
  assert.equal(o.got[0].code, 'part-lost', 'a part skipped');
  const was = LIMITS.whole;
  LIMITS.whole = text.length - 1;
  try {
    o.got.length = 0;
    for (const p of parts) await room.message(o, p);
    assert.deepEqual(o.got.map((m) => m.code), ['too-big']);
    assert.equal(o.closed, null, 'still connected, to say so');
  } finally { LIMITS.whole = was; }
  // Parts only once signed in.
  const { connect } = await start();
  const s = connect();
  assert.equal((await s.say(JSON.parse(parts[0])))[0].code, 'not-signed-in');
});

test('changes keep their order when they arrive together', async () => {
  const { o, owner, room } = await start();
  const texts = [];
  for (let i = 0; i < 20; i++) {
    const bytes = new Uint8Array([i]);
    texts.push(JSON.stringify({ type: 'update', doc: 'script', id: i, data: b64(bytes), sig: await owner.sign(signed.update(ROOM, 'script', bytes)) }));
  }
  o.got.length = 0;
  await Promise.all(texts.map((t) => room.message(o, t)));
  assert.deepEqual(o.got.map((m) => [m.id, m.seq]), Array.from({ length: 20 }, (_, i) => [i, i + 1]));
});

test('the owner deletes the project; an idle one is deleted after six months', async () => {
  const { join, o, editor, storage } = await start();
  const ed = await join('ed1', editor);
  assert.ok(storage.alarm > 0);
  await o.say({ type: 'delete-room' });
  assert.equal(storage.m.size, 0);
  assert.equal(ed.s.closed, 'room-deleted');

  let t = 1_000_000;
  const env = setup({ now: () => t }), owner = await keys(), s = env.connect();
  await s.say({ type: 'create', v: 2, owner: owner.pub, sig: await owner.sign(signed.auth(ROOM, nonce(s))), links: await linksFor(owner, 1, []) });
  t += LIMITS.idle - 1;
  await env.room.alarm();
  assert.ok(env.storage.m.size > 0, 'not yet');
  t += 1;
  await env.room.alarm();
  assert.equal(env.storage.m.size, 0);
});

test('the window for new projects slides: old ones leave it, refusals don’t count', () => {
  let times = [];
  for (let i = 0; i < 3; i++) { const r = takeSlot(times, 1000 + i, 3, 100); assert.equal(r.ok, true); times = r.times; }
  const full = takeSlot(times, 1050, 3, 100);
  assert.equal(full.ok, false);
  assert.deepEqual(full.times, times, 'a refusal isn’t counted');
  const later = takeSlot(times, 1101, 3, 100);
  assert.equal(later.ok, true, 'the first has left the window');
  assert.deepEqual(later.times, [1002, 1101]);
  assert.equal(takeSlot('junk', 5, 1, 100).ok, true, 'damaged storage starts again');
});

test('numbered changes are kept and passed on with their browser and number', async () => {
  const { join, o, owner, editor } = await start();
  const { s } = await join('ed1', editor);
  const bytes = new Uint8Array([4, 5, 6]), dev = 'abcdefghijkl';
  o.got.length = 0;
  const [ack] = await s.say({ type: 'update', doc: 'script', id: 1, dev, n: 3, data: b64(bytes), sig: await editor.sign(signed.update(ROOM, 'script', bytes, dev, 3)) });
  assert.equal(ack.type, 'ack');
  assert.deepEqual([o.got[0].dev, o.got[0].n], [dev, 3]);
  // Signed without the number, or in the old form, it doesn't check out.
  assert.equal((await s.say({ type: 'update', doc: 'script', dev, n: 4, data: b64(bytes), sig: await editor.sign(signed.update(ROOM, 'script', bytes)) }))[0].code, 'bad-signature');
  assert.equal((await s.say({ type: 'update', doc: 'script', dev, n: 0, data: b64(bytes), sig: 'x' }))[0].code, 'bad-message');
  assert.equal((await s.say({ type: 'update', doc: 'script', dev: 'short', n: 1, data: b64(bytes), sig: 'x' }))[0].code, 'bad-message');
  const [snap] = await o.say({ type: 'snapshot', doc: 'script', upTo: 1, id: 2, dev: 'ownerdevice1', n: 1, data: b64(bytes), sig: await owner.sign(signed.snapshot(ROOM, 'script', 1, bytes, 'ownerdevice1', 1)) });
  assert.equal(snap.type, 'ack');
  const synced = await s.say({ type: 'sync', since: 0 });
  assert.deepEqual(synced.filter((m) => m.type === 'snapshot').map((m) => [m.dev, m.n]), [['ownerdevice1', 1]]);
});

test('a link turned off may carry the last number of each of its browsers', async () => {
  const { o, owner, links } = await start();
  const off = (upTo) => links.map((l) => (l.id === 'ed1' ? { id: l.id, role: l.role, pub: l.pub, off: true, upTo } : l));
  assert.equal((await o.say({ type: 'links', id: 1, links: await linksFor(owner, 2, off({ abcdefghijkl: 4 })) }))[0].type, 'ack');
  assert.equal((await o.say({ type: 'links', id: 2, links: await linksFor(owner, 3, off({ abcdefghijkl: -1 })) }))[0].code, 'bad-message');
  const many = Object.fromEntries(Array.from({ length: LIMITS.devices + 1 }, (_, i) => [`device${String(i).padStart(5, '0')}`, 1]));
  assert.equal((await o.say({ type: 'links', id: 3, links: await linksFor(owner, 3, off(many)) }))[0].code, 'bad-message');
});

test('a browser that speaks another version is told which side to update', async () => {
  const { connect, join, editor } = await start();
  const s = connect();
  assert.equal(s.got[0].protocol, PROTOCOL.max, 'the challenge says the relay’s version');
  // Before versions, browsers sent none.
  const [old] = await s.say({ type: 'box', link: 'ed1' });
  assert.equal(old.code, 'old-app');
  assert.equal(s.closed, 'old-app');
  const t = connect();
  const [newer] = await t.say({ type: 'auth', v: PROTOCOL.max + 1, link: 'ed1', sig: await editor.sign(signed.auth(ROOM, nonce(t))) });
  assert.equal(newer.code, 'old-relay');
  assert.equal(t.closed, 'old-relay');
  const { w } = await join('ed1', editor);
  assert.equal(w.type, 'welcome', 'the same version signs in');
});
