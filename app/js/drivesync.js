// Syncing settings through Google Drive: what's synced, and how this browser's settings and
// the copy in Drive are brought together. No browser or network here, so it can be tested.
//
// The copy in Drive keeps each setting with the time it last changed: { v, at }, v being
// the text kept in storage, or null for a setting that was removed. This browser keeps what
// it last saw there (`seen`), so it can tell which side changed since. When both did, the
// later change wins.
import { settingNames, secretNames } from './settingsfile.js';

export const SYNC_FILE = 'settings.json';
export const FORMAT = 1;
const PREFIX = 'scribecue.';
// Kept by each browser for itself: which mode it's in, and how wide its list is on this screen.
const LOCAL_ONLY = new Set(['mode', 'listWidth']);
// Whether API keys are synced. Synced itself, so turning it off anywhere takes them out of Drive.
export const KEYS = 'syncKeys';
// This browser's sync state, and its sign-in. Neither is ever synced or in a settings file.
export const STATE = PREFIX + 'googleSync';
export const AUTH = PREFIX + 'google';
// How google.html passes Google's answer back to the window that asked.
export const CHANNEL = 'scribecue-google';

export const syncedSettings = () => [...settingNames().filter((n) => !LOCAL_ONLY.has(n)), KEYS];
export const syncedSecrets = () => secretNames();
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Shared projects: the keys this browser keeps for each one it shares or has joined
// (`scribecue.share.<project>`, see sharing.js), synced whenever Drive is connected, so they
// open in any browser. Each is synced as it's kept, less when it was last opened here.
export const SHARE = 'share.';
export const isShare = (n) => /^share\.[\w-]{1,64}$/.test(n);
const HERE_ONLY = ['opened'];
// The same record always gives the same text, whatever order its fields were kept in.
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
export function shareText(text) {
  if (text === null) return null;
  try {
    const r = JSON.parse(text);
    if (!isObject(r)) return text;
    for (const k of HERE_ONLY) delete r[k];
    return JSON.stringify(sorted(r));
  } catch { return text; }
}
// The shared projects kept in this browser, as names to sync.
export function shareNames(storage) {
  const out = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const n = storage.key(i)?.slice(PREFIX.length);
      if (storage.key(i).startsWith(PREFIX) && isShare(n)) out.push(n);
    }
  } catch { /* blocked */ }
  return out;
}
const get = (storage, name) => {
  try {
    const v = storage.getItem(PREFIX + name);
    return isShare(name) ? shareText(v) : v;
  } catch { return null; }
};
// Writes one value. A shared project keeps when it was last opened here.
function put(storage, name, v) {
  if (v === null) return storage.removeItem(PREFIX + name);
  if (isShare(name)) {
    try {
      const was = JSON.parse(storage.getItem(PREFIX + name) || 'null'), r = JSON.parse(v);
      if (isObject(was) && isObject(r)) for (const k of HERE_ONLY) if (k in was) r[k] = was[k];
      v = JSON.stringify(r);
    } catch { /* keep it as it came */ }
  }
  storage.setItem(PREFIX + name, v);
}

// What this browser has now, for these names: { name: text or null }.
export function localValues(storage, names) {
  return Object.fromEntries(names.map((n) => [n, get(storage, n)]));
}

// The sync state kept in this browser, made safe to use.
export function readState(text) {
  let s = {};
  try { s = JSON.parse(text) || {}; } catch { /* start again */ }
  const obj = (v) => (isObject(v) ? v : {});
  return { seen: obj(s.seen), changed: obj(s.changed), pending: obj(s.pending), fileId: typeof s.fileId === 'string' ? s.fileId : '', synced: Number(s.synced) || 0, first: !isObject(s.seen) };
}

// The copy in Drive, made safe to use: { settings: { name: { v, at } } } with only names we
// know, or null if it isn't one.
export function readRemote(json) {
  if (!isObject(json) || json.scribecue !== 'sync' || !isObject(json.settings)) return null;
  const known = new Set([...syncedSettings(), ...syncedSecrets()]);
  const settings = {};
  for (const [n, e] of Object.entries(json.settings)) {
    if ((!known.has(n) && !isShare(n)) || !isObject(e) || !Number.isFinite(e.at) || !(e.v === null || typeof e.v === 'string')) continue;
    settings[n] = { v: isShare(n) ? shareText(e.v) : e.v, at: e.at };
  }
  return { settings, newer: Number(json.version) > FORMAT };
}

