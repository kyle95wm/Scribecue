// Working offline: what this copy of Scribecue has for it, whether the browser will keep
// it, and a marker while there's no connection. And removing everything it keeps.
//
// The web version keeps itself offline (sw.js), and Piper voices and Whisper once they're
// downloaded. The Docker version runs from this computer anyway. Either way, a few things
// need the internet, and the checklist says which.
import { HOSTED } from './config.js';
import { VERSION } from './update.js';
import { chromium } from './browser.js';

const $ = (id) => document.getElementById(id);
export const online = () => globalThis.navigator?.onLine !== false;

// What the bottom bar says: offline is the news when it happens; otherwise, in the web
// version, whether it's ready to be used offline.
export function offlineLabel({ hosted, offline, ready }) {
  if (offline) return { text: 'offline', on: true };
  return ready || !hosted ? { text: 'offline ready', on: false } : { text: 'not ready offline', on: false };
}

// The checklist's rows: [ok, title, detail, button?] from what's been found.
export function checklist({ hosted, appKept, guides, voices, whisper, persisted, usage }) {
  const rows = [];
  rows.push(hosted
    ? [appKept, 'Scribecue itself', appKept ? 'Kept in this browser, so it opens without a connection.' : 'Not kept yet. It’s kept the first time Scribecue opens with a connection: reload once while online.']
    : [true, 'Scribecue itself', 'Runs from this computer, in Docker, so it works without a connection.']);
  rows.push([guides, 'The guides', guides ? 'They open inside Scribecue.' : 'Not kept yet: they open on GitHub, which needs a connection.']);
  rows.push(voices.length
    ? [true, 'Piper voices', `${voices.join(', ')}.`]
    : [false, 'Piper voices', hosted ? 'None downloaded. Offline, text to speech uses your computer’s own voices.' : 'Piper isn’t running. Offline, text to speech uses your computer’s own voices.', hosted ? 'voices' : null]);
  rows.push(whisper
    ? [true, 'Whisper, for speech to text', hosted ? 'Downloaded.' : 'The Whisper container is running.']
    : [false, 'Whisper, for speech to text', hosted ? 'Not downloaded.' : 'The Whisper container isn’t running.', hosted ? 'whisper' : null]);
  if (persisted !== null) {
    rows.push(persisted
      ? [true, 'Kept safe', 'The browser won’t clear Scribecue’s storage to free up space.']
      : [false, 'Kept safe', 'The browser may clear Scribecue’s storage if space runs low, including unsaved work. Installing Scribecue as an app makes it likelier to keep it.', 'persist']);
  }
  if (usage) rows.push([null, 'Space used', `${Math.round(usage / 1e6)} MB in this browser.`]);
  return rows;
}

// Asks the browser to keep Scribecue's storage. Chrome, Edge and the others on their
// engine decide by themselves, without asking; Firefox asks the person, so that waits for
// them to press the button.
export async function keepStorage({ ask = false } = {}) {
  const s = globalThis.navigator?.storage;
  if (!s?.persist) return null;
  if (await s.persisted()) return true;
  return ask || chromium(navigator.userAgent, navigator.userAgentData?.brands || []) ? s.persist() : false;
}

let hooks = { toast: () => {}, voices: () => [], whisper: () => false, openTts: () => {}, openStt: () => {}, guides: async () => false,
  unsaved: () => 0, save: async () => {} };

// The warning before removing everything, from what would be lost.
export function wipeWarning({ unsaved, offline, hosted }) {
  return [
    'This can’t be undone.',
    unsaved ? `${unsaved} block${unsaved === 1 ? ' isn’t' : 's aren’t'} saved in a project file and will be lost.` : '',
    offline && hosted ? 'You’re offline, so Scribecue won’t open again until you’re back online.' : '',
    'Afterwards Scribecue opens as if for the first time.',
  ].filter(Boolean).join(' ');
}

// Removes everything Scribecue keeps in this browser. It's all under Scribecue's own
// address, so nothing of any other site's is touched.
export async function removeAllData() {
  try { localStorage.clear(); } catch { /* blocked */ }
  try { sessionStorage.clear(); } catch { /* blocked */ }
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* none */ }
  const gone = (name) => new Promise((ok) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => ok(); });
  try {
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : ['scribecue'];
    for (const name of new Set([...dbs, 'scribecue'])) if (name) await gone(name);
  } catch { /* none */ }
  try {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
  } catch { /* none */ }
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch { /* none */ }
}
let ready = false;

