// The relay over real WebSockets, run locally with `npm run dev` in relay/. The owner makes a
// room with an edit link and a comment link; the editor joins and catches up; changes pass
// both ways; a snapshot as big as a 1,500-block script goes up and comes back; turning a
// link off closes it; deleting the room ends it.
// Usage: node scripts/relay-smoke.mjs [relay url, default ws://127.0.0.1:8787]
import assert from 'node:assert/strict';
import { b64, unb64, signed } from '../relay/src/room.js';

const base = process.argv[2] || 'ws://127.0.0.1:8787';
const room = b64(crypto.getRandomValues(new Uint8Array(16)));
const subtle = crypto.subtle;
async function keys() {
  const k = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return { pub: b64(new Uint8Array(await subtle.exportKey('raw', k.publicKey))), sign: async (b) => b64(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, k.privateKey, b))) };
}
async function connect() {
  const ws = new WebSocket(`${base}/rooms/${room}`), inbox = [], waiters = [];
  ws.addEventListener('message', (e) => { inbox.push(JSON.parse(e.data)); for (const w of [...waiters]) w(); });
  const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e.reason)));
  const next = (type) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Timed out waiting for ' + type)), 10000);
    const look = () => {
      const i = inbox.findIndex((m) => m.type === type || m.type === 'error');
      if (i < 0) return;
      clearTimeout(timer); waiters.splice(waiters.indexOf(look), 1);
      resolve(inbox.splice(i, 1)[0]);
    };
    waiters.push(look); look();
  });
  const say = (m) => ws.send(JSON.stringify(m));
  const { nonce } = await next('challenge');
  return { ws, say, next, nonce, closed };
}
const links = async (owner, n, list) => { const text = JSON.stringify({ room, n, links: list }); return { text, sig: await owner.sign(signed.links(text)) }; };

const owner = await keys(), editor = await keys(), commenter = await keys();
const list = [{ id: 'ed', role: 'edit', pub: editor.pub, box: 'sealed-ed' }, { id: 'co', role: 'comment', pub: commenter.pub, box: 'sealed-co' }];
const o = await connect();
o.say({ type: 'create', v: 2, owner: owner.pub, sig: await owner.sign(signed.auth(room, o.nonce)), links: await links(owner, 1, list) });
assert.equal((await o.next('welcome')).role, 'owner');
const first = new TextEncoder().encode('first change');
o.say({ type: 'update', doc: 'script', id: 1, data: b64(first), sig: await owner.sign(signed.update(room, 'script', first)) });
assert.equal((await o.next('ack')).seq, 1);

// The editor fetches its box, signs in and catches up.
const e = await connect();
e.say({ type: 'box', v: 2, link: 'ed' });
assert.equal((await e.next('box')).box, 'sealed-ed');
e.say({ type: 'auth', v: 2, link: 'ed', sig: await editor.sign(signed.auth(room, e.nonce)) });
assert.equal((await e.next('welcome')).role, 'edit');
e.say({ type: 'sync', since: 0 });
assert.equal(new TextDecoder().decode(unb64((await e.next('update')).data)), 'first change');
assert.equal((await e.next('synced')).seq, 1);

// Live both ways, timed.
let t = performance.now();
const reply = new TextEncoder().encode('from the editor');
e.say({ type: 'update', doc: 'script', data: b64(reply), sig: await editor.sign(signed.update(room, 'script', reply)) });
assert.equal((await o.next('update')).by, 'ed');
const liveMs = performance.now() - t;

// A snapshot the size of a 1,500-block script.
const big = Uint8Array.from({ length: 260_000 }, (_, i) => (i * 31) & 255);
t = performance.now();
o.say({ type: 'snapshot', doc: 'script', upTo: 2, data: b64(big), sig: await owner.sign(signed.snapshot(room, 'script', 2, big)) });
assert.equal((await o.next('ack')).seq, 2);
const c = await connect();
c.say({ type: 'auth', v: 2, link: 'co', sig: await commenter.sign(signed.auth(room, c.nonce)) });
await c.next('welcome');
c.say({ type: 'sync', since: 0 });
const snap = await c.next('snapshot');
assert.deepEqual(unb64(snap.data), big);
await c.next('synced');
const snapMs = performance.now() - t;
// The comment link can't change the script.
c.say({ type: 'update', doc: 'script', data: b64(first), sig: await commenter.sign(signed.update(room, 'script', first)) });
assert.equal((await c.next('ack')).code, 'not-allowed');

// Turning the edit link off closes it.
o.say({ type: 'links', links: await links(owner, 2, list.slice(1)) });
await o.next('ack');
assert.equal(await e.closed, 'link-off');
assert.equal((await c.next('links')).type, 'links');

// Deleting the room ends it for everyone.
o.say({ type: 'delete-room' });
assert.equal(await c.closed, 'room-deleted');
assert.equal(await o.closed, 'room-deleted');
const gone = await connect();
gone.say({ type: 'auth', v: 2, link: 'owner', sig: await owner.sign(signed.auth(room, gone.nonce)) });
assert.equal((await gone.next('welcome')).code, 'no-room');
console.log(`Relay smoke passed: a change reached the other person in ${Math.round(liveMs)} ms; a 260 KB snapshot went up and came back in ${Math.round(snapMs)} ms`);
process.exit(0);
