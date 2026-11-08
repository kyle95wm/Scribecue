// Connects a project's shared copy (shared.js) to the relay: sends this person's changes,
// encrypted and signed, and puts others' changes in once their signatures check out.
// It reconnects by itself, keeps changes made while offline until the relay has them, and
// now and then sends a whole document so the relay can drop the changes before it.
import * as Y from '../vendor/yjs.js';
import { b64, unb64, signed, signer, verifier, readLinks, projectCipher, WRITERS } from './sharekeys.js';
import { DOCS } from './shared.js';

const ENDS = new Set(['link-off', 'room-deleted', 'no-room', 'bad-signature', 'room-exists']);

export class RelayClient {
  // `who`: { link ('owner' or a link id), priv, ownerPub, projectKey }. `create`: the signed
  // links, to make the room first. `seed`: send everything already in the copy, as when
  // making the room or coming back to it; Yjs ignores what the relay already has.
  // `onStatus(status, detail)`: 'connecting', 'online',
  // 'offline' or 'ended'.
  constructor({ url, room, who, shared, create = null, seed = !!create, onStatus = () => {}, onLinks = () => {}, WebSocket = globalThis.WebSocket, snapshotEvery = 200, flushMs = 150, retryMs = 1000, connectMs = 20_000, timers = globalThis }) {
    Object.assign(this, { url, room, who, shared, create, onStatus, onLinks, WebSocket, snapshotEvery, flushMs, retryMs, connectMs, timers });
    this.seq = 0; this.role = null; this.links = null; this.status = null;
    this.pending = Object.fromEntries(DOCS.map((d) => [d, []])); // changes the relay doesn't have yet
    this.inflight = new Map(); // message id → { doc, count }
    this.counts = Object.fromEntries(DOCS.map((d) => [d, 0])); // changes since the last snapshot
    this.nextId = 1; this.delay = retryMs; this.stopped = false; this.synced = false;
    this.verify = verifier();
    this.ready = (async () => {
      this.sign = await signer(who.priv);
      this.cipher = await projectCipher(who.projectKey, room);
    })();
    if (seed) for (const d of DOCS) this.pending[d].push(shared.update(d));
    this.off = shared.onUpdate((doc, update, origin) => {
      if (origin === 'relay') return;
      this.pending[doc].push(update);
      this.#schedule();
    });
  }

  start() { this.ready.then(() => this.#connect()); return this; }
  stop() {
    this.stopped = true; this.off();
    this.timers.clearTimeout(this.flushTimer); this.timers.clearTimeout(this.retryTimer); this.timers.clearTimeout(this.connectTimer);
    try { this.ws?.close(1000, 'done'); } catch { /* closed */ }
  }
  // The owner's new list of links, or ending the project on the relay. Only when online:
  // a list sent while offline goes again on reconnecting (see onLinks in app.js).
  async sendLinks(links) {
    if (!this.synced || this.role !== 'owner') return;
    await this.#readLinks(links); // this side takes the new list at once, to accept new links' changes
    this.#send({ type: 'links', id: this.nextId++, links });
  }
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
  // Changes not yet kept by the relay.
  unsent() { return DOCS.reduce((n, d) => n + this.pending[d].length, 0); }

  #set(status, detail) { if (this.status !== status || detail) { this.status = status; this.onStatus(status, detail); } }

  #connect() {
    if (this.stopped) return;
    this.#set('connecting');
    this.synced = false; this.inflight.clear();
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
      const sig = await this.sign(signed.auth(this.room, m.nonce));
      if (this.create && !this.created) this.#send({ type: 'create', owner: this.who.ownerPub, sig, links: this.create });
      else this.#send({ type: 'auth', link: this.who.link, sig });
    } else if (m.type === 'welcome') {
      this.created = true;
      await this.#readLinks(m.links);
      this.role = m.role;
      this.#send({ type: 'sync', since: this.seq });
    } else if (m.type === 'links') {
      await this.#readLinks(m.links);
    } else if (m.type === 'update' || m.type === 'snapshot') {
      await this.#receive(m);
    } else if (m.type === 'synced') {
      this.synced = true; this.delay = this.retryMs;
      this.seq = Math.max(this.seq, m.seq);
      this.#set('online');
      this.#flush();
      this.#maybeSnapshot();
    } else if (m.type === 'ack') {
      const sent = this.inflight.get(m.id);
      if (sent) {
        this.inflight.delete(m.id);
        if (sent.count) this.pending[sent.doc].splice(0, sent.count);
        if (sent.snapshot) this.counts[sent.doc] = 0; else this.counts[sent.doc]++;
      }
      this.seq = Math.max(this.seq, m.seq);
      this.#maybeSnapshot();
    } else if (m.type === 'error') {
      if (ENDS.has(m.code)) { this.#set('ended', m.code); this.stop(); return; }
      // Refused, such as a full room: what was sent waits, and goes again with the next change.
      this.inflight.clear();
      this.onStatus(this.status, m.code);
    }
  }

  async #readLinks(links) {
    const read = await readLinks(this.room, this.who.ownerPub, links, this.verify);
    if (this.links && read.n < this.links.n) return; // an older list
    this.links = read;
    this.onLinks(read);
  }

