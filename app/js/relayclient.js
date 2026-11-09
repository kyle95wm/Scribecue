// Connects a project's shared copy (shared.js) to the relay: sends this person's changes,
// encrypted and signed, and puts others' changes in once their signatures check out.
// It reconnects by itself, keeps changes made while offline until the relay has them, and
// now and then sends a whole document so the relay can drop the changes before it.
import * as Y from '../vendor/yjs.js';
import { b64, unb64, signed, signer, verifier, readLinks, projectCipher, unwrapKeys, keysOf, WRITERS, DEVICES, PROTOCOL, relayTooOld } from './sharekeys.js';
export { fetchBox } from './sharing.js'; // kept here too, for the tests
import { DOCS } from './shared.js';

const ENDS = new Set(['link-off', 'link-expired', 'room-deleted', 'no-room', 'bad-signature', 'room-exists']);
// This browser and the relay speak different versions: 'old-app' when Scribecue needs
// updating, 'old-relay' when the relay does. Trying again won't help, but nothing is lost.
// What waits while a block is being typed (see hold).
const HELD = new Set(['script', 'review']);
export const OUTDATED = new Set(['old-app', 'old-relay']);


export class RelayClient {
  // `who`: { link ('owner' or a link id), priv, ownerPub, keys (or projectKey), w }. `create`: the signed
  // links, to make the room first. `seed`: send everything already in the copy, as when
  // making the room or coming back to it; Yjs ignores what the relay already has.
  // `onStatus(status, detail)`: 'connecting', 'online',
  // 'offline', 'ended', or 'old-app' or 'old-relay' (see OUTDATED).
  constructor({ url, room, who, shared, create = null, seed = !!create, onStatus = () => {}, onLinks = () => {}, onPresence = () => {}, WebSocket = globalThis.WebSocket, snapshotEvery = 200, flushMs = 150, retryMs = 1000, connectMs = 20_000, presenceMs = 250, heartbeatMs = 20_000, timers = globalThis }) {
    Object.assign(this, { url, room, who, shared, create, onStatus, onLinks, onPresence, WebSocket, snapshotEvery, flushMs, retryMs, connectMs, presenceMs, heartbeatMs, timers });
    this.people = new Map(); // connection id → { name, mode, block, editing, by, role, at }
    this.me = null; // this person's presence, as last given
    this.seq = 0; this.role = null; this.links = null; this.status = null;
    this.pending = Object.fromEntries(DOCS.map((d) => [d, []])); // changes the relay doesn't have yet
    this.inflight = new Map(); // message id → { doc, count }
    this.waiters = []; this.failures = 0; // waiting for the relay to answer, as compact() does
    this.held = []; // changes waiting for a project key this side doesn't have yet
    this.counts = Object.fromEntries(DOCS.map((d) => [d, 0])); // changes since the last snapshot
    this.nextId = 1; this.delay = retryMs; this.stopped = false; this.synced = false; this.holding = false;
    // Each change this side sends is numbered, for this browser (`dev`, new each time).
    this.dev = b64(crypto.getRandomValues(new Uint8Array(9))); this.n = 0;
    // The last number had from each browser of each link, so the owner can say where a link
    // turned off stops ({ link: { dev: n } }; app.js keeps it with the copy), and the
    // signature of each numbered change had, so no number counts twice.
    this.seen = {}; this.sigs = new Map();
    this.verify = verifier();
    this.ready = (async () => {
      this.sign = await signer(who.priv);
      this.cipher = await projectCipher(keysOf(who), room);
    })();
    if (seed) for (const d of DOCS) this.pending[d].push(shared.update(d));
    this.off = shared.onUpdate((doc, update, origin) => {
      if (origin === 'relay') return;
      this.pending[doc].push(update);
      this.#schedule();
    });
  }

