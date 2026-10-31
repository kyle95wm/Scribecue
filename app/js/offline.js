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
const mb = (bytes) => `${bytes < 1e6 ? 'less than 1' : Math.round(bytes / 1e6)} MB`;
export const online = () => globalThis.navigator?.onLine !== false;

// What the bottom bar says: offline is the news when it happens; otherwise, in the web
// version, whether it's ready to be used offline.
export function offlineLabel({ hosted, offline, ready }) {
  // Otherwise it only shows when something's wrong: the rest is in Settings.
  if (offline) return { text: 'offline', on: true };
  if (!hosted || ready) return null; // the Docker version runs on this computer anyway
  return { text: 'not ready offline', on: false };
}

// The checklist's rows: [ok, title, detail, button?] from what's been found.
// refused: the browser has just said no when asked. It decides by itself, mostly by how
// much the site is used, and nothing can make it agree, so the row says what keeps work
// safe anyway.
// readings: Piper, Kokoro and Google readings kept in this browser, { count, bytes }.
export function checklist({ hosted, appKept, guides, voices, whisper, persisted, usage, refused = false, readings = null }) {
  const rows = [];
  if (hosted) rows.push(...offlineRows({ appKept, guides, voices, whisper }));
  if (persisted !== null) {
    rows.push(persisted
      ? [true, 'Kept safe', 'The browser won’t clear Scribecue’s storage to free up space.']
      : refused
        ? [false, 'Kept safe', 'The browser said no. It decides by itself, mostly by how much you use Scribecue, and may agree later. Either way, saving your work as a project keeps it safe: the file is on your computer, and in Chrome or Edge it autosaves.', 'persist']
        : [false, 'Kept safe', 'The browser may clear Scribecue’s storage if space runs low, including unsaved work. You can ask it to keep it; saving your work as a project keeps it safe either way.', 'persist']);
  }
  if (readings?.count) {
    rows.push([null, 'Saved readings', `${readings.count} line${readings.count === 1 ? '' : 's'}, ${mb(readings.bytes)}. `
      + 'They play straight away and offline, and Google ones aren’t sent to Google again.', 'readings']);
  }
  if (usage) rows.push([null, 'Space used', `${usage < 1e6 ? 'Less than 1' : Math.round(usage / 1e6)} MB in this browser.`]);
  return rows;
}

// The web version's rows: what it has for working without a connection. The Docker
// version runs from this computer, so it has nothing to get ready.
function offlineRows({ appKept, guides, voices, whisper }) {
  return [
    [appKept, 'Scribecue itself', appKept ? 'Kept in this browser, so it opens without a connection.' : 'Not kept yet. It’s kept the first time Scribecue opens with a connection: reload once while online.'],
    [guides, 'The guides', guides ? 'They open inside Scribecue.' : 'Not kept yet: they open on GitHub, which needs a connection.'],
    voices.length ? [true, 'Piper voices', `${voices.join(', ')}.`]
      : [false, 'Piper voices', 'None downloaded. Offline, text to speech uses your computer’s own voices.', 'voices'],
    whisper ? [true, 'Whisper, for speech to text', 'Downloaded.'] : [false, 'Whisper, for speech to text', 'Not downloaded.', 'whisper'],
  ];
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

let hooks = { toast: () => {}, voices: () => [], whisper: () => false, readings: async () => null, clearReadings: async () => {}, openTts: () => {}, openStt: () => {}, guides: async () => false,
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
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
    for (const name of new Set([...dbs, 'scribecue', 'scribecue-readings', 'scribecue-waves'])) if (name) await gone(name);
  } catch { /* none */ }
  try {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
  } catch { /* none */ }
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch { /* none */ }
}
let ready = false, refused = false;

async function survey() {
  const appKept = HOSTED && !!navigator.serviceWorker?.controller && (await caches.has(`scribecue-${VERSION}`).catch(() => false));
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const usage = (await navigator.storage?.estimate?.().catch(() => null))?.usage || 0;
  return { hosted: HOSTED, appKept, guides: await hooks.guides(), voices: hooks.voices(), whisper: hooks.whisper(), persisted, usage, refused,
    readings: await hooks.readings() };
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
      : 'Scribecue isn’t ready to work offline yet. Click to see why';
  }
  if (!$('offlineDlg').open) return;
  $('offlineNow').textContent = HOSTED
    ? (!online() ? 'You’re offline. Everything below with a ✓ works now.'
      : 'What this browser has for working without a connection. Get what you need before you go offline.')
    : `${!online() ? 'You’re offline, but that’s fine: ' : ''}Scribecue runs from this computer, in Docker, so it works without a connection. Until you save a project, your blocks and settings are kept in this browser.`;
  const btn = { voices: 'Choose a voice', whisper: 'Set up', persist: refused ? 'Ask again' : 'Keep it safe', readings: 'Clear' };
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
      a.addEventListener('click', () => act === 'persist' ? persist() : act === 'readings' ? clearReadings()
        : ($('offlineDlg').close(), act === 'voices' ? hooks.openTts() : hooks.openStt()));
      li.append(a);
    }
    return li;
  }));
}

// The answer shows in the window's own row: a message under the window would be hidden.
async function persist() {
  refused = !(await keepStorage({ ask: true }));
  await render();
}

// Google charges for readings past its free allowance, so this asks first.
async function clearReadings() {
  if (!confirm('Remove the readings kept in this browser? Lines are read again the next time they’re needed, and Google readings are counted again.')) return;
  await hooks.clearReadings();
  await render();
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
  // The Docker version runs from this computer, so its window is only about storage.
  $('offlineTitle').textContent = HOSTED ? 'Offline and storage' : 'Storage';
  for (const el of d.querySelectorAll('.hosted-only')) el.hidden = !HOSTED;
  for (const el of d.querySelectorAll('.docker-only')) el.hidden = HOSTED;
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
