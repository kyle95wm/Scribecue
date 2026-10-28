import { parseSubs, toSRT, toVTT, fmtTime, parseTime } from './formats.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), stage = $('stage'), overlay = $('overlay'), list = $('list');
const tl = $('tl'), ruler = $('ruler'), lane = $('lane'), wave = $('wave'), cuesLayer = $('cues');
const playheadEl = $('playhead'), dragtip = $('dragtip'), overview = $('overview'), ovWin = $('ovWin');
const edText = $('edText'), edStart = $('edStart'), edEnd = $('edEnd');
const edIdx = $('edIdx'), edDur = $('edDur'), edStats = $('edStats');
const clockEl = $('clock'), durEl = $('durEl'), playState = $('playState'), ind = $('ind');
const toastEl = $('toast'), helpEl = $('help'), fileSubs = $('fileSubs'), fileVideo = $('fileVideo');

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MIN_DUR = 0.1;
const FRAME = 1 / 25;
const MAX_PPS = 1500;
const DEFAULT_LEN = 2;
const SNAP_PX = 8;
const STORE_KEY = 'subed.v1';
const PEAK_RATE = 200; // waveform bins per second
const OFFSETS = [0, 0.1, 0.15, 0.2, 0.25, 0.3]; // hold-to-mark reaction offsets, ⇧H cycles
const SNAP_WIN = 0.3; // how far hold-to-mark edges may move to meet the waveform

const css = getComputedStyle(document.documentElement);
const C = Object.fromEntries(['panel', 'line', 'dim', 'faint', 'accent', 'bg'].map((k) => [k, css.getPropertyValue('--' + k).trim()]));
C.wave = '#3b7f86';
C.grid = '#1b2028';

const S = {
  cues: [],
  sel: null,
  activeId: null,
  pps: 60,
  view: 0,
  follow: true,
  loop: false,
  loopOnce: false, // loop started with L: ends when the block editor closes
  cps: (() => { try { return localStorage.getItem('subed.cps') !== '0'; } catch { return true; } })(),
  snap: (() => { try { return localStorage.getItem('subed.snap') !== '0'; } catch { return true; } })(),
  offset: (() => { try { const v = parseFloat(localStorage.getItem('subed.offset')); return OFFSETS.includes(v) ? v : 0.2; } catch { return 0.2; } })(),
  resumeAfterEdit: false, // hold-to-mark paused playback; closing the editor resumes it
  rate: 1,
  hasVideo: false,
  videoFile: null,
  vt: 0,
  vplaying: false,
  playUntil: null,
  peaks: null, // raw peak level per bin; drawn relative to peakMax
  peakLen: 0,
  peakMax: 0,
  waveStatus: '',
  tracks: [], // audio tracks in the media file, as listed by the worker
  track: 0,
  maxEnd: 0,
  subName: 'untitled.srt',
};

let nextId = 1;
const mk = (start, end, text = '') => ({ id: nextId++, start, end, text });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const idx = (id) => S.cues.findIndex((c) => c.id === id);
const selIdx = () => (S.sel == null ? -1 : idx(S.sel));
const selCue = () => S.cues[selIdx()] || null;
const sortCues = () => S.cues.sort((a, b) => a.start - b.start || a.end - b.end);
const plain = (s) => s.replace(/<[^>]*>|\{[^}]*\}/g, '');
const cps = (c) => plain(c.text).replace(/\n/g, '').length / Math.max(0.001, c.end - c.start);
const cpsClass = (v) => (v > 21 ? 'bad' : v > 17 ? 'warn' : '');
let tlDirty = true;

// ---------------------------------------------------------------- time / playback

function duration() {
  const d = S.hasVideo && Number.isFinite(video.duration) ? video.duration : 0;
  return d > 0 ? Math.max(d, S.maxEnd) : Math.max(60, S.maxEnd + 30);
}
const now = () => (S.hasVideo ? video.currentTime : S.vt);
const isPlaying = () => (S.hasVideo ? !video.paused && !video.ended : S.vplaying);

function setTime(t) {
  t = clamp(t, 0, duration());
  if (S.hasVideo) video.currentTime = t;
  else S.vt = t;
}
function seek(t, reveal = true) {
  setTime(t);
  if (reveal) ensureVisible(now());
}
function seekBy(d) {
  S.playUntil = null;
  seek(now() + d);
}
function play() {
  if (S.hasVideo) video.play().catch((e) => toast('Playback failed: ' + e.message));
  else S.vplaying = true;
  updateInd();
}
function pause() {
  if (S.hasVideo) video.pause();
  else S.vplaying = false;
  updateInd();
}
function togglePlay() {
  S.playUntil = null;
  isPlaying() ? pause() : play();
}
function playCue() {
  const c = selCue();
  if (!c) return togglePlay();
  setTime(c.start);
  S.playUntil = c.end;
  play();
}
function setRate(r) {
  S.rate = clamp(Math.round(r * 100) / 100, 0.25, 3);
  video.playbackRate = S.rate;
  updateInd();
  toast(`Speed ${S.rate.toFixed(2)}×`);
}

// ---------------------------------------------------------------- view

const visSec = () => tl.clientWidth / S.pps;
const xToT = (clientX) => S.view + (clientX - tl.getBoundingClientRect().left) / S.pps;
const clampView = (v) => clamp(v, 0, Math.max(0, duration() - visSec() * 0.5));
const minPps = () => Math.max(0.5, tl.clientWidth / duration());

function setView(v) {
  v = clampView(v);
  if (v !== S.view) { S.view = v; tlDirty = true; }
}
function ensureVisible(t) {
  const vis = visSec();
  if (t < S.view || t > S.view + vis) setView(t - vis * 0.25);
}
function revealRange(a, b) {
  const vis = visSec();
  if (a >= S.view && b <= S.view + vis) return;
  setView(b - a > vis * 0.8 ? a - vis * 0.1 : (a + b) / 2 - vis / 2);
}
function zoom(f, anchorT) {
  const t = anchorT ?? (now() >= S.view && now() <= S.view + visSec() ? now() : S.view + visSec() / 2);
  const x = (t - S.view) * S.pps;
  S.pps = clamp(S.pps * f, minPps(), MAX_PPS);
  S.view = clampView(t - x / S.pps);
  tlDirty = true;
  updateInd();
}
function fitAll() {
  S.pps = clamp(tl.clientWidth / duration(), 0.5, MAX_PPS);
  S.view = 0;
  tlDirty = true;
  updateInd();
}
function followPlayhead(t) {
  const vis = visSec();
  if (t > S.view + vis * 0.92 || t < S.view) setView(t - vis * 0.08);
}

// ---------------------------------------------------------------- undo

const undoStack = [], redoStack = [];
let lastUndoTag = null, lastUndoTime = 0;
const snapshot = () => JSON.stringify({ cues: S.cues, sel: S.sel });

// `tag` coalesces repeated identical actions (e.g. holding a nudge key) into one undo step.
function pushUndo(snap = snapshot(), tag = null) {
  const t = performance.now();
  if (tag && tag === lastUndoTag && t - lastUndoTime < 1000) { lastUndoTime = t; return; }
  lastUndoTag = tag; lastUndoTime = t;
  undoStack.push(snap);
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
}
function restore(snap) {
  const o = JSON.parse(snap);
  S.cues = o.cues;
  nextId = S.cues.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  changed();
  select(o.sel != null && idx(o.sel) >= 0 ? o.sel : null, { seek: false });
}
function doUndo() {
  if (!undoStack.length) return toast('Nothing to undo');
  redoStack.push(snapshot());
  restore(undoStack.pop());
  lastUndoTag = null;
  toast('Undo');
}
function doRedo() {
  if (!redoStack.length) return toast('Nothing to redo');
  undoStack.push(snapshot());
  restore(redoStack.pop());
  lastUndoTag = null;
  toast('Redo');
}

// ---------------------------------------------------------------- change propagation

let saveTimer = 0;
function changed(id = null) {
  S.maxEnd = S.cues.reduce((m, c) => Math.max(m, c.end), 0);
  if (id != null) {
    const i = idx(id), c = S.cues[i];
    const ordered = c && (i === 0 || S.cues[i - 1].start <= c.start) &&
      (i === S.cues.length - 1 || c.start <= S.cues[i + 1].start);
    if (ordered) {
      const r = rowMap.get(id);
      if (r) fillRow(r, c, i);
    } else {
      sortCues();
      renderList();
    }
  } else {
    sortCues();
    renderList();
  }
  updateEditor();
  S.activeId = undefined; // force overlay/active refresh
  tlDirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      subName: S.subName,
      cues: S.cues.map(({ start, end, text }) => ({ start, end, text })),
    }));
  } catch { /* storage full or blocked */ }
}
function loadSaved() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY));
    if (o?.cues?.length) {
      S.cues = o.cues.map((c) => mk(c.start, c.end, c.text));
      S.subName = o.subName || S.subName;
      return S.cues.length;
    }
  } catch { /* ignore */ }
  return 0;
}

