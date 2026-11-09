// What this browser knows about shared projects: for each one it shares or has joined, the
// keys to reach it on the relay. Kept in this browser's storage, like API keys, so a project
// opens again without its password.
// It loads without Yjs: the shared copy and the connection (shared.js, relayclient.js) load
// only for a project that's shared.
import { newOwner, newLink, openBox, signLinks, parseLink, linkUrl, newProjectKey, keysOf, MAX_KEYS, ROLES, versionWith, relayTooOld, recoveryKey, openRecovery, readLinks, b64 } from './sharekeys.js';

// Scribecue's relay. A developer setting points elsewhere, such as ws://127.0.0.1:8787 for
// one run locally with `npm run dev` in relay/.
export const DEFAULT_RELAY = 'wss://share.kyleadvoice.ca';
export function relayUrl(storage = globalThis.localStorage) {
  try { return storage.getItem('scribecue.relay') || DEFAULT_RELAY; } catch { return DEFAULT_RELAY; }
}

// The web version. A link made at an address only this computer can open, such as Docker's
// localhost, points here instead, so the people it's sent to can open it. Only with the
// usual relay: the web version wouldn't find a project on another one.
export const WEB_APP = 'https://scribecue.kyleadvoice.ca/';
const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|.+\.localhost)$/i;
export function linkBase(href, relay = relayUrl()) {
  let u;
  try { u = new URL(href); } catch { return href; }
  return LOCAL.test(u.hostname) && relay === DEFAULT_RELAY ? WEB_APP : href;
}
export const linksGoToWeb = (href, relay) => linkBase(href, relay) === WEB_APP && !String(href).startsWith(WEB_APP);

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

// When a link made now stops working, `days` from now; null for never.
export const DAY = 86_400_000;
export const MAX_DAYS = 365;
export const expiryIn = (days, now = Date.now()) => (Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? now + days * DAY : null);
const dated = (link, expires) => (Number.isSafeInteger(expires) ? { ...link, expires } : link);
export const isExpired = (l, now = Date.now()) => Number.isSafeInteger(l.expires) && now >= l.expires;

// Starts sharing a project: a room, and a link for each role given a password.
// `passwords`: { edit, review, comment }, each a password or left out for no link.
// `expires`: for each role, when its link stops working, if it does.
export async function startSharing(project, relay, passwords, opts, expires = {}) {
  const owner = await newOwner(project);
  const links = [];
  for (const role of ROLES) if (typeof passwords[role] === 'string') links.push(dated(await newLink(owner, role, passwords[role], opts), expires[role]));
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
export async function addLink(record, role, password, opts, seen = null, expires = null) {
  const replaces = record.links.some((l) => l.role === role && !l.off);
  const next = replaces ? withNewKey(record) : record;
  const link = dated(await newLink({ room: next.room, keys: keysOf(next), ownerPub: next.ownerPub, project: next.project }, role, password, opts), expires);
  return { ...next, n: next.n + 1, links: [...next.links.map((l) => (l.role === role ? turnOff(l, seen) : l)), link] };
}
export function removeLink(record, id, seen = null) {
  const next = withNewKey(record);
  return { ...next, n: next.n + 1, links: next.links.map((l) => (l.id === id ? turnOff(l, seen) : l)) };
}
// Links that have expired, turned off as if by hand, so they can't read anything new. The
// relay already refuses them; this makes it so whatever the relay does. The same record if
// none has.
export function expireLinks(record, now = Date.now(), seen = null) {
  const ids = record.links.filter((l) => !l.off && isExpired(l, now)).map((l) => l.id);
  if (!ids.length) return record;
  const next = withNewKey(record);
  // It keeps when it expired, so someone opening it is told that rather than that it was
  // turned off.
  return { ...next, n: next.n + 1, links: next.links.map((l) => (ids.includes(l.id) ? { ...turnOff(l, seen), expires: l.expires } : l)) };
}
// When the next link expires, if one does.
export function nextExpiry(record) {
  const times = record.links.filter((l) => !l.off && Number.isSafeInteger(l.expires)).map((l) => l.expires);
  return times.length ? Math.min(...times) : null;
}

// What opening a link does, given what this browser keeps for its room (shareForRoom) and
// the project open here. 'join': ask for its password. 'switch': ask, to open the project
// kept here with this link instead, which decides what this person can do from then on.
// 'same': it's already open with this link. 'reopen': it's kept here with this link, and
// opens again without its password. 'own': the owner's own project, which stays
// theirs: joining would make them someone else's reviewer or editor.
export function linkAction(found, projectId, l) {
  if (!found) return 'join';
  if (found.record.link === 'owner') return 'own';
  if (found.record.link === l.id) return found.project === projectId ? 'same' : 'reopen';
  return 'switch';
}

// The shared projects kept in this browser: those it owns, those of them without a recovery
// link, and those joined with someone else's link.
export function sharesHere(storage = globalThis.localStorage) {
  const n = { owned: 0, unrecovered: 0, joined: 0 };
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k?.startsWith('scribecue.share.')) continue;
      const r = getShare(k.slice('scribecue.share.'.length), storage);
      if (!r) continue;
      if (r.link !== 'owner') n.joined++;
      else { n.owned++; if (!r.recovery) n.unrecovered++; }
    }
  } catch { /* blocked */ }
  return n;
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
export const signedLinks = (r) => signLinks({ room: r.room, ownerPriv: r.priv, ownerPub: r.ownerPub, keys: keysOf(r), ow: r.ow, project: r.project, recovery: r.recovery }, r.n, r.links);

