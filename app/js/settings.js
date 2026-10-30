// The Settings window: one place for everything that's set up rather than used while
// working, in sections down the left. The panels that used to be windows of their own
// (text to speech, speech to text, storage, keyboard shortcuts) are moved in as they are,
// and each old window stands in for its section, so the code that opens, closes or checks
// it keeps working unchanged: showing it shows the section, closing it closes Settings, and
// "open" means its section is the one showing.
import { HOSTED } from './config.js';

const $ = (id) => document.getElementById(id);
const sections = new Map(); // id -> { pane, tab, open, dialog }
let current = null;

const dlg = () => $('settingsDlg');

// Adds a section, with `content` in it if given. open: what its tab does, to bring the
// section up to date as it's shown; without one, the tab just shows it.
export function addSection(id, title, { open = null, content = null } = {}) {
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
  tab.addEventListener('click', () => (open ? open() : openSettings(id)));
  $('setTabs').append(tab);
  sections.set(id, { pane, tab, open, dialog: null });
  if (content) place(content, id);
  return pane;
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
  Object.defineProperty(dialog, 'open', { configurable: true, get: () => isShowing(id) });
  dialog.showModal = () => openSettings(id);
  dialog.show = () => openSettings(id);
  dialog.close = () => { if (isShowing(id)) closeSettings(); };
}

export const isShowing = (id) => !!dlg()?.open && current === id;
export const settingsOpen = () => !!dlg()?.open;

// Shows a section, opening Settings if it isn't open.
export function openSettings(id = 'general') {
  if (!sections.has(id)) id = 'general';
  if (current !== id) leave();
  current = id;
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

// Tells the section being left that its window has closed, as it used to be told.
function leave() {
  const s = current && sections.get(current);
  s?.dialog?.dispatchEvent(new Event('close'));
}

export function initSettings() {
  const d = dlg();
  $('setClose').addEventListener('click', () => d.close());
  d.addEventListener('close', () => { leave(); current = null; });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  // The editor's shortcuts don't fire behind it. Up and Down move between the sections.
  document.addEventListener('keydown', (e) => {
    if (!d.open) return;
    e.stopPropagation();
    if (!e.target.matches?.('#setTabs [role="tab"]')) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = [...sections.values()].map((s) => s.tab);
    const i = tabs.indexOf(e.target);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length;
    tabs[n].click();
    tabs[n].focus();
  }, true);
}
