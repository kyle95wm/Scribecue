// Google Drive: connecting it, and keeping settings in step through it. What's synced and
// how the two sides are brought together is in drivesync.js; this is the browser's part.
//
// Signing in opens Google's page in a window of its own. Google sends it back to
// google.html here with a code, which the relay swaps for a pass (see relay/src/google.js).
// The relay seals the long-lived part, so this browser keeps it without being able to use it
// anywhere but through the relay. Passes last an hour and are renewed as needed.
import { GOOGLE_CLIENT_ID, SIGNIN } from './config.js';
import {
  SYNC_FILE, STATE, AUTH, KEYS, CHANNEL, syncedSettings, syncedSecrets, localValues, readState, readRemote,
  noteChanges, merge, nextState, writeValues, shareNames, isShare, SHARE,
} from './drivesync.js';
import { FOLDER, MARK, copyName, driveRef, changedElsewhere } from './driveprojects.js';

// drive.appdata: the hidden folder settings sync in. drive.file: only files Scribecue made,
// for projects.
const SCOPES = 'openid email https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const LOOK = 15000; // how often to look for settings changed here, while visible
const SETTLE = 2000; // wait this long after a change before syncing it
const FRESH = 30000; // coming back to the window syncs if it's been longer than this
const START = 10000; // changes from Drive this soon after opening, before anything's touched, reload now

const $ = (id) => document.getElementById(id);
const loaded = Date.now();
let touched = false;
let opening = true; // the sync as Scribecue opens hasn't finished
let auth = readAuth(); // { sealed, email }
let access = null; // { token, until }
let status = { kind: auth ? 'idle' : 'off', text: '' };
let running = null, again = false, settleTimer = 0, waiting = null;
let hooks = { toast: () => {}, beforeReload: () => {}, projectCopied: () => {}, openProject: () => '', sharesChanged: () => {} };

function readAuth() {
  try { const a = JSON.parse(localStorage.getItem(AUTH)); return a && typeof a.sealed === 'string' ? a : null; } catch { return null; }
}
const readLocalState = () => readState(localStorage.getItem(STATE));
function saveState(s) { const { first, ...keep } = s; localStorage.setItem(STATE, JSON.stringify(keep)); }

export const canConnect = () => !!GOOGLE_CLIENT_ID;
export const connected = () => !!auth;
export const driveEmail = () => auth?.email || '';
// Whether this connection lets Scribecue keep projects in Drive. Connections made before it
// could (settings only) connect again once.
export const canProjects = () => !!auth?.projects;

class SyncError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// ---- signing in

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));

