// The Settings window: one place for everything that's set up rather than used while
// working, in sections down the left. The panels that used to be windows of their own
// (text to speech, speech to text, storage, keyboard shortcuts, diagnostics) are moved in
// as they are, and each old window stands in for its section, so the code that opens,
// closes or checks it keeps working unchanged: showing it shows the section, closing it
// closes Settings, and "open" means its section is the one showing. A window can be split
// over more than one section (`share`), and is open while any of them shows.
//
// The search box at the top looks through every section's headings and the words under
// them, and opens the one picked at its heading.
import { HOSTED } from './config.js';
import { searchEntries, snippet, marks } from './setsearch.js';

const $ = (id) => document.getElementById(id);
const sections = new Map(); // id -> { pane, tab, open, dialog, title, search }
let current = null;
let index = null; // what search looks through, built when it's first needed
let foundTimer = 0;

const dlg = () => $('settingsDlg');

// Adds a section, with `content` in it if given. open: what its tab does, to bring the
// section up to date as it's shown; without one, the tab just shows it. search: entries
// for things the section draws only when shown, such as the list of shortcuts, each
// { heading, text, go }, where go(query) shows it.
export function addSection(id, title, { open = null, content = null, search = null } = {}) {
  const pane = document.createElement('section');
  pane.className = 'setpane';
  pane.id = `set-${id}`;
  pane.setAttribute('role', 'tabpanel');
  pane.setAttribute('aria-labelledby', `settab-${id}`);
  pane.hidden = true;
  const h = document.createElement('h2');
  h.className = 'settitle';
  h.textContent = title;
  pane.append(h);
  $('setPanes').append(pane);
  const tab = document.createElement('button');
  tab.id = `settab-${id}`;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', pane.id);
  tab.setAttribute('aria-selected', 'false');
  tab.tabIndex = -1;
  tab.textContent = title;
  tab.addEventListener('click', () => { clearSearch(); show(id); });
  $('setTabs').append(tab);
  sections.set(id, { pane, tab, open, dialog: null, title, search });
  if (content) place(content, id);
  return pane;
}

// Shows a section the way its tab does.
function show(id) {
  const s = sections.get(id);
  return s.open ? s.open() : openSettings(id);
}

// Moves an element into a section, and shows it.
export function place(el, id) {
  for (const x of el.querySelectorAll('.hosted-only')) x.hidden = !HOSTED;
  for (const x of el.querySelectorAll('.docker-only')) x.hidden = HOSTED;
  el.hidden = false;
  sections.get(id).pane.append(el);
}

// Moves a panel's window into a section, leaving out its title and the buttons that only
// closed it, and makes the old window stand in for the section.
export function adopt(dialog, id, { skip = [] } = {}) {
  const s = sections.get(id);
  for (const el of [...dialog.children]) {
    if (el.matches('h2:first-child')) continue;
    s.pane.append(el);
  }
  for (const sel of skip) for (const el of s.pane.querySelectorAll(sel)) el.hidden = true;
  s.dialog = dialog;
  Object.defineProperty(dialog, 'open', { configurable: true, get: () => showingDialog(dialog) });
  dialog.showModal = () => openSettings(id);
  dialog.show = () => openSettings(id);
  dialog.close = () => { if (showingDialog(dialog)) closeSettings(); };
}

// Moves part of an adopted window into another section. The window counts as open while
// either shows, so it keeps the part up to date, and moving between the two doesn't tell
// it that it closed. `els` are moved in order.
export function share(dialog, id, els) {
  const s = sections.get(id);
  for (const el of els) s.pane.append(el);
  s.dialog = dialog;
}

const showingDialog = (dialog) => !!dlg()?.open && !!current && sections.get(current)?.dialog === dialog;
export const isShowing = (id) => !!dlg()?.open && current === id;
export const settingsOpen = () => !!dlg()?.open;

// Shows a section, opening Settings if it isn't open.
export function openSettings(id = 'general') {
  if (!sections.has(id)) id = 'general';
  if (current !== id) leave(id);
  current = id;
  showResults(false);
  for (const [k, s] of sections) {
    s.pane.hidden = k !== id;
    s.tab.setAttribute('aria-selected', String(k === id));
    s.tab.tabIndex = k === id ? 0 : -1;
  }
  const d = dlg();
  const s = sections.get(id);
  if (!d.open) { d.showModal(); s.tab.focus(); }
  s.pane.scrollTop = 0;
}

export function closeSettings() {
  if (dlg().open) dlg().close();
}

// Tells the section being left that its window has closed, as it used to be told, unless
// the next section is part of the same window.
function leave(next = null) {
  const s = current && sections.get(current);
  if (!s?.dialog || sections.get(next)?.dialog === s.dialog) return;
  s.dialog.dispatchEvent(new Event('close'));
}

// ---- search

// Whether an element shows when its section does: not hidden, and not for another mode.
function shows(el, pane, seen) {
  const chain = [];
  let ok = true;
  for (let x = el; x && x !== pane; x = x.parentElement) {
    if (seen.has(x)) { ok = seen.get(x); break; }
    chain.push(x);
    if (x.hidden || getComputedStyle(x).display === 'none') { ok = false; break; }
  }
  for (const x of chain) if (!ok || !seen.has(x)) seen.set(x, ok);
  return ok;
}