// ---------------------------------------------------------------- selection

function select(id, { seek: doSeek = true, reveal = true } = {}) {
  if (S.sel !== id) rowMap.get(S.sel)?.classList.remove('sel');
  S.sel = id;
  const r = rowMap.get(id);
  r?.classList.add('sel');
  r?.scrollIntoView({ block: 'nearest' });
  const c = selCue();
  if (c && doSeek) { S.playUntil = null; seek(c.start); }
  if (c && reveal) revealRange(c.start, c.end);
  updateEditor();
  tlDirty = true;
}
function selectRel(d) {
  if (!S.cues.length) return toast('No text blocks yet — press Enter to create one');
  let i = selIdx();
  if (i < 0) {
    const t = now();
    i = d > 0 ? S.cues.findIndex((c) => c.end > t) : S.cues.findLastIndex((c) => c.start < t);
    if (i < 0) i = d > 0 ? S.cues.length - 1 : 0;
  } else {
    i = clamp(i + d, 0, S.cues.length - 1);
  }
  select(S.cues[i].id);
}
function cueAt(t) {
  // last cue starting at or before t that still covers t
  let lo = 0, hi = S.cues.length - 1, found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (S.cues[m].start <= t) { found = m; lo = m + 1; } else hi = m - 1;
  }
  for (let i = found; i >= 0 && i > found - 4; i--) if (S.cues[i].end > t) return S.cues[i];
  return null;
}

// ---------------------------------------------------------------- edit operations

// Allowed range for cue i so it never newly overlaps its neighbours.
function bounds(i) {
  const c = S.cues[i], p = S.cues[i - 1], n = S.cues[i + 1];
  return {
    lo: p ? Math.min(p.end, c.start) : 0,
    hi: n ? Math.max(n.start, c.end) : Math.max(duration(), c.end),
  };
}
function needSel() {
  const c = selCue();
  if (!c) toast('No text block selected — use ↑/↓ or C to pick one');
  return c;
}

function nudge(what, d) {
  const c = needSel(); if (!c) return;
  const { lo, hi } = bounds(selIdx());
  pushUndo(undefined, 'nudge-' + what + c.id);
  if (what === 'start') c.start = clamp(c.start + d, lo, c.end - MIN_DUR);
  else if (what === 'end') c.end = clamp(c.end + d, c.start + MIN_DUR, hi);
  else {
    d = clamp(d, lo - c.start, hi - c.end);
    c.start += d; c.end += d;
  }
  changed(c.id);
  revealRange(c.start, c.end);
}

function setEdge(which) {
  const c = needSel(); if (!c) return;
  const t = now(), { lo, hi } = bounds(selIdx());
  if (which === 'start') {
    if (t > c.end - MIN_DUR) return toast('Playhead is after this cue’s end');
    pushUndo();
    c.start = Math.max(lo, t);
  } else {
    if (t < c.start + MIN_DUR) return toast('Playhead is before this cue’s start');
    pushUndo();
    c.end = Math.min(hi, t);
  }
  changed(c.id);
}

function newCue() {
  const t = now();
  const covering = cueAt(t);
  if (covering) {
    select(covering.id, { seek: false });
    return toast(`Playhead is inside cue #${idx(covering.id) + 1}`);
  }
  const next = S.cues.find((c) => c.start > t);
  const end = Math.min(t + DEFAULT_LEN, next ? next.start : Infinity);
  if (end - t < MIN_DUR) return toast('No room for a cue here');
  pushUndo();
  const c = mk(t, end);
  S.cues.push(c);
  changed();
  select(c.id, { seek: false });
  return c;
}

function splitText(s) {
  const lines = s.split('\n');
  if (lines.length > 1) {
    const h = Math.ceil(lines.length / 2);
    return [lines.slice(0, h).join('\n'), lines.slice(h).join('\n')];
  }
  const words = s.split(' ');
  if (words.length < 2) return [s, ''];
  let best = 1, bestD = Infinity, acc = 0;
  for (let i = 1; i < words.length; i++) {
    acc += words[i - 1].length + 1;
    const d = Math.abs(acc - s.length / 2);
    if (d < bestD) { bestD = d; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function split() {
  const c = needSel(); if (!c) return;
  const t = now();
  if (t <= c.start + MIN_DUR || t >= c.end - MIN_DUR) return toast('Move the playhead inside the selected cue to split');
  pushUndo();
  const [a, b] = splitText(c.text);
  const c2 = mk(t, c.end, b);
  c.end = t; c.text = a;
  S.cues.push(c2);
  changed();
  select(c2.id, { seek: false });
  toast('Split');
}

function merge() {
  const c = needSel(); if (!c) return;
  const i = selIdx(), n = S.cues[i + 1];
  if (!n) return toast('No next cue to merge with');
  pushUndo();
  c.end = Math.max(c.end, n.end);
  c.text = [c.text, n.text].filter(Boolean).join('\n');
  S.cues.splice(i + 1, 1);
  changed();
  select(c.id, { seek: false });
  toast('Merged');
}

function del() {
  const c = needSel(); if (!c) return;
  const i = selIdx();
  pushUndo();
  S.cues.splice(i, 1);
  changed();
  const n = S.cues[Math.min(i, S.cues.length - 1)];
  select(n ? n.id : null, { seek: false });
  toast(`Deleted cue — ${IS_MAC ? '⌘' : 'Ctrl+'}Z to undo`);
}

function selectAtPlayhead() {
  const c = cueAt(now());
  if (c) select(c.id, { seek: false });
  else toast('No cue under the playhead');
}

function gotoSel(end) {
  const c = needSel(); if (!c) return;
  S.playUntil = null;
  seek(end ? c.end : c.start);
}

// ---------------------------------------------------------------- text + time editor

let edit = null; // { id, orig, pushed }

function updateEditor() {
  const c = selCue();
  if (!c) {
    edIdx.textContent = '#–';
    if (document.activeElement !== edStart) edStart.value = '';
    if (document.activeElement !== edEnd) edEnd.value = '';
    edDur.textContent = '';
    edStats.textContent = '';
    if (!edit) edText.value = '';
    return;
  }
  const i = selIdx();
  edIdx.textContent = `#${i + 1}`;
  if (document.activeElement !== edStart) edStart.value = fmtTime(c.start, '.');
  if (document.activeElement !== edEnd) edEnd.value = fmtTime(c.end, '.');
  edDur.textContent = `${(c.end - c.start).toFixed(3)} s`;
  if (!edit || edit.id !== c.id) edText.value = c.text;
  const lines = plain(c.text).split('\n');
  const maxLine = Math.max(...lines.map((l) => l.length));
  const v = cps(c);
  edStats.innerHTML = '';
  const add = (label, cls) => {
    const s = document.createElement('span');
    s.textContent = label;
    if (cls) s.className = cls;
    edStats.append(s, ' · ');
  };
  if (S.cps) add(`CPS ${v.toFixed(1)}`, cpsClass(v));
  add(`${lines.length} line${lines.length > 1 ? 's' : ''}`, lines.length > 2 ? 'warn' : '');
  add(`max ${maxLine} ch`, maxLine > 42 ? 'warn' : '');
  edStats.lastChild.remove();
}

// Frazier "Enter": edit the block under the playhead, or create one there.
function createOrEdit() {
  const c = cueAt(now()) || newCue();
  if (!c) return;
  select(c.id, { seek: false });
  editText();
}

function editText(field = edText) {
  if (!selCue()) return toast('No text block selected — press Enter to create one at the playhead');
  field.focus();
  if (field === edText) edText.setSelectionRange(edText.value.length, edText.value.length);
  else field.select();
}

function closeEditor() {
  document.activeElement?.blur();
  if (S.loopOnce) stopLoop();
  if (S.resumeAfterEdit) { S.resumeAfterEdit = false; play(); }
}

function confirmDelete() {
  const c = needSel(); if (!c) return;
  const label = `#${selIdx() + 1}${c.text ? ` “${plain(c.text).slice(0, 40)}”` : ''}`;
  const field = document.activeElement;
  if (!confirm(`Delete text block ${label}?`)) { field?.focus?.(); return; }
  document.activeElement?.blur();
  del();
}

// Wrap the textarea selection in <b>/<i>/<u>, or unwrap it if it already is.
function toggleTag(tag) {
  const open = `<${tag}>`, close = `</${tag}>`;
  let { selectionStart: a, selectionEnd: b, value: v } = edText;
  const sel = v.slice(a, b);
  if (sel.startsWith(open) && sel.endsWith(close)) {
    edText.setRangeText(sel.slice(open.length, -close.length), a, b, 'select');
  } else if (v.slice(a - open.length, a) === open && v.slice(b, b + close.length) === close) {
    edText.setSelectionRange(a - open.length, b + close.length);
    edText.setRangeText(sel, a - open.length, b + close.length, 'select');
  } else {
    // execCommand keeps the change on the textarea's native undo stack
    if (!document.execCommand('insertText', false, open + sel + close)) edText.setRangeText(open + sel + close, a, b);
    edText.setSelectionRange(a + open.length, a + open.length + sel.length);
  }
  edText.dispatchEvent(new Event('input'));
}

// Keys shared by every field of the block editor (Frazier "Editor / Document").
const FIELDS = [edText, edStart, edEnd];
function editorKeys(e, field) {
  const mod = e.metaKey || e.ctrlKey, os = e.altKey && e.shiftKey;
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(); return true; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const i = FIELDS.indexOf(field);
    editText(FIELDS[(i + (e.shiftKey ? FIELDS.length - 1 : 1)) % FIELDS.length]);
    return true;
  }
  if (os && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    nudge('move', e.code === 'ArrowLeft' ? -FRAME : FRAME);
    updateEditorTimes();
    return true;
  }
  if (os && e.code === 'KeyD') { e.preventDefault(); confirmDelete(); return true; }
  if (mod && e.code === 'KeyS') return false; // let export through
  if (e.code === 'Space' && e.altKey && !e.shiftKey) { e.preventDefault(); togglePlay(); return true; }
  return false;
}

function blockStep(d, field) {
  const i = selIdx() + d;
  if (!S.cues[i]) return toast(d < 0 ? 'First text block' : 'Last text block');
  field.blur();
  select(S.cues[i].id);
  editText(field);
}

// Leaving the block editor ends an L loop. Moving between its fields (or to the next
// block with ↑ ↓) blurs and refocuses, so check once focus has settled.
for (const f of [edText, edStart, edEnd]) {
  f.addEventListener('blur', () => setTimeout(() => {
    if ([edText, edStart, edEnd].includes(document.activeElement)) return;
    S.resumeAfterEdit = false;
    if (S.loopOnce) stopLoop();
  }));
}

edText.addEventListener('focus', () => {
  const c = selCue();
  if (!c) { edText.blur(); return; }
  edit = { id: c.id, orig: c.text, pushed: false };
  document.body.classList.add('editing');
});
edText.addEventListener('input', () => {
  if (!edit) return;
  const c = S.cues[idx(edit.id)];
  if (!c) return;
  if (!edit.pushed) { pushUndo(); edit.pushed = true; }
  c.text = edText.value;
  changed(c.id);
});
edText.addEventListener('blur', () => {
  edit = null;
  document.body.classList.remove('editing');
  updateEditor();
});
edText.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (editorKeys(e, edText)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); closeEditor(); return; }
  if (mod && !e.shiftKey && !e.altKey && ['KeyB', 'KeyI', 'KeyU'].includes(e.code)) {
    e.preventDefault();
    toggleTag(e.code[3].toLowerCase());
    return;
  }
  if (mod && e.code === 'KeyS') { e.preventDefault(); exportSubs(e.shiftKey ? 'vtt' : 'srt'); return; }
  // ↑ on the first line / ↓ on the last line moves to the previous / next block
  if (!e.shiftKey && !e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const v = edText.value, a = edText.selectionStart, b = edText.selectionEnd;
    const up = e.key === 'ArrowUp';
    if (a === b && (up ? !v.slice(0, a).includes('\n') : !v.slice(a).includes('\n'))) {
      e.preventDefault();
      blockStep(up ? -1 : 1, edText);
    }
  }
});

