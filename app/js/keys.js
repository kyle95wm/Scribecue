// Changing the keyboard shortcuts: the panel, saving them in this browser, sharing them
// as a file, and showing them wherever keys are listed. The shortcuts themselves are in
// keymap.js.
import {
  GROUPS, RESERVED, comboOf, bindings, lookup, assign, unassign, resetAction, exportKeys, importKeys,
  keyLabels, comboText, KEYS_FILE,
} from './keymap.js';

const KEY = 'scribecue.keys';
const $ = (id) => document.getElementById(id);
let changes = {};
try { changes = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* ignore */ }
if (typeof changes !== 'object' || Array.isArray(changes)) changes = {};
export const keyChanges = () => changes;

let hooks = { onChange: () => {}, toast: () => {}, mac: true };
let capturing = null; // the action waiting for a key

function changed(next) {
  changes = next;
  try { localStorage.setItem(KEY, JSON.stringify(changes)); } catch { /* ignore */ }
  hooks.onChange(lookup(changes));
  showKeys();
  render();
}

const kbds = (combo) => keyLabels(combo, hooks.mac).map((k) => `<kbd>${k.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</kbd>`).join('');

// ---- where keys are shown: the shortcuts overlay, the hint line, the player buttons

// The player buttons' tooltips name their key in brackets at the end.
const CONTROLS = {
  prevBlock: 'blockBack', back3: 'back3', backFrame: 'frameBack', play: 'play', fwdFrame: 'frameFwd',
  fwd3: 'fwd3', nextBlock: 'blockNext', playBlock: 'playBlock', loop: 'loopBlock',
};
function showKeys() {
  const all = bindings(changes);
  const custom = (ids) => ids.some((id) => id in changes);
  for (const dt of document.querySelectorAll('[data-keys]')) {
    dt.dataset.orig ??= dt.innerHTML;
    const ids = dt.dataset.keys.split(' ');
    if (!custom(ids)) { dt.innerHTML = dt.dataset.orig; continue; }
    const prefix = ids[0] === 'hold' ? 'Hold ' : '';
    dt.innerHTML = prefix + ids.map((id) => (all[id][0] ? kbds(all[id][0]) : '—')).join(' ');
    delete dt.dataset.pc; // its own keys now, not the Mac-to-PC swap
  }
  for (const b of document.querySelectorAll('[data-ctl]')) {
    const id = CONTROLS[b.dataset.ctl];
    if (!id) continue;
    for (const attr of ['data-tip', 'aria-label']) {
      const v = b.getAttribute(attr);
      if (!v) continue;
      const k = all[id][0] ? comboText(all[id][0], hooks.mac) : '';
      b.setAttribute(attr, v.replace(/\s*\([^()]*\)$/, '') + (k ? ` (${k})` : ''));
    }
  }
}

// ---- the panel

function render() {
  const list = $('keysList');
  if (!list || !$('keysDlg').open) return;
  const all = bindings(changes), find = $('keysFind').value.trim().toLowerCase();
  list.textContent = '';
  for (const [group, actions] of GROUPS) {
    const rows = actions.filter(([id, label]) => !find || label.toLowerCase().includes(find)
      || all[id].some((c) => comboText(c, hooks.mac).toLowerCase().includes(find)));
    if (!rows.length) continue;
    const h = document.createElement('h3');
    h.textContent = group;
    list.append(h);
    for (const [id, label] of rows) {
      const row = document.createElement('div');
      row.className = 'keysrow' + (id in changes ? ' changed' : '');
      const name = document.createElement('span');
      name.className = 'keysname';
      name.textContent = label;
      const keys = document.createElement('span');
      keys.className = 'keyskeys';
      for (const c of all[id]) {
        const b = document.createElement('button');
        b.className = 'keychip';
        b.innerHTML = kbds(c);
        b.setAttribute('aria-label', `${comboText(c, hooks.mac)}: take it off ${label}`);
        b.dataset.tip = 'Click to take this key off';
        b.addEventListener('click', () => changed(unassign(changes, id, c)));
        keys.append(b);
      }
      if (!all[id].length) keys.append(Object.assign(document.createElement('span'), { className: 'dim small', textContent: 'no key' }));
      const add = document.createElement('button');
      add.className = 'keyadd';
      add.textContent = capturing === id ? 'Press keys…' : 'Add';
      add.classList.toggle('on', capturing === id);
      add.addEventListener('click', () => { capturing = capturing === id ? null : id; status(capturing ? `Press the keys for “${label}”. Esc cancels.` : ''); render(); });
      row.append(name, keys, add);
      if (id in changes) {
        const reset = document.createElement('button');
        reset.className = 'link small';
        reset.textContent = 'Reset';
        reset.addEventListener('click', () => changed(resetAction(changes, id)));
        row.append(reset);
      }
      list.append(row);
      if (capturing === id) setTimeout(() => add.focus(), 0);
    }
  }
}
const status = (t) => { $('keysStatus').textContent = t; };
const labelOf = (id) => GROUPS.flatMap(([, a]) => a).find(([k]) => k === id)?.[1] || id;