// The recovery link: opens the project as its owner, here or in another browser, if this
// one's storage is lost. Its password needs more than a link's, since it can do more.
export const RECOVERY_MIN = 10;
export async function addRecovery(record, password, opts) {
  const id = b64(crypto.getRandomValues(new Uint8Array(9))), secret = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { ...record, n: record.n + 1, recovery: { id, secret, rk: await recoveryKey(record.room, id, secret, password, opts) } };
}
export function removeRecovery(record) {
  const { recovery, ...rest } = record;
  return recovery ? { ...rest, n: record.n + 1 } : record;
}
export const recoveryUrl = (r, base) => (r.recovery ? linkUrl(base, r.room, r.recovery.id, r.recovery.secret) : null);
// The owner's record, rebuilt from the signed list and what the recovery box holds.
function fromRecovery(relay, room, recovery, inside, list) {
  const links = list.links.map((l) => {
    const s = !l.off && inside.l?.[l.id];
    return s ? { ...l, secret: s.s, ...(s.w ? { w: s.w } : {}), ...(Number.isSafeInteger(s.f) ? { from: s.f } : {}) } : { ...l };
  });
  const keys = [inside.k].flat();
  return { relay, room, link: 'owner', role: 'owner', priv: inside.sk, ownerPub: inside.pub, projectKey: keys[0], keys, ...(inside.ow ? { ow: inside.ow } : {}), project: inside.p || null, links, n: list.n, created: true, recovery };
}
async function recover(relay, l, password, box, signed, opts) {
  const rk = await recoveryKey(l.room, l.id, l.secret, password, opts);
  const inside = await openRecovery(l.room, l.id, rk, box);
  // The list must be the owner's own, and hold this box.
  const read = await readLinks(l.room, inside.pub, signed);
  if (read.recovery?.id !== l.id) throw new Error('no-link');
  return fromRecovery(relay, l.room, { id: l.id, secret: l.secret, rk }, inside, read.list);
}
// Another browser of the owner's changed the links: this one takes the newer list, with
// the secrets of links made there, from the recovery box. Null if it can't.
// Whatever its number: changes made apart, in each browser, are both kept (see mergeApart).
// Resolves { record, changed, dropped }, or null when the relay's list holds nothing this
// one lacks, or isn't this owner's.
export async function rebaseLinks(record, signed) {
  if (!record?.recovery || record.link !== 'owner') return null;
  try {
    const read = await readLinks(record.room, record.ownerPub, signed);
    if (read.recovery?.id !== record.recovery.id || !lacksFrom(record, read)) return null;
    const inside = await openRecovery(record.room, record.recovery.id, record.recovery.rk, read.recovery.box);
    if (inside.pub !== record.ownerPub) return null;
    return mergeApart(record, fromRecovery(record.relay, record.room, record.recovery, inside, read.list));
  } catch { return null; }
}