function bindTimeInput(input, which) {
  const apply = () => {
    const c = selCue();
    if (!c) return;
    const t = parseTime(input.value);
    const cur = which === 'start' ? c.start : c.end;
    if (Number.isNaN(t)) { toast('Invalid time — use hh:mm:ss.mmm'); }
    else if (Math.abs(t - cur) > 0.0005) {
      pushUndo();
      if (which === 'start') c.start = clamp(t, 0, c.end - MIN_DUR);
      else c.end = Math.max(t, c.start + MIN_DUR);
      changed();
      select(c.id, { seek: false });
    }
    input.value = fmtTime(which === 'start' ? c.start : c.end, '.');
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') apply();
    if (editorKeys(e, input)) return;
    if (e.key === 'Enter') { e.preventDefault(); apply(); closeEditor(); }
    else if (!e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      apply();
      blockStep(e.key === 'ArrowUp' ? -1 : 1, input);
    } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') { e.preventDefault(); exportSubs(e.shiftKey ? 'vtt' : 'srt'); }
  });
  input.addEventListener('blur', apply);
  input.addEventListener('focus', () => {
    if (!selCue()) { input.blur(); return; }
    document.body.classList.add('editing');
  });
  input.addEventListener('blur', () => { if (!FIELDS.includes(document.activeElement)) document.body.classList.remove('editing'); });
}
function updateEditorTimes() {
  const c = selCue();
  edStart.value = c ? fmtTime(c.start, '.') : '';
  edEnd.value = c ? fmtTime(c.end, '.') : '';
}
bindTimeInput(edStart, 'start');
bindTimeInput(edEnd, 'end');

// ---------------------------------------------------------------- list

const rowMap = new Map();

// ---- list search
const listSearch = $('listSearch'), listCount = $('listCount');
let query = '';
const noResults = document.createElement('div');
noResults.className = 'emptyhint';

function matches(c, i) {
  if (!query) return true;
  if (/^#\d+$/.test(query)) return String(i + 1) === query.slice(1);
  return plain(c.text).toLowerCase().includes(query);
}

// Row text with every occurrence of the query wrapped in <mark>.
function fillText(tx, c) {
  tx.textContent = '';
  const text = c.text || '(empty)';
  if (!query || query.startsWith('#') || !c.text) { tx.textContent = text; return; }
  const lower = text.toLowerCase();
  let at = 0;
  for (let k = lower.indexOf(query); k >= 0; k = lower.indexOf(query, at)) {
    tx.append(text.slice(at, k));
    const m = document.createElement('mark');
    m.textContent = text.slice(k, k + query.length);
    tx.append(m);
    at = k + query.length;
  }
  tx.append(text.slice(at));
}

function applyFilter() {
  let n = 0;
  S.cues.forEach((c, i) => {
    const r = rowMap.get(c.id);
    if (r) fillRow(r, c, i);
    if (matches(c, i)) n++;
  });
  listCount.textContent = query ? `${n} of ${S.cues.length}` : '';
  noResults.textContent = `No text blocks match “${listSearch.value.trim()}”`;
  if (query && !n && S.cues.length) list.append(noResults); else noResults.remove();
  tlDirty = true;
}

function stepMatch(d) {
  const hits = S.cues.filter((c, i) => matches(c, i));
  if (!hits.length) return toast('No matches');
  const cur = hits.findIndex((c) => c.id === S.sel);
  const next = cur < 0 ? (d > 0 ? 0 : hits.length - 1) : (cur + d + hits.length) % hits.length;
  select(hits[next].id);
}

listSearch.addEventListener('input', () => {
  query = listSearch.value.trim().toLowerCase();
  applyFilter();
});
listSearch.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    if (listSearch.value) { listSearch.value = ''; query = ''; applyFilter(); }
    listSearch.blur();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (!S.cues.some((c) => c.id === S.sel && matches(c, idx(c.id)))) stepMatch(1);
    listSearch.blur();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    stepMatch(e.key === 'ArrowDown' ? 1 : -1);
  } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
    e.preventDefault();
    exportSubs(e.shiftKey ? 'vtt' : 'srt');
  }
});

function fillRow(r, c, i) {
  const [n, t, tx, cp] = r.children;
  n.textContent = i + 1;
  t.children[0].textContent = fmtTime(c.start, '.');
  t.children[1].textContent = `${(c.end - c.start).toFixed(2)} s`;
  fillText(tx, c);
  tx.classList.toggle('blank', !c.text);
  r.hidden = !matches(c, i);
  const v = cps(c);
  cp.textContent = c.text ? v.toFixed(0) : '';
  cp.className = 'cps ' + cpsClass(v);
}

function renderList() {
  rowMap.clear();
  list.textContent = '';
  if (!S.cues.length) {
    const h = document.createElement('div');
    h.className = 'emptyhint';
    h.innerHTML = 'No text blocks yet.<br><kbd>Enter</kbd> create one at the playhead<br>' +
      '<kbd>' + (IS_MAC ? '⌘' : 'Ctrl+') + 'O</kbd> open an SRT / VTT file<br>' +
      'or drag on the timeline lane to draw one.';
    list.append(h);
    return;
  }
  const frag = document.createDocumentFragment();
  S.cues.forEach((c, i) => {
    const r = document.createElement('div');
    r.className = 'row';
    r.dataset.id = c.id;
    r.innerHTML = '<span class="n"></span><span class="t"><b></b><i></i></span><span class="tx"></span><span class="cps"></span>';
    fillRow(r, c, i);
    if (c.id === S.sel) r.classList.add('sel');
    if (c.id === S.activeId) r.classList.add('active');
    rowMap.set(c.id, r);
    frag.append(r);
  });
  list.append(frag);
  applyFilter();
}

