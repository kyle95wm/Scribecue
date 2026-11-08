// A room on the relay: one shared project. The relay passes changes between the people in it
// and keeps them for whoever opens the project next. It never sees what's in the project:
// changes arrive encrypted, and signed by the share link (or the owner) that made them.
//
// The owner signs the list of links: each link's id, role, public key and its "box" (the
// project key and link key, encrypted with the link's secret and password). The relay checks
// signatures so it can refuse writes a link may not make, and receiving clients check them
// again. A link turned off stays on the list, marked off and without its box: it can't sign
// in, but the changes it made before still check out for whoever opens the project later.
//
// This file has no Cloudflare in it: storage and sockets are passed in, so it runs in Node
// for the tests. See index.js for the Worker and Durable Object around it.

// Who may write each of the project's documents. Everyone in a room can read all of them.
export const WRITERS = {
  script: ['owner', 'edit'],
  comments: ['owner', 'edit', 'review', 'comment'],
  review: ['owner', 'edit', 'review'],
};
export const ROLES = ['edit', 'review', 'comment'];
export const LIMITS = {
  message: 2_000_000, // characters in one message
  room: 64 * 1024 * 1024, // bytes kept for one project
  presence: 4000, // characters in one presence message
  links: 30, // links on at once
  offLinks: 200, // links turned off, kept so their earlier changes still check out
  idle: 180 * 24 * 3600 * 1000, // a project nobody opens for this long is deleted
};
const CHUNK = 100_000; // stored values stay well under the storage's own limit
const enc = new TextEncoder();

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function unb64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64');
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const join = (label, bytes) => {
  const head = enc.encode(label), out = new Uint8Array(head.length + bytes.length);
  out.set(head); out.set(bytes, head.length);
  return out;
};
// What each signature covers. Clients sign the same bytes.
export const signed = {
  auth: (room, nonce) => enc.encode(`scribecue-relay:auth:${room}:${nonce}`),
  update: (room, doc, data) => join(`scribecue-relay:update:${room}:${doc}:`, data),
  snapshot: (room, doc, upTo, data) => join(`scribecue-relay:snapshot:${room}:${doc}:${upTo}:`, data),
  links: (text) => enc.encode(`scribecue-relay:links:${text}`),
};
export const validRoom = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const seqKey = (n) => 'u:' + String(n).padStart(15, '0');

// The owner's signed list of links, checked: { text, sig } → { n, links: Map(id → link) }.
export async function readLinks(room, owner, signedLinks, verify) {
  const { text, sig } = signedLinks || {};
  if (typeof text !== 'string' || typeof sig !== 'string' || text.length > 200_000) throw new Error('bad links');
  if (!(await verify(owner, unb64(sig), signed.links(text)))) throw new Error('links not signed by the owner');
  const o = JSON.parse(text);
  if (o.room !== room || !Number.isSafeInteger(o.n) || o.n < 1 || !Array.isArray(o.links)) throw new Error('bad links');
  const off = o.links.filter((l) => l?.off === true).length;
  if (o.links.length - off > LIMITS.links || off > LIMITS.offLinks) throw new Error('bad links');
  const links = new Map();
  for (const l of o.links) {
    if (!validId(l?.id) || l.id === 'owner' || links.has(l.id) || !ROLES.includes(l.role) || typeof l.pub !== 'string') throw new Error('bad link');
    if (l.off !== true && (typeof l.box !== 'string' || l.box.length > 4000)) throw new Error('bad link');
    unb64(l.pub);
    links.set(l.id, l.off === true ? { role: l.role, pub: l.pub, off: true } : { role: l.role, pub: l.pub, box: l.box });
  }
  return { n: o.n, links };
}

// Ed25519 with the Web Crypto API, as both Workers and Node have it. Keys are raw, base64url.
export function ed25519(subtle = crypto.subtle) {
  const keys = new Map();
  return async (pub, sig, data) => {
    try {
      if (!keys.has(pub)) {
        if (keys.size > 200) keys.clear();
        keys.set(pub, await subtle.importKey('raw', unb64(pub), { name: 'Ed25519' }, false, ['verify']));
      }
      return await subtle.verify({ name: 'Ed25519' }, keys.get(pub), sig, data);
    } catch { return false; }
  };
}

