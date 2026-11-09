// A room on the relay: one shared project. The relay passes changes between the people in it
// and keeps them for whoever opens the project next. It never sees what's in the project:
// changes arrive encrypted, and signed by the share link (or the owner) that made them.
//
// The owner signs the list of links: each link's id, role, public key and its "box" (the
// project key and link key, encrypted with the link's secret and password). The relay checks
// signatures so it can refuse writes a link may not make, and receiving clients check them
// again. A link turned off stays on the list, marked off and without its box: it can't sign
// in, but the changes it made before still check out for whoever opens the project later.
// Each change carries the browser that made it and its number there; the list says where a
// link turned off stopped, so clients can tell its earlier changes from later ones. The design
// is in docs/development/sharing-design.md.
//
// A link may expire (`expires`, a time in ms). From then on the relay treats it as off: it
// can't get its box or sign in, and its sockets close. The owner turns it off properly, with
// a new project key, once online.
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
// Which versions of the protocol this relay speaks. Browsers say theirs (`v`) when they ask
// for a box, make a room or sign in; one outside this range is told which side to update.
// 2: changes numbered by browser, links turned off sealed. Before it, browsers sent none.
// 3: a message longer than PART goes in parts, both ways. Version 2 browsers still connect:
// they send and get whole messages, as before.
export const PROTOCOL = { min: 2, max: 3 };
export const PART = 256_000; // characters in each part of a long message
export const LIMITS = {
  message: 2_000_000, // characters in one message, or one part
  whole: 24_000_000, // characters in a message put together from parts
  room: 64 * 1024 * 1024, // bytes kept for one project
  presence: 4000, // characters in one presence message
  links: 30, // links on at once
  offLinks: 200, // links turned off, kept so their earlier changes still check out
  devices: 50, // browsers whose last change is kept for each link turned off
  linksText: 500_000, // characters in the owner's signed list
  recovery: 40_000, // characters in the recovery link's box
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
  // A change carries the browser that made it (`dev`, new each time the project opens) and
  // its number there (`n`, counting up). Without them, as sent before numbering, the old form.
  update: (room, doc, data, dev, n) => join(dev ? `scribecue-relay:change:${room}:${doc}:${dev}:${n}:` : `scribecue-relay:update:${room}:${doc}:`, data),
  snapshot: (room, doc, upTo, data, dev, n) => join(dev ? `scribecue-relay:whole:${room}:${doc}:${upTo}:${dev}:${n}:` : `scribecue-relay:snapshot:${room}:${doc}:${upTo}:`, data),
  links: (text) => enc.encode(`scribecue-relay:links:${text}`),
};
export const validRoom = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const validDev = (d) => typeof d === 'string' && /^[A-Za-z0-9_-]{8,22}$/.test(d);
// A change's browser and number, checked: {} for one sent before numbering.
function numbering(m) {
  if (m.dev === undefined && m.n === undefined) return {};
  if (!validDev(m.dev) || !Number.isSafeInteger(m.n) || m.n < 1) throw new Error('bad numbering');
  return { dev: m.dev, n: m.n };
}
// The last number of each browser of a link turned off: { dev: n }.
export function validUpTo(upTo) {
  if (!upTo || typeof upTo !== 'object' || Array.isArray(upTo)) return false;
  const e = Object.entries(upTo);
  return e.length <= LIMITS.devices && e.every(([d, n]) => validDev(d) && Number.isSafeInteger(n) && n >= 0);
}
// Whether a link has expired by `now`.
export const expired = (l, now) => l?.expires !== undefined && now >= l.expires;
const seqKey = (n) => 'u:' + String(n).padStart(15, '0');
// A long change is kept in pieces, as whole copies are: its record says how many.
const piecesOf = (seq) => `p:${String(seq).padStart(15, '0')}:`;
const pieceKey = (seq, i) => piecesOf(seq) + String(i).padStart(4, '0');
const pieces = (data) => Array.from({ length: Math.ceil(data.length / CHUNK) }, (_, i) => data.slice(i * CHUNK, (i + 1) * CHUNK));