list.addEventListener('click', (e) => {
  const r = e.target.closest('.row');
  if (r) select(+r.dataset.id);
});
list.addEventListener('dblclick', (e) => {
  const r = e.target.closest('.row');
  if (r) { select(+r.dataset.id, { seek: false }); editText(); }
});

// ---------------------------------------------------------------- timeline drawing

function fitCanvas(cv) {
  const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return [ctx, w, h];
}

const TICKS = [[0.1, 0.02], [0.2, 0.05], [0.5, 0.1], [1, 0.2], [2, 0.5], [5, 1], [10, 2], [15, 5], [30, 5],
  [60, 10], [120, 30], [300, 60], [600, 120], [900, 300], [1800, 300], [3600, 600]];
const pickTicks = () => TICKS.find(([maj]) => maj * S.pps >= 90) || TICKS[TICKS.length - 1];

function rulerLabel(t, maj) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = maj < 1 ? s.toFixed(1).padStart(4, '0') : String(Math.round(s)).padStart(2, '0');
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + ss;
}

function drawTimeline() {
  tlDirty = false;
  const pps = S.pps, t0 = S.view;
  const [maj, min] = pickTicks();
  const ratio = Math.round(maj / min);

  // ruler
  const [rc, rw, rh] = fitCanvas(ruler);
  rc.fillStyle = C.panel;
  rc.fillRect(0, 0, rw, rh);
  const sc = selCue();
  if (sc) {
    rc.fillStyle = C.accent;
    rc.globalAlpha = 0.45;
    rc.fillRect((sc.start - t0) * pps, rh - 5, (sc.end - sc.start) * pps, 5);
    rc.globalAlpha = 1;
  }
  rc.strokeStyle = C.faint;
  rc.fillStyle = C.dim;
  rc.font = '11px ui-monospace, Menlo, monospace';
  rc.beginPath();
  const k0 = Math.floor(t0 / min), k1 = Math.ceil((t0 + rw / pps) / min);
  for (let k = k0; k <= k1; k++) {
    const x = Math.round((k * min - t0) * pps) + 0.5;
    const isMaj = k % ratio === 0;
    rc.moveTo(x, rh);
    rc.lineTo(x, rh - (isMaj ? 12 : 5));
    if (isMaj) rc.fillText(rulerLabel(k * min, maj), x + 4, 12);
  }
  rc.stroke();

  // grid + waveform
  const [wc, ww, wh] = fitCanvas(wave);
  wc.fillStyle = C.grid;
  for (let k = Math.floor(t0 / maj); k <= Math.ceil((t0 + ww / pps) / maj); k++) {
    wc.fillRect(Math.round((k * maj - t0) * pps), 0, 1, wh);
  }
  const mid = wh / 2;
  wc.fillStyle = C.line;
  wc.fillRect(0, Math.round(mid), ww, 1);
  if (S.peaks && S.peakMax > 0) {
    const P = S.peaks, len = S.peakLen, amp = wh / 2 - 4, inv = 1 / S.peakMax;
    wc.fillStyle = C.wave;
    for (let x = 0; x < ww; x++) {
      let i0 = Math.floor((t0 + x / pps) * PEAK_RATE);
      let i1 = Math.max(i0 + 1, Math.floor((t0 + (x + 1) / pps) * PEAK_RATE));
      if (i1 <= 0 || i0 >= len) continue;
      i0 = Math.max(0, i0); i1 = Math.min(len, i1);
      let m = 0;
      for (let i = i0; i < i1; i++) if (P[i] > m) m = P[i];
      if (!m) continue;
      const h = Math.max(0.5, Math.pow(m * inv, 0.7) * amp);
      wc.fillRect(x, mid - h, 1, h * 2);
    }
  }
  if (S.waveStatus) {
    wc.font = '11px ui-monospace, Menlo, monospace';
    wc.textAlign = 'right';
    wc.fillStyle = C.dim;
    wc.fillText(S.waveStatus, ww - 8, 14);
    wc.textAlign = 'left';
  }

  drawCues(ww);
  drawOverview();
}

const cueEls = new Map();
function drawCues(W) {
  const t0 = S.view, t1 = t0 + W / S.pps;
  const seen = new Set();
  for (let i = 0; i < S.cues.length; i++) {
    const c = S.cues[i];
    if (c.start > t1) break;
    if (c.end < t0) continue;
    let el = cueEls.get(c.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'cue';
      el.dataset.id = c.id;
      el.innerHTML = '<span class="hl"></span><span class="ci"></span><span class="ct"></span><span class="hr"></span>';
      cueEls.set(c.id, el);
      cuesLayer.append(el);
    }
    seen.add(c.id);
    const x = (c.start - t0) * S.pps, w = Math.max(2, (c.end - c.start) * S.pps);
    el.style.left = x + 'px';
    el.style.width = w + 'px';
    el.classList.toggle('narrow', w < 36);
    el.classList.toggle('sel', c.id === S.sel);
    el.classList.toggle('active', c.id === S.activeId);
    el.classList.toggle('faded', !matches(c, i));
    el.children[1].textContent = w > 28 ? '#' + (i + 1) : '';
    if (el._text !== c.text) { el._text = c.text; el.children[2].textContent = c.text; }
  }
  for (const [id, el] of cueEls) if (!seen.has(id)) { el.remove(); cueEls.delete(id); }
}

function drawOverview() {
  const d = duration(), W = overview.clientWidth;
  ovWin.style.left = (S.view / d) * W + 'px';
  ovWin.style.width = Math.min(W, (visSec() / d) * W) + 'px';
}

function placePlayhead(t) {
  const x = (t - S.view) * S.pps;
  playheadEl.style.display = x < -2 || x > tl.clientWidth + 2 ? 'none' : '';
  playheadEl.style.transform = `translateX(${x}px)`;
}

// ---------------------------------------------------------------- timeline interaction

let drag = null;

function snapT(t, extra, noSnap) {
  if (!S.snap || noSnap) return t;
  const thr = SNAP_PX / S.pps;
  let best = t, bd = thr;
  for (const cand of [now(), ...extra]) {
    if (cand == null || !Number.isFinite(cand)) continue;
    const d = Math.abs(cand - t);
    if (d < bd) { bd = d; best = cand; }
  }
  return best;
}

lane.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('.cue');
  if (el) {
    const id = +el.dataset.id, i = idx(id), c = S.cues[i];
    if (!c) return;
    if (S.sel !== id) select(id, { seek: false, reveal: false });
    const mode = e.target.closest('.hl') ? 'start' : e.target.closest('.hr') ? 'end' : 'move';
    drag = { mode, id, x0: e.clientX, s0: c.start, e0: c.end, ...bounds(i), snap: snapshot(), moved: false };
  } else {
    const t = xToT(e.clientX);
    S.playUntil = null;
    seek(t, false);
    drag = { mode: 'blank', x0: e.clientX, t0: t, snap: snapshot(), moved: false, id: null };
  }
  lane.setPointerCapture(e.pointerId);
  e.preventDefault();
});

lane.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0;
  if (!drag.moved && Math.abs(dx) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    document.body.classList.add('dragging');
    if (drag.mode !== 'move') document.body.classList.add('resize');
  }
  const noSnap = e.altKey;

  if (drag.mode === 'blank') {
    const ni = S.cues.findIndex((c) => c.start > drag.t0);
    const prev = ni < 0 ? S.cues[S.cues.length - 1] : S.cues[ni - 1];
    const next = ni < 0 ? null : S.cues[ni];
    if (prev && prev.end > drag.t0) { drag.mode = 'none'; return; }
    const c = mk(drag.t0, drag.t0 + MIN_DUR);
    S.cues.push(c);
    sortCues();
    renderList();
    Object.assign(drag, { mode: 'create', id: c.id, lo: prev ? prev.end : 0, hi: next ? next.start : Infinity });
    select(c.id, { seek: false, reveal: false });
  }
  if (drag.mode === 'none') return;
  const c = S.cues[idx(drag.id)];
  if (!c) return;
  const dt = dx / S.pps, { lo, hi } = drag;

  if (drag.mode === 'move') {
    const len = drag.e0 - drag.s0;
    let ns = drag.s0 + dt;
    const sSnap = snapT(ns, [lo, hi - len], noSnap);
    const eSnap = snapT(ns + len, [hi, lo + len], noSnap) - len;
    ns = Math.abs(sSnap - ns) <= Math.abs(eSnap - ns) ? (sSnap !== ns ? sSnap : eSnap) : eSnap;
    ns = clamp(ns, lo, hi - len);
    c.start = ns; c.end = ns + len;
  } else if (drag.mode === 'start') {
    c.start = clamp(snapT(drag.s0 + dt, [lo], noSnap), lo, c.end - MIN_DUR);
  } else if (drag.mode === 'end') {
    c.end = clamp(snapT(drag.e0 + dt, [hi], noSnap), c.start + MIN_DUR, hi);
  } else if (drag.mode === 'create') {
    const b = snapT(xToT(e.clientX), [lo, hi], noSnap);
    c.start = clamp(Math.min(drag.t0, b), lo, hi);
    c.end = clamp(Math.max(drag.t0, b), lo, hi);
    if (c.end - c.start < MIN_DUR) c.end = Math.min(hi, c.start + MIN_DUR);
  }
  changed(c.id);
  dragtip.hidden = false;
  dragtip.textContent = `${fmtTime(c.start, '.')} → ${fmtTime(c.end, '.')}  ·  ${(c.end - c.start).toFixed(2)} s`;
  const lx = e.clientX - lane.getBoundingClientRect().left;
  dragtip.style.left = clamp(lx + 12, 0, lane.clientWidth - dragtip.offsetWidth - 4) + 'px';
});

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  dragtip.hidden = true;
  document.body.classList.remove('dragging', 'resize');
  if (d.moved && d.id != null && d.mode !== 'none') {
    pushUndo(d.snap);
    changed();
    if (d.mode === 'create') { select(d.id, { seek: false, reveal: false }); editText(); }
  }
}
lane.addEventListener('pointerup', endDrag);
lane.addEventListener('pointercancel', endDrag);
lane.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.cue');
  if (el) { select(+el.dataset.id, { seek: false, reveal: false }); editText(); }
});