// Whether the relay's list (as readLinks reads it) has a change this record lacks: a link
// made, turned off or sealed elsewhere. Links are only ever made, turned off and sealed, in
// that order, so these are the only changes there are.
export function lacksFrom(record, read) {
  for (const [id, l] of read.links) {
    if (id === 'owner') continue;
    const mine = record.links.find((x) => x.id === id);
    if (!mine || (l.off && !mine.off) || (l.sealed && !mine.sealed)) return true;
  }
  return false;
}

// Two of the owner's browsers changed the links apart, as when one was offline. `theirs` is
// the newer list from the relay; what `mine` did meanwhile goes on top of it, rather than
// being lost:
// - a link turned off or sealed here stays so, with a new project key, as when turned off;
// - a link made here is added, and gets the keys it lacks. Its box holds this browser's
//   keys, which match theirs only up to where the two began to differ.
// - a link made here for a role the other made one for too is dropped (`dropped`), so a role
//   still has one link. It never reached the relay, so nobody can have opened it.
export function mergeApart(mine, theirs) {
  const ours = keysOf(mine), other = keysOf(theirs);
  let same = 0;
  while (same < ours.length && same < other.length && ours[same] === other[same]) same++;
  const known = new Set(theirs.links.map((l) => l.id));
  const made = mine.links.filter((l) => !l.off && !known.has(l.id));
  const dropped = made.filter((l) => theirs.links.some((r) => r.role === l.role && !r.off));
  const added = made.filter((l) => !dropped.includes(l)).map((l) => ({ ...l, from: Math.min(l.from ?? same, same) }));
  const offHere = mine.links.filter((l) => l.off && theirs.links.some((r) => r.id === l.id && !r.off)).map((l) => l.id);
  const sealedHere = mine.links.filter((l) => l.sealed && theirs.links.some((r) => r.id === l.id && r.off && !r.sealed)).map((l) => l.id);
  if (!added.length && !offHere.length && !sealedHere.length) return { record: theirs, changed: false, dropped };
  let out = offHere.length ? withNewKey(theirs) : theirs;
  out = {
    ...out,
    n: Math.max(mine.n, theirs.n) + 1,
    // Turned off here: as this browser has it, with what it had from that link, and sealed if so.
    links: [...out.links.map((l) => (offHere.includes(l.id) ? mine.links.find((x) => x.id === l.id) : sealedHere.includes(l.id) ? { ...l, sealed: true } : l)), ...added],
  };
  return { record: out, changed: true, dropped };
}
export const linksOf = (r, base, now = Date.now()) => (r.links || []).filter((l) => !l.off && !isExpired(l, now)).map((l) => ({ id: l.id, role: l.role, url: linkUrl(base, r.room, l.id, l.secret), expires: l.expires ?? null }));

// The keys a connection signs in with.
export const who = (r) => ({ link: r.link, priv: r.priv, ownerPub: r.ownerPub, projectKey: r.projectKey, keys: keysOf(r), w: r.link === 'owner' ? r.ow : r.w });

// Joins from a link with its password. Rejects with 'bad-link', 'no-link' (turned off),
// 'wrong-password' or 'offline'.
export async function joinShare(hash, password, relay, { fetch = fetchBox, ...opts } = {}) {
  const l = parseLink(hash);
  if (!l) throw new Error('bad-link');
  const { role, box, links } = await fetch(relay, l.room, l.id);
  if (role === 'owner') return recover(relay, l, password, box, links, opts);
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
        else ws.send(JSON.stringify({ type: 'box', v: versionWith(m), link: id }));
      }
      else if (m.type === 'box') done(resolve, { role: m.role, box: m.box, links: m.links });
      else if (m.type === 'error') done(reject, new Error(m.code));
    };
    ws.onclose = () => { clearTimeout(timer); reject(new Error('offline')); };
  });
}