async function helper(path, body) {
  let r;
  try {
    r = await fetch(`${SIGNIN}/google/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new SyncError('offline', 'Scribecue’s sign-in service couldn’t be reached'); }
  if (r.status === 403) throw new SyncError('origin', 'Google Drive can’t be connected from this address');
  if (r.status === 429) throw new SyncError('busy', 'too many tries. Wait a minute');
  const data = await r.json().catch(() => ({}));
  if (data.error === 'signed-out') throw new SyncError('signed-out', 'Google Drive was disconnected');
  if (data.error === 'not-set-up') throw new SyncError('not-set-up', 'connecting Google Drive isn’t set up yet');
  if (!r.ok || data.error) throw new SyncError('refused', `Google said ${data.error || r.status}`);
  return data;
}

// Must start from a click, or the browser blocks the window. Resolves true once connected.
export async function connect() {
  if (!canConnect()) return false;
  touched = true;
  const win = window.open('', 'scribecueGoogle', 'popup,width=500,height=650');
  if (!win) { show(auth ? 'error' : 'off', 'Your browser blocked the Google window. Allow pop-ups for this page, then try again.'); hooks.toast('Your browser blocked the Google window. Allow pop-ups for Scribecue, then try again'); return false; }
  const verifier = random(32), state = random(16);
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: `${location.origin}/google.html`, response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    code_challenge: challenge, code_challenge_method: 'S256', state,
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  win.location.href = url.href;
  show('waiting', 'Finish connecting in the Google window.');
  try {
    const code = await answer(state);
    show('waiting', 'Connecting…');
    const got = await helper('token', { code, verifier });
    if (!got.scope.includes('drive.appdata')) throw new SyncError('scope', 'Google Drive wasn’t allowed. Connect again and tick the box for Scribecue’s files');
    const fresh = !auth;
    auth = { sealed: got.sealed, email: got.email, projects: got.scope.includes('drive.file') };
    access = { token: got.access, until: Date.now() + got.expires * 1000 };
    folder = '';
    localStorage.setItem(AUTH, JSON.stringify(auth));
    if (fresh) localStorage.removeItem(STATE); // a first sync: Drive's settings win
    await syncNow();
    return true;
  } catch (e) {
    if (e.code === 'replaced') return false;
    const msg = e.code === 'cancelled' ? '' : `Couldn’t connect Google Drive: ${e.message}.`;
    show(auth ? 'error' : 'off', msg);
    if (msg) hooks.toast(msg.replace(/\.$/, ''));
    return false;
  }
}

// The code from google.html, sent on a channel rather than to the window that opened it:
// Google's pages cut that link on the way.
function answer(state) {
  if (waiting) waiting.reject(new SyncError('replaced'));
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(CHANNEL);
    const done = () => { ch.close(); waiting = null; };
    waiting = { reject: (e) => { done(); reject(e); } };
    ch.onmessage = ({ data }) => {
      if (!data || data.state !== state) return;
      done();
      if (data.code) resolve(data.code);
      else reject(new SyncError(data.error === 'access_denied' ? 'cancelled' : 'refused', `Google said ${data.error || 'no'}`));
    };
  });
}

export async function disconnect() {
  const was = auth;
  auth = null; access = null; folder = '';
  localStorage.removeItem(AUTH);
  localStorage.removeItem(STATE);
  show('off', 'Disconnected. Your settings stay in this browser, and in Google Drive.');
  if (was) helper('revoke', { sealed: was.sealed }).catch(() => {});
}

async function token() {
  if (access && access.until > Date.now() + 60000) return access.token;
  if (!auth) throw new SyncError('signed-out', 'Google Drive isn’t connected');
  try {
    const got = await helper('refresh', { sealed: auth.sealed });
    access = { token: got.access, until: Date.now() + got.expires * 1000 };
    return access.token;
  } catch (e) {
    if (e.code === 'signed-out') { auth = null; localStorage.removeItem(AUTH); localStorage.removeItem(STATE); }
    throw e;
  }
}

// ---- Drive

async function drive(url, opts = {}, retry = true) {
  const t = await token();
  let r;
  try { r = await fetch(url, { ...opts, headers: { ...opts.headers, authorization: `Bearer ${t}` } }); } catch { throw new SyncError('offline', 'Google Drive couldn’t be reached'); }
  if (r.status === 401 && retry) { access = null; return drive(url, opts, false); }
  if (r.status === 404) throw new SyncError('gone', 'not found');
  if (r.status === 403 && /insufficient|scope/i.test(await r.clone().text().catch(() => ''))) {
    if (auth) { auth.projects = false; localStorage.setItem(AUTH, JSON.stringify(auth)); }
    throw new SyncError('scope', 'Scribecue isn’t allowed to keep projects in your Drive. Connect Google Drive again');
  }
  if (!r.ok) throw new SyncError('drive', `Google Drive said ${r.status}`);
  return r;
}
async function findFile() {
  const q = encodeURIComponent(`name='${SYNC_FILE}'`);
  const r = await drive(`${API}?spaces=appDataFolder&q=${q}&fields=files(id)&orderBy=modifiedTime desc`);
  return (await r.json()).files?.[0]?.id || '';
}
async function readFile(id) {
  const r = await drive(`${API}/${encodeURIComponent(id)}?alt=media`);
  try { return await r.json(); } catch { return { damaged: true }; }
}
async function createFile(body) {
  const boundary = 'scribecue' + random(12);
  const meta = { name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' };
  const text = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n--${boundary}--`;
  const r = await drive(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: text });
  return (await r.json()).id;
}
async function writeFile(id, body) {
  await drive(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// ---- projects
//
// Kept in a Scribecue folder in My Drive, which people can see. Scribecue only reaches files
// it made itself. A project opened from Drive gets a stand-in for a file handle
// (driveHandle), so saving and autosave treat it like a file on this computer.

let folder = '';
const FIELDS = 'id,name,headRevisionId,modifiedTime,trashed';

async function folderId() {
  if (folder) return folder;
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await (await drive(`${API}?q=${q}&fields=files(id)&spaces=drive`)).json()).files?.[0]?.id;
  if (found) return (folder = found);
  const r = await drive(`${API}?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) });
  return (folder = (await r.json()).id);
}

// Every project Scribecue saved to this Drive, from any computer.
export async function listProjects() {
  const q = encodeURIComponent(`appProperties has { key='${MARK.key}' and value='${MARK.value}' } and trashed=false`);
  const r = await drive(`${API}?q=${q}&fields=files(${FIELDS})&pageSize=500&orderBy=modifiedTime desc&spaces=drive`);
  return (await r.json()).files || [];
}

async function names() {
  const q = encodeURIComponent(`'${await folderId()}' in parents and trashed=false`);
  return ((await (await drive(`${API}?q=${q}&fields=files(name)&pageSize=1000`)).json()).files || []).map((f) => f.name);
}

// A new project file in the Scribecue folder, named so it doesn't clash with another there.
export async function createProject(name, blob) {
  const meta = { name: copyName(name, await names()), parents: [await folderId()], mimeType: 'application/json', appProperties: { [MARK.key]: MARK.value } };
  const boundary = 'scribecue' + random(12);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
    blob, `\r\n--${boundary}--`,
  ]);
  const r = await drive(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
  const f = await r.json();
  return driveHandle({ id: f.id, name: f.name, revision: f.headRevisionId });
}

// Writes a project back. If it changed in Drive since this browser read or wrote it, or is
// gone, it's saved beside it as a copy instead, and the handle moves to the copy: nothing is
// overwritten. Returns why it made a copy, or ''.
async function writeProject(h, blob) {
  let now = null;
  try { now = await (await drive(`${API}/${encodeURIComponent(h.id)}?fields=${FIELDS}`)).json(); } catch (e) { if (e.code !== 'gone') throw e; }
  const why = !now || now.trashed ? 'gone' : changedElsewhere(h.revision, now.headRevisionId) ? 'changed' : '';
  if (why) {
    const copy = await createProject(h.name, blob);
    Object.assign(h, { id: copy.id, name: copy.name, revision: copy.revision });
    return why;
  }
  const r = await drive(`${UPLOAD}/${encodeURIComponent(h.id)}?uploadType=media&fields=${FIELDS}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: blob });
  h.revision = (await r.json()).headRevisionId;
  return '';
}

// A project in Drive, behaving enough like a FileSystemFileHandle for saving, autosave and
// Recents. Kept in storage as driveRef(handle).
export function driveHandle(ref) {
  const h = {
    kind: 'drive', id: ref.id, name: ref.name, revision: ref.revision || '',
    ref: () => driveRef(h),
    queryPermission: async () => (auth ? 'granted' : 'prompt'),
    requestPermission: async () => (auth ? 'granted' : 'denied'),
    isSameEntry: async (o) => o?.kind === 'drive' && o.id === h.id,
    async getFile() {
      const meta = await (await drive(`${API}/${encodeURIComponent(h.id)}?fields=${FIELDS}`)).json();
      if (meta.trashed) throw new SyncError('gone', 'it’s in the Drive bin');
      const text = await (await drive(`${API}/${encodeURIComponent(h.id)}?alt=media`)).text();
      Object.assign(h, { name: meta.name, revision: meta.headRevisionId });
      return new File([text], meta.name, { type: 'application/json' });
    },
    async createWritable() {
      const parts = [];
      return {
        write: async (x) => { parts.push(x); },
        close: async () => {
          const was = h.name;
          const why = await writeProject(h, new Blob(parts, { type: 'application/json' }));
          if (why) hooks.projectCopied(h, was, why);
        },
      };
    },
  };
  return h;
}

// ---- syncing

const allNames = () => [...syncedSettings(), ...syncedSecrets(), ...shareNames(localStorage)];

// One sync: read Drive's copy, bring the two together, write back what changed.
export function syncNow() {
  if (!auth) return Promise.resolve();
  if (running) { again = true; return running; }
  running = cycle().finally(() => {
    running = null; opening = false;
    if (again) { again = false; syncNow(); }
  });
  return running;
}

async function cycle() {
  if (navigator.onLine === false) return show('offline', 'Not synced: you’re offline. Scribecue syncs when you’re back online.');
  show('syncing', 'Syncing…');
  try {
    const state = readLocalState();
    let id = state.fileId, json = null;
    if (id) {
      try { json = await readFile(id); } catch (e) { if (e.code !== 'gone') throw e; id = ''; }
    }
    if (!id) { id = await findFile(); if (id) json = await readFile(id); }
    const remote = json ? readRemote(json) : null;
    if (json && !remote) throw new SyncError('damaged', 'the copy in Google Drive can’t be read');
    const now = Date.now();
    const local = localValues(localStorage, allNames());
    if (!state.first) state.changed = noteChanges(local, state, now).changed;
    // Shared projects changed both here and elsewhere are combined (driveshares.js), which
    // needs the sharing code: loaded only when there are shared projects.
    const shares = Object.keys(local).some(isShare) || Object.keys(remote?.settings || {}).some(isShare);
    const combine = shares ? (await import('./driveshares.js')).combineShares : null;
    const result = merge({ local, state, remote, now, combine });
    // Shared projects are used straight away, but for the one open now, which waits like a setting.
    const open = SHARE + (hooks.openProject() || ''), ready = {}, held = {};
    for (const [n, v] of Object.entries(result.apply)) (isShare(n) && n !== open ? ready : held)[n] = v;
    const changes = Object.keys(held).length > 0;
    const reloadNow = changes && opening && !touched && now - loaded < START;
    if (result.upload && !remote?.newer) {
      if (id) await writeFile(id, result.file); else id = await createFile(result.file);
    }
    if (reloadNow) writeValues(localStorage, held);
    writeValues(localStorage, ready);
    saveState(nextState({ state, result: { ...result, apply: held }, local, hold: changes && !reloadNow, fileId: id, now }));
    if (Object.keys(ready).length) hooks.sharesChanged(Object.keys(ready).filter((n) => ready[n] !== null && local[n] == null).length);
    if (reloadNow) {
      hooks.beforeReload();
      sessionStorage.setItem(RELOADED, '1');
      location.reload();
      return;
    }
    show('synced', remote?.newer ? 'Some settings come from a newer version of Scribecue, and wait until this one is updated.' : '');
    if (Object.keys(held).some((n) => !isShare(n))) hooks.toast('New settings from Google Drive. They’re used when Scribecue opens again');
  } catch (e) {
    if (!auth) return show('off', `${e.message}. Connect it again to keep syncing.`);
    show(e.code === 'offline' ? 'offline' : 'error', e.code === 'offline'
      ? 'Not synced: Google Drive couldn’t be reached. Scribecue tries again soon.'
      : `Couldn’t sync: ${e.message}.`);
  }
}
const RELOADED = 'scribecue.driveReloaded'; // in sessionStorage, for the toast after reloading

// Looks for settings changed here, and syncs them once they've settled.
function look() {
  if (!auth || document.hidden) return;
  const state = readLocalState();
  if (state.first) return;
  const { changed, any } = noteChanges(localValues(localStorage, allNames()), state, Date.now());
  if (!any) return;
  state.changed = changed;
  saveState(state);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(syncNow, SETTLE);
}

// ---- the Google Drive section in Settings

function show(kind, text) {
  status = { kind, text };
  render();
}

function render() {
  const sec = $('setDrive');
  if (!sec) return;
  $('gdNotSetUp').hidden = canConnect();
  $('gdOff').hidden = !canConnect() || !!auth;
  $('gdOn').hidden = !auth;
  if (auth) $('gdWho').textContent = auth.email || 'your Google account';
  $('gdProjects').hidden = !auth || !!auth.projects;
  const keys = localStorage.getItem('scribecue.' + KEYS) === '1';
  $('gdKeys').setAttribute('aria-pressed', String(keys));
  const st = readLocalState();
  const pending = !!auth && Object.keys(st.pending).length > 0;
  $('gdPending').hidden = !pending;
  let text = status.text;
  if (auth && status.kind === 'synced' && st.synced) {
    text = `Synced at ${new Date(st.synced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. ${text}`.trim();
  }
  $('gdStatus').textContent = text;
  $('gdSync').disabled = status.kind === 'syncing';
}

export function initDrive(h) {
  hooks = { ...hooks, ...h };
  addEventListener('pointerdown', () => { touched = true; }, { capture: true, once: true });
  addEventListener('keydown', () => { touched = true; }, { capture: true, once: true });
  $('gdConnect').addEventListener('click', connect);
  $('gdReconnect').addEventListener('click', connect);
  $('gdDisconnect').addEventListener('click', disconnect);
  $('gdSync').addEventListener('click', () => syncNow());
  $('gdReload').addEventListener('click', () => { hooks.beforeReload(); location.reload(); });
  $('gdKeys').addEventListener('click', () => {
    const on = $('gdKeys').getAttribute('aria-pressed') !== 'true';
    localStorage.setItem('scribecue.' + KEYS, on ? '1' : '0');
    render();
    syncNow();
  });
  setInterval(look, LOOK);
  document.addEventListener('visibilitychange', () => {
    if (!auth) return;
    if (document.hidden) return look();
    if (Date.now() - readLocalState().synced > FRESH) syncNow();
  });
  addEventListener('online', () => syncNow());
  try {
    if (sessionStorage.getItem(RELOADED)) {
      sessionStorage.removeItem(RELOADED);
      hooks.toast('Using your settings from Google Drive');
    }
  } catch { /* fine */ }
  render();
  if (auth) syncNow();
}

export const refreshDrive = render;