let scrubbing = false;
ruler.addEventListener('pointerdown', (e) => {
  scrubbing = true;
  ruler.setPointerCapture(e.pointerId);
  S.playUntil = null;
  seek(xToT(e.clientX), false);
});
ruler.addEventListener('pointermove', (e) => { if (scrubbing) seek(xToT(e.clientX), false); });
ruler.addEventListener('pointerup', () => { scrubbing = false; });

let ovDrag = false;
const ovJump = (e) => {
  const r = overview.getBoundingClientRect();
  setView(((e.clientX - r.left) / r.width) * duration() - visSec() / 2);
};
overview.addEventListener('pointerdown', (e) => { ovDrag = true; overview.setPointerCapture(e.pointerId); ovJump(e); });
overview.addEventListener('pointermove', (e) => { if (ovDrag) ovJump(e); });
overview.addEventListener('pointerup', () => { ovDrag = false; });

tl.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoom(Math.exp(-e.deltaY * 0.01), xToT(e.clientX));
  } else {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setView(S.view + d / S.pps);
  }
}, { passive: false });

new ResizeObserver(() => { tlDirty = true; }).observe(tl);

// ---------------------------------------------------------------- overlay / indicators

const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
function renderOverlay(c) {
  overlay.textContent = '';
  if (!c || !c.text) return;
  const span = document.createElement('span');
  // allow basic <i>/<b>/<u> markup, strip everything else
  span.innerHTML = esc(c.text.replace(/\{[^}]*\}/g, '')).replace(/&lt;(\/?)([ibu])&gt;/gi, '<$1$2>');
  overlay.append(span);
}

function updateActive(t) {
  const a = cueAt(t);
  const id = a ? a.id : null;
  if (id === S.activeId) return;
  rowMap.get(S.activeId)?.classList.remove('active');
  cueEls.get(S.activeId)?.classList.remove('active');
  S.activeId = id;
  rowMap.get(id)?.classList.add('active');
  cueEls.get(id)?.classList.add('active');
  renderOverlay(a);
  if (a && isPlaying() && S.follow && !S.loop && !edit && !drag && S.sel !== id) {
    select(id, { seek: false, reveal: false });
  }
}

const IND_TIPS = {
  speed: 'Playback speed. + and - change it; click or press \\ to reset to 1×',
  follow: 'Follow: keep the playhead in view and select each block as it plays (F)',
  loop: 'Loop: keep replaying the selected block. L loops until you finish editing; O leaves it on',
  offset: 'Hold-to-mark reaction offset: marks made with H move back by this much. ⇧H or click to change',
  cps: 'Show reading speed (characters per second) in the list and editor (I)',
  snap: 'Snap (B): dragged edges stick to the playhead and neighbouring blocks, and blocks marked with H move to where the waveform rises and falls. Hold ⌥ to override',
};
function updateInd() {
  const items = [
    ['speed', `${S.rate.toFixed(2)}×`, S.rate !== 1],
    ['follow', 'FOLLOW', S.follow],
    ['loop', 'LOOP', S.loop],
    ['offset', `H −${Math.round(S.offset * 1000)}ms`, false],
    ['cps', 'CPS', S.cps],
    ['snap', 'SNAP', S.snap],
  ];
  ind.textContent = '';
  for (const [key, label, on] of items) {
    const s = document.createElement('span');
    s.textContent = label;
    s.dataset.key = key;
    s.dataset.tip = IND_TIPS[key];
    s.className = (on ? 'on ' : '') + (key === 'speed' || key === 'follow' ? '' : 'tip-end');
    ind.append(s);
  }
  const p = isPlaying();
  playState.textContent = p ? (S.playUntil != null ? 'CUE' : 'PLAYING') : 'PAUSED';
  playState.classList.toggle('on', p);
}
clockEl.addEventListener('click', async () => {
  const tc = fmtTime(now(), '.');
  let ok = false;
  try { await navigator.clipboard.writeText(tc); ok = true; } catch { /* fall back below */ }
  if (!ok) {
    // older path for browsers that refuse the async clipboard API
    const ta = document.createElement('textarea');
    ta.value = tc;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast(ok ? `Copied ${tc}` : 'Couldn’t copy: the browser blocked clipboard access');
});
ind.addEventListener('click', (e) => {
  const k = e.target.dataset.key;
  if (k === 'speed') setRate(1);
  else if (k === 'offset') cycleOffset();
  else if (k) toggleFlag(k);
});

function toggleFlag(k) {
  S[k] = !S[k];
  if (k === 'loop') S.loopOnce = false;
  if (k === 'cps') {
    document.body.classList.toggle('no-cps', !S.cps);
    updateEditor();
    try { localStorage.setItem('subed.cps', S.cps ? '1' : '0'); } catch { /* ignore */ }
  }
  if (k === 'snap') try { localStorage.setItem('subed.snap', S.snap ? '1' : '0'); } catch { /* ignore */ }
  updateInd();
  toast(`${k[0].toUpperCase() + k.slice(1)} ${S[k] ? 'on' : 'off'}`);
}

// L: loop the block under the playhead (or the selected one) until the editor closes.
function loopBlock() {
  if (S.loop) { stopLoop(); return; }
  const c = cueAt(now()) || selCue();
  if (!c) return toast('No text block here — move the playhead into one or select one');
  select(c.id, { seek: now() < c.start || now() >= c.end });
  S.loop = true;
  S.loopOnce = true;
  if (!isPlaying()) play();
  updateInd();
  toast(`Looping #${selIdx() + 1} — ↵ to type, Esc when done`);
}
function stopLoop() {
  S.loop = S.loopOnce = false;
  updateInd();
  toast('Loop off');
}

// ---------------------------------------------------------------- hold-to-mark

// Hold H while the narrator speaks: press marks the start, release marks the end.
// Both edges move back by the reaction offset, then snap to where the waveform
// rises or falls nearby. Releasing pauses and opens the new block for typing.
let hold = null; // { t0, el }
const markEl = document.createElement('div');
markEl.className = 'cue marking';
markEl.hidden = true;

function holdStart() {
  if (hold) return;
  const wasPlaying = isPlaying();
  if (!wasPlaying) play();
  hold = { t0: now() - (wasPlaying ? S.offset * S.rate : 0) };
  cuesLayer.append(markEl);
  markEl.hidden = false;
  updateMark();
}

function updateMark() {
  if (!hold) return;
  const a = Math.max(0, hold.t0), b = Math.max(a, now() - S.offset * S.rate);
  markEl.style.left = (a - S.view) * S.pps + 'px';
  markEl.style.width = Math.max(2, (b - a) * S.pps) + 'px';
}

function holdEnd(noSnap) {
  if (!hold) return;
  const tUp = now();
  let a = Math.max(0, hold.t0), b = tUp - S.offset * S.rate;
  hold = null;
  markEl.hidden = true;
  pause();
  if (b - a < 0.25) return toast('Hold H for as long as the narrator speaks');
  const snapped = S.snap && !noSnap && S.peaks && S.peakMax > 0;
  if (snapped) {
    a = waveEdge(a, true) ?? a;
    b = waveEdge(b, false) ?? b;
  }
  // keep inside the gap the mark started in
  const prev = S.cues.findLast((c) => c.start <= a);
  if (prev && prev.end > a) a = prev.end;
  const next = S.cues.find((c) => c.start > a);
  if (next) b = Math.min(b, next.start);
  if (b - a < MIN_DUR) return toast('No room for a block here');
  pushUndo();
  const c = mk(a, b);
  S.cues.push(c);
  changed();
  select(c.id, { seek: false });
  S.resumeAfterEdit = true;
  editText();
  toast(`Block #${idx(c.id) + 1} marked${snapped ? ' and snapped to the waveform' : ''} — type it, then ↵ or Esc to carry on`);
}

// Find where the waveform rises (start) or falls (end) most sharply near t, in dB.
// Returns null if nothing within SNAP_WIN changes by at least 6 dB.
function waveEdge(t, rising) {
  const P = S.peaks, len = S.peakLen, W = 8; // 8 bins = 40 ms either side
  const db = (i) => 20 * Math.log10(P[i] / S.peakMax + 1e-4);
  const mean = (i0, i1) => { let m = 0; for (let i = i0; i < i1; i++) m += db(i); return m / (i1 - i0); };
  const c = Math.round(t * PEAK_RATE), r = Math.round(SNAP_WIN * PEAK_RATE);
  let best = null, bestScore = 6;
  for (let i = Math.max(W, c - r); i <= Math.min(len - W, c + r); i++) {
    const jump = rising ? mean(i, i + W) - mean(i - W, i) : mean(i - W, i) - mean(i, i + W);
    const score = jump - Math.abs(i - c) / PEAK_RATE * 5; // prefer edges close to the mark
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best == null ? null : best / PEAK_RATE;
}

function cycleOffset() {
  S.offset = OFFSETS[(OFFSETS.indexOf(S.offset) + 1) % OFFSETS.length];
  try { localStorage.setItem('subed.offset', S.offset); } catch { /* ignore */ }
  updateInd();
  toast(`Hold-to-mark reaction offset ${Math.round(S.offset * 1000)} ms`);
}

document.addEventListener('keyup', (e) => { if (e.code === 'KeyH') holdEnd(e.altKey); });
window.addEventListener('blur', () => holdEnd(false));

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('fade');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('fade'), 3500);
}

