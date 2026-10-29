// Optional update check. Scribecue asks once whether it may check GitHub for a
// newer release. If the answer is no, nothing ever leaves the machine. If yes,
// it asks GitHub's API for the latest release at most once a day; the request
// carries no cookies, no referrer and nothing about the user's work.

export const VERSION = '0.14.0';

const REPO = 'kyle95wm/Scribecue';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES = `https://github.com/${REPO}/releases`;
const DAY = 24 * 60 * 60 * 1000;
const K_OPT = 'scribecue.updates';          // '1' check, '0' never, missing = not asked yet
const K_LAST = 'scribecue.updateCheck';     // { at, latest, url }
const K_DISMISS = 'scribecue.updateDismissed';

const $ = (id) => document.getElementById(id);
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };
const lastCheck = () => { try { return JSON.parse(get(K_LAST)) || null; } catch { return null; } };

// 1.10.0 > 1.9.2; a leading "v" and anything after "-" are ignored.
export function newer(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m > 1 ? 's' : ''} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

let toast = () => {};
let checking = false;
let later = false; // Later pressed: hide the alert until Scribecue is next opened
let failed = false;
const dlg = () => $('updates');

async function check() {
  if (checking || get(K_OPT) !== '1') return;
  checking = true;
  failed = false;
  render();
  try {
    const r = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    let rel = null;
    if (r.ok) rel = await r.json();
    else if (r.status !== 404) throw new Error(r.status); // 404: no releases published yet
    set(K_LAST, JSON.stringify({ at: Date.now(), latest: rel?.tag_name || null, url: rel?.html_url || RELEASES }));
  } catch {
    failed = true;
  }
  checking = false;
  render();
}

function available() {
  const c = lastCheck();
  return get(K_OPT) === '1' && c?.latest && newer(c.latest, VERSION) ? c : null;
}

// Footer notice and the dialog's contents both follow the stored state.
function render() {
  const up = available();
  const btn = $('verBtn');
  btn.textContent = up ? `Update available: ${up.latest.replace(/^v/, '')}` : `v${VERSION}`;
  btn.classList.toggle('new', !!up);
  btn.dataset.tip = up ? 'A newer version of Scribecue is out. Click for what\'s new and how to update'
    : 'Scribecue version and update settings';
  // The alert drops down at the top for people who check for updates, until they skip
  // that version or put it off for this session.
  const alert = $('updAlert');
  alert.hidden = !up || get(K_DISMISS) === up.latest || later;
  if (up) {
    $('updAlertTitle').textContent = `Scribecue ${up.latest.replace(/^v/, '')} is available`;
    $('updAlertHave').textContent = `You have ${VERSION}.`;
    $('updAlertNotes').href = up.url;
  }

  const opt = get(K_OPT);
  $('updAsk').hidden = opt !== null;
  $('updMain').hidden = opt === null;
  $('updCurrent').textContent = VERSION;
  $('updOpt').checked = opt === '1';
  $('updNow').disabled = opt !== '1' || checking;
  $('updNew').hidden = !up;
  if (up) {
    $('updNewText').textContent = `Scribecue ${up.latest.replace(/^v/, '')} is available. You have ${VERSION}.`;
    $('updNotes').href = up.url;
  }
  const c = lastCheck();
  $('updStatus').textContent =
    opt !== '1' ? 'Update checks are off. Scribecue doesn\'t contact anything outside your computer.'
    : checking ? 'Checking GitHub…'
    : failed ? 'Couldn\'t reach GitHub. It will try again next time you open Scribecue.'
    : !c ? 'Not checked yet.'
    : up ? `Checked ${ago(c.at)}.`
    : `You have the latest version. Checked ${ago(c.at)}.`;
}

export function openUpdates() {
  render();
  if (!dlg().open) dlg().showModal();
}

// The update check choice: '1' checks, '0' never, null if not asked yet.
export const updateChoice = () => get(K_OPT);
export function setUpdateChoice(on) { choose(on); }

function choose(on) {
  set(K_OPT, on ? '1' : '0');
  if (!on) set(K_LAST, null);
  render();
  if (on) check();
}

// ask: false leaves the first-run question to the welcome wizard.
export function initUpdates(opts = {}) {
  toast = opts.toast || toast;
  const d = dlg();
  $('verBtn').addEventListener('click', (e) => { e.currentTarget.blur(); openUpdates(); });
  $('updAlertLater').addEventListener('click', () => { later = true; render(); });
  $('updAlertSkip').addEventListener('click', () => {
    set(K_DISMISS, available()?.latest || null);
    render();
    toast('You won’t be reminded about this version. The version number, bottom right, still shows it');
  });
  $('updYes').addEventListener('click', () => { choose(true); d.close(); toast('Scribecue will check for updates once a day'); });
  $('updNo').addEventListener('click', () => { choose(false); d.close(); toast('Update checks are off. Turn them on from the version number, bottom right'); });
  $('updOpt').addEventListener('change', (e) => choose(e.target.checked));
  $('updNow').addEventListener('click', check);
  $('updClose').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  // Keep the editor's shortcuts (Space, arrows…) from firing behind the dialog.
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
  // Asking counts as an answer only once a button is pressed; Esc asks again next time.
  render();
  if (get(K_OPT) === null) { if (opts.ask !== false) setTimeout(openUpdates, 800); }
  else {
    const c = lastCheck();
    if (get(K_OPT) === '1' && (!c || Date.now() - c.at > DAY)) check();
  }
}