// The owner's signed list of links, checked: { text, sig } → { n, links: Map(id → link) }.
export async function readLinks(room, owner, signedLinks, verify) {
  const { text, sig } = signedLinks || {};
  if (typeof text !== 'string' || typeof sig !== 'string' || text.length > LIMITS.linksText) throw new Error('bad links');
  if (!(await verify(owner, unb64(sig), signed.links(text)))) throw new Error('links not signed by the owner');
  const o = JSON.parse(text);
  if (o.room !== room || !Number.isSafeInteger(o.n) || o.n < 1 || !Array.isArray(o.links)) throw new Error('bad links');
  const off = o.links.filter((l) => l?.off === true).length;
  if (o.links.length - off > LIMITS.links || off > LIMITS.offLinks) throw new Error('bad links');
  const links = new Map();
  for (const l of o.links) {
    if (!validId(l?.id) || l.id === 'owner' || links.has(l.id) || !ROLES.includes(l.role) || typeof l.pub !== 'string') throw new Error('bad link');
    if (l.off !== true && (typeof l.box !== 'string' || l.box.length > 4000)) throw new Error('bad link');
    if (l.off === true && l.upTo !== undefined && !validUpTo(l.upTo)) throw new Error('bad link');
    if (l.expires !== undefined && (!Number.isSafeInteger(l.expires) || l.expires < 0)) throw new Error('bad link');
    unb64(l.pub);
    const ends = l.expires !== undefined ? { expires: l.expires } : {};
    links.set(l.id, l.off === true ? { role: l.role, pub: l.pub, off: true, ...ends } : { role: l.role, pub: l.pub, box: l.box, ...ends });
  }
  // The owner's recovery link: its box opens the project as the owner.
  let recovery = null;
  if (o.recovery !== undefined) {
    const r = o.recovery;
    if (!validId(r?.id) || r.id === 'owner' || links.has(r.id) || typeof r.box !== 'string' || r.box.length > LIMITS.recovery) throw new Error('bad recovery');
    recovery = { id: r.id, box: r.box };
  }
  return { n: o.n, links, recovery };
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
    this.partial = new Map(); // connection id → the parts of a long message so far
  }

  // A socket opens: it gets a challenge to sign.
  open(socket) {
    const nonce = this.random();
    socket.state = { nonce };
    send(socket, { type: 'challenge', room: this.id, nonce, protocol: PROTOCOL.max });
  }

  // Messages are handled one at a time, in order, so changes get their numbers in order.
  message(socket, text) {
    const run = this.queue.then(() => this.#handle(socket, text));
    this.queue = run.catch(() => {});
    return run;
  }

  // `whole`: a message put together from parts. One too long is refused, and the browser
  // stays connected to say so.
  async #handle(socket, text, whole = false) {
    let m;
    try {
      if (typeof text !== 'string' || text.length > (whole ? LIMITS.whole : LIMITS.message)) return fail(socket, 'too-big', !whole);
      m = JSON.parse(text);
      if (!m || typeof m.type !== 'string' || (whole && m.type === 'part')) throw new Error();
    } catch { return fail(socket, 'bad-message'); }
    const state = socket.state || {};
    if (m.type === 'part') return this.#part(socket, state, m);
    if (['box', 'create', 'auth'].includes(m.type)) {
      const v = Number.isSafeInteger(m.v) ? m.v : 1;
      if (v < PROTOCOL.min) return fail(socket, 'old-app', true);
      if (v > PROTOCOL.max) return fail(socket, 'old-relay', true);
    }
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
        if (expired(l, this.now())) return fail(socket, 'link-expired', true);
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

  // One part of a long message, in order. The last puts it together and handles it.
  #part(socket, state, m) {
    if (!state.role) return fail(socket, 'not-signed-in', true);
    if (!Number.isSafeInteger(m.i) || !Number.isSafeInteger(m.of) || m.of < 2 || m.i < 0 || m.i >= m.of || typeof m.text !== 'string') return fail(socket, 'bad-message');
    if (m.of > Math.ceil(LIMITS.whole / PART)) { this.partial.delete(state.sid); return m.i === 0 ? fail(socket, 'too-big') : undefined; }
    let p = this.partial.get(state.sid);
    if (m.i === 0) this.partial.set(state.sid, p = { id: m.id, of: m.of, texts: [], size: 0 });
    // A part missing, as when the room slept between them: the browser sends it all again.
    if (!p || p.id !== m.id || p.of !== m.of || p.texts.length !== m.i) { this.partial.delete(state.sid); return fail(socket, 'part-lost'); }
    p.texts.push(m.text); p.size += m.text.length;
    if (p.size > LIMITS.whole) { this.partial.delete(state.sid); return fail(socket, 'too-big'); }
    if (p.texts.length < p.of) return;
    this.partial.delete(state.sid);
    return this.#handle(socket, p.texts.join(''), true);
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
    // The recovery link's box comes with the signed list, to rebuild the owner's from.
    const recovery = meta && validId(m.link) && (await this.#links(meta)).recovery;
    if (recovery?.id === m.link) return send(socket, { type: 'box', link: m.link, role: 'owner', box: recovery.box, links: meta.links });
    const l = meta && validId(m.link) && (await this.#links(meta)).links.get(m.link);
    // One the owner turned off once it expired still says it expired.
    if (expired(l, this.now())) return fail(socket, 'link-expired');
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
    socket.state = { role: 'owner', link: 'owner', pub: m.owner, sid: this.random().slice(0, 12), v: m.v };
    send(socket, { type: 'welcome', role: 'owner', links: m.links, seq: 0 });
  }

  async #auth(socket, state, m) {
    const meta = await this.storage.get('meta');
    if (!meta) return fail(socket, 'no-room', true);
    let role, pub, expires;
    if (m.link === 'owner') { role = 'owner'; pub = meta.owner; }
    else {
      const l = validId(m.link) && (await this.#links(meta)).links.get(m.link);
      if (!l || l.off) return fail(socket, 'link-off', true);
      if (expired(l, this.now())) return fail(socket, 'link-expired', true);
      ({ role, pub, expires } = l);
    }
    if (typeof m.sig !== 'string' || !state.nonce || !(await this.verify(pub, unb64(m.sig), signed.auth(this.id, state.nonce)))) return fail(socket, 'bad-signature', true);
    socket.state = { role, link: m.link, pub, ...(expires !== undefined ? { expires } : {}), sid: this.random().slice(0, 12), v: m.v };
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
      send(socket, { type: 'snapshot', doc, upTo: s.upTo, by: s.by, ...numbering(s), sig: s.sig, data: [...parts.values()].join('') });
    }
    const updates = await this.storage.list({ start: seqKey(since + 1), end: 'u;' });
    for (const [key, u] of updates) {
      const seq = Number(key.slice(2));
      const data = u.parts ? [...(await this.storage.list({ prefix: piecesOf(seq) })).values()].join('') : u.data;
      send(socket, { type: 'update', seq, doc: u.doc, by: u.by, ...numbering(u), sig: u.sig, data });
    }
    send(socket, { type: 'synced', seq: meta.seq });
  }

  // Who's here and where, encrypted: passed to the others now, and never kept. Each
  // connection has its own id, so two tabs of one link are two people here.
  #presence(socket, state, m) {
    if (typeof m.data !== 'string' || m.data.length > LIMITS.presence) return fail(socket, 'too-big');
    const out = { type: 'presence', sid: state.sid, by: state.link, data: m.data };
    for (const other of this.#others(socket)) send(other, out);
  }
  // The other signed-in sockets. One whose link has expired since signing in closes instead.
  #others(socket) {
    const now = this.now(), out = [];
    for (const other of this.sockets()) {
      if (other === socket || !other.state?.role) continue;
      if (expired(other.state, now)) fail(other, 'link-expired', true);
      else out.push(other);
    }
    return out;
  }
  // A connection closed: the others stop showing it.
  close(socket) {
    const sid = socket.state?.sid;
    this.partial.delete(sid);
    if (!sid || !socket.state.role) return;
    for (const other of this.#others(socket)) send(other, { type: 'gone', sid });
  }

  async #update(socket, state, m) {
    if (!WRITERS[m.doc]?.includes(state.role)) return fail(socket, 'not-allowed', false, m.doc);
    const data = unb64(m.data), num = numbering(m);
    if (typeof m.sig !== 'string' || !(await this.verify(state.pub, unb64(m.sig), signed.update(this.id, m.doc, data, num.dev, num.n)))) return fail(socket, 'bad-signature');
    const meta = await this.storage.get('meta');
    if (meta.bytes + data.length > LIMITS.room) return fail(socket, 'room-full');
    const seq = meta.seq + 1;
    meta.seq = seq; meta.bytes += data.length;
    await this.#touch(meta, false);
    const record = { doc: m.doc, by: state.link, ...num, sig: m.sig, size: data.length };
    if (m.data.length <= CHUNK) record.data = m.data;
    else {
      const all = pieces(m.data);
      record.parts = all.length;
      await this.#putAll(Object.fromEntries(all.map((t, i) => [pieceKey(seq, i), t])));
    }
    await this.storage.put({ [seqKey(seq)]: record, meta });
    const out = { type: 'update', seq, doc: m.doc, by: state.link, ...num, sig: m.sig, data: m.data };
    for (const other of this.#others(socket)) send(other, out);
    send(socket, { type: 'ack', id: m.id ?? null, seq });
  }

  // The whole of one document up to change `upTo`, so the changes before it can go.
  async #snapshot(socket, state, m) {
    if (!WRITERS[m.doc]?.includes(state.role)) return fail(socket, 'not-allowed', false, m.doc);
    const meta = await this.storage.get('meta'), old = await this.storage.get('snap:' + m.doc);
    // One up to the same change may replace the last, as the owner's does after a link is
    // turned off.
    if (!Number.isSafeInteger(m.upTo) || m.upTo < 1 || m.upTo > meta.seq || (old && m.upTo < old.upTo)) return fail(socket, 'stale-snapshot');
    const data = unb64(m.data), num = numbering(m);
    if (typeof m.sig !== 'string' || !(await this.verify(state.pub, unb64(m.sig), signed.snapshot(this.id, m.doc, m.upTo, data, num.dev, num.n)))) return fail(socket, 'bad-signature');
    const gone = [], drop = await this.storage.list({ start: seqKey(1), end: seqKey(m.upTo + 1) });
    let freed = old?.size || 0;
    for (const [key, u] of drop) {
      if (u.doc !== m.doc) continue;
      gone.push(key); freed += u.size;
      for (let i = 0; i < (u.parts || 0); i++) gone.push(pieceKey(Number(key.slice(2)), i));
    }
    if (meta.bytes - freed + data.length > LIMITS.room) return fail(socket, 'room-full');
    if (old) for (let i = 0; i < old.parts; i++) gone.push(`snap:${m.doc}:${String(i).padStart(4, '0')}`);
    const parts = Object.fromEntries(pieces(m.data).map((t, i) => [`snap:${m.doc}:${String(i).padStart(4, '0')}`, t]));
    // Old parts first: the new ones may reuse their keys.
    for (let i = 0; i < gone.length; i += 128) await this.storage.delete(gone.slice(i, i + 128));
    meta.bytes += data.length - freed;
    await this.#putAll(parts);
    await this.storage.put({ ['snap:' + m.doc]: { upTo: m.upTo, by: state.link, ...num, sig: m.sig, size: data.length, parts: Object.keys(parts).length }, meta });
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
    for (const other of this.#others(socket)) {
      const s = other.state;
      if (s.role === 'owner') { send(other, { type: 'links', links: m.links }); continue; } // the owner's other tabs
      const l = next.links.get(s.link);
      if (!l || l.off || l.role !== s.role || l.pub !== s.pub) fail(other, 'link-off', true);
      else if (expired(l, this.now())) fail(other, 'link-expired', true);
      else {
        // The owner may change when it expires.
        const { expires, ...rest } = s;
        if (expires !== l.expires) other.state = l.expires !== undefined ? { ...rest, expires: l.expires } : rest;
        send(other, { type: 'links', links: m.links });
      }
    }
    send(socket, { type: 'ack', id: m.id ?? null, seq: meta.seq });
  }

  // Storage takes at most 128 keys at a time.
  async #putAll(values) {
    const all = Object.entries(values);
    for (let i = 0; i < all.length; i += 100) await this.storage.put(Object.fromEntries(all.slice(i, i + 100)));
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

// A long message goes in parts to a browser that takes them (version 3 on), whole to others.
let partId = 0;
function send(socket, m) {
  try {
    const text = JSON.stringify(m);
    if (text.length <= PART || !(socket.state?.v >= 3)) { socket.send(text); return; }
    const id = ++partId, of = Math.ceil(text.length / PART);
    for (let i = 0; i < of; i++) socket.send(JSON.stringify({ type: 'part', id, i, of, text: text.slice(i * PART, (i + 1) * PART) }));
  } catch { /* it closed */ }
}
function fail(socket, code, close = false, detail) {
  send(socket, { type: 'error', code, ...(detail ? { detail } : {}) });
  if (close) try { socket.close(4000, code); } catch { /* it closed */ }
}