function toggleHelp(show = helpEl.hidden) {
  helpEl.hidden = !show;
}
helpEl.addEventListener('click', (e) => { if (e.target === helpEl) toggleHelp(false); });

// ---------------------------------------------------------------- files

function baseName() {
  const n = S.subName !== 'untitled.srt' ? S.subName : S.videoFile?.name || 'subtitles';
  return n.replace(/\.[^.]+$/, '');
}

function exportSubs(fmt) {
  if (!S.cues.length) return toast('Nothing to export yet');
  const text = fmt === 'vtt' ? toVTT(S.cues) : toSRT(S.cues);
  const name = `${baseName()}.${fmt}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${name} (${S.cues.length} cues)`);
}

async function loadSubsFile(file) {
  const parsed = parseSubs(await file.text());
  if (!parsed.length) return toast(`No cues found in ${file.name}`);
  pushUndo();
  S.cues = parsed.map((c) => mk(c.start, c.end, c.text));
  S.subName = file.name;
  $('subName').textContent = file.name;
  changed();
  select(S.cues[0].id);
  toast(`Loaded ${parsed.length} cues from ${file.name}${undoStack.length > 1 ? ' — undo restores previous' : ''}`);
}

let videoURL = null;
function loadVideoFile(file) {
  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL = URL.createObjectURL(file);
  S.videoFile = file;
  S.hasVideo = true;
  video.src = videoURL;
  video.playbackRate = S.rate;
  document.body.classList.add('has-video');
  const v = $('videoName');
  v.textContent = file.name;
  v.classList.remove('dim');
  toast(`Loading ${file.name}…`);
  loadTracks(file);
}

// ---------------------------------------------------------------- audio tracks
//
// Files often carry several audio tracks (e.g. the original mix and an audio
// description mix). Most browsers only ever play the default one, so for a
// multi-track file the chosen track is copied out into an audio-only file by
// the worker and played in step with the muted video. Each track's waveform
// and copy are cached, so switching back and forth is instant.

const altAudio = new Audio();
altAudio.preload = 'auto';
altAudio.hidden = true;
document.body.append(altAudio);
let alt = null; // { url, start } of the copied track now playing, if any
const trackCache = new Map(); // track index -> { peaks, peakLen, peakMax, audio, reason }
const langNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();

function trackLabel(i) {
  const t = S.tracks[i];
  if (!t) return `Track ${i + 1}`;
  let lang = t.lang;
  try { if (lang && langNames) lang = langNames.of(lang); } catch { /* unknown code */ }
  const ch = { 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' }[t.channels] || `${t.channels} ch`;
  return [`${i + 1}`, lang, `${t.codec} ${ch}`, t.name && `“${t.name}”`, t.ad && 'AD'].filter(Boolean).join(' · ');
}

function resetTracks() {
  useNativeAudio();
  for (const c of trackCache.values()) if (c.audio) URL.revokeObjectURL(c.audio.url);
  trackCache.clear();
  S.tracks = [];
  S.track = 0;
  renderTrackPicker();
}

function probeTracks(file) {
  return new Promise((done) => {
    let w;
    try { w = new Worker('js/wave-worker.js'); } catch { return done([]); }
    w.onmessage = ({ data: m }) => { w.terminate(); done(m.type === 'tracks' ? m.tracks : []); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); done([]); };
    w.postMessage({ cmd: 'probe', file });
  });
}

async function loadTracks(file) {
  resetTracks();
  resetWaveform();
  S.waveStatus = 'Reading audio tracks…';
  const tracks = await probeTracks(file);
  if (S.videoFile !== file) return;
  S.tracks = tracks;
  renderTrackPicker();
  if (tracks.length < 2) return buildWaveform(file, 0, false);
  // transcribing description is the point, so prefer a track marked as AD
  let pick = tracks.findIndex((t) => t.ad);
  if (pick >= 0) toast(`Using the audio description track (${trackLabel(pick)}). Press T to switch tracks`);
  else {
    pick = Math.max(0, tracks.findIndex((t) => t.default));
    toast(`This file has ${tracks.length} audio tracks. Press T to switch`);
  }
  selectTrack(pick);
}

// Safari can switch tracks itself; everywhere else we copy the track out.
const nativeSwitching = () => video.audioTracks && video.audioTracks.length === S.tracks.length;

function selectTrack(i) {
  const file = S.videoFile;
  if (!file || !S.tracks[i]) return;
  S.track = i;
  renderTrackPicker();
  const multi = S.tracks.length > 1, native = multi && nativeSwitching();
  if (native) {
    for (let k = 0; k < video.audioTracks.length; k++) video.audioTracks[k].enabled = k === i;
    useNativeAudio();
  }
  const cached = trackCache.get(i);
  if (cached) {
    resetWaveform();
    Object.assign(S, { peaks: cached.peaks, peakLen: cached.peakLen, peakMax: cached.peakMax });
    if (multi && !native) {
      if (cached.audio) useAltAudio(cached.audio);
      else toast(`Can't play track ${i + 1} on its own: ${cached.reason}`);
    }
    if (multi) toast(`Audio: ${trackLabel(i)}`);
    return;
  }
  buildWaveform(file, i, multi && !native);
}

function stepTrack(d) {
  if (S.tracks.length < 2) return toast(S.hasVideo ? 'This file has only one audio track' : 'No media loaded');
  selectTrack((S.track + d + S.tracks.length) % S.tracks.length);
}

function renderTrackPicker() {
  const pick = $('trackPick'), sel = $('trackSel');
  pick.hidden = S.tracks.length < 2;
  sel.textContent = '';
  S.tracks.forEach((t, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = trackLabel(i);
    sel.append(o);
  });
  sel.value = S.track;
}
$('trackSel').addEventListener('change', (e) => { selectTrack(+e.target.value); e.target.blur(); });

function useAltAudio(a) {
  if (alt === a) return;
  alt = a;
  altAudio.src = a.url;
  altAudio.playbackRate = video.playbackRate;
  video.muted = true;
  syncAlt(true);
  if (isPlaying()) altAudio.play().catch(() => {});
}
function useNativeAudio() {
  if (!alt) return;
  alt = null;
  altAudio.pause();
  altAudio.removeAttribute('src');
  altAudio.load();
  video.muted = false;
}
// The video is the clock; the copied track follows it.
function syncAlt(force) {
  if (!alt) return;
  const target = video.currentTime - alt.start;
  if (target < 0) { altAudio.pause(); return; }
  const drift = altAudio.currentTime - target;
  if (force || Math.abs(drift) > 0.3) {
    altAudio.currentTime = target;
    altAudio.playbackRate = video.playbackRate;
    return;
  }
  // Jumping again would land late again (seeking has latency) and is audible,
  // so close small gaps by playing a little faster or slower for a moment.
  // The nudge shrinks as the gap closes, so it settles instead of overshooting.
  const k = Math.abs(drift) < 0.005 ? 1 : 1 - clamp(drift * 1.5, -0.08, 0.08);
  altAudio.playbackRate = video.playbackRate * k;
}
video.addEventListener('play', () => { if (alt) { syncAlt(true); altAudio.play().catch(() => {}); } });
video.addEventListener('playing', () => { if (alt) { syncAlt(true); altAudio.play().catch(() => {}); } });
video.addEventListener('pause', () => { if (alt) altAudio.pause(); });
video.addEventListener('waiting', () => { if (alt) altAudio.pause(); });
video.addEventListener('seeking', () => syncAlt(true));
video.addEventListener('ratechange', () => { altAudio.playbackRate = video.playbackRate; });
altAudio.addEventListener('error', () => {
  if (!alt) return;
  useNativeAudio();
  toast('The browser couldn’t play the selected track, so the video’s own audio is playing');
});