// While waiting for a key, the next key press is the new shortcut.
function capture(e) {
  if (!capturing) return;
  if (e.key === 'Escape') { e.preventDefault(); capturing = null; status(''); render(); return; }
  if (e.key === 'Tab') return;
  const combo = comboOf(e);
  if (!combo) {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); status('Keys with Ctrl or Cmd stay as they are. Try another.'); }
    return; // a modifier on its own: wait for the rest
  }
  e.preventDefault();
  const id = capturing, text = comboText(combo, hooks.mac);
  if (RESERVED[combo]) return status(`${text} can’t be changed: ${RESERVED[combo]}. Try another.`);
  const owner = lookup(changes).get(combo);
  if (owner === id) { capturing = null; status(`${text} is already a key for this.`); return render(); }
  if (owner && !confirm(`${text} is the key for “${labelOf(owner)}”. Use it for “${labelOf(id)}” instead?`)) return;
  capturing = null;
  const { changes: next, movedFrom } = assign(changes, id, combo);
  changed(next);
  status(movedFrom ? `${text} now does “${labelOf(id)}”, and no longer “${labelOf(movedFrom)}”.` : `${text} now does “${labelOf(id)}”.`);
}

export function openKeys() {
  capturing = null;
  status(Object.keys(changes).length ? `${Object.keys(changes).length} changed from the usual keys.` : '');
  $('keysFind').value = '';
  $('keysDlg').showModal();
  render();
  $('keysFind').focus();
}

function download() {
  const blob = new Blob([JSON.stringify(exportKeys(changes), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: KEYS_FILE });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status(`Saved ${KEYS_FILE}. Others can load it with Import.`);
}

async function load(file) {
  try {
    const { changes: next, skipped } = importKeys(JSON.parse(await file.text()));
    changed(next);
    status(`Loaded ${file.name}.${skipped.length ? ` ${skipped.length === 1 ? '1 couldn’t be used and was' : `${skipped.length} couldn’t be used and were`} left out.` : ''}`);
  } catch (e) {
    status(`Couldn’t load ${file.name}: ${e instanceof SyntaxError ? 'the file is damaged' : e.message}.`);
  }
}

// onChange(lookup) runs with the new shortcuts whenever they change.
export function initKeys(h) {
  hooks = { ...hooks, ...h };
  const d = $('keysDlg');
  $('keysFind').addEventListener('input', render);
  $('keysDone').addEventListener('click', () => d.close());
  $('keysExport').addEventListener('click', download);
  $('keysImport').addEventListener('click', () => $('keysFile').click());
  $('keysFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) load(f); });
  $('keysResetAll').addEventListener('click', () => {
    if (!Object.keys(changes).length) return status('These are already the usual keys.');
    if (confirm('Put every shortcut back to the usual keys?')) { changed({}); status('Back to the usual keys.'); }
  });
  d.addEventListener('close', () => { capturing = null; });
  // The panel's own keys, and the key being captured, don't reach the editor.
  document.addEventListener('keydown', (e) => {
    if (!d.open) return;
    e.stopPropagation();
    capture(e);
  }, true);
  showKeys();
}
