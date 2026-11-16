// The Subtitles from OpenSubtitles dialog, opened from the Dialogue picker, and its part of
// Settings (under AI help, with the TMDB key): the key, and signing in for more downloads.
// The searching and downloading are in opensubtitles.js.
import { movieHash, guessFromName, search, download, signIn, signOut, LANGUAGES, KEY_PAGE, API } from './opensubtitles.js';
import { storedKey, storeKey } from './aidrawer.js';
import { parseSubs } from './formats.js';
import { VERSION } from './update.js';

const $ = (id) => document.getElementById(id);
const PREFS = 'scribecue.opensubs';
const APP = `Scribecue v${VERSION}`;
let h = { video: () => null, use: () => 0, toast: () => {} };
let hashFor = null, hash = null, busy = false, results = [];

const prefs = () => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } };
const keepPrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify({ ...prefs(), ...p })); } catch { /* ignore */ } };

// The key and sign-in, as the requests need them.
function account() {
  let login = null;
  try { login = JSON.parse(storedKey('opensubtitlesLogin') || 'null'); } catch { /* none */ }
  return { key: storedKey('opensubtitles'), token: login?.token || '', base: login?.base || API, user: login?.user || '', allowed: login?.allowed ?? null, app: APP };
}
const forgetLogin = () => storeKey('opensubtitlesLogin', '');

// ---- the dialog

export function openOpenSubs() {
  const file = h.video();
  if (!file) return h.toast('Open the video first');
  const d = $('osDlg');
  const guess = guessFromName(file.name);
  if (hashFor !== file) {
    hashFor = file;
    hash = null;
    results = [];
    $('osQuery').value = guess.query;
    $('osSeason').value = guess.season;
    $('osEpisode').value = guess.episode;
    $('osYear').value = guess.year;
    $('osStatus').textContent = '';
    renderList();
  }
  $('osKeyRow').hidden = !!account().key;
  d.showModal();
  ($('osKeyRow').hidden ? $('osGo') : $('osKey')).focus();
}

const label = (r) => [r.language.toUpperCase(), r.hearing && 'SDH', r.machine && 'machine translated', r.fps && `${+r.fps.toFixed(3)} fps`,
  `${r.downloads.toLocaleString('en')} downloads`].filter(Boolean).join(' · ');

function renderList() {
  const list = $('osList');
  list.textContent = '';
  for (const r of results) {
    const li = document.createElement('li');
    const what = document.createElement('span');
    what.className = 'what';
    const name = document.createElement('strong');
    name.textContent = r.release || r.title;
    const about = document.createElement('span');
    about.className = 'dim small';
    about.textContent = `${r.title} · ${label(r)}`;
    what.append(name, about);
    if (r.matches) {
      const fit = document.createElement('span');
      fit.className = 'osfit small';
      fit.textContent = 'Fits this file';
      li.append(fit);
    }
    const use = document.createElement('button');
    use.textContent = 'Use';
    use.setAttribute('aria-label', `Use ${r.release || r.title}`);
    use.addEventListener('click', () => pick(r));
    li.prepend(what);
    li.append(use);
    list.append(li);
  }
}

function keyFromDialog() {
  const typed = $('osKey').value.trim();
  if (typed) return typed;
  return account().key;
}

async function find() {
  if (busy) return;
  const file = h.video(), status = $('osStatus');
  const key = keyFromDialog();
  if (!key) {
    $('osKeyRow').hidden = false;
    status.textContent = 'Searching needs your own free OpenSubtitles key: get one, paste it here, then Search.';
    $('osKey').focus();
    return;
  }
  if (navigator.onLine === false) { status.textContent = 'You’re offline, so OpenSubtitles can’t be reached.'; return; }
  busy = true;
  $('osGo').disabled = true;
  status.textContent = 'Searching…';
  try {
    if (file && hashFor === file && !hash) hash = await movieHash(file).catch(() => null);
    const language = $('osLang').value;
    keepPrefs({ language });
    const ask = (acc) => search({ ...acc, key, hash, query: $('osQuery').value, season: $('osSeason').value.trim(), episode: $('osEpisode').value.trim(), year: $('osYear').value.trim(), language });
    let acc = account();
    try { results = await ask(acc); } catch (e) {
      if (e.auth !== 'token' || !acc.token) throw e;
      forgetLogin();
      renderSettings();
      acc = account();
      results = await ask(acc);
    }
    if ($('osKey').value.trim()) { storeKey('opensubtitles', key); $('osKey').value = ''; $('osKeyRow').hidden = true; renderSettings(); }
    renderList();
    const fits = results.filter((r) => r.matches).length;
    status.textContent = !results.length ? 'Nothing found. Try the title alone, or another language.'
      : fits ? `${results.length} found. ${fits === 1 ? 'One fits' : `${fits} fit`} this file exactly.`
        : `${results.length} found. None was timed for this file, so check the one you pick against the sound.`;
  } catch (e) {
    if (e.auth === 'key') { storeKey('opensubtitles', ''); $('osKeyRow').hidden = false; renderSettings(); }
    status.textContent = e instanceof TypeError ? 'Couldn’t reach OpenSubtitles. Check your connection.' : `${e.message}.`;
  } finally {
    busy = false;
    $('osGo').disabled = false;
  }
}

