// The shared copy of a project, for working on it with others: its blocks and comments in a
// Yjs document. The app keeps its own blocks as before. Edits are copied in as they happen,
// and changes from others come back out as plain blocks to put in the script.
// Block text is shared text, so two people typing in one block merge letter by letter.
// Times, voice and other settings take the latest change. Record mode's pickups, readings
// and the video stay on each computer.
import * as Y from '../vendor/yjs.js';
import { cleanComments } from './comments.js';
import { cleanBookmarks } from './bookmarks.js';

export const LOCAL = 'local';
export const SHARED_FIELDS = ['start', 'end', 'speed', 'voice', 'dip', 'dipBy', 'vol', 'auto', 'fit', 'pinned', 'say', 'extended', 'notes', 'edited'];
// What's shared about a block, as plain values: what a change is compared by.
const shareable = (b) => {
  const o = { text: b.text || '' };
  for (const k of SHARED_FIELDS) if (b[k] !== undefined && b[k] !== null && b[k] !== false) o[k] = b[k];
  return o;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Changes `text` into `next` with the fewest edits at one place, so letters typed elsewhere
// by someone else at the same time survive.
export function retype(text, next) {
  const was = text.toString();
  if (was === next) return;
  let start = 0;
  while (start < was.length && start < next.length && was[start] === next[start]) start++;
  let end = 0;
  while (end < was.length - start && end < next.length - start && was[was.length - 1 - end] === next[next.length - 1 - end]) end++;
  if (was.length - start - end) text.delete(start, was.length - start - end);
  if (next.length - start - end) text.insert(start, next.slice(start, next.length - end));
}

const commentOrder = (a, z) => a.created.localeCompare(z.created) || a.id.localeCompare(z.id);
const plainComments = (list, timed) => cleanComments(list.map(({ block, ...c }) => c).sort(commentOrder), timed);

// The project is three Yjs documents, so the sharing service can tell who may change what:
// `script` holds the blocks, `comments` the comments, and `review` reviewers' suggested
// block changes, waiting in Pending review. Those who can edit write all three; reviewers
// the last two; commenters only comments.
export const DOCS = ['script', 'comments', 'review'];
// A block as it's compared: what's shared, without who changed it last.
const body = (b) => { const { edited, ...rest } = shareable(b); return rest; };

export class SharedProject {
  constructor() {
    this.docs = { script: new Y.Doc(), comments: new Y.Doc(), review: new Y.Doc() };
    this.blocks = this.docs.script.getMap('blocks');
    // Shared with the project: `googleKey`, a separate Google key the owner lets others read
    // Google voices with, and `voice`, the voice the project reads with. In the script, so
    // only those who can edit change it; the app lets only the owner.
    this.access = this.docs.script.getMap('access');
    // The writers' bookmarks, by id. In the script, so only those who can edit change them.
    this.bookmarks = this.docs.script.getMap('bookmarks');
    this.comments = this.docs.comments.getMap('comments');
    // By block uid: { uid, by (link id), name, who (editor id), at, block (null: remove it) }.
    this.proposals = this.docs.review.getMap('proposals');
  }

  // Copies blocks and comments in, as this person's change. `only` is a list of block uids
  // to check; leave it out to check them all, including blocks and comments that went.
  // Returns how many blocks and comments changed.
  // `script: false` leaves the blocks alone, for those who can't change them. `bookmarks`,
  // when given, is the whole list of bookmarks, and goes with the script.
  write(blocks, timeline = [], only = null, { script = true, bookmarks = null } = {}) {
    let n = 0;
    const list = only ? blocks.filter((b) => only.includes(b.uid)) : blocks;
    if (script) this.docs.script.transact(() => {
      for (const b of list) n += this.#writeBlock(b);
      if (!only) {
        const kept = new Set(blocks.map((b) => b.uid));
        for (const uid of [...this.blocks.keys()]) if (!kept.has(uid)) { this.blocks.delete(uid); n++; }
      }
      if (bookmarks) {
        const wanted = new Map(bookmarks.map((b) => [b.id, { id: b.id, time: b.time, title: b.title, notes: b.notes, kind: b.kind }]));
        for (const [id, b] of wanted) if (!same(this.bookmarks.get(id), b)) { this.bookmarks.set(id, b); n++; }
        for (const id of [...this.bookmarks.keys()]) if (!wanted.has(id)) { this.bookmarks.delete(id); n++; }
      }
    }, LOCAL);
    this.docs.comments.transact(() => {
      const wanted = new Map();
      for (const b of list) for (const c of b.comments || []) wanted.set(c.id, { ...c, block: b.uid });
      if (!only) for (const c of timeline) wanted.set(c.id, { ...c, block: null });
      for (const [id, c] of wanted) if (!same(this.comments.get(id), c)) { this.comments.set(id, c); n++; }
      // A comment goes when it's gone from the blocks checked, or from the whole project.
      for (const [id, c] of [...this.comments.entries()]) {
        if (wanted.has(id)) continue;
        if (!only || (c.block && only.includes(c.block))) { this.comments.delete(id); n++; }
      }
    }, LOCAL);
    return n;
  }
  #writeBlock(b) {
    let m = this.blocks.get(b.uid), n = 0;
    if (!m) {
      m = new Y.Map();
      m.set('text', new Y.Text());
      this.blocks.set(b.uid, m);
      n++;
    }
    const want = shareable(b);
    if (m.get('text').toString() !== want.text) { retype(m.get('text'), want.text); n++; }
    for (const k of SHARED_FIELDS) {
      if (k in want) { if (!same(m.get(k), want[k])) { m.set(k, want[k]); n++; } }
      else if (m.has(k)) { m.delete(k); n++; }
    }
    return n;
  }

  // A reviewer's block changes, as suggestions rather than changes to the script: each block
  // that differs from the script's gets one, and one that's back as it was loses it. Without
  // `only`, blocks gone from the list are suggested for removal. `me`: { link, name, who }.
  propose(blocks, only, me, at = new Date().toISOString()) {
    const list = only ? blocks.filter((b) => only.includes(b.uid)) : blocks;
    const uids = only || [...new Set([...this.blocks.keys(), ...blocks.map((b) => b.uid)])];
    const script = this.readBlocks(uids), wanted = new Map(list.map((b) => [b.uid, body(b)]));
    if (!only) for (const uid of this.blocks.keys()) if (!wanted.has(uid)) wanted.set(uid, null);
    let n = 0;
    this.docs.review.transact(() => {
      for (const [uid, want] of wanted) {
        const was = script.get(uid), old = this.proposals.get(uid);
        const unchanged = want ? !!was && same(body(was), want) : !was;
        if (unchanged) { if (old?.by === me.link) { this.proposals.delete(uid); n++; } continue; }
        if (old && old.by === me.link && same(old.block, want)) continue;
        this.proposals.set(uid, { uid, by: me.link, name: me.name || '', at, ...(me.who ? { who: me.who } : {}), block: want });
        n++;
      }
    }, LOCAL);
    return n;
  }
  readProposals() { return [...this.proposals.values()]; }
  // This person's suggestions, by block uid: the block, or null to remove it.
  myProposals(link) { return new Map([...this.proposals.values()].filter((p) => p.by === link).map((p) => [p.uid, p.block])); }
  clearProposals(uids) { this.docs.review.transact(() => { for (const uid of uids) this.proposals.delete(uid); }, LOCAL); }

  // Some blocks as plain values, by uid: null for a block that's gone. With their comments.
  readBlocks(uids) {
    const byBlock = new Map(uids.map((uid) => [uid, []]));
    for (const c of this.comments.values()) if (c.block && byBlock.has(c.block)) byBlock.get(c.block).push(c);
    return new Map(uids.map((uid) => {
      const m = this.blocks.get(uid);
      if (!m) return [uid, null];
      const b = { uid, text: m.get('text').toString() };
      for (const k of SHARED_FIELDS) if (m.has(k)) b[k] = m.get(k);
      const comments = plainComments(byBlock.get(uid), false);
      if (comments.length) b.comments = comments;
      return [uid, b];
    }));
  }
  readTimeline() { return plainComments([...this.comments.values()].filter((c) => !c.block), true); }
  readBookmarks() { return cleanBookmarks([...this.bookmarks.values()]); }

  // The owner's separate Google key for this project, or ''. Setting '' takes it out.
  googleKey() { return this.#access('googleKey'); }
  setGoogleKey(key) { this.#setAccess('googleKey', key); }
  // Calls `fn(key)` when the key changes, from anyone. Returns a function that stops it.
  onGoogleKey(fn) { return this.#onAccess('googleKey', fn); }
  // The project's voice, as the owner chose it in Settings, or ''. Others read with it.
  voice() { return this.#access('voice'); }
  setVoice(uri) { this.#setAccess('voice', uri); }
  onVoice(fn) { return this.#onAccess('voice', fn); }
  // The project's name, as the owner has it, or ''. Others list the project by it.
  name() { return this.#access('name'); }
  setName(name) { this.#setAccess('name', String(name || '').slice(0, 200)); }
  onName(fn) { return this.#onAccess('name', fn); }
  #access(k) { const v = this.access.get(k); return typeof v === 'string' ? v : ''; }
  #setAccess(k, v) {
    if (this.#access(k) === (v || '')) return;
    this.docs.script.transact(() => { if (v) this.access.set(k, v); else this.access.delete(k); }, LOCAL);
  }
  #onAccess(k, fn) {
    const h = (e) => { if (e.keysChanged.has(k)) fn(this.#access(k)); };
    this.access.observe(h);
    return () => this.access.unobserve(h);
  }

  // The blocks and comments as plain values, in time order, as the app keeps them.
  read() {
    const byBlock = new Map(), timeline = [];
    for (const c of this.comments.values()) {
      if (c.block) { if (!byBlock.has(c.block)) byBlock.set(c.block, []); byBlock.get(c.block).push(c); }
      else timeline.push(c);
    }
    const blocks = [...this.blocks.entries()].map(([uid, m]) => {
      const b = { uid, text: m.get('text').toString() };
      for (const k of SHARED_FIELDS) if (m.has(k)) b[k] = m.get(k);
      const comments = plainComments(byBlock.get(uid) || [], false);
      if (comments.length) b.comments = comments;
      return b;
    }).sort((a, z) => a.start - z.start || a.uid.localeCompare(z.uid));
    return { blocks, comments: plainComments(timeline, true), bookmarks: this.readBookmarks() };
  }

  // Calls `fn(uids, timeline, suggestions, bookmarks)` with the uids of blocks changed by
  // someone else, whether timeline comments changed, whether it's suggestions that changed,
  // and whether bookmarks did. A block whose comments changed counts as changed.
  observe(fn) {
    const handler = (events, tx) => {
      if (tx.origin === LOCAL) return;
      const uids = new Set();
      let timeline = false;
      for (const e of events) {
        if (e.target === this.blocks) for (const k of e.keysChanged) uids.add(k);
        else if (e.target === this.comments) {
          for (const k of e.keysChanged) {
            for (const c of [this.comments.get(k), e.changes.keys.get(k)?.oldValue]) {
              if (c?.block) uids.add(c.block); else if (c) timeline = true;
            }
          }
        } else {
          // Inside a block: its map, or its text. A type in a map knows its key.
          let t = e.target;
          while (t && t.parent !== this.blocks) t = t.parent;
          if (t?._item?.parentSub) uids.add(t._item.parentSub);
        }
      }
      fn([...uids], timeline, false);
    };
    const onComments = (e, tx) => handler([e], tx); // the comments document's own changes
    // Suggestions: the blocks they're for, and that they changed.
    const onProposals = (e, tx) => { if (tx.origin !== LOCAL) fn([...e.keysChanged], false, true); };
    const onBookmarks = (e, tx) => { if (tx.origin !== LOCAL) fn([], false, false, true); };
    this.blocks.observeDeep(handler);
    this.comments.observe(onComments);
    this.proposals.observe(onProposals);
    this.bookmarks.observe(onBookmarks);
    return () => { this.blocks.unobserveDeep(handler); this.comments.unobserve(onComments); this.proposals.unobserve(onProposals); this.bookmarks.unobserve(onBookmarks); };
  }

  // Undo and redo of this person's own changes only: others' changes stay. `step()` starts
  // a step and returns where it starts; until the next, typing a sentence stays one step.
  // `undoTo(mark)` undoes back to it and says how far, for `redo` to go forward again.
  undoer() {
    const scope = { script: [this.blocks, this.bookmarks], comments: this.comments, review: this.proposals };
    const managers = Object.fromEntries(DOCS.map((d) => [d, new Y.UndoManager(scope[d], { trackedOrigins: new Set([LOCAL]), captureTimeout: Infinity })]));
    const each = (fn) => Object.fromEntries(DOCS.map((d) => [d, fn(managers[d], d)]));
    return {
      step: () => each((um) => { um.stopCapturing(); return um.undoStack.length; }),
      undoTo: (mark) => each((um, d) => { let n = 0; while (um.undoStack.length > mark[d] && um.undo()) n++; return n; }),
      redo: (counts) => each((um, d) => { let n = 0; while (n < counts[d] && um.redo()) n++; return n; }),
      depth: () => each((um) => um.undoStack.length),
      clear: () => each((um) => um.clear()),
    };
  }

  // A document's whole state, or changes to it, as Yjs updates.
  update(doc) { return Y.encodeStateAsUpdate(this.docs[doc]); }
  apply(doc, update, origin = 'remote') { Y.applyUpdate(this.docs[doc], update, origin); }
  // Calls `fn(doc, update, origin)` for every change to either document.
  onUpdate(fn) {
    const off = DOCS.map((d) => { const h = (u, origin) => fn(d, u, origin); this.docs[d].on('update', h); return () => this.docs[d].off('update', h); });
    return () => off.forEach((f) => f());
  }
}

// Links the shared copies of the same project in this browser's other tabs: the stand-in for
// the sharing service until it exists. A tab that opens asks the others for their copy and
// waits up to `wait` ms: `ready` says whether one came. It only answers others once ready,
// so an empty copy is never handed on.
export function linkTabs(shared, name, { Channel = globalThis.BroadcastChannel, wait = 400 } = {}) {
  if (!Channel) return { ready: Promise.resolve(false), stop: () => {} };
  const channel = new Channel(`scribecue-shared:${name}`);
  const send = (type, doc, update) => { try { channel.postMessage({ type, doc, update }); } catch { /* closed */ } };
  let answering = false, joined;
  const ready = new Promise((resolve) => { joined = resolve; setTimeout(() => resolve(false), wait); })
    .then((got) => { answering = true; return got; });
  const off = shared.onUpdate((doc, update, origin) => { if (origin !== 'remote') send('update', doc, update); });
  channel.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hello') { if (answering) try { channel.postMessage({ type: 'state', updates: DOCS.map((d) => shared.update(d)) }); } catch { /* closed */ } }
    else if (data.type === 'update' && DOCS.includes(data.doc) && data.update instanceof Uint8Array) {
      try { shared.apply(data.doc, data.update); } catch { /* a damaged update changes nothing */ }
    } else if (data.type === 'state' && Array.isArray(data.updates) && data.updates.length === DOCS.length && data.updates.every((u) => u instanceof Uint8Array)) {
      try { DOCS.forEach((d, i) => shared.apply(d, data.updates[i])); } catch { return; }
      joined(true);
    }
  };
  send('hello');
  return { ready, stop: () => { off(); channel.close(); } };
}