// Every heading in every section, with the words under it up to the next heading. Words
// before the first heading go with the section's own title.
function buildIndex() {
  const out = [];
  for (const [id, s] of sections) {
    if (s.tab.hidden) continue;
    const seen = new Map();
    let entry = { section: id, title: s.title, heading: s.title, text: '', el: s.pane.querySelector('.settitle'), own: true };
    const parts = [entry];
    const walk = document.createTreeWalker(s.pane, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.matches('script, style, option:not(:checked), #diagText, #keysList')) return NodeFilter.FILTER_REJECT;
          return shows(n, s.pane, seen) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) { if (!n.parentElement.matches('h2, h3')) entry.text += n.data; continue; }
      if (n.matches('h3')) {
        entry = { section: id, title: s.title, heading: n.textContent.replace(/\s+/g, ' ').trim(), text: '', el: n };
        parts.push(entry);
        continue;
      }
      // Tooltips and the names of fields say what a control is for.
      for (const a of ['data-tip', 'aria-label', 'placeholder']) {
        const v = n.getAttribute(a);
        if (v && !/^[\d.…:,\s-]*$/.test(v)) entry.text += ` ${v} `;
      }
      if (/^(P|DIV|LABEL|LI|DT|DD|BUTTON|SECTION|TR)$/.test(n.tagName)) entry.text += ' ';
    }
    for (const e of parts) e.text = e.text.replace(/\s+/g, ' ').trim();
    out.push(...parts);
    for (const e of s.search?.() || []) out.push({ section: id, title: s.title, ...e });
  }
  return out;
}

function showResults(on) {
  const r = $('setResults');
  if (!r) return;
  r.hidden = !on;
  if (on) for (const s of sections.values()) {
    s.pane.hidden = true;
    s.tab.setAttribute('aria-selected', 'false');
  }
}

function clearSearch() {
  const f = $('setSearch');
  if (f) f.value = '';
  showResults(false);
}

// Text with the query's words marked.
function marked(text, q) {
  const span = document.createElement('span');
  for (const p of marks(text, q)) {
    if (!p.hit) { span.append(p.text); continue; }
    const m = document.createElement('mark');
    m.textContent = p.text;
    span.append(m);
  }
  return span;
}

function runSearch() {
  const q = $('setSearch').value;
  if (!q.trim()) {
    showResults(false);
    if (current) openSettings(current);
    return;
  }
  index ||= buildIndex();
  const found = searchEntries(index, q);
  const list = $('setResultList');
  list.textContent = '';
  $('setResultCount').textContent = found.length
    ? `${found.length === 30 ? 'The first 30 places' : found.length === 1 ? 'One place' : `${found.length} places`} with “${q.trim()}”`
    : `Nothing in Settings matches “${q.trim()}”. Try another word, such as voice, key or name.`;
  for (const e of found) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'setresult';
    const where = document.createElement('span');
    where.className = 'setwhere';
    where.textContent = e.own ? e.title : `${e.title} ›`;
    b.append(where);
    if (!e.own) { const h = marked(e.heading, q); h.className = 'sethit'; b.append(' ', h); }
    const bit = snippet(e.text, q) || (e.minor ? e.text : ''); // a shortcut shows its keys
    if (bit) { const p = marked(bit, q); p.className = 'setbit'; b.append(p); }
    b.addEventListener('click', () => go(e, q));
    li.append(b);
    list.append(li);
  }
  showResults(true);
}

// Opens a result's section at its heading, and marks the heading for a moment.
async function go(e, q) {
  clearSearch();
  index = null;
  if (e.go) { await e.go(q); return; }
  await show(e.section);
  const s = sections.get(e.section);
  const h = e.el && s.pane.contains(e.el) ? e.el : null;
  if (!h) return;
  if (!h.matches('.settitle')) h.scrollIntoView({ block: 'start' });
  clearTimeout(foundTimer);
  for (const x of document.querySelectorAll('.setfound')) x.classList.remove('setfound');
  h.classList.add('setfound');
  h.tabIndex = -1;
  h.focus({ preventScroll: true });
  foundTimer = setTimeout(() => h.classList.remove('setfound'), 2000);
}

export function initSettings() {
  const d = dlg();
  $('setClose').addEventListener('click', () => d.close());
  d.addEventListener('close', () => { leave(); current = null; clearSearch(); index = null; });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  const field = $('setSearch');
  field.addEventListener('input', runSearch);
  // Keys in the search box and its results. Called from the handler below, which keeps
  // keys from going any further while Settings is open.
  const searchKeys = (e) => {
    const list = $('setResultList'), all = [...list.querySelectorAll('button')];
    if (e.target === field) {
      if (e.key === 'Escape' && field.value) { field.value = ''; runSearch(); }
      else if (e.key === 'Enter') all[0]?.click();
      else if (e.key === 'ArrowDown') all[0]?.focus();
      else return false;
    } else if (list.contains(e.target)) {
      // Up and Down move between results, and back up to the search box.
      const i = all.indexOf(e.target);
      if (e.key === 'ArrowDown') all[i + 1]?.focus();
      else if (e.key === 'ArrowUp') (all[i - 1] || field).focus();
      else if (e.key === 'Escape') field.focus();
      else return false;
    } else return false;
    e.preventDefault();
    return true;
  };
  // The editor's shortcuts don't fire behind it. Ctrl/Cmd+F goes to the search box. Up and
  // Down move between the sections.
  document.addEventListener('keydown', (e) => {
    if (!d.open) return;
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      field.focus();
      field.select();
      return;
    }
    if (searchKeys(e)) return;
    if (!e.target.matches?.('#setTabs [role="tab"]')) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = [...sections.values()].map((s) => s.tab).filter((t) => !t.hidden);
    const i = tabs.indexOf(e.target);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length;
    tabs[n].click();
    tabs[n].focus();
  }, true);
}