  // Someone else's change: only if it's signed by a link that may write that document.
  async #receive(m) {
    if (!DOCS.includes(m.doc)) return;
    const by = this.links?.links.get(m.by);
    if (!by || !WRITERS[m.doc].includes(by.role)) return;
    const data = unb64(m.data);
    const what = m.type === 'update' ? signed.update(this.room, m.doc, data) : signed.snapshot(this.room, m.doc, m.upTo, data);
    if (!(await this.verify(by.pub, m.sig, what))) return;
    let plain;
    try { plain = await this.cipher.open(m.doc, data); } catch { return; }
    try { this.shared.apply(m.doc, plain, 'relay'); } catch { return; }
    if (m.type === 'update') { this.seq = Math.max(this.seq, m.seq); this.counts[m.doc]++; }
    else { this.seq = Math.max(this.seq, m.upTo); this.counts[m.doc] = 0; }
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
      if (fresh <= 0) continue;
      if (!WRITERS[doc].includes(this.role)) { list.length = 0; continue; } // not this link's to change
      const merged = Y.mergeUpdates(list.slice(waiting));
      const data = await this.cipher.seal(doc, merged);
      const sig = await this.sign(signed.update(this.room, doc, data));
      if (this.ws !== ws || !this.synced) return;
      const id = this.nextId++;
      this.inflight.set(id, { doc, count: fresh });
      this.#send({ type: 'update', doc, id, data: b64(data), sig });
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
        const sig = await this.sign(signed.snapshot(this.room, doc, upTo, data));
        if (this.ws !== ws || !this.synced) return;
        const id = this.nextId++;
        this.inflight.set(id, { doc, count: 0, snapshot: true });
        this.#send({ type: 'snapshot', doc, upTo, id, data: b64(data), sig });
      } finally { this.snapshotting = false; }
      return;
    }
  }
}

// A link's box, fetched before signing in. Resolves { role, box }, or rejects with the
// relay's reason ('no-link' when the link was turned off) or 'offline'.
export function fetchBox(url, room, id, { WebSocket = globalThis.WebSocket, wait = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    let ws;
    const timer = setTimeout(() => { reject(new Error('offline')); try { ws.close(); } catch { /* closed */ } }, wait);
    const done = (fn, v) => { clearTimeout(timer); try { ws.close(1000, 'done'); } catch { /* closed */ } fn(v); };
    try { ws = new WebSocket(`${url.replace(/\/$/, '')}/rooms/${room}`); } catch { clearTimeout(timer); reject(new Error('offline')); return; }
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'challenge') ws.send(JSON.stringify({ type: 'box', link: id }));
      else if (m.type === 'box') done(resolve, { role: m.role, box: m.box });
      else if (m.type === 'error') done(reject, new Error(m.code));
    };
    ws.onclose = () => { clearTimeout(timer); reject(new Error('offline')); };
  });
}
