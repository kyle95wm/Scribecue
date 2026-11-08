// The shared copy of a project, for working on it with others: its blocks and comments in a
// Yjs document. The app keeps its own blocks as before. Edits are copied in as they happen,
// and changes from others come back out as plain blocks to put in the script.
// Block text is shared text, so two people typing in one block merge letter by letter.
// Times, voice and other settings take the latest change. Record mode's pickups, readings
// and the video stay on each computer.
import * as Y from '../vendor/yjs.js';
import { cleanComments } from './comments.js';

export const LOCAL = 'local';
const FIELDS = ['start', 'end', 'speed', 'voice', 'dip', 'dipBy', 'vol', 'auto', 'fit', 'pinned', 'say', 'extended', 'notes', 'edited'];
// What's shared about a block, as plain values: what a change is compared by.
const shareable = (b) => {
  const o = { text: b.text || '' };
  for (const k of FIELDS) if (b[k] !== undefined && b[k] !== null && b[k] !== false) o[k] = b[k];
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

export class SharedProject {
  constructor(doc = new Y.Doc()) {
    this.doc = doc;
    this.blocks = doc.getMap('blocks');
    this.comments = doc.getMap('comments');
  }

  // Copies blocks and comments in, as this person's change. `only` is a list of block uids
  // to check; leave it out to check them all, including blocks and comments that went.
  // Returns how many blocks and comments changed.
  write(blocks, timeline = [], only = null) {
    let n = 0;
    this.doc.transact(() => {
      const list = only ? blocks.filter((b) => only.includes(b.uid)) : blocks;
      for (const b of list) n += this.#writeBlock(b);
      const wanted = new Map();
      for (const b of list) for (const c of b.comments || []) wanted.set(c.id, { ...c, block: b.uid });
      if (!only) {
        const kept = new Set(blocks.map((b) => b.uid));
        for (const uid of [...this.blocks.keys()]) if (!kept.has(uid)) { this.blocks.delete(uid); n++; }
        for (const c of timeline) wanted.set(c.id, { ...c, block: null });
      }
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
    for (const k of FIELDS) {
      if (k in want) { if (!same(m.get(k), want[k])) { m.set(k, want[k]); n++; } }
      else if (m.has(k)) { m.delete(k); n++; }
    }
    return n;
  }

  // The blocks and comments as plain values, in time order, as the app keeps them.
  read() {
    const byBlock = new Map(), timeline = [];
    for (const c of this.comments.values()) {
      if (c.block) { if (!byBlock.has(c.block)) byBlock.set(c.block, []); byBlock.get(c.block).push(c); }
      else timeline.push(c);
    }
    const order = (a, z) => a.created.localeCompare(z.created) || a.id.localeCompare(z.id);
    const plain = (list, timed) => cleanComments(list.map(({ block, ...c }) => c).sort(order), timed);
    const blocks = [...this.blocks.entries()].map(([uid, m]) => {
      const b = { uid, text: m.get('text').toString() };
      for (const k of FIELDS) if (m.has(k)) b[k] = m.get(k);
      const comments = plain(byBlock.get(uid) || [], false);
      if (comments.length) b.comments = comments;
      return b;
    }).sort((a, z) => a.start - z.start || a.uid.localeCompare(z.uid));
    return { blocks, comments: plain(timeline, true) };
  }

  // Calls `fn` with the uids of blocks changed by someone else, and whether timeline
  // comments changed. A block whose comments changed counts as changed.
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
      fn([...uids], timeline);
    };
    const onComments = (e, tx) => handler([e], tx);
    this.blocks.observeDeep(handler);
    this.comments.observe(onComments);
    return () => { this.blocks.unobserveDeep(handler); this.comments.unobserve(onComments); };
  }

  update() { return Y.encodeStateAsUpdate(this.doc); }
  apply(update, origin = 'remote') { Y.applyUpdate(this.doc, update, origin); }
}
