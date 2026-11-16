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
  noteChanges, merge, nextState, writeValues,
} from './drivesync.js';

const SCOPES = 'openid email https://www.googleapis.com/auth/drive.appdata';
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
let hooks = { toast: () => {}, beforeReload: () => {} };

function readAuth() {
  try { const a = JSON.parse(localStorage.getItem(AUTH)); return a && typeof a.sealed === 'string' ? a : null; } catch { return null; }
}
const readLocalState = () => readState(localStorage.getItem(STATE));
function saveState(s) { const { first, ...keep } = s; localStorage.setItem(STATE, JSON.stringify(keep)); }

export const canConnect = () => !!GOOGLE_CLIENT_ID;
export const connected = () => !!auth;
export const driveEmail = () => auth?.email || '';

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

// Must start from a click, or the browser blocks the window.
export async function connect() {
  if (!canConnect()) return;
  touched = true;
  const win = window.open('', 'scribecueGoogle', 'popup,width=500,height=650');
  if (!win) return show('error', 'Your browser blocked the Google window. Allow pop-ups for this page, then try again.');
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
    auth = { sealed: got.sealed, email: got.email };
    access = { token: got.access, until: Date.now() + got.expires * 1000 };
    localStorage.setItem(AUTH, JSON.stringify(auth));
    localStorage.removeItem(STATE); // a first sync: Drive's settings win
    await syncNow();
  } catch (e) {
    if (e.code === 'replaced') return;
    show(auth ? 'error' : 'off', e.code === 'cancelled' ? '' : `Couldn’t connect Google Drive: ${e.message}.`);
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
  auth = null; access = null;
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

// ---- syncing

const allNames = () => [...syncedSettings(), ...syncedSecrets()];

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
    const result = merge({ local, state, remote, now });
    const changes = Object.keys(result.apply).length > 0;
    const reloadNow = changes && opening && !touched && now - loaded < START;
    if (result.upload && !remote?.newer) {
      if (id) await writeFile(id, result.file); else id = await createFile(result.file);
    }
    if (reloadNow) writeValues(localStorage, result.apply);
    saveState(nextState({ state, result, local, hold: changes && !reloadNow, fileId: id, now }));
    if (reloadNow) {
      hooks.beforeReload();
      sessionStorage.setItem(RELOADED, '1');
      location.reload();
      return;
    }
    show('synced', remote?.newer ? 'Some settings come from a newer version of Scribecue, and wait until this one is updated.' : '');
    if (changes) hooks.toast('New settings from Google Drive. They’re used when Scribecue opens again');
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
