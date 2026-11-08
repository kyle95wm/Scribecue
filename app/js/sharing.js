// What this browser knows about shared projects: for each one it shares or has joined, the
// keys to reach it on the relay. Kept in this browser's storage, like API keys, so a project
// opens again without its password.
import { newOwner, newLink, openBox, signLinks, parseLink, linkUrl, ROLES } from './sharekeys.js';
import { fetchBox } from './relayclient.js';

// The relay runs locally until it's deployed. A developer setting points elsewhere.
export const DEFAULT_RELAY = 'ws://127.0.0.1:8787';
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
// The owner's signed list, as the relay and others need it.
export const signedLinks = (r) => signLinks({ room: r.room, ownerPriv: r.priv }, r.n, r.links);
export const linksOf = (r, base) => (r.links || []).map((l) => ({ id: l.id, role: l.role, url: linkUrl(base, r.room, l.id, l.secret) }));

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