async function pick(r) {
  if (busy) return;
  const file = h.video(), status = $('osStatus');
  busy = true;
  for (const b of $('osList').querySelectorAll('button')) b.disabled = true;
  status.textContent = 'Downloading…';
  try {
    let acc = account(), got;
    try { got = await download(r.fileId, acc); } catch (e) {
      if (e.auth !== 'token' || !acc.token) throw e;
      forgetLogin();
      renderSettings();
      h.toast('Your OpenSubtitles sign-in ran out, so this download counts as not signed in. Sign in again in Settings');
      acc = account();
      got = await download(r.fileId, acc);
    }
    if (h.video() !== file) return;
    const lines = parseSubs(got.text);
    if (!lines.length) { status.textContent = 'That file had no subtitles in it. Try another.'; return; }
    const n = h.use(file, `OpenSubtitles: ${r.release || r.title}`, lines);
    status.textContent = '';
    $('osDlg').close();
    const left = got.remaining == null ? '' : ` ${got.remaining === 1 ? '1 download' : `${got.remaining} downloads`} left today.`;
    h.toast(`Dialogue lane: ${n.toLocaleString('en')} subtitles from OpenSubtitles${r.matches ? '' : '. Check they keep time with the sound'}.${left} D and Shift+D jump between free gaps`);
  } catch (e) {
    if (e.auth === 'key') { storeKey('opensubtitles', ''); $('osKeyRow').hidden = false; renderSettings(); }
    status.textContent = e instanceof TypeError ? 'Couldn’t reach OpenSubtitles. Check your connection.'
      : e.quota ? `${e.message}. Sign in to your OpenSubtitles account in Settings for more, or try again tomorrow.` : `${e.message}.`;
  } finally {
    busy = false;
    for (const b of $('osList').querySelectorAll('button')) b.disabled = false;
  }
}

// ---- Settings

export function renderSettings() {
  const acc = account();
  $('setOsKey').value = acc.key;
  $('setOsForget').hidden = !acc.key;
  $('setOsSignedIn').hidden = !acc.token;
  $('setOsSignedOut').hidden = !!acc.token;
  $('setOsWho').textContent = acc.token ? `Signed in as ${acc.user}${acc.allowed ? `, ${acc.allowed} downloads a day` : ''}.` : '';
}

async function settingsSignIn() {
  const status = $('setOsStatus'), user = $('setOsUser').value.trim(), pass = $('setOsPass').value;
  const key = account().key;
  if (!key) { status.textContent = 'Add your OpenSubtitles key first.'; $('setOsKey').focus(); return; }
  if (!user || !pass) { status.textContent = 'Type your OpenSubtitles username and password.'; return; }
  status.textContent = 'Signing in…';
  $('setOsSignIn').disabled = true;
  try {
    const login = await signIn(user, pass, { key, app: APP });
    storeKey('opensubtitlesLogin', JSON.stringify(login));
    status.textContent = 'Signed in.';
  } catch (e) {
    status.textContent = e instanceof TypeError ? 'Couldn’t reach OpenSubtitles. Check your connection.' : `${e.message}.`;
  } finally {
    $('setOsPass').value = '';
    $('setOsSignIn').disabled = false;
    renderSettings();
  }
}

export function initOpenSubs(hooks) {
  h = { ...h, ...hooks };
  const lang = $('osLang');
  for (const [code, name] of LANGUAGES) lang.append(new Option(name, code));
  lang.value = LANGUAGES.some(([c]) => c === prefs().language) ? prefs().language : 'en';
  $('osKeyGet').href = KEY_PAGE;
  $('setOsGet').href = KEY_PAGE;
  $('osGo').addEventListener('click', find);
  for (const id of ['osKey', 'osQuery', 'osSeason', 'osEpisode', 'osYear']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  }
  $('osCancel').addEventListener('click', () => $('osDlg').close());
  $('osDlg').addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  $('setOsKey').addEventListener('change', (e) => {
    storeKey('opensubtitles', e.target.value.trim());
    renderSettings();
    $('setOsStatus').textContent = e.target.value ? 'Saved.' : 'Forgotten.';
  });
  $('setOsForget').addEventListener('click', () => { storeKey('opensubtitles', ''); renderSettings(); $('setOsStatus').textContent = 'Forgotten.'; });
  $('setOsSignIn').addEventListener('click', settingsSignIn);
  $('setOsPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); settingsSignIn(); } });
  $('setOsSignOut').addEventListener('click', async () => {
    const acc = account();
    forgetLogin();
    renderSettings();
    $('setOsStatus').textContent = 'Signed out.';
    await signOut(acc);
  });
  renderSettings();
}