async function survey() {
  const appKept = HOSTED && !!navigator.serviceWorker?.controller && (await caches.has(`scribecue-${VERSION}`).catch(() => false));
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const usage = (await navigator.storage?.estimate?.().catch(() => null))?.usage || 0;
  return { hosted: HOSTED, appKept, guides: await hooks.guides(), voices: hooks.voices(), whisper: hooks.whisper(), persisted, usage };
}

async function render() {
  const s = await survey();
  ready = !HOSTED || s.appKept;
  const label = offlineLabel({ hosted: HOSTED, offline: !online(), ready });
  const b = $('offlineBtn');
  b.hidden = !label;
  if (label) {
    b.textContent = label.text;
    b.classList.toggle('on', label.on);
    b.dataset.tip = !online() ? 'You’re offline. Click to see what works without a connection'
      : ready ? 'Scribecue works without a connection. Click to see what’s ready for offline, or what it keeps in this browser'
        : 'Scribecue isn’t ready to work offline yet. Click to see why';
  }
  if (!$('offlineDlg').open) return;
  $('offlineNow').textContent = !online() ? 'You’re offline. Everything below with a ✓ works now.'
    : HOSTED ? 'What this browser has for working without a connection. Get what you need before you go offline.'
      : 'This copy of Scribecue runs on your computer, so it works offline. Here’s what it has.';
  const btn = { voices: 'Choose a voice', whisper: 'Set up', persist: 'Keep it safe' };
  $('offlineList').replaceChildren(...checklist(s).map(([ok, title, detail, act]) => {
    const li = document.createElement('li');
    li.className = ok === null ? 'info' : ok ? 'ok' : 'no';
    li.innerHTML = '<span class="mark"></span><span class="what"><strong></strong><span class="dim small"></span></span>';
    li.querySelector('.mark').textContent = ok === null ? '·' : ok ? '✓' : '✗';
    li.querySelector('strong').textContent = title;
    li.querySelector('.small').textContent = detail;
    if (act) {
      const a = document.createElement('button');
      a.textContent = btn[act];
      a.addEventListener('click', () => act === 'persist' ? persist() : ($('offlineDlg').close(), act === 'voices' ? hooks.openTts() : hooks.openStt()));
      li.append(a);
    }
    return li;
  }));
}

async function persist() {
  const ok = await keepStorage({ ask: true });
  hooks.toast(ok ? 'The browser will keep Scribecue’s storage'
    : 'The browser didn’t agree to keep it. Installing Scribecue as an app, or using it more, can change its mind');
  render();
}

export function openOffline() {
  const d = $('offlineDlg');
  if (!d.open) d.showModal();
  render();
}

function askWipe(show) {
  $('wipeAsk').hidden = show;
  $('wipeConfirm').hidden = !show;
  if (!show) return;
  const unsaved = hooks.unsaved();
  $('wipeWarn').textContent = wipeWarning({ unsaved, offline: !online(), hosted: HOSTED });
  $('wipeSave').hidden = !unsaved;
  $('wipeCancel').focus();
}

export function initOffline(h) {
  hooks = { ...hooks, ...h };
  const d = $('offlineDlg');
  $('wipeBtn').addEventListener('click', () => askWipe(true));
  $('wipeCancel').addEventListener('click', () => askWipe(false));
  $('wipeSave').addEventListener('click', async () => { await hooks.save(); askWipe(true); });
  $('wipeGo').addEventListener('click', async () => {
    $('wipeGo').disabled = true;
    $('wipeWarn').textContent = 'Removing…';
    await removeAllData();
    location.replace(location.pathname); // starts again, with nothing kept
  });
  d.addEventListener('close', () => askWipe(false));
  $('offlineBtn').addEventListener('click', (e) => { e.currentTarget.blur(); openOffline(); });
  $('offlineClose').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
  addEventListener('online', () => { render(); hooks.toast('Back online'); });
  addEventListener('offline', () => { render(); hooks.toast('You’re offline. Scribecue keeps working; online AI providers and online voices wait for a connection'); });
  keepStorage().finally(render);
  // The offline copy is made in the background after the first load, and voices and
  // Whisper download later, so look again now and then.
  setInterval(render, 60e3);
  navigator.serviceWorker?.addEventListener?.('controllerchange', render);
}

export const refreshOffline = () => render();