// The waveform is built in a worker that streams the audio track from disk,
// so any file size works. Formats it can't stream fall back to decoding the
// whole file in memory, which only works for smaller files.
let waveWorker = null;
const LEGACY_LIMIT = 2e9;

function resetWaveform() {
  waveWorker?.terminate();
  waveWorker = null;
  S.peaks = null;
  S.peakLen = 0;
  S.peakMax = 0;
  S.waveStatus = '';
  tlDirty = true;
}

function addPeaks(from, data, max) {
  const need = from + data.length;
  if (!S.peaks || S.peaks.length < need) {
    const grown = new Float32Array(Math.max(need, Math.ceil(duration() * PEAK_RATE) + 1, (S.peaks?.length || 0) * 2));
    if (S.peaks) grown.set(S.peaks.subarray(0, S.peakLen));
    S.peaks = grown;
  }
  S.peaks.set(data, from);
  S.peakLen = Math.max(S.peakLen, need);
  S.peakMax = Math.max(S.peakMax, max);
  tlDirty = true;
}

function buildWaveform(file, track, mux) {
  resetWaveform();
  const multi = S.tracks.length > 1;
  const prefix = multi ? `Track ${track + 1} · ` : '';
  S.waveStatus = `${prefix}Waveform 0%`;
  let worker;
  try {
    worker = new Worker('js/wave-worker.js');
  } catch {
    return multi ? toast('No waveform: workers are unavailable') : legacyWaveform(file, 'workers are unavailable');
  }
  waveWorker = worker;
  const entry = { audio: null, reason: '' };
  const stale = () => S.videoFile !== file || waveWorker !== worker;
  const stop = (reason) => {
    worker.terminate();
    if (stale()) return;
    waveWorker = null;
    S.waveStatus = '';
    tlDirty = true;
    if (S.peakLen) toast(`Waveform may be incomplete: ${reason}`);
    // the in-memory fallback can only see the default track
    else if (multi) toast(`Track ${track + 1} (${S.tracks[track].codec}): ${reason}`);
    else legacyWaveform(file, reason);
  };
  worker.onmessage = ({ data: m }) => {
    if (stale()) return;
    if (m.type === 'peaks') addPeaks(m.from, m.data, m.max);
    else if (m.type === 'progress') { S.waveStatus = `${prefix}Waveform ${Math.round(m.done * 100)}%`; tlDirty = true; }
    else if (m.type === 'audio') {
      if (m.blob && !altAudio.canPlayType(m.mime)) entry.reason = `this browser can’t play ${S.tracks[track].codec} on its own`;
      else if (m.blob) entry.audio = { url: URL.createObjectURL(m.blob), start: m.start || 0 };
      else entry.reason = m.reason;
      if (S.track !== track) return;
      if (entry.audio) useAltAudio(entry.audio);
      else toast(`Can't play track ${track + 1} on its own: ${entry.reason}`);
    } else if (m.type === 'done') {
      worker.terminate();
      waveWorker = null;
      S.waveStatus = '';
      tlDirty = true;
      trackCache.set(track, { peaks: S.peaks, peakLen: S.peakLen, peakMax: S.peakMax, ...entry });
      if (!S.peakMax) toast('No waveform: the audio track is silent');
      else toast(multi ? `Audio: ${trackLabel(track)}. T switches tracks` : 'Waveform ready');
    } else stop(m.message);
  };
  worker.onerror = (e) => { e.preventDefault(); stop('the waveform worker crashed'); };
  worker.postMessage({ cmd: 'build', file, rate: PEAK_RATE, track, mux });
}

async function legacyWaveform(file, reason) {
  if (file.size > LEGACY_LIMIT) {
    S.waveStatus = '';
    tlDirty = true;
    return toast(`No waveform: ${reason}`);
  }
  S.waveStatus = 'Waveform…';
  tlDirty = true;
  try {
    const buf = await file.arrayBuffer();
    if (S.videoFile !== file) return;
    // Decode at a low sample rate to keep memory small; we only need the envelope.
    const ctx = new OfflineAudioContext(1, 1, 8000);
    const audio = await ctx.decodeAudioData(buf);
    if (S.videoFile !== file) return;
    const sr = audio.sampleRate, per = sr / PEAK_RATE;
    const n = Math.ceil(audio.duration * PEAK_RATE);
    const peaks = new Float32Array(n);
    let max = 0;
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const d = audio.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        let m = peaks[i];
        const end = Math.min(d.length, Math.floor((i + 1) * per));
        for (let j = Math.floor(i * per); j < end; j++) {
          const v = d[j] < 0 ? -d[j] : d[j];
          if (v > m) m = v;
        }
        peaks[i] = m;
        if (m > max) max = m;
      }
    }
    S.peaks = peaks;
    S.peakLen = n;
    S.peakMax = max;
    toast('Waveform ready');
  } catch {
    if (S.videoFile === file) toast(`No waveform: ${reason}`);
  } finally {
    if (S.videoFile === file) { S.waveStatus = ''; tlDirty = true; }
  }
}

video.addEventListener('loadedmetadata', () => {
  durEl.textContent = fmtTime(duration(), '.');
  if (S.pps * duration() < tl.clientWidth) fitAll();
  tlDirty = true;
  toast(`Loaded ${S.videoFile?.name || 'media'}`);
});
video.addEventListener('error', () => toast('This browser cannot play that file (try MP4/H.264 or WebM)'));
video.addEventListener('play', updateInd);
video.addEventListener('pause', updateInd);
video.addEventListener('click', togglePlay);

function openFiles(files) {
  for (const f of files) {
    if (/\.(srt|vtt|txt)$/i.test(f.name)) loadSubsFile(f);
    else loadVideoFile(f);
  }
}
fileSubs.addEventListener('change', () => { openFiles(fileSubs.files); fileSubs.value = ''; });
fileVideo.addEventListener('change', () => { openFiles(fileVideo.files); fileVideo.value = ''; });

window.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) stage.classList.remove('drop'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('drop');
  openFiles(e.dataTransfer.files);
});

const actions = {
  openSubs: () => fileSubs.click(),
  openVideo: () => fileVideo.click(),
  exportSrt: () => exportSubs('srt'),
  exportVtt: () => exportSubs('vtt'),
  help: () => toggleHelp(),
  clear: () => {
    if (!S.cues.length) return toast('Nothing to clear');
    const n = S.cues.length;
    if (!confirm(`Clear all ${n} text block${n > 1 ? 's' : ''}? Export first if you want to keep them.`)) return;
    pushUndo();
    S.cues = [];
    S.subName = 'untitled.srt';
    $('subName').textContent = S.subName;
    changed();
    select(null);
    toast(`Cleared — ${IS_MAC ? '⌘' : 'Ctrl+'}Z to undo`);
  },
};
document.querySelector('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  b.blur(); // keep Space/Enter for the editor, not the button
  actions[b.dataset.act]?.();
});

// ---------------------------------------------------------------- quick navigation / jump to timecode

const pal = $('palette'), palInput = $('palInput'), palList = $('palList'), palTitle = $('palTitle'), palHint = $('palHint');
let palMode = null, palItems = [], palPos = 0;

function parseTimecode(s) {
  const m = s.trim().match(/^(\d+):(\d+):(\d+)[:;](\d+)$/); // hh:mm:ss:ff
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] * FRAME : parseTime(s);
}
function openPalette(mode) {
  palMode = mode;
  palPos = 0;
  pal.hidden = false;
  palTitle.textContent = mode === 'time' ? 'Jump to timecode' : 'Quick navigation';
  palInput.placeholder = mode === 'time' ? 'hh:mm:ss.mmm · hh:mm:ss:ff · mm:ss · seconds' : 'Type text or a block number';
  palInput.value = mode === 'time' ? fmtTime(now(), '.') : '';
  renderPalette();
  palInput.focus();
  palInput.select();
}
function closePalette() {
  pal.hidden = true;
  palMode = null;
  palInput.blur();
}
function renderPalette() {
  palList.textContent = '';
  if (palMode === 'time') {
    const t = parseTimecode(palInput.value);
    palHint.textContent = Number.isNaN(t) ? 'Not a valid timecode' : `Enter jumps to ${fmtTime(clamp(t, 0, duration()), '.')}`;
    palItems = [];
    return;
  }
  const q = palInput.value.trim().toLowerCase();
  const num = /^#?\d+$/.test(q) ? q.replace('#', '') : null;
  palItems = S.cues.map((c, i) => ({ c, i }))
    .filter(({ c, i }) => !q || (num && String(i + 1).startsWith(num)) || plain(c.text).toLowerCase().includes(q))
    .slice(0, 80);
  palPos = clamp(palPos, 0, Math.max(0, palItems.length - 1));
  palHint.textContent = palItems.length ? '↑ ↓ choose · Enter jump · Esc close' : 'No matching text blocks';
  palItems.forEach(({ c, i }, k) => {
    const r = document.createElement('div');
    r.className = 'palrow' + (k === palPos ? ' on' : '');
    r.innerHTML = '<span class="n"></span><span class="t"></span><span class="tx"></span>';
    r.children[0].textContent = '#' + (i + 1);
    r.children[1].textContent = fmtTime(c.start, '.');
    r.children[2].textContent = plain(c.text).replace(/\n/g, ' / ') || '(empty)';
    r.addEventListener('mousedown', (ev) => { ev.preventDefault(); palPos = k; palGo(); });
    palList.append(r);
  });
  palList.children[palPos]?.scrollIntoView({ block: 'nearest' });
}
function palGo() {
  if (palMode === 'time') {
    const t = parseTimecode(palInput.value);
    if (Number.isNaN(t)) return toast('Not a valid timecode');
    closePalette();
    S.playUntil = null;
    seek(t);
    return;
  }
  const it = palItems[palPos];
  closePalette();
  if (it) select(it.c.id);
}
palInput.addEventListener('input', () => { palPos = 0; renderPalette(); });
palInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); palGo(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    palPos = clamp(palPos + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, palItems.length - 1));
    renderPalette();
  }
});
palInput.addEventListener('blur', () => { if (!pal.hidden) closePalette(); });
pal.addEventListener('mousedown', (e) => { if (e.target === pal) { e.preventDefault(); closePalette(); } });

