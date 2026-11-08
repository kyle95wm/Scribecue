// What this browser knows about shared projects: for each one it shares or has joined, the
// keys to reach it on the relay. Kept in this browser's storage, like API keys, so a project
// opens again without its password.
// It loads without Yjs: the shared copy and the connection (shared.js, relayclient.js) load
// only for a project that's shared.
import { newOwner, newLink, openBox, signLinks, parseLink, linkUrl, newProjectKey, keysOf, MAX_KEYS, ROLES, PROTOCOL, relayTooOld } from './sharekeys.js';

// Scribecue's relay. A developer setting points elsewhere, such as ws://127.0.0.1:8787 for
// one run locally with `npm run dev` in relay/.
export const DEFAULT_RELAY = 'wss://share.kyleadvoice.ca';
export function relayUrl(storage = globalThis.localStorage) {
  try { return storage.getItem('scribecue.relay') || DEFAULT_RELAY; } catch { return DEFAULT_RELAY; }
}

const key = (project) => `scribecue.share.${project}`;
export function getShare(project, storage = globalThis.localStorage) {
  try {
    const r = JSON.parse(storage.getItem(key(project)) || 'null');
    return r && typeof r.room === 'string' && typeof r.priv === 'string' ? r : null;
  } catch { return null; }
}
export function setShare(project, record, storage = globalThis.localStorage) {
  try { storage.setItem(key(project), JSON.stringify(record)); return true; } catch { return false; }
}
export function dropShare(project, storage = globalThis.localStorage) {
  try { storage.removeItem(key(project)); } catch { /* blocked */ }
}

// Starts sharing a project: a room, and a link for each role given a password.
// `passwords`: { edit, review, comment }, each a password or left out for no link.
export async function startSharing(project, relay, passwords, opts) {
  const owner = await newOwner(project);
  const links = [];
  for (const role of ROLES) if (typeof passwords[role] === 'string') links.push(await newLink(owner, role, passwords[role], opts));
  return { relay, room: owner.room, link: 'owner', role: 'owner', priv: owner.ownerPriv, ownerPub: owner.ownerPub, projectKey: owner.projectKey, keys: owner.keys, ow: owner.ow, project, links, n: 1, created: false };
}
// One link per role: a new one for a role replaces the old, which stops working. Each change
// to the list counts up, so the relay and others can tell the newest. A link turned off stays
// on the list, marked off, so the changes it made still count; only its key to check them is
// kept. Changes from then on use a new project key, which the link turned off never gets.
//
// `seen`: the last number had from each browser of each link ({ link: { dev: n } }, from
// the connection, when it's up to date). A link turned off keeps them as `upTo`: changes
// signed with higher numbers came after, and don't count. Without `seen`, as when offline,
// they're filled in by settle() before the list goes to the relay.
const turnOff = (l, seen) => (l.off ? l : { id: l.id, role: l.role, pub: l.pub, off: true, upTo: seen ? { ...(seen[l.id] || {}) } : null });
export function settle(record, seen) {
  if (!record.links.some((l) => l.off && l.upTo === null)) return record;
  return { ...record, links: record.links.map((l) => (l.off && l.upTo === null ? { ...l, upTo: { ...(seen[l.id] || {}) } } : l)) };
}
function withNewKey(record) {
  const keys = keysOf(record);
  return { ...record, keys: keys.length < MAX_KEYS ? [...keys, newProjectKey()] : keys, ow: record.ow || newProjectKey() };
}
// Links turned off, once the owner's whole copy is on the relay: it holds everything they
// did, so nothing more from them counts, whatever its number.
export const unsealed = (record) => record.links.filter((l) => l.off && l.upTo !== null && !l.sealed).map((l) => l.id);
export const sealLinks = (record, ids) => ({ ...record, n: record.n + 1, links: record.links.map((l) => (ids.includes(l.id) && l.off ? { ...l, sealed: true } : l)) });
export async function addLink(record, role, password, opts, seen = null) {
  const replaces = record.links.some((l) => l.role === role && !l.off);
  const next = replaces ? withNewKey(record) : record;
  const link = await newLink({ room: next.room, keys: keysOf(next), ownerPub: next.ownerPub, project: next.project }, role, password, opts);
  return { ...next, n: next.n + 1, links: [...next.links.map((l) => (l.role === role ? turnOff(l, seen) : l)), link] };
}
export function removeLink(record, id, seen = null) {
  const next = withNewKey(record);
  return { ...next, n: next.n + 1, links: next.links.map((l) => (l.id === id ? turnOff(l, seen) : l)) };
}

// The project that has joined or shares this room, if any, among those kept here.
export function shareForRoom(room, storage = globalThis.localStorage) {
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k?.startsWith('scribecue.share.')) continue;
      const project = k.slice('scribecue.share.'.length), r = getShare(project, storage);
      if (r?.room === room) return { project, record: r };
    }
  } catch { /* blocked */ }
  return null;
}

// The owner's signed list, as the relay and others need it.
export const signedLinks = (r) => signLinks({ room: r.room, ownerPriv: r.priv, keys: keysOf(r), ow: r.ow }, r.n, r.links);
export const linksOf = (r, base) => (r.links || []).filter((l) => !l.off).map((l) => ({ id: l.id, role: l.role, url: linkUrl(base, r.room, l.id, l.secret) }));

// The keys a connection signs in with.
export const who = (r) => ({ link: r.link, priv: r.priv, ownerPub: r.ownerPub, projectKey: r.projectKey, keys: keysOf(r), w: r.link === 'owner' ? r.ow : r.w });

// Joins from a link with its password. Rejects with 'bad-link', 'no-link' (turned off),
// 'wrong-password' or 'offline'.
export async function joinShare(hash, password, relay, { fetch = fetchBox, ...opts } = {}) {
  const l = parseLink(hash);
  if (!l) throw new Error('bad-link');
  const { role, box } = await fetch(relay, l.room, l.id);
  const opened = await openBox({ room: l.room, id: l.id, secret: l.secret, role, box }, password, opts);
  return { relay, room: l.room, link: l.id, secret: l.secret, role, priv: opened.priv, ownerPub: opened.ownerPub, projectKey: opened.projectKey, keys: opened.keys, w: opened.w, project: opened.project };
}

// A link's box, fetched before signing in. Resolves { role, box }, or rejects with the
// relay's reason ('no-link' when the link was turned off, 'old-app' or 'old-relay' when
// Scribecue or the relay needs updating) or 'offline'.
export function fetchBox(url, room, id, { WebSocket = globalThis.WebSocket, wait = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    let ws;
    const timer = setTimeout(() => { reject(new Error('offline')); try { ws.close(); } catch { /* closed */ } }, wait);
    const done = (fn, v) => { clearTimeout(timer); try { ws.close(1000, 'done'); } catch { /* closed */ } fn(v); };
    try { ws = new WebSocket(`${url.replace(/\/$/, '')}/rooms/${room}`); } catch { clearTimeout(timer); reject(new Error('offline')); return; }
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'challenge') {
        if (relayTooOld(m)) done(reject, new Error('old-relay'));
        else ws.send(JSON.stringify({ type: 'box', v: PROTOCOL, link: id }));
      }
      else if (m.type === 'box') done(resolve, { role: m.role, box: m.box });
      else if (m.type === 'error') done(reject, new Error(m.code));
    };
    ws.onclose = () => { clearTimeout(timer); reject(new Error('offline')); };
  });
}