// A sliding window: whether one more fits in `limit` per `period` ms, and the times to keep.
export function takeSlot(times, now, limit, period) {
  const recent = (Array.isArray(times) ? times : []).filter((t) => typeof t === 'number' && t > now - period && t <= now);
  return recent.length < limit ? { ok: true, times: [...recent, now] } : { ok: false, times: recent };
}
export const NEW_ROOMS = { limit: 10, period: 3600_000 }; // per address

// `storage`: get, put, delete (a key or list of keys), list({ prefix, start, end }) → Map,
// deleteAll, setAlarm. `sockets()`: the open sockets, each with send(text), close(code,
// reason) and a `state` object that survives the room going to sleep. `mayCreate(socket)`:
// whether this socket may make a new room now, to limit how fast one address can make them.
export class Room {
  constructor({ id, storage, sockets, verify = ed25519(), now = () => Date.now(), random = () => b64(crypto.getRandomValues(new Uint8Array(24))), mayCreate = async () => true }) {
    Object.assign(this, { id, storage, sockets, verify, now, random, mayCreate });
    this.queue = Promise.resolve();
  }

  // A socket opens: it gets a challenge to sign.
  open(socket) {
    const nonce = this.random();
    socket.state = { nonce };
    send(socket, { type: 'challenge', room: this.id, nonce });
  }

  // Messages are handled one at a time, in order, so changes get their numbers in order.
  message(socket, text) {
    const run = this.queue.then(() => this.#handle(socket, text));
    this.queue = run.catch(() => {});
    return run;
  }

  async #handle(socket, text) {
    let m;
    try {
      if (typeof text !== 'string' || text.length > LIMITS.message) return fail(socket, 'too-big', true);
      m = JSON.parse(text);
      if (!m || typeof m.type !== 'string') throw new Error();
    } catch { return fail(socket, 'bad-message'); }
    const state = socket.state || {};
    try {
      if (m.type === 'box') return await this.#box(socket, m);
      if (m.type === 'create') return await this.#create(socket, state, m);
      if (m.type === 'auth') return await this.#auth(socket, state, m);
      if (!state.role) return fail(socket, 'not-signed-in', true);
      // A link turned off while the room slept: its socket goes now.
      if (state.role !== 'owner') {
        const meta = await this.storage.get('meta');
        const l = meta && (await this.#links(meta)).links.get(state.link);
        if (!l || l.off || l.role !== state.role || l.pub !== state.pub) return fail(socket, 'link-off', true);
      }
      if (m.type === 'sync') return await this.#sync(socket, m);
      if (m.type === 'presence') return this.#presence(socket, state, m);
      if (m.type === 'update') return await this.#update(socket, state, m);
      if (m.type === 'snapshot') return await this.#snapshot(socket, state, m);
      if (m.type === 'links') return await this.#setLinks(socket, state, m);
      if (m.type === 'delete-room') return await this.#deleteRoom(socket, state);
      return fail(socket, 'bad-message');
    } catch (e) {
      return fail(socket, 'bad-message', false, String(e?.message || e).slice(0, 200));
    }
  }

  async #links(meta) {
    if (this.cache?.n === meta.n && this.cache.owner === meta.owner) return this.cache;
    this.cache = { owner: meta.owner, ...(await readLinks(this.id, meta.owner, meta.links, this.verify)) };
    return this.cache;
  }

  // A link's box, before signing in: it holds the key to sign in with, encrypted with the
  // link's secret (which never reaches the relay) and its password.
  async #box(socket, m) {
    const meta = await this.storage.get('meta');
    const l = meta && validId(m.link) && (await this.#links(meta)).links.get(m.link);
    if (!l || l.off) return fail(socket, 'no-link');
    send(socket, { type: 'box', link: m.link, role: l.role, box: l.box });
  }

