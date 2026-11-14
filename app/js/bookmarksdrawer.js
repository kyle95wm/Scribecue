// The Bookmarks drawer: the writer's bookmarks in time order, to add, edit, delete and jump
// to, and markers to bring in from a Frazier script. It takes the place of Comments and AI
// help, as they take each other's.
import { KINDS, kindLabel, newBookmarkId, shownTitle, adcBookmarks, newBookmarks, TITLE_MAX, NOTES_MAX } from './bookmarks.js';
const $ = (id) => document.getElementById(id);
let hooks, editing = null, draft = null, drawn = '';
const SHOWN_KEY = 'scribecue.bookmarkKinds';
let shown = (() => {
  try { const v = JSON.parse(localStorage.getItem(SHOWN_KEY)); if (Array.isArray(v)) return new Set(v.filter((k) => KINDS.some((x) => x.id === k))); } catch { /* blocked */ }
  return new Set(KINDS.map((k) => k.id));
})();
const button = (label, action, tip = '') => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action);
  if (tip) b.dataset.tip = tip;
  return b;
};
const kindVar = (kind) => `var(${KINDS.find((k) => k.id === kind)?.token || '--bm-note'})`;

export const bookmarksOpen = () => !!$('bookmarksDrawer') && !$('bookmarksDrawer').hidden;

export function toggleBookmarks(open = !bookmarksOpen()) {
  if (open && !hooks.canBookmark()) return hooks.toast('Bookmarks are for Write and Transcribe. Switch modes at the top');
  if (!open) {
    editing = null; draft = null; drawn = '';
    $('bookmarksDrawer').hidden = true;
    $('bookmarksBtn').setAttribute('aria-pressed', 'false');
    document.activeElement?.blur();
    return;
  }
  hooks.closeOthers();
  $('bookmarksDrawer').hidden = false;
  $('bookmarksBtn').setAttribute('aria-pressed', 'true');
  refreshBookmarks();
  if (!editing) $('bookmarkAdd').focus();
}

// B: a bookmark at the playhead, there at once, with its title ready to type. Playback
// keeps going.
export function addBookmark(time = hooks.now()) {
  if (!hooks.canBookmark()) return hooks.toast('Bookmarks are for Write and Transcribe. Switch modes at the top');
  const b = { id: newBookmarkId(), time: Math.max(0, Math.min(time, hooks.duration())), title: '', notes: '', kind: 'note' };
  hooks.change(() => { hooks.bookmarks().push(b); hooks.bookmarks().sort((x, y) => x.time - y.time); });
  editing = b.id; draft = { time: hooks.tc(b.time), title: '', notes: '', kind: b.kind, fresh: true };
  if (!bookmarksOpen()) toggleBookmarks(true); else refreshBookmarks();
}

// Shows a bookmark in the list, as when its mark on the timeline is clicked.
export function revealBookmark(id) {
  if (!bookmarksOpen()) return;
  const b = hooks.bookmarks().find((x) => x.id === id);
  if (b && !shown.has(b.kind)) { shown.add(b.kind); saveShown(); refreshBookmarks(); }
  $('bookmarksLog').querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function saveShown() { try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown])); } catch { /* blocked */ } }

function kindButtons(selected, pick) {
  const group = document.createElement('div'); group.className = 'bm-kinds'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Kind');
  for (const k of KINDS) {
    const b = button(k.label, () => { pick(k.id); for (const x of group.children) x.setAttribute('aria-pressed', String(x.dataset.kind === k.id)); });
    b.dataset.kind = k.id; b.style.setProperty('--k', kindVar(k.id)); b.setAttribute('aria-pressed', String(selected === k.id));
    group.append(b);
  }
  return group;
}

function save(b) {
  const time = hooks.readTime(draft.time.trim());
  if (!Number.isFinite(time) || time < 0 || time > hooks.duration()) { $('bookmarksStatus').textContent = 'Enter a time within the timeline'; return false; }
  const next = { title: draft.title.trim().slice(0, TITLE_MAX), notes: draft.notes.trim().slice(0, NOTES_MAX), kind: draft.kind };
  // The time shown is to the frame: a bookmark only moves when its time is changed.
  const moved = draft.time.trim() !== hooks.tc(b.time);
  editing = null; draft = null;
  if (moved || next.title !== b.title || next.notes !== b.notes || next.kind !== b.kind) {
    hooks.change(() => { Object.assign(b, next); if (moved) b.time = time; hooks.bookmarks().sort((x, y) => x.time - y.time); });
  } else refreshBookmarks();
  $('bookmarksStatus').textContent = 'Bookmark saved';
  return true;
}

function editor(b) {
  const form = document.createElement('div'); form.className = 'bm-edit';
  const field = (label, el) => { const l = document.createElement('label'); l.className = 'airow'; l.append(label, el); return l; };
  const at = document.createElement('input'); at.className = 'bm-time'; at.spellcheck = false; at.value = draft.time; at.setAttribute('aria-label', 'Bookmark time');
  at.addEventListener('input', () => { draft.time = at.value; });
  const title = document.createElement('input'); title.value = draft.title; title.maxLength = TITLE_MAX; title.placeholder = 'Title, such as a name or “Act 2”';
  title.setAttribute('aria-label', 'Bookmark title'); title.addEventListener('input', () => { draft.title = title.value; });
  const notes = document.createElement('textarea'); notes.rows = 2; notes.value = draft.notes; notes.maxLength = NOTES_MAX; notes.placeholder = 'Notes (optional)';
  notes.setAttribute('aria-label', 'Bookmark notes'); notes.addEventListener('input', () => { draft.notes = notes.value; });
  const done = () => save(b) && hooks.focusOut();
  for (const el of [at, title]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); done(); } });
  notes.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(); } });
  const acts = document.createElement('div'); acts.className = 'acts';
  acts.append(button('Save', done), button('Cancel', () => { editing = null; draft = null; refreshBookmarks(); }));
  form.append(field('Time', at), field('Title', title), kindButtons(draft.kind, (k) => { draft.kind = k; }), notes, acts);
  return { form, focus: () => { title.focus(); title.setSelectionRange(title.value.length, title.value.length); } };
}

