// Backing up settings: a file with this browser's preferences, to keep them safe or to set
// up another browser the same way. It holds preferences only. Projects, unsaved blocks,
// shared projects and their keys, saved readings, waveforms and takes stay out, and so does
// anything about this browser alone, such as its microphone or what it has been shown.
// API keys go in only when the person asks.

export const SETTINGS_FILE = 'scribecue-settings.json';
const FORMAT = 1;
const PREFIX = 'scribecue.';
export const MAX_FILE = 1e6; // bytes: a settings file is a few kilobytes

// [name in storage after 'scribecue.', kind, what it's called when importing]
// json: kept as JSON, an object. text: kept as text. merge: an object whose entries are
// added to what's there, so an API key the file doesn't have isn't lost.
const SETTINGS = [
  ['reviewer', 'text', 'Your name'],
  ['mode', 'text', 'Mode'],
  ['replay', 'text', 'Editing'],
  ['lead', 'text', 'Editing'],
  ['returnToStart', 'text', 'Editing'],
  ['remaining', 'text', 'Display'],
  ['swapped', 'text', 'Display'],
  ['listWidth', 'text', 'Display'],
  ['appearance', 'json', 'Appearance'],
  ['floatVideo', 'text', 'Appearance'],
  ['offset', 'text', 'Transcribing'],
  ['stt', 'json', 'Transcribing'],
  ['proof', 'json', 'Spelling and grammar'],
  ['tts', 'json', 'Text to speech'],
  ['ai', 'json', 'AI help'],
  ['keys', 'json', 'Keyboard shortcuts'],
  ['rec.lead', 'text', 'Recording'],
  ['rec.hear', 'text', 'Recording'],
  ['rec.video', 'text', 'Recording'],
  ['recStart', 'text', 'Recording'],
  ['updates', 'text', 'Updates'],
];
const SECRETS = [
  ['googleTts', 'json', 'Google key'],
  ['pollyTts', 'json', 'Amazon Polly key'],
  ['ai.keys', 'merge', 'AI and TMDB keys'],
];
const KNOWN = new Map([...SETTINGS, ...SECRETS].map(([name, kind, label]) => [name, { kind, label }]));
export const settingNames = () => SETTINGS.map(([n]) => n);
export const secretNames = () => SECRETS.map(([n]) => n);

const get = (storage, name) => { try { return storage.getItem(PREFIX + name); } catch { return null; } };
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// What a stored value goes into the file as, or undefined to leave it out.
function exported(raw, kind) {
  if (raw === null) return undefined;
  if (kind === 'text') return raw;
  try { const v = JSON.parse(raw); return isObject(v) ? v : undefined; } catch { return undefined; }
}

// The file's contents. secrets: include API keys too.
export function exportSettings(storage, { secrets = false, version = '', now = new Date() } = {}) {
  const pick = (list) => {
    const out = {};
    for (const [name, kind] of list) {
      const v = exported(get(storage, name), kind);
      if (v !== undefined) out[name] = v;
    }
    return out;
  };
  const file = { scribecue: 'settings', version: FORMAT, app: version, saved: now.toISOString(), settings: pick(SETTINGS) };
  if (secrets) {
    const s = pick(SECRETS);
    if (Object.keys(s).length) file.secrets = s;
  }
  return file;
}

// What a value from a file is kept as, or undefined if it can't be used.
function stored(v, kind) {
  if (kind === 'text') return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : undefined;
  return isObject(v) ? v : undefined;
}

// Reads a settings file, already parsed from JSON. Throws an Error that says what's wrong
// when it isn't one. Settings it doesn't know, from a newer version, or that can't be used
// are left out and listed in skipped.
export function readSettingsFile(json) {
  if (json?.scribecue === 'shortcuts') throw new Error('this is a shortcuts file. Import it under Keyboard shortcuts');
  if (!isObject(json) || json.scribecue !== 'settings' || !isObject(json.settings)) throw new Error('this isn’t a Scribecue settings file');
  const values = new Map(), skipped = [];
  const read = (group, list) => {
    if (group === undefined) return;
    if (!isObject(group)) { skipped.push(list); return; }
    const names = new Set((list === 'secrets' ? SECRETS : SETTINGS).map(([n]) => n));
    for (const [name, v] of Object.entries(group)) {
      const ok = names.has(name) ? stored(v, KNOWN.get(name).kind) : undefined;
      if (ok === undefined) skipped.push(name);
      else values.set(name, ok);
    }
  };
  read(json.settings, 'settings');
  read(json.secrets, 'secrets');
  return { values, skipped, app: typeof json.app === 'string' ? json.app : '', newer: Number(json.version) > FORMAT };
}

// The value each setting would have after importing, as kept in storage.
function after(name, v, storage) {
  const { kind } = KNOWN.get(name);
  if (kind === 'text') return v;
  if (kind === 'merge') {
    let now = {};
    try { now = JSON.parse(get(storage, name)) || {}; } catch { /* replaced */ }
    return JSON.stringify({ ...(isObject(now) ? now : {}), ...v });
  }
  return JSON.stringify(v);
}

