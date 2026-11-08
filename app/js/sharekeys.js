// Keys for sharing a project, with the browser's own Web Crypto: nothing here leaves this
// computer unencrypted.
//
// - The project key (AES-GCM) encrypts every change. The relay never has it.
// - The owner key (Ed25519) signs the list of links and the owner's changes.
// - Each link has its own key (Ed25519) to sign in and sign its changes, and a box: the
//   project key, the link's key and the owner's public key, encrypted with a key made from
//   the link's secret and its password (PBKDF2). The secret is in the link after `#`, so
//   browsers never send it; the relay keeps the box and hands it to whoever asks for it.
// The relay checks the same signatures (relay/src/room.js): `signed` must match it.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();
export const ITERATIONS = 600_000;

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
const random = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));
const join = (label, bytes) => {
  const head = enc.encode(label), out = new Uint8Array(head.length + bytes.length);
  out.set(head); out.set(bytes, head.length);
  return out;
};
export const signed = {
  auth: (room, nonce) => enc.encode(`scribecue-relay:auth:${room}:${nonce}`),
  update: (room, doc, data) => join(`scribecue-relay:update:${room}:${doc}:`, data),
  snapshot: (room, doc, upTo, data) => join(`scribecue-relay:snapshot:${room}:${doc}:${upTo}:`, data),
  links: (text) => enc.encode(`scribecue-relay:links:${text}`),
};
// Who may write each document. The relay refuses other writes; clients check again.
export const WRITERS = {
  script: ['owner', 'edit'],
  comments: ['owner', 'edit', 'review', 'comment'],
  review: ['owner', 'edit', 'review'],
};
export const ROLES = ['edit', 'review', 'comment'];

async function newSigningKey() {
  const k = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return { pub: b64(new Uint8Array(await subtle.exportKey('raw', k.publicKey))), priv: b64(new Uint8Array(await subtle.exportKey('pkcs8', k.privateKey))) };
}

// A new shared project: its room on the relay, the owner's key and the project key.
// `project` is the project's id, which people who join take too.
export async function newOwner(project = null) {
  const owner = await newSigningKey();
  return { room: random(16), ownerPub: owner.pub, ownerPriv: owner.priv, projectKey: random(32), project };
}

const boxLabel = (room, id, role) => enc.encode(`scribecue-box:${room}:${id}:${role}`);
async function boxKey(room, id, secret, password, iterations) {
  const material = await subtle.importKey('raw', join(`${secret}:`, enc.encode(password.normalize('NFC'))), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`scribecue-link:${room}:${id}`), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// A new link for `role`, locked with `password`. The owner keeps `secret` to show the link
// again; the relay gets { id, role, pub, box }.
export async function newLink(owner, role, password, { iterations = ITERATIONS } = {}) {
  if (!ROLES.includes(role)) throw new Error('unknown role');
  const id = random(9), secret = random(16), key = await newSigningKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const inside = enc.encode(JSON.stringify({ k: owner.projectKey, sk: key.priv, owner: owner.ownerPub, p: owner.project || null }));
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: boxLabel(owner.room, id, role) }, await boxKey(owner.room, id, secret, password, iterations), inside));
  return { id, secret, role, pub: key.pub, box: b64(new Uint8Array([...iv, ...sealed])) };
}

// Opens a link's box with its secret and password. Throws 'wrong-password' if they don't fit.
export async function openBox({ room, id, secret, role, box }, password, { iterations = ITERATIONS } = {}) {
  const bytes = unb64(box);
  try {
    const inside = await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: boxLabel(room, id, role) }, await boxKey(room, id, secret, password, iterations), bytes.subarray(12));
    const o = JSON.parse(dec.decode(inside));
    return { projectKey: o.k, priv: o.sk, ownerPub: o.owner, project: o.p || null };
  } catch { throw new Error('wrong-password'); }
}

// Links look like https://…/#share=<room>.<link id>.<secret>
export const linkUrl = (base, room, id, secret) => `${base.split('#')[0]}#share=${room}.${id}.${secret}`;
export function parseLink(hash) {
  const m = /(?:^#|[#&])share=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{22})(?:&|$)/.exec(hash || '');
  return m ? { room: m[1], id: m[2], secret: m[3] } : null;
}

// The owner's signed list of links: { text, sig }, with `n` higher each time it changes.
export async function signLinks(owner, n, links) {
  const text = JSON.stringify({ room: owner.room, n, links: links.map(({ id, role, pub, box }) => ({ id, role, pub, box })) });
  const sign = await signer(owner.ownerPriv);
  return { text, sig: await sign(signed.links(text)) };
}

export async function signer(priv) {
  const key = await subtle.importKey('pkcs8', unb64(priv), { name: 'Ed25519' }, false, ['sign']);
  return async (bytes) => b64(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, key, bytes)));
}

// Checks signatures with public keys, remembering the keys it has imported.
export function verifier() {
  const keys = new Map();
  return async (pub, sig, bytes) => {
    try {
      if (!keys.has(pub)) keys.set(pub, await subtle.importKey('raw', unb64(pub), { name: 'Ed25519' }, false, ['verify']));
      return await subtle.verify({ name: 'Ed25519' }, keys.get(pub), unb64(sig), bytes);
    } catch { return false; }
  };
}

// The owner's list of links, checked: Map(id → { role, pub }), and the owner as 'owner'.
export async function readLinks(room, ownerPub, { text, sig } = {}, verify = verifier()) {
  if (typeof text !== 'string' || !(await verify(ownerPub, sig, signed.links(text)))) throw new Error('links not signed by the owner');
  const o = JSON.parse(text);
  if (o.room !== room || !Array.isArray(o.links)) throw new Error('bad links');
  const out = new Map([['owner', { role: 'owner', pub: ownerPub }]]);
  for (const l of o.links) if (ROLES.includes(l?.role) && typeof l.pub === 'string' && l.id !== 'owner') out.set(l.id, { role: l.role, pub: l.pub });
  return { n: o.n, links: out };
}

// Encrypts and decrypts changes with the project key. Each is bound to its room and document,
// so a change can't be moved to another.
export async function projectCipher(projectKey, room) {
  const key = await subtle.importKey('raw', unb64(projectKey), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const label = (doc) => enc.encode(`scribecue-change:${room}:${doc}`);
  return {
    async seal(doc, bytes) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: label(doc) }, key, bytes));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv); out.set(ct, 12);
      return out;
    },
    async open(doc, bytes) {
      return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: label(doc) }, key, bytes.subarray(12)));
    },
  };
}
