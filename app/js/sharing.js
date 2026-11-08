// What this browser knows about shared projects: for each one it shares or has joined, the
// keys to reach it on the relay. Kept in this browser's storage, like API keys, so a project
// opens again without its password.
import { newOwner, newLink, openBox, signLinks, parseLink, linkUrl, ROLES } from './sharekeys.js';
import { fetchBox } from './relayclient.js';

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
  return { relay, room: owner.room, link: 'owner', role: 'owner', priv: owner.ownerPriv, ownerPub: owner.ownerPub, projectKey: owner.projectKey, project, links, n: 1, created: false };
}
// One link per role: a new one for a role replaces the old, which stops working. Each change
// to the list counts up, so the relay and others can tell the newest. A link turned off stays
// on the list, marked off, so the changes it made still count; only its key to check them is
// kept.
const turnOff = (l) => (l.off ? l : { id: l.id, role: l.role, pub: l.pub, off: true });
export async function addLink(record, role, password, opts) {
  const link = await newLink({ room: record.room, projectKey: record.projectKey, ownerPub: record.ownerPub, project: record.project }, role, password, opts);
  return { ...record, n: record.n + 1, links: [...record.links.map((l) => (l.role === role ? turnOff(l) : l)), link] };
}
export const removeLink = (record, id) => ({ ...record, n: record.n + 1, links: record.links.map((l) => (l.id === id ? turnOff(l) : l)) });

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
export const signedLinks = (r) => signLinks({ room: r.room, ownerPriv: r.priv }, r.n, r.links);
export const linksOf = (r, base) => (r.links || []).filter((l) => !l.off).map((l) => ({ id: l.id, role: l.role, url: linkUrl(base, r.room, l.id, l.secret) }));

// The keys a connection signs in with.
export const who = (r) => ({ link: r.link, priv: r.priv, ownerPub: r.ownerPub, projectKey: r.projectKey });

// Joins from a link with its password. Rejects with 'bad-link', 'no-link' (turned off),
// 'wrong-password' or 'offline'.
export async function joinShare(hash, password, relay, { fetch = fetchBox, ...opts } = {}) {
  const l = parseLink(hash);
  if (!l) throw new Error('bad-link');
  const { role, box } = await fetch(relay, l.room, l.id);
  const opened = await openBox({ room: l.room, id: l.id, secret: l.secret, role, box }, password, opts);
  return { relay, room: l.room, link: l.id, secret: l.secret, role, priv: opened.priv, ownerPub: opened.ownerPub, projectKey: opened.projectKey, project: opened.project };
}