export function refreshBookmarks(force = false) {
  if (!hooks || !bookmarksOpen()) { drawn = ''; return; }
  const all = hooks.bookmarks();
  if (editing && !all.some((b) => b.id === editing)) { editing = null; draft = null; } // deleted by someone else
  // Changes to blocks call this too: the list is only drawn again when what it shows changed.
  const key = JSON.stringify([all, [...shown], editing, hooks.tc(0)]);
  if (key === drawn && !force) return;
  drawn = key;
  const list = all.filter((b) => shown.has(b.kind) || b.id === editing);
  for (const x of $('bookmarksKinds').children) x.setAttribute('aria-pressed', String(shown.has(x.dataset.kind)));
  const hidden = all.length - list.length;
  $('bookmarksCount').textContent = `${all.length} bookmark${all.length === 1 ? '' : 's'}${hidden ? ` · ${hidden} hidden` : ''}`;
  const log = $('bookmarksLog'), keep = log.scrollTop; log.replaceChildren();
  if (!list.length) {
    const p = document.createElement('p'); p.className = 'dim small';
    p.textContent = all.length ? 'No bookmarks of the kinds shown.' : 'No bookmarks yet. Press B to add one at the playhead.';
    log.append(p);
  }
  let focus = null;
  for (const b of list) {
    const row = document.createElement('article'); row.className = 'aimsg assistant bm'; row.dataset.id = b.id;
    row.style.setProperty('--k', kindVar(b.kind));
    if (b.id === editing) { const ed = editor(b); row.append(ed.form); focus = ed.focus; log.append(row); continue; }
    const head = document.createElement('div'); head.className = 'bm-head';
    const at = button(hooks.tc(b.time), () => hooks.go(b.time), 'Move the playhead here'); at.className = 'comment-location bm-at';
    const kind = document.createElement('span'); kind.className = 'bm-kind'; kind.textContent = kindLabel(b.kind);
    head.append(at, kind);
    const title = document.createElement('p'); title.className = 'bm-title' + (b.title ? '' : ' dim'); title.textContent = shownTitle(b);
    row.append(head, title);
    if (b.notes) { const n = document.createElement('p'); n.className = 'comment-body'; n.textContent = b.notes; row.append(n); }
    const acts = document.createElement('div'); acts.className = 'acts';
    acts.append(button('Edit', () => { editing = b.id; draft = { time: hooks.tc(b.time), title: b.title, notes: b.notes, kind: b.kind }; refreshBookmarks(); }),
      button('Delete', () => { if (editing === b.id) { editing = null; draft = null; } hooks.change(() => { const all = hooks.bookmarks(), i = all.indexOf(b); if (i >= 0) all.splice(i, 1); }); $('bookmarksStatus').textContent = 'Bookmark deleted. Ctrl/Cmd+Z brings it back'; }));
    row.append(acts); log.append(row);
  }
  log.scrollTop = keep;
  if (focus) { focus(); log.querySelector(`[data-id="${editing}"]`)?.scrollIntoView({ block: 'nearest' }); }
}

// Markers from a Frazier script, added to the bookmarks here. Ones already here are skipped.
export async function importBookmarks(file) {
  let text;
  try { text = await file.text(); } catch { return hooks.toast(`Couldn’t read ${file.name}`); }
  const found = adcBookmarks(text);
  if (!found.length) return hooks.toast(`No markers in ${file.name}`);
  const add = newBookmarks(hooks.bookmarks(), found);
  if (!add.length) return hooks.toast(`The ${found.length} marker${found.length === 1 ? ' in' : 's in'} ${file.name} ${found.length === 1 ? 'is' : 'are'} already here`);
  hooks.change(() => { hooks.bookmarks().push(...add); hooks.bookmarks().sort((x, y) => x.time - y.time); });
  const skipped = found.length - add.length;
  hooks.toast(`Added ${add.length} bookmark${add.length === 1 ? '' : 's'} from ${file.name}${skipped ? `. ${skipped} already here` : ''}`);
}

export function initBookmarks(h) {
  hooks = h;
  const kinds = $('bookmarksKinds');
  for (const k of KINDS) {
    const b = button(k.label, () => {
      if (shown.has(k.id)) shown.delete(k.id); else shown.add(k.id);
      saveShown(); refreshBookmarks();
    }, `Show or hide ${k.label === 'Left off here' ? '“Left off here”' : k.label.toLowerCase()} bookmarks in this list`);
    b.dataset.kind = k.id; b.style.setProperty('--k', kindVar(k.id));
    kinds.append(b);
  }
  $('bookmarksClose').onclick = () => toggleBookmarks(false);
  $('bookmarkAdd').onclick = () => addBookmark();
  $('bookmarkImport').onclick = () => $('bookmarkFile').click();
  $('bookmarkFile').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importBookmarks(f); });
  $('bookmarksDrawer').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || ['s', 'o', 'e'].includes(e.key.toLowerCase()))) return;
    e.stopPropagation();
    if (e.key !== 'Escape') return;
    e.preventDefault();
    // Esc keeps a bookmark just added, with what's typed, and goes back to the video.
    // Changes to an older one are let go.
    const b = editing && hooks.bookmarks().find((x) => x.id === editing);
    if (b && draft?.fresh) save(b);
    toggleBookmarks(false);
  });
}