// Notes when this browser's settings changed since they were last synced, so a later change in
// Drive can be told from an earlier one. Returns the new `changed`, and whether anything did.
export function noteChanges(local, state, now) {
  const changed = { ...state.changed };
  let any = false;
  for (const [n, v] of Object.entries(local)) {
    const was = state.seen[n] ? state.seen[n].v : null;
    if (v === was) { delete changed[n]; continue; }
    any = true;
    if (!changed[n]) changed[n] = now;
  }
  return { changed, any };
}

// Brings this browser and Drive together.
// local: what this browser has, for every name that could be synced. remote: readRemote's
// result, or null when Drive has no copy yet. now: the time, in ms.
// On the first sync in a browser, Drive's settings win: signing in sets this browser up
// the same way. Settings Drive doesn't have are added to it.
// combine(name, here, there): for a shared project kept both here and in Drive, changed on
// both sides, the record to keep (see driveshares.js). Without it, the later change wins.
// Returns { apply: { name: text or null } for this browser, upload: whether Drive needs the
// new copy, file: that copy, seen: the new `seen` }.
export function merge({ local, state, remote, now, combine = null }) {
  const r = remote?.settings || {};
  const out = {}, apply = {};
  let upload = !remote;
  const one = (n) => {
    const l = n in local ? local[n] : null, s = state.seen[n], e = r[n];
    let take; // 'local' or 'remote'
    const localChanged = l !== (s ? s.v : null);
    const remoteChanged = !!e && (!s || e.at !== s.at);
    // A shared project changed on both sides, or met here for the first time: both are kept.
    if (combine && isShare(n) && e && e.v !== null && l !== null && e.v !== l && (state.first || !s || (localChanged && remoteChanged))) {
      const v = combine(n, l, e.v);
      if (v === e.v) take = 'remote';
      else if (v === l) take = 'local';
      else { out[n] = { v, at: now }; apply[n] = v; upload = true; return; }
    // A shared project removed elsewhere, but never synced from this browser: it stays here.
    } else if (isShare(n) && (state.first || !s) && e?.v === null && l !== null) take = 'local';
    // Drive's copy wins the first time, and for a setting this browser hasn't synced before.
    else if (state.first || (!s && e)) take = e ? 'remote' : 'local';
    else if (localChanged && remoteChanged) take = e.v === l ? 'remote' : (state.changed[n] || now) > e.at ? 'local' : 'remote';
    else if (localChanged) take = 'local';
    else take = e ? 'remote' : 'local';
    if (take === 'remote') {
      out[n] = { v: e.v, at: e.at };
      if (e.v !== l) apply[n] = e.v;
    } else {
      if (l === null && !e && !s) return; // nothing anywhere
      const same = e && e.v === l;
      out[n] = same ? { v: e.v, at: e.at } : { v: l, at: now };
      if (!same) upload = true;
    }
  };
  syncedSettings().forEach(one);
  new Set([...Object.keys(local), ...Object.keys(r), ...Object.keys(state.seen)].filter(isShare)).forEach(one);
  const keysOn = out[KEYS]?.v === '1';
  if (keysOn) syncedSecrets().forEach(one);
  else if (syncedSecrets().some((n) => n in r)) upload = true; // turned off: take them out of Drive
  // A removed setting that was never anywhere else needs no entry.
  for (const n of Object.keys(out)) if (out[n].v === null && !r[n] && !state.seen[n]) delete out[n];
  return { apply, upload, file: { scribecue: 'sync', version: FORMAT, saved: now, settings: out }, seen: out, keysOn };
}

// What to keep after a sync. Changes from Drive that can't be used until Scribecue opens
// again (`hold`) wait in `pending`; `seen` then keeps this browser's own value for them, so
// they don't look like changes made here.
export function nextState({ state, result, local, hold, fileId, now }) {
  const seen = { ...result.seen }, pending = {};
  if (hold) {
    for (const [n, v] of Object.entries(result.apply)) {
      pending[n] = v;
      seen[n] = { v: n in local ? local[n] : null, at: result.seen[n].at };
    }
  }
  return { seen, changed: {}, pending, fileId: fileId || state.fileId, synced: now };
}

// Uses changes held from Drive, as Scribecue opens, before anything reads its settings. A
// setting changed here since is kept as it is. Returns the names it changed.
export function applyPending(storage, state) {
  const done = [];
  for (const [n, v] of Object.entries(state.pending)) {
    const now = get(storage, n), was = state.seen[n] ? state.seen[n].v : null;
    if (now !== was) continue;
    try {
      put(storage, n, v);
      state.seen[n] = { ...state.seen[n], v };
      done.push(n);
    } catch { /* storage full or blocked: try next time */ }
  }
  state.pending = {};
  return done;
}

export function writeValues(storage, values) {
  for (const [n, v] of Object.entries(values)) put(storage, n, v);
}