// ---------------------------------------------------------------- keyboard (Frazier layout + extras)

const isHelpKey = (e) => e.key === '?' || ((e.code === 'Slash' || e.key === '/') && e.shiftKey);
// match the printed character so + and - work on any layout (e.g. the German "+" key)
const isPlus = (e) => e.key === '+' || e.code === 'NumpadAdd' || (e.key === '=' && !e.shiftKey);
const isMinus = (e) => e.key === '-' || e.code === 'NumpadSubtract';
const FRAZIER_ONLY = {
  KeyP: 'Glossary', KeyL: 'Glossary', KeyM: 'Markers', KeyC: 'Comments', KeyS: 'Snippets',
};

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === 'KeyO') { e.preventDefault(); (e.shiftKey ? fileVideo : fileSubs).click(); return; }
  if (mod && e.code === 'KeyS') { e.preventDefault(); exportSubs(e.shiftKey ? 'vtt' : 'srt'); return; }
  if (!helpEl.hidden) {
    if (e.key === 'Escape' || isHelpKey(e) || (e.shiftKey && e.code === 'KeyO')) { e.preventDefault(); toggleHelp(false); }
    return;
  }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); doRedo(); return; }
  if (mod) return; // leave other browser shortcuts (zoom, find, reload…) alone
  if (isHelpKey(e)) { e.preventDefault(); toggleHelp(); return; }
  if (e.key === '/' && !e.altKey) { e.preventDefault(); listSearch.focus(); listSearch.select(); return; }

  const sh = e.shiftKey, alt = e.altKey;
  let handled = true;

  if (alt && sh) {
    switch (e.code) {
      case 'ArrowLeft': selectRel(-1); break;
      case 'ArrowRight': selectRel(1); break;
      case 'KeyJ': openPalette('time'); break;
      case 'KeyD': confirmDelete(); break;
      case 'KeyM': case 'KeyC': toast(`${e.code === 'KeyM' ? 'Markers' : 'Comments'} are not part of this editor`); break;
      default: handled = false;
    }
  } else if (!alt && isPlus(e)) {
    setRate(S.rate + 0.25);
  } else if (!alt && isMinus(e)) {
    setRate(S.rate - 0.25);
  } else if (alt) {
    switch (e.code) {
      case 'Equal': case 'NumpadAdd': zoom(1.5); break;
      case 'Minus': case 'NumpadSubtract': zoom(1 / 1.5); break;
      case 'Digit0': case 'Numpad0': fitAll(); break;
      default: handled = false;
    }
  } else if (sh) {
    switch (e.code) {
      case 'ArrowLeft': seekBy(-3); break;
      case 'ArrowRight': seekBy(3); break;
      case 'KeyF': openPalette('nav'); break;
      case 'KeyO': toggleHelp(); break;
      case 'Space': playCue(); break;
      case 'KeyG': gotoSel(true); break;
      case 'KeyT': stepTrack(-1); break;
      case 'KeyH': cycleOffset(); break;
      case 'KeyQ': nudge('start', -0.01); break;
      case 'KeyW': nudge('start', 0.01); break;
      case 'KeyE': nudge('end', -0.01); break;
      case 'KeyR': nudge('end', 0.01); break;
      case 'Comma': nudge('move', -0.01); break;
      case 'Period': nudge('move', 0.01); break;
      default:
        if (FRAZIER_ONLY[e.code]) toast(`${FRAZIER_ONLY[e.code]} are not part of this editor`);
        else handled = false;
    }
  } else {
    switch (e.code) {
      // Frazier
      case 'Space': togglePlay(); break;
      case 'ArrowLeft': seekBy(-FRAME); break;
      case 'ArrowRight': seekBy(FRAME); break;
      case 'Home': S.playUntil = null; seek(0); break;
      case 'End': S.playUntil = null; seek(duration()); break;
      case 'Enter': case 'NumpadEnter': createOrEdit(); break;
      case 'Escape':
        S.playUntil = null;
        document.activeElement?.blur();
        if (S.loopOnce) stopLoop(); else updateInd();
        break;
      // extras
      case 'ArrowUp': case 'KeyK': selectRel(-1); break;
      case 'ArrowDown': case 'KeyJ': selectRel(1); break;
      case 'PageUp': selectRel(-10); break;
      case 'PageDown': selectRel(10); break;
      case 'KeyN': newCue(); break;
      case 'KeyA': setEdge('start'); break;
      case 'KeyS': setEdge('end'); break;
      case 'KeyQ': nudge('start', -0.1); break;
      case 'KeyW': nudge('start', 0.1); break;
      case 'KeyE': nudge('end', -0.1); break;
      case 'KeyR': nudge('end', 0.1); break;
      case 'Comma': nudge('move', -0.1); break;
      case 'Period': nudge('move', 0.1); break;
      case 'KeyX': split(); break;
      case 'KeyM': merge(); break;
      case 'Delete': case 'Backspace': del(); break;
      case 'KeyC': selectAtPlayhead(); break;
      case 'KeyG': gotoSel(false); break;
      case 'KeyT': stepTrack(1); break;
      case 'KeyL': loopBlock(); break;
      case 'KeyH': if (!e.repeat) holdStart(); break;
      case 'KeyO': toggleFlag('loop'); break;
      case 'KeyF': toggleFlag('follow'); break;
      case 'KeyB': toggleFlag('snap'); break;
      case 'KeyI': toggleFlag('cps'); break;
      case 'Backslash': setRate(1); break;
      default: handled = false;
    }
  }
  if (handled) e.preventDefault();
});

// ---------------------------------------------------------------- main loop

let lastTs = 0, lastT = -1, lastPlaying = false, lastSync = 0;
function tick(ts) {
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  if (!S.hasVideo && S.vplaying) {
    S.vt += dt * S.rate;
    if (S.vt >= duration()) { S.vt = duration(); S.vplaying = false; }
  }
  const playing = isPlaying();
  if (playing) {
    const c = selCue(), t = now();
    if (S.playUntil != null && t >= S.playUntil) {
      pause();
      setTime(S.playUntil);
      S.playUntil = null;
    } else if (S.loop && c && t >= c.end) {
      setTime(c.start);
    }
    if (S.follow) followPlayhead(now());
    if (alt && ts - lastSync > 100) { lastSync = ts; syncAlt(false); }
  }
  if (playing !== lastPlaying) { lastPlaying = playing; updateInd(); }
  const t = now();
  if (t !== lastT || S.activeId === undefined) {
    lastT = t;
    updateActive(t);
    clockEl.textContent = fmtTime(t, '.');
  }
  if (tlDirty) drawTimeline();
  updateMark();
  placePlayhead(t);
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- boot

document.querySelectorAll('.mod').forEach((el) => { el.textContent = IS_MAC ? '⌘' : 'Ctrl+'; });
document.querySelectorAll('[data-tip]').forEach((el) => { el.dataset.tip = el.dataset.tip.replaceAll('{mod}', IS_MAC ? '⌘' : 'Ctrl+'); });
const restored = loadSaved();
$('subName').textContent = S.subName;
S.pps = Math.max(20, tl.clientWidth / 20);
changed();
updateInd();
document.body.classList.toggle('no-cps', !S.cps);
durEl.textContent = S.hasVideo ? fmtTime(duration(), '.') : '--:--:--.---';
if (restored) {
  select(S.cues[0].id, { seek: false });
  toast(`Restored ${restored} cues from autosave`);
} else {
  toast('Ready. Press ? for keyboard shortcuts.');
}
requestAnimationFrame(tick);