  async #create(socket, state, m) {
    if (await this.storage.get('meta')) return fail(socket, 'room-exists', true);
    if (typeof m.owner !== 'string' || typeof m.sig !== 'string') return fail(socket, 'bad-message', true);
    if (!(await this.verify(m.owner, unb64(m.sig), signed.auth(this.id, state.nonce)))) return fail(socket, 'bad-signature', true);
    const links = await readLinks(this.id, m.owner, m.links, this.verify);
    if (!(await this.mayCreate(socket))) return fail(socket, 'busy', true);
    const now = this.now();
    await this.storage.put('meta', { owner: m.owner, links: m.links, n: links.n, seq: 0, bytes: 0, created: now, touched: now });
    await this.storage.setAlarm(now + LIMITS.idle);
    socket.state = { role: 'owner', link: 'owner', pub: m.owner, sid: this.random().slice(0, 12) };
    send(socket, { type: 'welcome', role: 'owner', links: m.links, seq: 0 });
  }

  async #auth(socket, state, m) {
    const meta = await this.storage.get('meta');
    if (!meta) return fail(socket, 'no-room', true);
    let role, pub;
    if (m.link === 'owner') { role = 'owner'; pub = meta.owner; }
    else {
      const l = validId(m.link) && (await this.#links(meta)).links.get(m.link);
      if (!l || l.off) return fail(socket, 'link-off', true);
      ({ role, pub } = l);
    }
    if (typeof m.sig !== 'string' || !state.nonce || !(await this.verify(pub, unb64(m.sig), signed.auth(this.id, state.nonce)))) return fail(socket, 'bad-signature', true);
    socket.state = { role, link: m.link, pub, sid: this.random().slice(0, 12) };
    await this.#touch(meta);
    send(socket, { type: 'welcome', role, links: meta.links, seq: meta.seq });
  }

  // Everything after `since`: each document's latest snapshot, if it's newer, then the
  // changes that came after it.
  async #sync(socket, m) {
    const since = Number.isSafeInteger(m.since) && m.since > 0 ? m.since : 0;
    const meta = await this.storage.get('meta');
    for (const doc of Object.keys(WRITERS)) {
      const s = await this.storage.get('snap:' + doc);
      if (!s || s.upTo <= since) continue;
      const parts = await this.storage.list({ prefix: `snap:${doc}:` });
      send(socket, { type: 'snapshot', doc, upTo: s.upTo, by: s.by, sig: s.sig, data: [...parts.values()].join('') });
    }
    const updates = await this.storage.list({ start: seqKey(since + 1), end: 'u;' });
    for (const [key, u] of updates) send(socket, { type: 'update', seq: Number(key.slice(2)), doc: u.doc, by: u.by, sig: u.sig, data: u.data });
    send(socket, { type: 'synced', seq: meta.seq });
  }

  // Who's here and where, encrypted: passed to the others now, and never kept. Each
  // connection has its own id, so two tabs of one link are two people here.
  #presence(socket, state, m) {
    if (typeof m.data !== 'string' || m.data.length > LIMITS.presence) return fail(socket, 'too-big');
    const out = { type: 'presence', sid: state.sid, by: state.link, data: m.data };
    for (const other of this.sockets()) if (other !== socket && other.state?.role) send(other, out);
  }
  // A connection closed: the others stop showing it.
  close(socket) {
    const sid = socket.state?.sid;
    if (!sid || !socket.state.role) return;
    for (const other of this.sockets()) if (other !== socket && other.state?.role) send(other, { type: 'gone', sid });
  }

  async #update(socket, state, m) {
    if (!WRITERS[m.doc]?.includes(state.role)) return fail(socket, 'not-allowed', false, m.doc);
    const data = unb64(m.data);
    if (typeof m.sig !== 'string' || !(await this.verify(state.pub, unb64(m.sig), signed.update(this.id, m.doc, data)))) return fail(socket, 'bad-signature');
    const meta = await this.storage.get('meta');
    if (meta.bytes + data.length > LIMITS.room) return fail(socket, 'room-full');
    const seq = meta.seq + 1;
    meta.seq = seq; meta.bytes += data.length;
    await this.#touch(meta, false);
    await this.storage.put({ [seqKey(seq)]: { doc: m.doc, by: state.link, sig: m.sig, data: m.data, size: data.length }, meta });
    const out = { type: 'update', seq, doc: m.doc, by: state.link, sig: m.sig, data: m.data };
    for (const other of this.sockets()) if (other !== socket && other.state?.role) send(other, out);
    send(socket, { type: 'ack', id: m.id ?? null, seq });
  }

  // The whole of one document up to change `upTo`, so the changes before it can go.
  async #snapshot(socket, state, m) {
    if (!WRITERS[m.doc]?.includes(state.role)) return fail(socket, 'not-allowed', false, m.doc);
    const meta = await this.storage.get('meta'), old = await this.storage.get('snap:' + m.doc);
    if (!Number.isSafeInteger(m.upTo) || m.upTo < 1 || m.upTo > meta.seq || (old && m.upTo <= old.upTo)) return fail(socket, 'stale-snapshot');
    const data = unb64(m.data);
    if (typeof m.sig !== 'string' || !(await this.verify(state.pub, unb64(m.sig), signed.snapshot(this.id, m.doc, m.upTo, data)))) return fail(socket, 'bad-signature');
    const gone = [], drop = await this.storage.list({ start: seqKey(1), end: seqKey(m.upTo + 1) });
    let freed = old?.size || 0;
    for (const [key, u] of drop) if (u.doc === m.doc) { gone.push(key); freed += u.size; }
    if (meta.bytes - freed + data.length > LIMITS.room) return fail(socket, 'room-full');
    if (old) for (let i = 0; i < old.parts; i++) gone.push(`snap:${m.doc}:${String(i).padStart(4, '0')}`);
    const parts = {};
    for (let i = 0; i * CHUNK < m.data.length; i++) parts[`snap:${m.doc}:${String(i).padStart(4, '0')}`] = m.data.slice(i * CHUNK, (i + 1) * CHUNK);
    // Old parts first: the new ones may reuse their keys.
    for (let i = 0; i < gone.length; i += 128) await this.storage.delete(gone.slice(i, i + 128));
    meta.bytes += data.length - freed;
    await this.storage.put({ ...parts, ['snap:' + m.doc]: { upTo: m.upTo, by: state.link, sig: m.sig, size: data.length, parts: Object.keys(parts).length }, meta });
    send(socket, { type: 'ack', id: m.id ?? null, seq: m.upTo });
  }

  // The owner changes the links: adds one, changes a password, or turns one off. Sockets of
  // links that went, or changed, close.
  async #setLinks(socket, state, m) {
    if (state.role !== 'owner') return fail(socket, 'not-allowed');
    const meta = await this.storage.get('meta');
    const next = await readLinks(this.id, meta.owner, m.links, this.verify);
    if (next.n <= meta.n) return fail(socket, 'stale-links');
    meta.links = m.links; meta.n = next.n;
    await this.storage.put('meta', meta);
    for (const other of this.sockets()) {
      const s = other.state;
      if (other === socket || !s?.role) continue;
      if (s.role === 'owner') { send(other, { type: 'links', links: m.links }); continue; } // the owner's other tabs
      const l = next.links.get(s.link);
      if (!l || l.off || l.role !== s.role || l.pub !== s.pub) fail(other, 'link-off', true);
      else send(other, { type: 'links', links: m.links });
    }
    send(socket, { type: 'ack', id: m.id ?? null, seq: meta.seq });
  }

  async #deleteRoom(socket, state) {
    if (state.role !== 'owner') return fail(socket, 'not-allowed');
    await this.storage.deleteAll();
    for (const other of this.sockets()) if (other !== socket) fail(other, 'room-deleted', true);
    fail(socket, 'room-deleted', true);
  }

  // Notes that the project is in use, so it isn't deleted. `save` false: the caller saves.
  async #touch(meta, save = true) {
    const now = this.now();
    if (now - meta.touched < 3600_000) return; // once an hour is enough
    meta.touched = now;
    if (save) await this.storage.put('meta', meta);
    await this.storage.setAlarm(now + LIMITS.idle);
  }

  // A project nobody has opened for a long time is deleted.
  async alarm() {
    const meta = await this.storage.get('meta');
    if (!meta) return;
    if (this.now() - meta.touched >= LIMITS.idle) await this.storage.deleteAll();
    else await this.storage.setAlarm(meta.touched + LIMITS.idle);
  }
}

function send(socket, m) { try { socket.send(JSON.stringify(m)); } catch { /* it closed */ } }
function fail(socket, code, close = false, detail) {
  send(socket, { type: 'error', code, ...(detail ? { detail } : {}) });
  if (close) try { socket.close(4000, code); } catch { /* it closed */ }
}