  start() { this.ready.then(() => this.#connect()); return this; }
  // While someone types in a block, their changes to the script and suggestions wait here,
  // so others see the block once it's done rather than letter by letter. `hold(false)`
  // sends them. Comments still go at once.
  hold(on) {
    if (this.holding === !!on) return;
    this.holding = !!on;
    if (!on) this.#schedule();
  }
  stop() {
    this.stopped = true; this.off();
    this.timers.clearTimeout(this.flushTimer); this.timers.clearTimeout(this.retryTimer); this.timers.clearTimeout(this.connectTimer);
    this.timers.clearTimeout(this.presenceTimer); this.timers.clearTimeout(this.heartbeat);
    try { this.ws?.close(1000, 'done'); } catch { /* closed */ }
    this.#wake();
  }
  // The owner's new list of links, or ending the project on the relay. Only when online:
  // a list sent while offline goes again on reconnecting (see onLinks in app.js).
  // Resolves true once the relay has it.
  async sendLinks(links) {
    if (!this.synced || this.role !== 'owner') return false;
    await this.#readLinks(links); // this side takes the new list at once, to accept new links' changes
    const id = this.nextId++;
    this.inflight.set(id, { doc: null, count: 0, links: true });
    this.#send({ type: 'links', id, links });
    return this.#answered([id]);
  }
  // Sends each document this side may write, whole, up to the latest change, so the relay
  // drops the changes before it: as after a link is turned off, so that none of its changes
  // are needed any more. Resolves true once the relay has them all; false if it can't now,
  // as when offline or still waiting for a project key.
  async compact() {
    if (!this.synced || this.held.length || this.snapshotting) return false;
    if (this.holding && [...HELD].some((d) => this.pending[d].length)) return false; // a block being typed

    const upTo = this.seq, ws = this.ws, ids = [];
    if (upTo < 1) return true;
    this.snapshotting = true;
    try {
      for (const doc of DOCS) {
        if (!WRITERS[doc].includes(this.role)) continue;
        const data = await this.cipher.seal(doc, this.shared.update(doc));
        const n = ++this.n, sig = await this.sign(signed.snapshot(this.room, doc, upTo, data, this.dev, n));
        if (this.ws !== ws || !this.synced) return false;
        const id = this.nextId++;
        ids.push(id);
        this.inflight.set(id, { doc, count: 0, snapshot: true });
        this.#send({ type: 'snapshot', doc, upTo, id, dev: this.dev, n, data: b64(data), sig });
      }
    } finally { this.snapshotting = false; }
    return this.#answered(ids);
  }
  // Waits for the relay to answer messages `ids`: true if it took them all.
  #answered(ids) {
    const ws = this.ws, failures = this.failures;
    return new Promise((resolve) => {
      const check = () => {
        if (ids.some((id) => this.inflight.has(id)) && this.ws === ws && !this.stopped) return false;
        resolve(this.ws === ws && this.failures === failures && !this.stopped);
        return true;
      };
      if (!check()) this.waiters.push(check);
    });
  }
  #wake() { this.waiters = this.waiters.filter((check) => !check()); }
  // Back online: tries again now, rather than after the wait between tries.
  reconnect() {
    if (this.stopped || !this.status || this.status === 'online' || this.status === 'ended') return;
    this.timers.clearTimeout(this.retryTimer);
    this.delay = this.retryMs;
    const old = this.ws;
    this.#connect();
    try { old?.close(); } catch { /* closed */ }
  }
  deleteRoom() { if (this.synced && this.role === 'owner') { this.#send({ type: 'delete-room' }); return true; } return false; }
  // Where this person is, for the others: { name, mode, block, editing }. Sent when online,
  // at most every `presenceMs`, and again every `heartbeatMs` so others know it's still here.
  setPresence(me) {
    this.me = me;
    if (this.presenceTimer) { this.presenceDue = true; return; }
    this.#sendPresence();
  }
  async #sendPresence() {
    if (this.stopped) return;
    this.timers.clearTimeout(this.heartbeat);
    this.heartbeat = this.timers.setTimeout(() => { this.#expire(); this.#sendPresence(); }, this.heartbeatMs);
    if (!this.me || !this.synced) return;
    this.presenceDue = false;
    this.presenceTimer = this.timers.setTimeout(() => { this.presenceTimer = 0; if (this.presenceDue) this.#sendPresence(); }, this.presenceMs);
    const ws = this.ws;
    const data = await this.cipher.seal('presence', new TextEncoder().encode(JSON.stringify(this.me)));
    if (ws === this.ws && this.synced) this.#send({ type: 'presence', data: b64(data) });
  }
  #canBeHere(by) { const l = this.links?.links.get(by); return !!l && !l.off; }
  async #presence(m) {
    if (typeof m.sid !== 'string' || !this.#canBeHere(m.by)) return;
    let p;
    try { p = JSON.parse(new TextDecoder().decode(await this.cipher.open('presence', unb64(m.data)))); } catch { return; }
    if (!p || typeof p !== 'object') return;
    const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const fresh = !this.people.has(m.sid);
    this.people.set(m.sid, { name: text(p.name, 60), mode: text(p.mode, 12), block: text(p.block, 64), editing: p.editing === true, by: m.by, role: this.links.links.get(m.by).role, at: Date.now() });
    this.#people();
    if (fresh) this.setPresence(this.me); // someone new: they hear from this person too
  }
  #expire() {
    let gone = false;
    for (const [sid, p] of this.people) if (Date.now() - p.at > this.heartbeatMs * 3) { this.people.delete(sid); gone = true; }
    if (gone) this.#people();
  }
  #forget() { if (this.people.size) { this.people.clear(); this.#people(); } }
  #people() { this.onPresence([...this.people.entries()].map(([sid, p]) => ({ sid, ...p }))); }

  // How far this side has everything from the relay: before any change it's still holding.
  get safeSeq() { return this.held.reduce((n, m) => Math.min(n, (m.seq ?? m.upTo) - 1), this.seq); }
  // Changes not yet kept by the relay.
  unsent() { return DOCS.reduce((n, d) => n + this.pending[d].length, 0); }

  #outdated(code) { this.#set(code); this.stop(); }
  #set(status, detail) { if (this.status !== status || detail) { this.status = status; this.onStatus(status, detail); } }

  #connect() {
    if (this.stopped) return;
    this.#set('connecting');
    this.synced = false; this.inflight.clear(); this.#wake();
    const ws = this.ws = new this.WebSocket(`${this.url.replace(/\/$/, '')}/rooms/${this.room}`);
    // Messages are handled one at a time, in order: checking a signature takes a moment.
    let queue = Promise.resolve(), heard = false;
    ws.onmessage = (e) => { heard = true; queue = queue.then(() => this.#message(ws, e.data)).catch(() => {}); };
    // One that neither connects nor fails, as can happen offline, is given up on.
    this.timers.clearTimeout(this.connectTimer);
    this.connectTimer = this.timers.setTimeout(() => {
      if (this.ws !== ws || heard) return;
      const retry = ws.onclose; ws.onclose = null;
      try { ws.close(); } catch { /* closed */ }
      retry();
    }, this.connectMs);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.synced = false;
      this.#forget(); // while not connected, nobody shows as here
      if (this.stopped || this.status === 'ended') return;
      this.#set('offline');
      this.retryTimer = this.timers.setTimeout(() => this.#connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    };
  }

  #send(m) { try { this.ws.send(JSON.stringify(m)); } catch { /* closed: sent again on reconnecting */ } }

  async #message(ws, text) {
    if (ws !== this.ws) return;
    const m = JSON.parse(text);
    if (m.type === 'challenge') {
      if (relayTooOld(m)) { this.#outdated('old-relay'); return; }
      const sig = await this.sign(signed.auth(this.room, m.nonce));
      if (this.create && !this.created) this.#send({ type: 'create', v: PROTOCOL, owner: this.who.ownerPub, sig, links: this.create });
      else this.#send({ type: 'auth', v: PROTOCOL, link: this.who.link, sig });
    } else if (m.type === 'welcome') {
      this.created = true;
      await this.#readLinks(m.links);
      this.role = m.role;
      const since = this.safeSeq;
      this.held.length = 0; // the relay sends them again
      this.#send({ type: 'sync', since });
    } else if (m.type === 'links') {
      await this.#readLinks(m.links);
      // Someone whose link went off is no longer here.
      for (const [sid, p] of this.people) if (!this.#canBeHere(p.by)) this.people.delete(sid);
      this.#people();
    } else if (m.type === 'presence') {
      await this.#presence(m);
    } else if (m.type === 'gone') {
      if (this.people.delete(m.sid)) this.#people();
    } else if (m.type === 'update' || m.type === 'snapshot') {
      await this.#receive(m);
    } else if (m.type === 'synced') {
      this.synced = true; this.delay = this.retryMs;
      this.seq = Math.max(this.seq, m.seq);
      this.#set('online');
      this.#sendPresence(); // others learn this person is here, and answer with theirs
      this.#flush();
      this.#maybeSnapshot();
    } else if (m.type === 'ack') {
      const sent = this.inflight.get(m.id);
      if (sent) {
        this.inflight.delete(m.id);
        if (sent.count) this.pending[sent.doc].splice(0, sent.count);
        if (sent.snapshot) this.counts[sent.doc] = 0; else if (sent.doc) this.counts[sent.doc]++;
      }
      this.seq = Math.max(this.seq, m.seq);
      this.#wake();
      this.#maybeSnapshot();
    } else if (m.type === 'error') {
      if (ENDS.has(m.code)) { this.#set('ended', m.code); this.stop(); return; }
      if (OUTDATED.has(m.code)) { this.#outdated(m.code); return; }
      // Refused, such as a full room: what was sent waits, and goes again with the next change.
      this.inflight.clear(); this.failures++; this.#wake();
      this.onStatus(this.status, m.code);
    }
  }

  async #readLinks(links) {
    const read = await readLinks(this.room, this.who.ownerPub, links, this.verify);
    if (this.links && read.n < this.links.n) return; // an older list
    this.links = read;
    // Project keys added since this side's were made, as when a link was turned off.
    const wrapped = read.wraps[this.who.link];
    if (wrapped && this.who.w) {
      await this.ready;
      this.keys = await unwrapKeys(this.room, this.who.link, this.who.w, wrapped, this.keys || keysOf(this.who));
      this.cipher.setKeys(this.keys);
      for (const m of this.held.splice(0)) await this.#receive(m);
    }
    this.onLinks(read);
  }

  // Someone else's change: only if it's signed by a link that may write that document.
  async #receive(m) {
    if (!DOCS.includes(m.doc)) return;
    const by = this.links?.links.get(m.by);
    if (!by || !WRITERS[m.doc].includes(by.role)) return;
    const num = typeof m.dev === 'string' && /^[A-Za-z0-9_-]{8,22}$/.test(m.dev) && Number.isSafeInteger(m.n) && m.n >= 1 ? { dev: m.dev, n: m.n } : null;
    // A link turned off: only changes numbered up to where the owner said it stopped. Once
    // sealed, the owner's whole copy holds all it did, and nothing from it counts.
    if (by.off && (by.sealed || (by.upTo && !(num && num.n <= (by.upTo[num.dev] ?? 0))))) return;
    const data = unb64(m.data);
    const what = m.type === 'update' ? signed.update(this.room, m.doc, data, num?.dev, num?.n) : signed.snapshot(this.room, m.doc, m.upTo, data, num?.dev, num?.n);
    if (!(await this.verify(by.pub, m.sig, what))) return;
    const key = num && `${m.by}:${num.dev}:${num.n}`;
    if (num && this.sigs.has(key) && this.sigs.get(key) !== m.sig) return; // a second change with the same number
    // One sealed with a project key this side doesn't have yet is kept until it arrives.
    let plain;
    try { plain = await this.cipher.open(m.doc, data); } catch { if (data[0] > this.cipher.count) this.held.push(m); return; }
    try { this.shared.apply(m.doc, plain, 'relay'); } catch { return; }
    if (num) this.#note(m.by, num, key, m.sig);
    if (m.type === 'update') { this.seq = Math.max(this.seq, m.seq); this.counts[m.doc]++; }
    else { this.seq = Math.max(this.seq, m.upTo); this.counts[m.doc] = 0; }
  }

  #note(by, { dev, n }, key, sig) {
    this.sigs.set(key, sig);
    if (this.sigs.size > 100_000) this.sigs.delete(this.sigs.keys().next().value);
    if (by === 'owner') return;
    const devs = this.seen[by] ||= {};
    const last = Math.max(devs[dev] ?? 0, n);
    delete devs[dev]; devs[dev] = last; // newest last
    const all = Object.keys(devs);
    if (all.length > DEVICES) delete devs[all[0]];
  }

  #schedule() {
    if (this.flushTimer || !this.synced) return;
    this.flushTimer = this.timers.setTimeout(() => { this.flushTimer = 0; this.#flush(); }, this.flushMs);
  }

  // Sends what's waiting, one message per document. On reconnecting, what was sent but not
  // kept goes again: Yjs ignores changes it already has.
  async #flush() {
    if (!this.synced || !this.role) return;
    if (this.flushing) { this.again = true; return; }
    this.flushing = true;
    try { await this.#flushNow(); } finally { this.flushing = false; }
    if (this.again) { this.again = false; this.#flush(); }
  }
  async #flushNow() {
    const ws = this.ws;
    for (const doc of DOCS) {
      if (this.ws !== ws || !this.synced) return; // reconnecting: it all goes again after
      const list = this.pending[doc];
      const waiting = [...this.inflight.values()].filter((s) => s.doc === doc).reduce((n, s) => n + s.count, 0);
      const fresh = list.length - waiting;
      if (fresh <= 0 || (this.holding && HELD.has(doc))) continue;
      if (!WRITERS[doc].includes(this.role)) { list.length = 0; continue; } // not this link's to change
      const merged = Y.mergeUpdates(list.slice(waiting));
      const data = await this.cipher.seal(doc, merged);
      const n = ++this.n, sig = await this.sign(signed.update(this.room, doc, data, this.dev, n));
      if (this.ws !== ws || !this.synced) return;
      const id = this.nextId++;
      this.inflight.set(id, { doc, count: fresh });
      this.#send({ type: 'update', doc, id, dev: this.dev, n, data: b64(data), sig });
    }
  }

  async #maybeSnapshot() {
    if (!this.synced || this.snapshotting) return;
    for (const doc of DOCS) {
      if (this.counts[doc] < this.snapshotEvery || !WRITERS[doc].includes(this.role) || this.pending[doc].length || this.inflight.size) continue;
      this.snapshotting = true;
      try {
        const upTo = this.seq, ws = this.ws;
        const data = await this.cipher.seal(doc, this.shared.update(doc));
        const n = ++this.n, sig = await this.sign(signed.snapshot(this.room, doc, upTo, data, this.dev, n));
        if (this.ws !== ws || !this.synced) return;
        const id = this.nextId++;
        this.inflight.set(id, { doc, count: 0, snapshot: true });
        this.#send({ type: 'snapshot', doc, upTo, id, dev: this.dev, n, data: b64(data), sig });
      } finally { this.snapshotting = false; }
      return;
    }
  }
}