// What importing would change here: the names of the settings, in the order they're
// listed in Settings, without those that are the same already.
export function settingsChanges(file, storage) {
  const labels = [];
  for (const [name, v] of file.values) {
    if (get(storage, name) === after(name, v, storage)) continue;
    const { label } = KNOWN.get(name);
    if (!labels.includes(label)) labels.push(label);
  }
  const order = [...new Set([...SETTINGS, ...SECRETS].map(([, , l]) => l))];
  return labels.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// Puts the file's settings in storage. Settings the file doesn't have are left as they are.
// Returns how many were written.
export function applySettings(file, storage) {
  let n = 0;
  for (const [name, v] of file.values) {
    const next = after(name, v, storage);
    if (get(storage, name) === next) continue;
    storage.setItem(PREFIX + name, next);
    n++;
  }
  return n;
}

// "Text to speech, AI help and Keyboard shortcuts"
export const listLabels = (l) => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`);

// The question before importing, from what it would change.
export function importQuestion(labels, { name = 'the file', newer = false, skipped = 0 } = {}) {
  return [
    `Replace these settings with the ones in ${name}: ${listLabels(labels)}?`,
    'Settings the file doesn’t have stay as they are. Projects aren’t touched.',
    newer ? 'It was saved by a newer version of Scribecue, so some of it may be left out.' : '',
    skipped ? `${skipped} setting${skipped === 1 ? ' couldn’t be used and is' : 's couldn’t be used and are'} left out.` : '',
    'Scribecue reloads to use them.',
  ].filter(Boolean).join(' ');
}

// ---- the Storage section's part

const $ = (id) => document.getElementById(id);
const DONE = 'scribecue.settingsImported'; // in sessionStorage, for the toast after reloading
let hooks = { toast: () => {}, version: '', beforeReload: () => {} };
let pending = null; // { file, name } waiting for the person to say yes

const status = (msg) => { $('setsStatus').textContent = msg; };

function download(secrets) {
  const file = exportSettings(localStorage, { secrets, version: hooks.version });
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: SETTINGS_FILE });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status(`Saved ${SETTINGS_FILE}${file.secrets ? ', with your API keys. Keep it private' : secrets ? '. There were no API keys to include' : ''}. Import it in another browser to use these settings there.`);
}

function ask(show) {
  $('setsConfirm').hidden = !show;
  if (!show) pending = null;
}

async function load(f) {
  ask(false);
  try {
    if (f.size > MAX_FILE) throw new Error('it’s too big to be a settings file');
    const file = readSettingsFile(JSON.parse(await f.text()));
    const labels = settingsChanges(file, localStorage);
    if (!labels.length) return status(`${f.name} has the same settings as this browser, so nothing needs to change.`);
    pending = { file, name: f.name };
    $('setsWhat').textContent = importQuestion(labels, { name: f.name, newer: file.newer, skipped: file.skipped.length });
    ask(true);
    status('');
    $('setsCancel').focus();
  } catch (e) {
    status(`Couldn’t import ${f.name}: ${e instanceof SyntaxError ? 'the file is damaged' : e.message}.`);
  }
}

function go() {
  if (!pending) return;
  const { file, name } = pending;
  try {
    hooks.beforeReload();
    applySettings(file, localStorage);
  } catch (e) {
    ask(false);
    return status(`Couldn’t import ${name}: ${e.message}.`);
  }
  try { sessionStorage.setItem(DONE, name); } catch { /* no toast then */ }
  location.reload();
}

export function initSettingsFile(h) {
  hooks = { ...hooks, ...h };
  // Exporting asks first whether to include API keys. It starts with them left out each
  // time, so a file with keys is never made by accident.
  const secrets = $('setsSecrets'), exportDlg = $('setsExportDlg');
  const showSecrets = (on) => {
    secrets.setAttribute('aria-pressed', String(on));
    $('setsSecretsWarn').hidden = !on;
  };
  secrets.addEventListener('click', () => showSecrets(secrets.getAttribute('aria-pressed') !== 'true'));
  $('setsExport').addEventListener('click', () => {
    ask(false);
    showSecrets(false);
    exportDlg.showModal();
    $('setsSave').focus();
  });
  $('setsExportCancel').addEventListener('click', () => exportDlg.close());
  $('setsSave').addEventListener('click', () => {
    const on = secrets.getAttribute('aria-pressed') === 'true';
    exportDlg.close();
    download(on);
  });
  $('setsImport').addEventListener('click', () => $('setsFile').click());
  $('setsFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) load(f); });
  $('setsGo').addEventListener('click', go);
  $('setsCancel').addEventListener('click', () => { ask(false); status(''); });
  // Leaving the section, or Settings, drops a question that wasn't answered.
  $('offlineDlg').addEventListener('close', () => { ask(false); status(''); });
  let done = null;
  try { done = sessionStorage.getItem(DONE); sessionStorage.removeItem(DONE); } catch { /* none */ }
  if (done) setTimeout(() => hooks.toast(`Settings imported from ${done}`), 500);
}
