import { parseSubs, parseAdc, toSRT, toVTT, fmtTC, parseTC } from './formats.js';
import { initUpdates, openUpdates, updateChoice, renderUpdates } from './update.js';
import { HOSTED } from './config.js';
import { initAi, toggleAi, aiNotesChanged, openAiSettings } from './aidrawer.js';
import { initWelcome, openWelcome, welcomed, markWelcomed } from './welcome.js';
import { toProject, fromProject, sameMedia, PROJECT_EXT } from './project.js';
import { browserName, noticeItems, needsNotice, isMobile } from './browser.js';
import { blockFromPlayhead, nudgeFor, NUDGE, takeFrom } from './nav.js';
import { initTour, startTour, showLoop, maybeShowLoop } from './tour.js';
import { initWhatsNew, openWhatsNew } from './whatsnew.js';
import { initSettings, addSection, adopt, place, openSettings, closeSettings } from './settings.js';
import { initReminder } from './reminder.js';
import { announce, speakable, blockLabel } from './a11y.js';
import { initOffline, openOffline } from './offline.js';
import { initGuides, openGuide, guidesHere } from './guide.js';
import { matcher, count as countMatches, replaceIn, nextMatch } from './findreplace.js';
import { autosaveState, AUTOSAVE_LABEL, AUTOSAVE_TIP, nextSave, canAutosave } from './autosave.js';
import { comboOf, lookup } from './keymap.js';
import { initKeys, keyChanges, openKeys } from './keys.js';
import { VERSION } from './update.js';
import { FIT_MIN, MAX_SPEED } from './tts.js';
import { stt, initStt, openStt, transcribe, warmStt, RATE as STT_RATE } from './stt.js';
import { soundsLike, hasWord, mergeSay } from './tts.js';
import { tts, initTts, openTts, speak, stop as stopSpeech, duration as speechLength, spoken, SPEEDS, isSpeed, toBase, baseFromSpeed, speedLabel,
  isBlockSpeed, speedName, speedToFit, speedFromReadings, nextFitSpeed, bestFit, readingsOf, fixedShare, LANES,
  usingAudioVoice, measure, prefetch, readAhead, renderTrack, chosenVoice, chosenVoiceName, voiceName, voiceLabel, fillVoiceSelect, showGoogleCost, usingGoogle, setTtsOption, onlyNotes, mixLevels, setMix,
  savedReadings, clearSavedReadings } from './tts.js';

const $ = (id) => document.getElementById(id);

// Phones and tablets get a notice instead of the editor, which needs a keyboard and a
// bigger screen. Nothing else starts.
if (isMobile({ ua: navigator.userAgent, mobile: navigator.userAgentData?.mobile, touchPoints: navigator.maxTouchPoints })) {
  document.body.classList.add('blocked');
  $('mobileBlock').hidden = false;
  throw new Error('Scribecue needs a computer');
}

const video = $('video'), stage = $('stage'), overlay = $('overlay'), list = $('list');
const tl = $('tl'), ruler = $('ruler'), lane = $('lane'), wave = $('wave'), cuesLayer = $('cues');
const playheadEl = $('playhead'), dragtip = $('dragtip'), overview = $('overview'), ovWin = $('ovWin');
const edText = $('edText'), edStart = $('edStart'), edEnd = $('edEnd');
const editor = $('editor'), edTts = $('edTts');
const edIdx = $('edIdx'), edDur = $('edDur'), edStats = $('edStats'), edSpeed = $('edSpeed'), edSpeedWrap = $('edSpeedWrap'), edAuto = $('edAuto');
const clockEl = $('clock'), durEl = $('durEl'), ind = $('ind');
const toastEl = $('toast'), helpEl = $('help'), fileSubs = $('fileSubs'), fileVideo = $('fileVideo');

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// Mac key symbols as Windows and Linux users know them: ⌥⇧← becomes Alt+Shift+←.
const writing = () => S.mode === 'write';
const ttsOn = () => tts.on && writing();
const pcKeys = (s) => (IS_MAC ? s : s
  .replace(/⌘(?=\S)/g, 'Ctrl+').replace(/⌘/g, 'Ctrl')
  .replace(/⌥(?=\S)/g, 'Alt+').replace(/⌥/g, 'Alt')
  .replace(/⇧(?=\S)/g, 'Shift+').replace(/⇧/g, 'Shift'));
const MIN_DUR = 0.1;
const MAX_PPS = 1500;
const DEFAULT_LEN = 2;
const STORE_KEY = 'scribecue.v1';
// Nothing saved yet, under this name or the old one: a new user, who gets the welcome wizard.
const FIRST_RUN = (() => {
  try { return !Object.keys(localStorage).some((k) => k.startsWith('scribecue.') || k.startsWith('subed.')); } catch { return false; }
})();
// Carry over work and settings saved under the editor's old name.
try {
  for (const k of ['v1', 'offset']) {
    const old = localStorage.getItem('subed.' + k);
    if (old !== null && localStorage.getItem('scribecue.' + k) === null) localStorage.setItem('scribecue.' + k, old);
    localStorage.removeItem('subed.' + k);
  }
  // Settings for features that have been removed: reading speed (CPS) and snapping.
  for (const k of ['cps', 'snap']) { localStorage.removeItem('subed.' + k); localStorage.removeItem('scribecue.' + k); }
} catch { /* storage blocked */ }
const PEAK_RATE = 200; // waveform bins per second
const OFFSETS = [0, 0.1, 0.15, 0.2, 0.25, 0.3]; // hold-to-mark reaction offsets, ⇧H cycles

const css = getComputedStyle(document.documentElement);
const C = Object.fromEntries(['panel', 'line', 'dim', 'faint', 'accent', 'bg'].map((k) => [k, css.getPropertyValue('--' + k).trim()]));
C.wave = '#3b7f86';
C.grid = '#1b2028';

// Modes show the features for the task at hand. Transcribe: existing audio description
// at its original timing, with hold-to-mark. Write: new audio description, with text to
// speech. Someone who already turned text to speech on starts in Write.
const savedMode = (() => { try { return localStorage.getItem('scribecue.mode'); } catch { return null; } })();
const S = {
  mode: savedMode === 'write' || savedMode === 'transcribe' ? savedMode : tts.on ? 'write' : 'transcribe',
  cues: [],
  sel: null,
  activeId: null,
  pps: 60,
  view: 0,
  follow: true,
  loop: false,
  loopOnce: false, // loop started with L: ends when the block editor closes
  offset: (() => { try { const v = parseFloat(localStorage.getItem('scribecue.offset')); return OFFSETS.includes(v) ? v : 0.2; } catch { return 0.2; } })(),
  // After editing a block, go back to its start, to hear it again. On unless turned off.
  replay: (() => { try { return localStorage.getItem('scribecue.replay') !== '0'; } catch { return true; } })(),
  // The total length shows the time remaining instead.
  remaining: (() => { try { return localStorage.getItem('scribecue.remaining') === '1'; } catch { return false; } })(),
  resumeAfterEdit: false, // hold-to-mark paused playback; closing the editor resumes it
  rate: 1,
  fps: 25, // the video's frame rate, for timecode and frame steps (see setFps)
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
  subName: 'untitled.srt', // the open project or script's file name
  dirty: false, // changed since the project was last saved or opened
  handle: null, // where the project saves to, when the browser allows saving in place
  projectMedia: null, // { name, size } of the video the open project belongs to
  pendingPlayhead: null, // where to put the playhead once that video is open
  notes: '', // the writer's notes about the programme, for AI help
};

// Times show as SMPTE timecode at the video's frame rate, and typed times can be timecode
// or seconds. A frame step is one of the video's frames.
const tc = (t) => fmtTC(t, S.fps);
const readTime = (s) => parseTC(s, S.fps);
const frame = () => 1 / S.fps;
// The usual frame rates, to tidy a measured one: 23.976, 29.97 and 59.94 exactly.
const RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48000 / 1001, 48, 50, 60000 / 1001, 60];
function setFps(f) {
  if (!(f > 1 && f < 1000)) return;
  const near = RATES.find((r) => Math.abs(r - f) / r < 0.004);
  const fps = near ?? Math.round(f * 1000) / 1000;
  S.fpsKnown = true;
  if (fps === S.fps) return;
  S.fps = fps;
  updateEditor();
  applyFilter();
  showDur();
  tlDirty = true;
}
// For a video whose file doesn't say its frame rate: measured from the frames shown as it
// plays, once enough have played. Averaged over the steps of one frame (skipped frames
// make longer ones), as some files round frame times to the millisecond.
function measureFps() {
  if (!video.requestVideoFrameCallback) return;
  const src = video.src, steps = [];
  let last = null;
  const onFrame = (_, m) => {
    if (S.fpsKnown || video.src !== src) return;
    if (last != null && m.mediaTime > last) steps.push(m.mediaTime - last);
    last = m.mediaTime;
    if (steps.length >= 40) {
      const ok = steps.filter((d) => d > 0.004), one = ok.filter((d) => d < Math.min(...ok) * 1.5);
      return setFps(one.length / one.reduce((a, d) => a + d, 0));
    }
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

let nextId = 1;
// speed: the block's own text to speech speed, if it has one.
const mk = (start, end, text = '', speed) => ({ id: nextId++, start, end, text, ...(isBlockSpeed(speed) ? { speed } : {}) });
// A saved block back as a block: voice (its own text to speech voice), auto (end follows
// the reading), fit (speed follows the length) and pinned (speed picked by hand, so
// resizing leaves it alone).
const revive = (b) => Object.assign(mk(b.start, b.end, b.text, b.speed),
  typeof b.voice === 'string' && b.voice ? { voice: b.voice } : {},
  b.auto ? { auto: true } : {}, b.fit ? { fit: true } : {}, b.pinned ? { pinned: true } : {},
  b.say?.length ? { say: b.say } : {});
// What text to speech reads for a block: its text, with its "sounds like" words.
const said = (c) => soundsLike(c.text, c.say);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const idx = (id) => S.cues.findIndex((c) => c.id === id);
const selIdx = () => (S.sel == null ? -1 : idx(S.sel));
const selCue = () => S.cues[selIdx()] || null;
const sortCues = () => S.cues.sort((a, b) => a.start - b.start || a.end - b.end);
const plain = (s) => s.replace(/<[^>]*>|\{[^}]*\}/g, '');
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
  if (tts.speaking && Math.abs(t - now()) > 0.05) stopSpeech(); // a jump ends the reading
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
  stopSpeech();
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
  S.lastChange = Date.now();
  S.changeGen = (S.changeGen || 0) + 1;
  S.maxEnd = S.cues.reduce((m, c) => Math.max(m, c.end), 0);
  if (!S.dirty) { S.dirty = true; showDocName(); }
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
  if (S.dirty) scheduleAutosave();
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      subName: S.subName,
      dirty: S.dirty,
      // The open video, so it can be reopened after a reload, or else the project's.
      projectMedia: S.videoFile ? { name: S.videoFile.name, size: S.videoFile.size } : S.projectMedia,
      notes: S.notes,
      cues: S.cues.map(({ start, end, text, speed, voice, auto, fit, pinned, say }) => ({ start, end, text, speed, voice, auto, fit, pinned, say })),
    }));
  } catch { /* storage full or blocked */ }
}
function loadSaved() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY));
    if (o?.cues?.length) {
      S.cues = o.cues.map(revive);
      S.subName = o.subName || S.subName;
      S.savedDirty = o.dirty !== false;
      S.projectMedia = o.projectMedia || null;
      S.notes = typeof o.notes === 'string' ? o.notes : '';
      return S.cues.length;
    }
  } catch { /* ignore */ }
  return 0;
}

// ---------------------------------------------------------------- selection

// toTop: the block's row goes to the top of the list, so the blocks after it show below.
// Not for a row just clicked, which stays where it is under the pointer.
function select(id, { seek: doSeek = true, reveal = true, toTop = true } = {}) {
  if (S.sel !== id) {
    rowMap.get(S.sel)?.classList.remove('sel');
    rowMap.get(S.sel)?.setAttribute('aria-selected', 'false');
  }
  S.sel = id;
  const r = rowMap.get(id);
  r?.classList.add('sel');
  r?.setAttribute('aria-selected', 'true');
  // The list says which block is selected, so a screen reader in it reads each as you move.
  if (r) list.setAttribute('aria-activedescendant', r.id); else list.removeAttribute('aria-activedescendant');
  placeEditor();
  const shown = editor.hidden ? r : editor;
  if (shown && toTop) list.scrollTop += shown.getBoundingClientRect().top - list.getBoundingClientRect().top;
  else shown?.scrollIntoView({ block: 'nearest' });
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
// ⌥⇧← ⌥⇧→ and the buttons under the video: previous / next block from the playhead
// (see nav.js). ↑ ↓ step through the list from the selected block instead.
function playheadBlock(d) {
  if (!S.cues.length) return toast('No text blocks yet — press Enter to create one');
  const i = blockFromPlayhead(S.cues, now(), d, isPlaying());
  if (i < 0) return toast(d < 0 ? 'No text block before the playhead' : 'No text block after the playhead');
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
  if (what === 'end' && endLocked(c)) return;
  const { lo, hi } = bounds(selIdx());
  pushUndo(undefined, 'nudge-' + what + c.id);
  if (what === 'start') { c.start = clamp(c.start + d, lo, c.end - MIN_DUR); resized(c, 'start'); }
  else if (what === 'end') { c.end = clamp(c.end + d, c.start + MIN_DUR, hi); resized(c, 'end'); }
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
    resized(c, 'start');
  } else {
    if (endLocked(c)) return;
    if (t < c.start + MIN_DUR) return toast('Playhead is before this cue’s start');
    pushUndo();
    c.end = Math.min(hi, t);
    resized(c, 'end');
  }
  changed(c.id);
}

// The pencil in the block editor: the block starts at the playhead, keeping its length.
function moveToPlayhead() {
  const c = needSel(); if (!c) return;
  const { lo, hi } = bounds(selIdx()), len = c.end - c.start, t = now();
  if (t < lo || t + len > hi) return toast('The block doesn’t fit there without running into another one');
  pushUndo();
  c.start = t; c.end = t + len;
  changed(c.id);
  revealRange(c.start, c.end);
}
$('edBack').addEventListener('click', (e) => { e.currentTarget.blur(); nudge('move', -frame()); });
$('edFwd').addEventListener('click', (e) => { e.currentTarget.blur(); nudge('move', frame()); });
$('edHere').addEventListener('click', (e) => { e.currentTarget.blur(); moveToPlayhead(); });
$('edDel').addEventListener('click', (e) => { e.currentTarget.blur(); del(); });

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
  // A block written with text to speech on takes its end from the reading.
  if (ttsOn()) c.auto = true;
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
  const c2 = mk(t, c.end, b, c.speed);
  if (c.say) c2.say = c.say.map((x) => [...x]); // each half keeps the words; unused ones do nothing
  c.end = t; c.text = a;
  delete c.auto; delete c.fit;
  S.cues.push(c2);
  sortCues();
  // With text to speech on, each half ends where its reading does.
  for (const x of [c, c2]) { adapt(x); fitAuto(x); }
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
  const words = new Set((c.say || []).map(([w]) => w.toLocaleLowerCase()));
  const more = (n.say || []).filter(([w]) => !words.has(w.toLocaleLowerCase()));
  if (more.length) c.say = [...(c.say || []), ...more];
  delete c.auto; delete c.fit;
  S.cues.splice(i + 1, 1);
  adapt(c);
  fitAuto(c);
  changed();
  select(c.id, { seek: false });
  toast('Merged');
}

// Deletes the selected block, or the one given (the list's × buttons).
function del(c = needSel()) {
  if (!c) return;
  const i = idx(c.id);
  if (i < 0) return;
  const wasSel = c.id === S.sel;
  pushUndo();
  S.cues.splice(i, 1);
  changed();
  if (wasSel) {
    const n = S.cues[Math.min(i, S.cues.length - 1)];
    select(n ? n.id : null, { seek: false });
  }
  toast(`Deleted block #${i + 1} — ${IS_MAC ? '⌘' : 'Ctrl+'}Z to undo`);
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
// Whether the selected block is open in the list to edit. Esc closes it, leaving it selected.
let edOpen = false;

function updateEditor() {
  const c = selCue();
  edTts.hidden = !(c && ttsOn());
  if (!c) {
    edSpeedWrap.hidden = true;
    edVoiceWrap.hidden = true;
    edAuto.hidden = true;
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
  if (document.activeElement !== edStart) edStart.value = tc(c.start);
  if (document.activeElement !== edEnd) edEnd.value = tc(c.end);
  // The end comes from the reading with text to speech on.
  edEnd.readOnly = following(c);
  if (edEnd.readOnly) edEnd.dataset.tip = 'Where the reading ends. Change the block’s speed to move it'; else delete edEnd.dataset.tip;
  edAuto.hidden = !(c.auto && ttsOn());
  edDur.textContent = `${(c.end - c.start).toFixed(3)} s`;
  edSpeedWrap.hidden = !ttsOn();
  edVoiceWrap.hidden = !ttsOn();
  if (ttsOn() && document.activeElement !== edVoice) fillEdVoice(c);
  const custom = c.speed && !isSpeed(c.speed);
  edSpeedCustom.hidden = !custom;
  edSpeedCustom.textContent = custom ? speedName(c.speed) + (c.fit ? ', fits the block' : '') : 'custom';
  if (document.activeElement !== edSpeed) edSpeed.value = custom ? 'custom' : String(c.speed || 1);
  if (!edit || edit.id !== c.id) edText.value = c.text;
  edStats.textContent = '';
  if (ttsOn() && spoken(c.text)) {
    // How long the voice takes to read it: "~" until it has actually been read.
    const { secs, exact } = speechLength(said(c), c.speed, c.voice);
    const s = document.createElement('span');
    const tooLong = secs > c.end - c.start + 0.05;
    s.textContent = `TTS ${exact ? '' : '~'}${secs.toFixed(1)} s${tooLong ? ' · too long' : ''}`;
    s.className = 'tts ' + (tooLong ? 'bad' : '');
    edStats.append(s);
    if (!exact) schedulePrefetch(c);
  } else if (ttsOn() && onlyNotes(c.text)) {
    const s = document.createElement('span');
    s.textContent = 'TTS: notes only';
    s.className = 'dim';
    edStats.append(s);
  }
}

// With a Piper or Google voice, make the selected block's reading once typing pauses, so its
// length is exact rather than estimated. Google counts every reading, so with a Google voice
// a block being typed in is only read when the editing ends (see the blur handler).
let prefetchTimer = 0;
function schedulePrefetch(c) {
  clearTimeout(prefetchTimer);
  if (edit?.id === c.id && usingGoogle(c.voice)) return;
  const text = said(c), { speed, voice } = c;
  prefetchTimer = setTimeout(() => prefetch(text, speed, voice), 500);
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
  openEditor();
  field.focus();
  if (field === edText) edText.setSelectionRange(edText.value.length, edText.value.length);
  else field.select();
}

// finished: closed with Esc or ↵, rather than by opening something else.
function closeEditor(finished = false) {
  document.activeElement?.blur();
  if (finished) { edOpen = false; placeEditor(); }
  if (S.loopOnce) stopLoop();
  // With Replay on, the playhead goes back to the start of the block just edited, so it
  // can be heard again, and playback carries on from there if it was playing.
  if (finished && S.replay && selCue()) seek(selCue().start);
  if (S.resumeAfterEdit) {
    S.resumeAfterEdit = false;
    play();
  }
}

function setReplay(on, quiet = false) {
  S.replay = on;
  try { localStorage.setItem('scribecue.replay', on ? '1' : '0'); } catch { /* ignore */ }
  updateInd();
  if (!quiet) toast(on ? 'Replay on: Esc or ↵ after editing a block goes back to its start' : 'Replay off: the playhead stays where it is after editing');
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
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); return true; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const i = FIELDS.indexOf(field);
    editText(FIELDS[(i + (e.shiftKey ? FIELDS.length - 1 : 1)) % FIELDS.length]);
    return true;
  }
  if (os && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    nudge('move', e.code === 'ArrowLeft' ? -frame() : frame());
    updateEditorTimes();
    return true;
  }
  if (os && e.code === 'KeyD') { e.preventDefault(); confirmDelete(); return true; }
  if (mod && ['s', 'e', 'o'].includes(e.key.toLowerCase())) return false; // let file keys through
  // Windows keeps Alt+Space for the window menu, so Ctrl+Space works too off the Mac.
  if (e.code === 'Space' && (e.altKey || (!IS_MAC && e.ctrlKey)) && !e.shiftKey) { e.preventDefault(); togglePlay(); return true; }
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
  adapt(c);
  fitAuto(c);
  changed(c.id);
});
edText.addEventListener('blur', () => {
  const was = edit && S.cues.find((c) => c.id === edit.id);
  edit = null;
  document.body.classList.remove('editing');
  updateEditor();
  // The block just edited, even when another one is now selected: with a Google voice,
  // this is when it's read.
  if (was && ttsOn() && spoken(was.text)) prefetch(said(was), was.speed, was.voice);
});
edText.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyP') { e.preventDefault(); openSay(); return; }
  if (editorKeys(e, edText)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); closeEditor(true); return; }
  if (mod && !e.shiftKey && !e.altKey && ['KeyB', 'KeyI', 'KeyU'].includes(e.code)) {
    e.preventDefault();
    toggleTag(e.code[3].toLowerCase());
    return;
  }
  if (fileKeys(e)) return;
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
    const t = readTime(input.value);
    const cur = which === 'start' ? c.start : c.end;
    if (Number.isNaN(t)) { toast('Invalid time — use hh:mm:ss:ff, or seconds'); }
    else if (Math.abs(t - cur) > 0.0005 && which === 'end' && endLocked(c)) input.value = tc(c.end);
    else if (Math.abs(t - cur) > 0.0005) {
      pushUndo();
      if (which === 'start') c.start = clamp(t, 0, c.end - MIN_DUR);
      else c.end = Math.max(t, c.start + MIN_DUR);
      resized(c, which);
      changed();
      select(c.id, { seek: false });
    }
    input.value = tc(which === 'start' ? c.start : c.end);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') apply();
    if (editorKeys(e, input)) return;
    if (e.key === 'Enter') { e.preventDefault(); apply(); closeEditor(true); }
    else if (!e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      apply();
      blockStep(e.key === 'ArrowUp' ? -1 : 1, input);
    } else fileKeys(e);
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
  edStart.value = c ? tc(c.start) : '';
  edEnd.value = c ? tc(c.end) : '';
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
  } else fileKeys(e);
});

function fillRow(r, c, i) {
  const [n, t, d] = r.children[0].children, tx = r.children[1];
  n.textContent = i + 1;
  t.textContent = `${tc(c.start)} – ${tc(c.end)}`;
  d.textContent = `${(c.end - c.start).toFixed(2)} s` + (ttsOn() && c.speed ? ` · TTS ${isSpeed(c.speed) ? '' : 'custom '}${speedLabel(c.speed)}` : '')
    + (ttsOn() && c.voice ? ` · ${blockVoiceName(c.voice)}` : '');
  // Red when the reading is longer than the block, with a sign for anyone who can't tell red.
  const reading = ttsOn() && !!spoken(c.text) ? speechLength(said(c), c.speed, c.voice) : null;
  const over = !!reading && reading.secs > c.end - c.start + 0.05;
  d.classList.toggle('over', over);
  if (over) d.textContent += ' ⚠';
  // A dot when the reading has been made, at this voice and speed. Piper, Kokoro and Google
  // readings are kept in the browser, so they play straight away, even after a reload.
  if (reading?.exact) {
    d.append(Object.assign(document.createElement('span'), { className: 'ready', textContent: ' ●',
      title: usingGoogle(c.voice) ? 'Reading kept: plays straight away, and isn\'t sent to Google again'
        : usingAudioVoice(c.voice) ? 'Reading kept: its length is exact, and it plays straight away' : 'Reading made: its length is exact' }));
  }
  r.setAttribute('aria-label', blockLabel({ n: i + 1, start: tc(c.start), secs: (c.end - c.start).toFixed(2), text: c.text, tooLong: over, ready: !!reading?.exact }));
  fillText(tx, c);
  tx.classList.toggle('blank', !c.text);
  r.hidden = !matches(c, i);
}

function renderList() {
  rowMap.clear();
  // Everything but the editor, which stays put so typing in it isn't interrupted.
  for (const el of [...list.children]) if (el !== editor) el.remove();
  list.removeAttribute('aria-activedescendant');
  // A list for screen readers only when there are blocks in it.
  if (S.cues.length) list.setAttribute('role', 'listbox'); else list.removeAttribute('role');
  if (!S.cues.length) {
    const h = document.createElement('div');
    h.className = 'emptyhint';
    h.innerHTML = 'No text blocks yet.<br><kbd>Enter</kbd> create one at the playhead<br>' +
      '<kbd>' + (IS_MAC ? '⌘' : 'Ctrl+') + 'O</kbd> open an SRT / VTT file<br>' +
      'or drag on the timeline lane to draw one.';
    list.append(h);
    placeEditor();
    return;
  }
  const frag = document.createDocumentFragment();
  S.cues.forEach((c, i) => {
    const r = document.createElement('div');
    r.className = 'row';
    r.dataset.id = c.id;
    r.id = `blk-${c.id}`;
    r.setAttribute('role', 'option');
    r.setAttribute('aria-selected', String(c.id === S.sel));
    r.innerHTML = '<div class="rh"><span class="n"></span><span class="t"></span><span class="d"></span>' +
      // Only for the mouse: from the keyboard, Delete does it, so screen readers skip it.
      '<span class="rowdel" aria-hidden="true" data-tip="Delete this block (Del). Ctrl/Cmd+Z brings it back">×</span></div>' +
      '<div class="tx"></div>';
    fillRow(r, c, i);
    if (c.id === S.sel) r.classList.add('sel');
    if (c.id === S.activeId) r.classList.add('active');
    rowMap.set(c.id, r);
    frag.append(r);
  });
  list.insertBefore(frag, editor);
  if (rowMap.has(S.sel)) list.setAttribute('aria-activedescendant', `blk-${S.sel}`);
  placeEditor();
  applyFilter();
}

// The selected block opens in its place, as in Frazier: the rows up to it go above the
// editor and the rest below. The rows move rather than the editor, as moving a text box
// takes the focus out of it.
function openEditor() {
  if (edOpen) return;
  edOpen = true;
  placeEditor();
  editor.scrollIntoView({ block: 'nearest' });
}
function placeEditor() {
  const i = selIdx();
  editor.hidden = !edOpen || i < 0 || !rowMap.has(S.sel);
  if (editor.hidden) return;
  const rows = S.cues.map((c) => rowMap.get(c.id));
  const above = (r) => r.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING;
  for (let k = 0; k <= i; k++) if (!above(rows[k])) list.insertBefore(rows[k], editor);
  for (let k = rows.length - 1; k > i; k--) if (above(rows[k])) editor.after(rows[k]);
}

list.addEventListener('click', (e) => {
  const r = e.target.closest('.row');
  if (!r) return;
  if (e.target.closest('.rowdel')) { e.target.blur(); del(S.cues[idx(+r.dataset.id)]); return; }
  // One click opens the block, ready to type, as in Frazier.
  select(+r.dataset.id, { toTop: false });
  editText();
});

// ---------------------------------------------------------------- find and replace

const findDlg = $('findDlg');
const findRe = () => matcher($('frFind').value, { matchCase: $('frCase').checked, wholeWords: $('frWhole').checked });
function showFindCount() {
  const { matches, blocks } = countMatches(S.cues, findRe());
  $('frCount').textContent = !$('frFind').value ? 'Type what to find.'
    : matches ? `Found ${matches} time${matches === 1 ? '' : 's'} in ${blocks} block${blocks === 1 ? '' : 's'}.` : 'Not found.';
  $('frAll').disabled = $('frNext').disabled = !matches;
}
function openFind() {
  if (edit) closeEditor();
  // What's selected in the text box, or searched for in the list, is what to find.
  const picked = document.activeElement === edText ? edText.value.slice(edText.selectionStart, edText.selectionEnd).trim() : '';
  if (picked && !picked.includes('\n')) $('frFind').value = picked;
  else if (!$('frFind').value && listSearch.value && !listSearch.value.startsWith('#')) $('frFind').value = listSearch.value;
  if (!findDlg.open) findDlg.showModal();
  showFindCount();
  $('frFind').select();
}
$('replaceBtn').addEventListener('click', (e) => { e.currentTarget.blur(); openFind(); });
for (const id of ['frFind', 'frCase', 'frWhole']) $(id).addEventListener('input', showFindCount);
$('frFind').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('frNext').click(); } });
$('frWith').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('frAll').click(); } });
$('frNext').addEventListener('click', () => {
  const i = nextMatch(S.cues, findRe(), selIdx());
  if (i < 0) return showFindCount();
  select(S.cues[i].id);
  $('frCount').textContent = `Block #${i + 1}: ${plain(S.cues[i].text).slice(0, 80)}`;
});
$('frAll').addEventListener('click', () => {
  const re = findRe(), { matches, blocks } = countMatches(S.cues, re);
  if (!matches) return showFindCount();
  pushUndo();
  for (const c of S.cues) c.text = replaceIn(c.text, re, $('frWith').value);
  changed();
  showFindCount();
  $('frCount').textContent = `Replaced ${matches} in ${blocks} block${blocks === 1 ? '' : 's'}. ${IS_MAC ? '⌘Z' : 'Ctrl+Z'} undoes it.`;
  toast(`Replaced ${matches} in ${blocks} block${blocks === 1 ? '' : 's'}. ⌘Z undoes it`);
});
$('frClose').addEventListener('click', () => findDlg.close());
document.addEventListener('keydown', (e) => { if (findDlg.open) e.stopPropagation(); }, true);

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
    el.classList.toggle('locked', following(c));
    el.classList.toggle('sel', c.id === S.sel);
    el.classList.toggle('active', c.id === S.activeId);
    el.classList.toggle('faded', !matches(c, i));
    el.children[1].textContent = w > 28 ? '#' + (i + 1) + (ttsOn() && c.speed && w > 70 ? ` · ${speedLabel(c.speed)}` : '') : '';
    if (el._text !== c.text) { el._text = c.text; el.children[2].textContent = c.text; }
  }
  for (const [id, el] of cueEls) if (!seen.has(id)) { el.remove(); cueEls.delete(id); }
}

function drawOverview() {
  const d = duration(), W = overview.clientWidth;
  ovWin.style.left = (S.view / d) * W + 'px';
  ovWin.style.width = Math.min(W, (visSec() / d) * W) + 'px';
}

// ---------------------------------------------------------------- scrubber

// A bar under the video for the whole programme: click or drag to move the playhead.
// Blocks show as marks along it, the selected one in the accent colour. It takes no
// keyboard focus, so the editor's keys keep working; ←/→ and the rest still move.
const scrubEl = $('scrub'), scrubMarks = $('scrubMarks'), scrubTime = $('scrubTime');
let scrubW = 0, scrubSec = -1;
function placeScrub(t) {
  const d = duration();
  scrubEl.style.setProperty('--at-f', d > 0 ? clamp(t / d, 0, 1) : 0);
  const sec = Math.floor(t);
  if (sec !== scrubSec) {
    scrubSec = sec;
    scrubEl.setAttribute('aria-valuemax', String(Math.round(d)));
    scrubEl.setAttribute('aria-valuenow', String(sec));
    scrubEl.setAttribute('aria-valuetext', tc(t).slice(0, 8));
  }
}
function drawScrub(force = false) {
  const w = scrubMarks.clientWidth, dpr = devicePixelRatio || 1;
  if (!w || (!force && w === scrubW)) return;
  scrubW = w;
  scrubMarks.width = Math.round(w * dpr);
  scrubMarks.height = Math.round(6 * dpr);
  const g = scrubMarks.getContext('2d'), d = duration(), k = scrubMarks.width / d;
  g.clearRect(0, 0, scrubMarks.width, scrubMarks.height);
  const css = getComputedStyle(document.documentElement);
  const mark = (c, color) => {
    g.fillStyle = color;
    g.fillRect(c.start * k, 0, Math.max(dpr, (c.end - c.start) * k), scrubMarks.height);
  };
  for (const c of S.cues) mark(c, css.getPropertyValue('--cue'));
  const s = selCue();
  if (s) mark(s, css.getPropertyValue('--accent'));
}
const scrubAt = (e) => {
  const r = scrubMarks.getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width, 0, 1) * duration();
};
function showScrubTime(e) {
  const r = scrubEl.getBoundingClientRect(), mr = scrubMarks.getBoundingClientRect();
  scrubTime.hidden = false;
  scrubTime.textContent = tc(scrubAt(e));
  scrubTime.style.left = `${clamp(e.clientX, mr.left, mr.right) - r.left}px`;
}
scrubEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  scrubEl.setPointerCapture(e.pointerId);
  scrubEl.classList.add('on');
  S.playUntil = null;
  seek(scrubAt(e));
  showScrubTime(e);
});
scrubEl.addEventListener('pointermove', (e) => {
  showScrubTime(e);
  if (scrubEl.hasPointerCapture(e.pointerId)) seek(scrubAt(e));
});
const scrubDone = (e) => {
  scrubEl.classList.remove('on');
  if (e.type !== 'pointerup' || !scrubEl.matches(':hover')) scrubTime.hidden = true;
};
scrubEl.addEventListener('pointerup', scrubDone);
scrubEl.addEventListener('pointercancel', scrubDone);
scrubEl.addEventListener('pointerleave', () => { if (!scrubEl.classList.contains('on')) scrubTime.hidden = true; });

function placePlayhead(t) {
  const x = (t - S.view) * S.pps;
  playheadEl.style.display = x < -2 || x > tl.clientWidth + 2 ? 'none' : '';
  playheadEl.style.transform = `translateX(${x}px)`;
}

// ---------------------------------------------------------------- timeline interaction

let drag = null;

lane.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('.cue');
  if (el) {
    const id = +el.dataset.id, i = idx(id), c = S.cues[i];
    if (!c) return;
    if (S.sel !== id) select(id, { seek: false, reveal: false });
    const mode = following(c) ? 'move' : e.target.closest('.hl') ? 'start' : e.target.closest('.hr') ? 'end' : 'move';
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
    const ns = clamp(drag.s0 + dt, lo, hi - len);
    c.start = ns; c.end = ns + len;
  } else if (drag.mode === 'start') {
    c.start = clamp(drag.s0 + dt, lo, c.end - MIN_DUR);
    resized(c, 'start');
  } else if (drag.mode === 'end') {
    c.end = clamp(drag.e0 + dt, c.start + MIN_DUR, hi);
    resized(c, 'end');
  } else if (drag.mode === 'create') {
    const b = xToT(e.clientX);
    c.start = clamp(Math.min(drag.t0, b), lo, hi);
    c.end = clamp(Math.max(drag.t0, b), lo, hi);
    if (c.end - c.start < MIN_DUR) c.end = Math.min(hi, c.start + MIN_DUR);
  }
  changed(c.id);
  dragtip.hidden = false;
  dragtip.textContent = `${tc(c.start)} → ${tc(c.end)}  ·  ${(c.end - c.start).toFixed(2)} s`;
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
  // While you hold H to time your own read, the block you're reading stays up, even
  // past its old end, until you let go.
  const a = (hold?.take != null && S.cues[idx(hold.take)]) || cueAt(t);
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
  replay: 'Replay is on: Esc or ↵ after editing a block puts the playhead back at its start (⇧L). Click for its settings',
  offset: 'Reaction offset: blocks marked, and reads timed, with H move back by this much, since you let go a moment late. ⇧H changes it; click for its settings',
  tts: 'Text to speech is on: hear blocks read aloud (V). Click for its settings, such as the voice and speed (⌥⇧V)',
  stt: 'Speech to text is on: Whisper types what the narrator says in each block you mark. Click for its settings, or to transcribe empty blocks (⌥⇧H)',
};
function updateInd() {
  const items = [
    ['speed', `${S.rate.toFixed(2)}×`, S.rate !== 1],
    ['follow', 'FOLLOW', S.follow],
    ['loop', 'LOOP', S.loop],
    ['offset', `H −${Math.round(S.offset * 1000)}ms`, false],
    // Settings show only while they're on, and open their section of Settings.
    ...(S.replay ? [['replay', 'REPLAY', true]] : []),
    ...(!writing() && stt.on && stt.ready ? [['stt', 'STT', true]] : []),
    ...(writing() && tts.on ? [['tts', tts.base !== 1 ? `TTS ${Math.round(tts.base * 100)}%` : 'TTS', true]] : []),
  ];
  ind.textContent = '';
  showMix();
  duckAudio(); // the mix only applies in Write mode with text to speech on
  for (const [key, label, on] of items) {
    const s = document.createElement('button');
    s.textContent = label;
    s.dataset.key = key;
    s.dataset.tip = pcKeys(IND_TIPS[key]);
    s.setAttribute('aria-label', speakable(IND_TIPS[key], IS_MAC));
    if (['follow', 'loop'].includes(key)) s.setAttribute('aria-pressed', String(!!on));
    else if (key !== 'speed') s.classList.add('setlabel');
    s.className = (on ? 'on ' : '') + (key === 'speed' || key === 'follow' ? '' : 'tip-end');
    ind.append(s);
  }
  const p = isPlaying();
  ctrls.classList.toggle('playing', p);
  ctrls.querySelector('[data-ctl="playBlock"]').classList.toggle('on', p && S.playUntil != null);
  ctrls.querySelector('[data-ctl="loop"]').classList.toggle('on', S.loop);
}

// Player controls under the video: each button does what its key does.
const ctrls = $('ctrls');
const CTL = {
  prevBlock: () => playheadBlock(-1),
  back3: () => seekBy(-3),
  backFrame: () => seekBy(-frame()),
  play: () => togglePlay(),
  fwdFrame: () => seekBy(frame()),
  fwd3: () => seekBy(3),
  nextBlock: () => playheadBlock(1),
  playBlock: () => playCue(),
  loop: () => loopBlock(),
};
// Don't take focus, so Space and the other keys keep working on the timeline.
ctrls.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
ctrls.addEventListener('click', (e) => CTL[e.target.closest('button')?.dataset.ctl]?.());
// After the clock: the total length, or, clicked, the time remaining. Remembered.
function showDur(t = now()) {
  const d = S.hasVideo ? duration() : NaN, remaining = S.remaining && d > 0;
  durEl.textContent = !(d > 0) ? '--:--:--:--'
    : remaining ? `−${tc(Math.max(0, d - t))}` : tc(d);
  durEl.dataset.tip = remaining ? 'Time remaining. Click to show the total length instead'
    : 'Total length. Click to show the time remaining instead';
  durEl.setAttribute('aria-label', remaining ? 'Time remaining. Show the total length instead' : 'Total length. Show the time remaining instead');
}
durEl.addEventListener('mousedown', (e) => e.preventDefault()); // keys stay on the timeline
durEl.addEventListener('click', () => {
  S.remaining = !S.remaining;
  try { localStorage.setItem('scribecue.remaining', S.remaining ? '1' : '0'); } catch { /* ignore */ }
  showDur();
});
// Swap sides: the video on the left and the editor on the right, or back. Remembered.
function setSwapped(on) {
  document.body.classList.toggle('swapped', on);
  $('swapBtn').setAttribute('aria-pressed', String(on));
  tlDirty = true;
}
setSwapped((() => { try { return localStorage.getItem('scribecue.swapped') === '1'; } catch { return false; } })());
function swapSides() {
  const on = !document.body.classList.contains('swapped');
  setSwapped(on);
  try { localStorage.setItem('scribecue.swapped', on ? '1' : '0'); } catch { /* ignore */ }
}
clockEl.addEventListener('click', async (e) => {
  e.currentTarget.blur(); // so Space still plays
  const code = tc(now());
  let ok = false;
  try { await navigator.clipboard.writeText(code); ok = true; } catch { /* fall back below */ }
  if (!ok) {
    // older path for browsers that refuse the async clipboard API
    const ta = document.createElement('textarea');
    ta.value = code;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast(ok ? `Copied ${code}` : 'Couldn’t copy: the browser blocked clipboard access');
});
ind.addEventListener('click', (e) => {
  e.target.blur?.(); // so Space still plays
  const k = e.target.dataset.key;
  if (k === 'speed') setRate(1);
  // The settings' labels open their section of Settings.
  else if (k === 'offset' || k === 'stt') showMarking();
  else if (k === 'tts') openTts();
  else if (k === 'replay') showGeneral();
  else if (k) toggleFlag(k);
});

function toggleFlag(k) {
  S[k] = !S[k];
  if (k === 'loop') S.loopOnce = false;
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

// ---------------------------------------------------------------- text to speech

// V: read the block under the playhead (or the selected one) from its start, with the
// video playing alongside. Playback stops at the block's end, or where the reading
// ends if it runs over. ⇧V then sets the block's end to where the reading finished.
function speakBlock(fit) {
  if (!writing()) return modeOnly('Text to speech', 'write');
  if (!tts.on) { openTts(); return toast('Turn on text to speech to hear blocks read aloud'); }
  const c = cueAt(now()) || selCue();
  if (!c) return toast('No text block here — move the playhead into one or select one');
  if (!spoken(c.text)) return toast(onlyNotes(c.text) ? 'This block only has notes in [brackets], which aren’t read' : 'This block has no text to read yet');
  select(c.id, { seek: false });
  if (S.loop) { S.loop = S.loopOnce = false; updateInd(); }
  S.playUntil = null;
  setTime(c.start);
  const id = c.id;
  speak(said(c), {
    id, manual: true, speed: c.speed, voice: c.voice,
    done: (secs) => {
      const cur = S.cues[idx(id)];
      if (secs == null || !cur) return;
      if (fit) { pause(); fitToSpeech(cur, secs); return; }
      const room = cur.end - cur.start;
      if (now() >= cur.end) pause(); else S.playUntil = cur.end;
      // An auto block has just been refitted to this reading.
      if (cur.auto && room + 0.0005 >= secs) return toast(`Reading takes ${secs.toFixed(1)} s. The block now ends where the reading finishes`);
      toast(secs > room + 0.05
        ? `Reading takes ${secs.toFixed(1)} s, ${(secs - room).toFixed(1)} s longer than the block. ⇧V fits the block to it`
        : `Reading takes ${secs.toFixed(1)} s and fits, with ${(room - secs).toFixed(1)} s to spare`);
    },
  });
  play();
  toast(fit ? 'Reading the block to measure it…' : 'Reading the block…');
}

function fitToSpeech(c, secs) {
  const i = idx(c.id), { hi } = bounds(i);
  const end = clamp(c.start + secs, c.start + MIN_DUR, hi);
  pushUndo();
  c.end = end;
  // The end now follows the reading, not the other way round, including as the text changes.
  delete c.fit;
  c.auto = true;
  select(c.id, { seek: false });
  changed(c.id);
  toast(c.start + secs > hi + 0.001
    ? `Reading takes ${secs.toFixed(1)} s, but the next block starts first, so the end stops there`
    : `Block now ends where the reading finishes (${secs.toFixed(1)} s)`);
}

// Blocks marked auto take their end from how long the reading takes, until the end is
// set by hand. It never runs into the next block.
function fitAuto(c) {
  if (!c?.auto || !ttsOn() || !spoken(c.text)) return false;
  const i = idx(c.id);
  if (i < 0) return false;
  const { hi } = bounds(i);
  const end = clamp(c.start + speechLength(said(c), c.speed, c.voice).secs, c.start + MIN_DUR, Math.max(hi, c.start + MIN_DUR));
  if (Math.abs(end - c.end) < 0.0005) return false;
  c.end = end;
  return true;
}
// With text to speech on, a block with text ends where its reading does, as in Frazier:
// its length changes with its text and speed, not by hand.
const following = (c) => ttsOn() && !!spoken(c.text);
function adapt(c) {
  if (!following(c)) return;
  delete c.fit;
  c.auto = true;
}
const lockedTip = 'With text to speech on, a block ends where its reading does. Change its speed to make it longer or shorter';
// A block's end about to be set by hand: says why it can't be, with text to speech on.
function endLocked(c) {
  if (!following(c)) return false;
  toast(lockedTip);
  return true;
}
// A block's length changed by hand: its start or end edge. With text to speech on, the end
// goes back to where the reading finishes, so a new start moves the whole block.
function resized(c, edge) {
  if (following(c)) {
    adapt(c);
    fitAuto(c);
    if (edge === 'end') toast(lockedTip);
    return;
  }
  if (edge === 'end') delete c.auto;
  else fitAuto(c);
}

// How far over its block a reading can run and still count as fitting: half a 1% step,
// on long blocks.
const fitNear = (secs) => Math.max(0.03, secs * 0.005);
// The readings fitting can choose from, at FIT_MIN or faster, and the next speed to try.
const fitReadings = (c) => readingsOf(said(c), false, c.voice).filter((p) => p.speed >= FIT_MIN - 0.005);
function nextFit(c, target, near) {
  const pts = fitReadings(c);
  const guess = speedFromReadings(pts, target, c.speed ?? 1, fixedShare(c.voice));
  const s = nextFitSpeed(pts, target, guess == null ? null : Math.max(FIT_MIN, guess), near);
  return s == null ? null : Math.max(FIT_MIN, s);
}
// Blocks marked fit read at whatever speed fills them. Uses the reading at the block's
// current speed when that's been measured, so the speed closes in on an exact fit.
// force: fit even with the resize setting off, as Fit speeds to timings does.
function fitSpeed(c) {
  if (!c?.fit || !ttsOn() || !spoken(c.text)) return false;
  const at = c.speed ?? 1, target = c.end - c.start;
  let s;
  if (fitReadings(c).length) s = nextFit(c, target, fitNear(target));
  // With Piper or Google, wait for real readings rather than move the speed on an estimate.
  else if (usingAudioVoice(c.voice) && at >= FIT_MIN) { if (c.id === S.sel) schedulePrefetch(c); return false; }
  else s = Math.max(FIT_MIN, speedToFit(speechLength(said(c), 1, c.voice).secs, 1, target));
  if (s == null || Math.abs(s - at) < 0.005) return false;
  c.speed = s;
  if (c.id === S.sel) schedulePrefetch(c);
  return true;
}

function fitAllAuto() {
  let any = false;
  for (const c of S.cues) any = (fitAuto(c) || (c.fit && measuring && fitSpeed(c))) || any;
  if (any) changed();
}

// Update all timings: set every block's end from its reading, optionally reading each
// one silently first so every length is exact. One undo step.
const ttsAll = $('ttsAll'), ttsAllStop = $('ttsAllStop'), ttsAllStatus = $('ttsAllStatus'), ttsAllBar = $('ttsAllBar');
// While a job runs, its button gives way to a progress bar.
function busy(btn, bar, on) {
  btn.hidden = on;
  bar.hidden = !on;
  bar.value = 0;
}
let measuring = false;
// Update all timings and Fit speeds to timings run in the background, one at a time, so
// work can carry on while they do. Their progress shows in the bottom bar, with Stop,
// wherever they were started, and in the text to speech settings too.
const jobBox = $('jobBox'), jobBar = $('jobBar'), jobText = $('jobText');
let jobActive = false;
async function asJob(fn) {
  if (jobActive) return toast('Another job is running. Wait for it to finish, or press Stop in the bottom bar');
  jobActive = true;
  try { return await fn(); } finally { jobActive = false; jobBox.hidden = true; }
}
function progress(ui, frac, text) {
  ui.bar.value = jobBar.value = frac;
  ui.status.textContent = text;
  jobText.textContent = `${ui.job}: ${text.replace(/^[^:]*: /, '')}`;
  jobBox.hidden = false;
}
// Stops the job under way, if there is one, and waits for it to finish, as before the
// blocks it's working on are replaced.
async function stopJob() {
  if (!jobActive) return;
  measuring = false;
  stopSpeech();
  while (jobActive) await new Promise((r) => setTimeout(r, 50));
}
$('jobStop').addEventListener('click', () => { measuring = false; stopSpeech(); });
// Measures every block that hasn't been yet, at its current speed, showing progress in
// place of a button. Returns false if Stop was pressed. ui: { btn, bar, stop, status }.
// Shows a job's result in the panel and on screen, so it's seen even if the panel was
// closed while the job ran.
function report(el, msg) {
  el.textContent = msg;
  toast(msg);
}

async function measureAll(blocks, ui) {
  const todo = blocks.filter((c) => !speechLength(said(c), c.speed, c.voice).exact);
  if (!todo.length) return true;
  const audio = todo.every((c) => usingAudioVoice(c.voice));
  pause();
  measuring = true;
  busy(ui.btn, ui.bar, true);
  ui.stop.hidden = false;
  if (audio) {
    // Several readings at once where the web version can (see LANES).
    let next = 0, done = 0;
    progress(ui, 0, `Making readings: 0 of ${todo.length}`);
    await Promise.all(Array.from({ length: LANES }, async () => {
      while (measuring && next < todo.length) {
        const c = todo[next++];
        await measure(said(c), c.speed, { bulk: true, voice: c.voice });
        ++done;
        progress(ui, done / todo.length, `Making readings: ${done} of ${todo.length}`);
      }
    }));
  } else {
    for (let k = 0; k < todo.length && measuring; k++) {
      progress(ui, k / todo.length, `Reading block ${k + 1} of ${todo.length} silently`);
      await measure(said(todo[k]), todo[k].speed, { voice: todo[k].voice });
    }
  }
  ui.bar.value = 1;
  const done = measuring;
  measuring = false;
  busy(ui.btn, ui.bar, false);
  ui.stop.hidden = true;
  return done;
}

// ask: false when the choice was already made, as when opening a script.
async function updateAllTimings(ask = true) {
  const blocks = S.cues.filter((c) => spoken(c.text));
  if (!blocks.length) return (ttsAllStatus.textContent = 'There are no blocks with text yet.');
  // Piper and Google make exact lengths quickly, so it always measures. Browser voices only do
  // when asked, since they have to read each block in real time.
  const audio = blocks.every((c) => usingAudioVoice(c.voice));
  if (audio || $('ttsAllExact').checked) {
    if (!(await measureAll(blocks, { btn: ttsAll, bar: ttsAllBar, stop: ttsAllStop, status: ttsAllStatus, job: 'Updating timings' }))) {
      return report(ttsAllStatus, 'Update all timings stopped. No timings were changed.');
    }
  }
  const n = blocks.length;
  if (ask && !confirm(`Update the end of ${n} block${n > 1 ? 's' : ''} from the reading? This also changes blocks marked with H or opened from a file. You can undo it.`)) {
    return (ttsAllStatus.textContent = '');
  }
  pushUndo();
  let moved = 0, short = 0, estimated = 0;
  for (let i = 0; i < S.cues.length; i++) {
    const c = S.cues[i], next = S.cues[i + 1];
    if (!spoken(c.text)) continue;
    const { secs, exact } = speechLength(said(c), c.speed, c.voice);
    const hi = next ? Math.max(next.start, c.start + MIN_DUR) : Math.max(duration(), c.start + secs);
    const end = clamp(c.start + secs, c.start + MIN_DUR, hi);
    if (c.start + secs > hi + 0.0005) short++;
    if (!exact) estimated++;
    // From now on the end follows the reading, as the text changes, as in a new block.
    delete c.fit;
    c.auto = true;
    if (Math.abs(end - c.end) > 0.0005) { c.end = end; moved++; }
  }
  changed();
  const msg = `Updated ${moved} of ${n} block${n > 1 ? 's' : ''}.` +
    (short ? ` ${short === 1 ? "1 block doesn't" : `${short} blocks don't`} fit before the next one (red in the list).` : '') +
    (estimated && !audio ? ` ${estimated === n ? 'All' : estimated} used estimated lengths: tick the box above for exact ones.` : '');
  report(ttsAllStatus, msg);
}
ttsAll.addEventListener('click', () => asJob(() => updateAllTimings()));

// Make all readings: every block's reading, made now and kept, so each plays straight away.
const ttsMakeAll = $('ttsMakeAll'), ttsMakeStatus = $('ttsMakeStatus');
async function makeAllReadings() {
  const blocks = S.cues.filter((c) => spoken(c.text));
  if (!blocks.length) return (ttsMakeStatus.textContent = 'There are no blocks with text yet.');
  const todo = blocks.filter((c) => !speechLength(said(c), c.speed, c.voice).exact).length;
  if (!todo) return report(ttsMakeStatus, `All ${blocks.length} readings are made already.`);
  if (!(await measureAll(blocks, { btn: ttsMakeAll, bar: $('ttsMakeBar'), stop: $('ttsMakeStop'), status: ttsMakeStatus, job: 'Making readings' }))) {
    return report(ttsMakeStatus, 'Make all readings stopped. The readings made so far are kept.');
  }
  const failed = blocks.filter((c) => !speechLength(said(c), c.speed, c.voice).exact).length;
  report(ttsMakeStatus, failed ? `Made ${todo - failed} of ${todo} readings. ${failed} couldn’t be made: try again in a moment.`
    : `Made ${todo} reading${todo > 1 ? 's' : ''}. All ${blocks.length} are ready.`);
}
ttsMakeAll.addEventListener('click', () => asJob(() => makeAllReadings()));
$('ttsMakeStop').addEventListener('click', () => { measuring = false; stopSpeech(); });

// Fits Piper or Google readings to their blocks one block at a time, so the progress runs once from
// the first block to the last. Each block is read at a speed guessed from its estimate,
// then at better guesses from the readings so far, until the reading is as close to the
// block as the speed's 1% steps allow. Returns false if Stop was pressed.
async function fitEach(blocks, ui) {
  pause();
  measuring = true;
  busy(ui.btn, ui.bar, true);
  ui.stop.hidden = false;
  let next = 0, done = 0;
  progress(ui, 0, `Fitting blocks: 0 of ${blocks.length} done`);
  // Several blocks at once where the web version can run several readings (see LANES).
  await Promise.all(Array.from({ length: LANES }, async () => {
    while (measuring && next < blocks.length) {
      await fitBlock(blocks[next++]);
      ++done;
      progress(ui, done / blocks.length, `Fitting blocks: ${done} of ${blocks.length} done`);
    }
  }));
  ui.bar.value = 1;
  const finished = measuring;
  measuring = false;
  busy(ui.btn, ui.bar, false);
  ui.stop.hidden = true;
  return finished;
}
async function fitBlock(c) {
  const target = c.end - c.start;
  const near = fitNear(target);
  const tried = new Set();
  for (let attempt = 0; attempt < 8 && measuring; attempt++) {
    const s = fitReadings(c).length ? nextFit(c, target, near)
      : Math.max(FIT_MIN, speedToFit(speechLength(said(c), 1, c.voice).secs, 1, target));
    if (s != null) c.speed = s;
    const at = c.speed ?? 1;
    if (tried.has(at)) break; // back to a speed already read: it's as close as it gets
    tried.add(at);
    const secs = await measure(said(c), at, { bulk: true, voice: c.voice });
    if (secs == null || Math.abs(secs - target) <= near || at <= FIT_MIN || at >= MAX_SPEED) break;
  }
  // The best of the speeds read, rather than the last one tried.
  const best = measuring ? bestFit(fitReadings(c), target, near) : null;
  if (best != null) c.speed = best;
}

// Fit speeds to timings, the other way round: every block keeps its timing, and its
// reading speed changes so the reading fills it, as when a block is resized. Speeds
// picked by hand are left alone. One undo step.
const ttsFitAll = $('ttsFitAll'), ttsFitStop = $('ttsFitStop'), ttsFitStatus = $('ttsFitStatus'), ttsFitBar = $('ttsFitBar');
async function fitAllSpeeds(ask = true) {
  const blocks = S.cues.filter((c) => spoken(c.text) && !c.pinned);
  const kept = S.cues.filter((c) => spoken(c.text) && c.pinned).length;
  if (!blocks.length) {
    return (ttsFitStatus.textContent = kept ? 'Every block with text has a speed you picked, so there’s nothing to fit.' : 'There are no blocks with text yet.');
  }
  const n = blocks.length;
  if (ask && !confirm(`Change the reading speed of ${n} block${n > 1 ? 's' : ''} so each reading fills its block? Their timings stay as they are${kept ? `, and ${kept === 1 ? '1 block with a speed you picked keeps it' : `${kept} blocks with a speed you picked keep theirs`}` : ''}. You can undo it.`)) return;
  pushUndo();
  // Marked fit, the speeds follow each block's length from here on, including as
  // readings are measured below.
  for (const c of blocks) { delete c.auto; c.fit = true; }
  const fits = () => { let any = false; for (const c of blocks) any = fitSpeed(c) || any; if (any) changed(); };
  fits();
  const audio = blocks.every((c) => usingAudioVoice(c.voice));
  const ui = { btn: ttsFitAll, bar: ttsFitBar, stop: ttsFitStop, status: ttsFitStatus, job: 'Fitting speeds' };
  let stopped = false;
  // Piper and Google read quickly, so each block is read, its speed moved, and read again until the
  // reading fills it. Browser voices read in real time, so they measure once, and only
  // when asked to.
  if (audio) stopped = !(await fitEach(blocks, ui));
  else if ($('ttsAllExact').checked) { stopped = !(await measureAll(blocks, ui)); fits(); }
  // Stopped before the voice reached some blocks: leave those exactly as they were, rather
  // than marked to change speed later when they're next selected or edited.
  let left = 0;
  if (stopped && audio) {
    for (const c of blocks) {
      if (!readingsOf(said(c), false, c.voice).length) { delete c.fit; left++; }
    }
  }
  const fitted = n - left;
  // Doesn't fit: a reading that runs over its block even at the fastest speed, or a
  // measured one that does. Shorter is fine: the rest of the block is silence.
  const off = blocks.filter((c) => {
    if (!c.fit) return false;
    const m = speechLength(said(c), c.speed, c.voice);
    return (m.exact || (c.speed ?? 1) >= MAX_SPEED) && m.secs - (c.end - c.start) > 0.05;
  }).length;
  const estimated = blocks.filter((c) => !speechLength(said(c), c.speed, c.voice).exact).length;
  // Done: the blocks keep their timing and new speeds. Edited later, a block's end follows
  // its reading at that speed, like any other.
  for (const c of blocks) delete c.fit;
  changed();
  const msg = (stopped
    ? `Fit speeds to timings stopped. Fitted ${fitted} of ${n} block${n > 1 ? 's' : ''}${left ? `; ${left === 1 ? '1 was' : `${left} were`} left as ${left === 1 ? 'it was' : 'they were'}` : ''}.`
    : `Fitted the speed of ${n} block${n > 1 ? 's' : ''} to ${n > 1 ? 'their' : 'its'} timing.`) +
    (off ? ` ${off === 1 ? '1 block' : `${off} blocks`} ${off === 1 ? 'is' : 'are'} too long to fit, even at +100%.` : '') +
    (kept ? ` ${kept} kept the speed you picked.` : '') +
    (stopped && !audio ? ' Some speeds are from estimates.' : !stopped && estimated && !audio ? ' Speeds are from estimates: tick "Read each block silently first" for exact ones.' : '');
  report(ttsFitStatus, msg);
}
ttsFitAll.addEventListener('click', () => asJob(() => fitAllSpeeds()));

// Opening a script in Write mode with text to speech on: ask what to do with its
// timings, or do what was chosen before. It runs in the background, with its progress
// and Stop in the bottom bar, so the script can be worked on meanwhile.
const importDlg = $('importDlg');
function runImportChoice(choice) {
  if (choice !== 'fit' && choice !== 'ends') return;
  asJob(() => (choice === 'fit' ? fitAllSpeeds(false) : updateAllTimings(false)));
}
function afterImport(name) {
  if (!ttsOn() || !S.cues.some((c) => spoken(c.text))) return;
  if (tts.onImport !== 'ask') return runImportChoice(tts.onImport);
  const n = S.cues.length;
  $('impWhat').textContent = `${name} has ${n} block${n > 1 ? 's' : ''} with timings of ${n > 1 ? 'their' : 'its'} own.`;
  $('impAlways').checked = false;
  showGoogleCost();
  importDlg.showModal();
  importDlg.querySelector('.wzchoice').focus();
}
for (const b of importDlg.querySelectorAll('.wzchoice')) {
  b.addEventListener('click', () => {
    const choice = b.dataset.choice;
    if ($('impAlways').checked) setTtsOption('onImport', choice);
    importDlg.close();
    runImportChoice(choice);
  });
}
importDlg.addEventListener('click', (e) => { if (e.target === importDlg) importDlg.close(); });
document.addEventListener('keydown', (e) => { if (importDlg.open) e.stopPropagation(); }, true);

// The voice, speed or base speed changed in Settings: every reading takes a different
// time now, so ask whether the ends should follow, or do what was chosen before.
const changeDlg = $('changeDlg');
let changedFrom = null; // { what, was }: the voice or base speed before, to go back to
function readingChanged(what, was) {
  const n = S.cues.filter((c) => spoken(c.text)).length;
  if (!writing() || !ttsOn() || !n || tts.onChange === 'leave') return;
  if (tts.onChange === 'ends') return asJob(() => updateAllTimings(false));
  const now = { voice: () => `The voice is now ${chosenVoiceName()}`,
    base: () => `The base speed is now ${Math.round(tts.base * 100)}%` }[what]();
  $('chgWhat').textContent = `${now}, so the readings of ${n === 1 ? 'the 1 block' : `all ${n} blocks`} take a different time.`;
  changedFrom = { what, was };
  $('chgBack').textContent = `Go back to ${what === 'voice' ? voiceName(was) : `${Math.round(was * 100)}%`}`;
  $('chgAlways').checked = false;
  showGoogleCost();
  changeDlg.showModal();
  changeDlg.querySelector('.wzchoice').focus();
}
for (const b of changeDlg.querySelectorAll('.wzchoice')) {
  b.addEventListener('click', () => {
    const choice = b.dataset.choice;
    changeDlg.close();
    if (choice === 'back') return setTtsOption(changedFrom.what, changedFrom.was);
    if ($('chgAlways').checked) setTtsOption('onChange', choice);
    if (choice === 'ends') asJob(() => updateAllTimings(false));
  });
}
changeDlg.addEventListener('click', (e) => { if (e.target === changeDlg) changeDlg.close(); });
document.addEventListener('keydown', (e) => { if (changeDlg.open) e.stopPropagation(); }, true);
ttsFitStop.addEventListener('click', () => { measuring = false; stopSpeech(); });

// Export description track: every block's Piper or Google reading in one WAV file, each at its
// block's start, as long as the video (or the last reading, without one).
const ttsExport = $('ttsExport'), ttsExportStatus = $('ttsExportStatus'), ttsExportBar = $('ttsExportBar');
ttsExport.addEventListener('click', async () => {
  const blocks = S.cues.filter((c) => spoken(c.text)).map((c) => ({ start: c.start, text: said(c), speed: c.speed, voice: c.voice }));
  if (!blocks.length) return (ttsExportStatus.textContent = 'There are no blocks with text yet.');
  pause();
  busy(ttsExport, ttsExportBar, true);
  try {
    const { blob, overlaps } = await renderTrack(blocks, S.hasVideo ? duration() : 0,
      (k, n) => { ttsExportBar.value = k / n; ttsExportStatus.textContent = `Making readings: ${k} of ${n}`; });
    const name = `${baseName()} - audio description.wav`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    report(ttsExportStatus, `Saved ${name}.` + (overlaps
      ? ` ${overlaps === 1 ? '1 reading runs' : `${overlaps} readings run`} into the next block, so they overlap in the file.`
      : ''));
  } catch (e) {
    report(ttsExportStatus, `Couldn’t export the description track: ${e.message}`);
  } finally {
    busy(ttsExport, ttsExportBar, false);
    ttsExport.disabled = !usingAudioVoice();
  }
});
ttsAllStop.addEventListener('click', () => { measuring = false; stopSpeech(); });
// A job carries on when the settings close: it shows in the bottom bar.
$('ttsDlg').addEventListener('close', () => { if (!jobActive) { ttsAllStatus.textContent = ''; ttsFitStatus.textContent = ''; ttsMakeStatus.textContent = ''; } });

// A block's own speed. Setting it to normal leaves the block without one.
function setBlockSpeed(c, v) {
  pushUndo(undefined, 'speed-' + c.id);
  if (!isBlockSpeed(v) || v === 1) delete c.speed;
  else c.speed = v;
  // A speed picked by hand stays put when the block is resized. Back to default, and
  // resizing fits the speed again.
  delete c.fit;
  if (c.speed) c.pinned = true; else delete c.pinned;
  // The speed was picked, so the end follows the reading instead.
  c.auto = true;
  fitAuto(c);
  changed(c.id);
  tlDirty = true;
  toast(c.speed ? `Block #${idx(c.id) + 1} reads at ${speedName(c.speed)}`
    : `Block #${idx(c.id) + 1} reads at normal speed`);
}
// A block's own voice, such as a second voice for translated dialogue. Without one, a block reads
// with the voice chosen in Settings, and follows it when that changes.
const edVoice = $('edVoice'), edVoiceWrap = $('edVoiceWrap');
const blockVoiceName = (uri) => { const n = voiceName(uri); return n === 'the voice before' ? voiceLabel(uri) : n; };
let edVoiceFor = '';
// force: refill even if nothing seems to have changed, as when the list is opened, since
// voices can arrive at any time.
function fillEdVoice(c, force = false) {
  const key = `${c.id}|${c.voice || ''}|${chosenVoice()}`;
  if (!force && key === edVoiceFor) return;
  edVoiceFor = key;
  fillVoiceSelect(edVoice, c.voice || '');
  edVoice.prepend(new Option(`Same as Settings (${chosenVoiceName()})`, ''));
  // A voice that isn't here, such as Kokoro's in the web version, stays chosen and says so.
  if (c.voice && ![...edVoice.options].some((o) => o.value === c.voice)) edVoice.add(new Option(`${voiceLabel(c.voice)}: not available here`, c.voice), 1);
  edVoice.value = c.voice || '';
  edVoice.disabled = false;
}
for (const ev of ['mousedown', 'focus']) edVoice.addEventListener(ev, () => { if (selCue()) fillEdVoice(selCue(), true); });
edVoice.addEventListener('change', () => {
  const c = selCue();
  if (c) setBlockVoice(c, edVoice.value);
  edVoice.blur();
});
function setBlockVoice(c, uri) {
  pushUndo(undefined, 'voice-' + c.id);
  if (uri) c.voice = uri; else delete c.voice;
  fitAuto(c);
  changed(c.id);
  tlDirty = true;
  schedulePrefetch(c);
  toast(c.voice ? `Block #${idx(c.id) + 1} reads with ${blockVoiceName(c.voice)}` : `Block #${idx(c.id) + 1} reads with the voice in Settings`);
}

// Replace all voices: every block reads with the voice chosen in Settings again.
$('ttsReplaceVoices').addEventListener('click', () => {
  const own = S.cues.filter((c) => c.voice);
  if (!own.length) return;
  pushUndo();
  for (const c of own) { delete c.voice; fitAuto(c); }
  changed();
  tlDirty = true;
  openTts(); // shows the panel again, without the note
  toast(`${own.length === 1 ? '1 block reads' : `${own.length} blocks read`} with ${chosenVoiceName()} again. ⌘Z undoes it`);
});

// [ and ]: one speed step slower or faster for the selected block.
function stepBlockSpeed(d) {
  if (!writing()) return modeOnly('Text to speech', 'write');
  if (!tts.on) return toast('Turn on text to speech first (⌥⇧V)');
  const c = needSel(); if (!c) return;
  // From a custom speed, step to the next set speed in that direction.
  const list = SPEEDS.map(([s]) => s), cur = c.speed ?? 1;
  const next = d > 0 ? list.find((s) => s > cur + 1e-9) : [...list].reverse().find((s) => s < cur - 1e-9);
  if (next == null) return toast(`Already at the ${d < 0 ? 'slowest' : 'fastest'} speed`);
  setBlockSpeed(c, next);
}
for (const [v, label] of SPEEDS) edSpeed.add(new Option(label, String(v)));
// Shown for a custom speed, such as one set by resizing the block.
const edSpeedCustom = new Option('custom', 'custom');
edSpeed.add(edSpeedCustom);
edSpeed.addEventListener('change', () => {
  const c = selCue();
  if (c && edSpeed.value !== 'custom') setBlockSpeed(c, edSpeed.value ? +edSpeed.value : null);
  edSpeed.blur();
});

// ---------------------------------------------------------------- sounds like

// Each block can say how text to speech should pronounce words in it, as pairs of
// [written, said] in c.say. The text itself never changes (see said()).
const sayDlg = $('sayDlg'), sayRows = $('sayRows');
let sayFor = null, rows = [];
function addSayRow(word = '', as = '') {
  const w = document.createElement('input'), s = document.createElement('input');
  const arrow = document.createElement('span'), del = document.createElement('button'), miss = document.createElement('div');
  w.value = word; w.placeholder = 'As written'; w.spellcheck = false; w.setAttribute('aria-label', 'Word or phrase, as written');
  s.value = as; s.placeholder = 'Say it like'; s.spellcheck = false; s.setAttribute('aria-label', 'How to say it');
  arrow.className = 'arrow'; arrow.textContent = '→';
  del.textContent = '×'; del.setAttribute('aria-label', 'Remove this word');
  miss.className = 'missing'; miss.textContent = 'This isn’t in the block’s text, so it won’t change anything.';
  const row = { w, s, els: [w, arrow, s, del, miss] };
  const check = () => { miss.hidden = !w.value.trim() || hasWord(sayFor?.text || '', w.value); };
  w.addEventListener('input', check);
  check();
  w.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); s.focus(); } });
  s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sayDlg.close(); } });
  del.addEventListener('click', () => {
    row.els.forEach((el) => el.remove());
    rows = rows.filter((r) => r !== row);
    if (!rows.length) addSayRow().w.focus();
  });
  sayRows.append(...row.els);
  rows.push(row);
  return row;
}
const sayPairs = () => rows.map((r) => [r.w.value.trim(), r.s.value.trim()]).filter(([w, s]) => w && s);
// The other blocks that have any of these words, for "Use them in every block".
const sayOthers = (c, pairs) => S.cues.filter((o) => o !== c && pairs.some(([w]) => hasWord(o.text, w)));
function showSayAll() {
  if (!sayFor) return;
  const n = sayOthers(sayFor, rows.map((r) => [r.w.value.trim()]).filter(([w]) => w)).length;
  $('sayAllCount').textContent = n ? `(${n} other block${n === 1 ? '' : 's'})` : '(no other blocks have them)';
  $('sayAll').disabled = !n;
  if (!n) $('sayAll').checked = false;
}
sayRows.addEventListener('input', showSayAll);

function openSay() {
  if (!writing()) return modeOnly('Sounds like', 'write');
  if (!ttsOn()) { openTts(); return toast('Turn on text to speech to set how words sound'); }
  const c = needSel(); if (!c) return;
  // A word selected in the text box is the one to add.
  const picked = document.activeElement === edText || edit?.id === c.id
    ? edText.value.slice(edText.selectionStart, edText.selectionEnd).trim() : '';
  sayFor = c;
  rows = [];
  sayRows.textContent = '';
  $('sayBlock').textContent = `block #${selIdx() + 1}`;
  for (const [w, as] of c.say || []) addSayRow(w, as);
  let focus = null;
  if (picked && !picked.includes('\n') && picked.length <= 60) {
    focus = rows.find((r) => r.w.value.toLocaleLowerCase() === picked.toLocaleLowerCase())?.s || addSayRow(picked).s;
  } else if (!rows.length) focus = addSayRow().w;
  $('sayAll').checked = false;
  showSayAll();
  sayDlg.showModal();
  (focus || rows[0].s).focus();
}

// Closing keeps what's there, however the dialog is closed; Ctrl/Cmd+Z undoes it.
sayDlg.addEventListener('close', () => {
  stopSpeech();
  const c = sayFor;
  sayFor = null;
  if (!c || !S.cues.includes(c)) return;
  const pairs = sayPairs();
  const others = $('sayAll').checked && pairs.length ? sayOthers(c, pairs) : [];
  const same = JSON.stringify(pairs) === JSON.stringify(c.say || []);
  if (same && !others.length) return;
  pushUndo(); // one step, for this block and every other one
  if (!same) { if (pairs.length) c.say = pairs; else delete c.say; }
  for (const o of others) o.say = mergeSay(o.say, pairs.filter(([w]) => hasWord(o.text, w)));
  changed();
  const words = pairs.length === 1 ? '1 word sounds' : `${pairs.length} words sound`;
  toast(others.length ? `${words} different when read aloud, in this block and ${others.length} other${others.length === 1 ? '' : 's'}. ⌘Z undoes it`
    : pairs.length ? `${words} different in this block when read aloud` : 'This block is read as written again');
});
$('sayAdd').addEventListener('click', () => addSayRow().w.focus());
$('sayTry').addEventListener('click', () => {
  if (sayFor) speak(soundsLike(sayFor.text, sayPairs()), { speed: sayFor.speed, voice: sayFor.voice });
});
$('sayDone').addEventListener('click', () => sayDlg.close());
sayDlg.addEventListener('click', (e) => { if (e.target === sayDlg) sayDlg.close(); });
document.addEventListener('keydown', (e) => { if (sayDlg.open) e.stopPropagation(); }, true);

// Select a word in the block text and a "sounds like" button pops up under it: one click
// opens Sounds like with the word filled in, so only how it sounds is left to type.
const selSay = $('selSay');
// What's selected, if it's something Sounds like can take: one line, and not too long.
const sayable = () => {
  if (!ttsOn() || document.activeElement !== edText) return '';
  const t = edText.value.slice(edText.selectionStart, edText.selectionEnd);
  return t.trim() && !t.includes('\n') && t.trim().length <= 60 ? t.trim() : '';
};
// Where a place in the text box is on screen, from a copy of it laid out the same way.
function caretXY(pos) {
  const st = getComputedStyle(edText), m = document.createElement('div');
  for (const p of ['font', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize']) m.style[p] = st[p];
  Object.assign(m.style, { position: 'fixed', visibility: 'hidden', top: '0', left: '0', width: `${edText.clientWidth}px`, whiteSpace: 'pre-wrap' });
  m.textContent = edText.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  m.append(mark);
  document.body.append(m);
  const r = edText.getBoundingClientRect();
  const x = r.left + mark.offsetLeft - edText.scrollLeft, y = r.top + mark.offsetTop + mark.offsetHeight - edText.scrollTop;
  m.remove();
  return [x, y];
}
function showSelSay(x, y) {
  const word = sayable();
  if (!word) { selSay.hidden = true; return; }
  const said = selCue()?.say?.some(([w]) => w.toLocaleLowerCase() === word.toLocaleLowerCase());
  selSay.textContent = said ? 'Sounds Like ✓' : 'Sounds Like';
  selSay.dataset.tip = pcKeys(`How text to speech says “${word}”, without changing the text (⌥⇧P)`);
  selSay.setAttribute('aria-label', speakable(selSay.dataset.tip, IS_MAC));
  selSay.hidden = false;
  const w = selSay.offsetWidth;
  selSay.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, x - w / 2))}px`;
  selSay.style.top = `${Math.min(innerHeight - selSay.offsetHeight - 4, y + 6)}px`;
}
// Under the pointer for a mouse selection; under the selection's end for a keyboard one.
edText.addEventListener('mouseup', (e) => setTimeout(() => showSelSay(e.clientX, e.clientY + 12)));
edText.addEventListener('keyup', (e) => {
  if (e.key === 'Escape') { selSay.hidden = true; return; }
  if (!e.shiftKey && !['Shift', 'Meta', 'Control', 'Alt'].includes(e.key) && edText.selectionStart === edText.selectionEnd) { selSay.hidden = true; return; }
  const [x, y] = caretXY(edText.selectionEnd);
  showSelSay(x, y);
});
for (const ev of ['input', 'scroll', 'blur']) edText.addEventListener(ev, () => { selSay.hidden = true; });
// Keep the text box's focus and selection, so Sounds like picks the word up.
selSay.addEventListener('mousedown', (e) => e.preventDefault());
selSay.addEventListener('click', () => { selSay.hidden = true; openSay(); });

// While playing, read each block as the playhead reaches its start.
function liveSpeech(prevT, t) {
  readAheadOf(t);
  if (!ttsOn() || !tts.live || tts.speaking?.manual || hold) return; // not over someone reading
  const a = cueAt(t);
  if (a && prevT <= a.start && t > a.start && t - prevT < 0.5 && tts.speaking?.id !== a.id) speak(said(a), { id: a.id, speed: a.speed, voice: a.voice });
}

// Making a reading takes a moment, a second or more with Kokoro, so while playing, the
// next blocks are read ahead. Otherwise a reading would start late and run past its block.
const AHEAD_SECS = 15, AHEAD_BLOCKS = 2;
let aheadOf = '';
function readAheadOf(t) {
  if (!ttsOn() || !tts.live) return;
  const next = S.cues.filter((c) => c.start > t && c.start - t <= AHEAD_SECS && spoken(c.text) && usingAudioVoice(c.voice))
    .sort((a, b) => a.start - b.start).slice(0, AHEAD_BLOCKS);
  // Only when the blocks ahead, or what they say, change: this runs on every frame.
  const key = `${chosenVoice()}|${tts.base}|` + next.map((c) => `${c.id}|${c.speed}|${c.voice}|${said(c)}`).join('\n');
  if (key === aheadOf) return;
  aheadOf = key;
  for (const c of next) readAhead(said(c), c.speed, c.voice);
}

// Lower the original audio while a block is read, and as the mix slider says.
let ducked = false;
function duckAudio(on = ducked) {
  ducked = on;
  const v = (on && tts.duck ? 0.3 : 1) * (writing() && tts.on ? mixLevels(tts.mix).video : 1);
  video.volume = v;
  altAudio.volume = v;
}

// The mix slider under the video, in Write mode with text to speech on: the video's sound
// against the readings. Double-click puts it back in the middle.
function mixText(m) {
  const pct = Math.round(Math.abs(m) * 100);
  return !pct ? 'Even: both at full volume' : m > 0 ? `Readings louder: the video at ${100 - pct}%` : `Video louder: readings at ${100 - pct}%`;
}
function showMix() {
  const mixEl = $('mix'), mixBox = $('mixBox');
  mixBox.hidden = !(writing() && tts.on);
  mixEl.value = String(Math.round(tts.mix * 100));
  mixEl.setAttribute('aria-valuetext', mixText(tts.mix));
  mixBox.dataset.tip = `Mix: ${mixText(tts.mix)}. Double-click for even`;
}
const mixEl = $('mix');
mixEl.addEventListener('input', () => { setMix(+mixEl.value / 100, false); duckAudio(); showMix(); });
mixEl.addEventListener('change', () => setMix(+mixEl.value / 100));
// After dragging it, keys go back to the timeline; from the keyboard, it keeps them.
mixEl.addEventListener('pointerup', () => mixEl.blur());
mixEl.addEventListener('dblclick', () => { setMix(0); duckAudio(); showMix(); });

// ---------------------------------------------------------------- modes

const MODE_NAMES = { transcribe: 'Transcribe', write: 'Write' };
function modeOnly(feature, mode) {
  toast(`${feature} is part of ${MODE_NAMES[mode]} mode. Switch modes at the top`);
}
function setMode(m, quiet = false) {
  if (!MODE_NAMES[m]) return;
  S.mode = m;
  try { localStorage.setItem('scribecue.mode', m); } catch { /* ignore */ }
  document.body.classList.toggle('mode-write', m === 'write');
  document.body.classList.toggle('mode-transcribe', m === 'transcribe');
  for (const b of document.querySelectorAll('#modeSw button')) {
    const on = b.dataset.mode === m;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  }
  if (m === 'write') { holdEnd(); fitAllAuto(); } else { stopSpeech(); if (stt.on) warmStt(); }
  renderList();
  updateEditor();
  updateInd();
  tlDirty = true;
  if (!quiet) {
    toast(m === 'write'
      ? `Write mode: text to speech${tts.on ? '' : ' (turn it on in Settings, or with ⌥⇧V)'}, reading times and block speeds`
      : 'Transcribe mode: hold H while the narrator speaks to mark each line');
  }
}
// Like a switch: clicking the other side picks it, and clicking the side that's on, or
// the track around it, flips to the other.
document.getElementById('modeSw').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  b?.blur();
  const m = b && !b.classList.contains('on') ? b.dataset.mode : (S.mode === 'write' ? 'transcribe' : 'write');
  setMode(m);
  maybeShowLoop(m); // the first time in a mode, how to work in it
});

// ---------------------------------------------------------------- hold-to-mark

// Hold H while the narrator speaks: press marks the start, release marks the end.
// Both edges move back by the reaction offset, since key presses lag what you hear.
// Releasing pauses and opens the new block for typing.
let hold = null; // { t0, el }
const markEl = document.createElement('div');
markEl.className = 'cue marking';
markEl.hidden = true;

function holdStart() {
  if (hold) return;
  if (writing()) return takeStart();
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

// Write mode, reading it yourself, like punching in on a recording: hold H and the
// selected block plays from the playhead while you read; letting go sets its end there,
// moved back by the same reaction offset, and leaves the playhead at that end. So after a
// breath, holding H again carries on from where you stopped; stepping back first redoes
// the rest from there; and from the block's start (G), or outside it, it starts over.
// Ctrl/Cmd+Z undoes one part at a time. Where it starts: takeFrom, in nav.js.

function takeStart() {
  const c = selCue();
  if (!c) return toast('Select a block, then hold H while you read it aloud to set its end');
  stopSpeech();
  const from = takeFrom(now(), c.start, c.end);
  if (from > c.start) toast(`Carrying on from ${(from - c.start).toFixed(2)} s into block #${selIdx() + 1}`);
  seek(from);
  play();
  hold = { take: c.id, t0: c.start, from };
  cuesLayer.append(markEl);
  markEl.hidden = false;
  updateMark();
}

function takeEnd() {
  const { take: id, from } = hold;
  hold = null;
  markEl.hidden = true;
  pause();
  const i = idx(id), c = S.cues[i];
  if (!c) return;
  if (endLocked(c)) return;
  const end = Math.min(bounds(i).hi, now() - S.offset * S.rate);
  if (end < c.start + MIN_DUR || end <= from) { seek(from); return toast('Hold H for as long as you read the line'); }
  pushUndo();
  c.end = end;
  resized(c, 'end');
  changed(c.id);
  seek(end); // where the next part carries on from
  toast(`Block #${i + 1} now ends at ${tc(end)} (${(end - c.start).toFixed(2)} s). Hold H to carry on, or G then H to start again`);
}

function holdEnd() {
  if (!hold) return;
  if (hold.take != null) return takeEnd();
  const tUp = now();
  let a = Math.max(0, hold.t0), b = tUp - S.offset * S.rate;
  hold = null;
  markEl.hidden = true;
  pause();
  if (b - a < 0.25) return toast('Hold H for as long as the narrator speaks');
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
  if (stt.on && stt.ready) liveTranscribe(c);
  else toast(`Block #${idx(c.id) + 1} marked — type it, then ↵ or Esc to carry on`);
}

function setOffset(v) {
  if (!OFFSETS.includes(v)) return;
  S.offset = v;
  try { localStorage.setItem('scribecue.offset', S.offset); } catch { /* ignore */ }
  updateInd();
}

function cycleOffset() {
  S.offset = OFFSETS[(OFFSETS.indexOf(S.offset) + 1) % OFFSETS.length];
  try { localStorage.setItem('scribecue.offset', S.offset); } catch { /* ignore */ }
  updateInd();
  toast(`Hold-to-mark reaction offset ${Math.round(S.offset * 1000)} ms`);
}

// ---------------------------------------------------------------- speech to text

// The audio between two times on the chosen track, as 16 kHz mono for Whisper.
function clipAudio(from, to) {
  const file = S.videoFile;
  if (!file) return Promise.reject(new Error('open the video or audio first'));
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker('js/wave-worker.js'); } catch { return reject(new Error('workers are unavailable')); }
    w.onmessage = ({ data: m }) => {
      if (m.type === 'peaks' || m.type === 'progress') return;
      w.terminate();
      if (m.type === 'clip') resolve(m.audio);
      else if (m.type === 'unsupported' && file.size <= LEGACY_LIMIT && !S.track) wholeFileClip(file, from, to).then(resolve, reject);
      else reject(new Error(m.message || 'the audio couldn’t be read'));
    };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); reject(new Error('the audio reader crashed')); };
    w.postMessage({ cmd: 'clip', file, track: S.track, from, to });
  });
}

// Files the worker can't read, such as MP3s, are decoded whole, once.
let decoded = null; // { file, audio }
async function wholeFileClip(file, from, to) {
  if (decoded?.file !== file) {
    decoded = null;
    const buf = await new OfflineAudioContext(1, 1, STT_RATE).decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    decoded = { file, audio: mono };
  }
  return decoded.audio.slice(Math.round(from * STT_RATE), Math.round(to * STT_RATE));
}

// A block's audio, with a little either side (Whisper misses words cut off at the edges),
// but not into the blocks next to it.
const CLIP_PAD = 0.2;
function blockAudio(c) {
  const i = idx(c.id), prev = S.cues[i - 1], next = S.cues[i + 1];
  const from = Math.max(0, c.start - CLIP_PAD, prev ? Math.min(c.start, prev.end) : 0);
  const to = Math.min(c.end + CLIP_PAD, next ? Math.max(c.end, next.start) : Infinity);
  return clipAudio(from, to);
}

// Transcribes a block and fills in its text. Unless `replace`, a block that has been given
// text meanwhile is left alone. `undo`: make it an undo step of its own.
async function transcribeBlock(c, { replace = false, undo = true } = {}) {
  const text = await transcribe(await blockAudio(c));
  const cur = S.cues[idx(c.id)];
  if (!text || !cur || (!replace && plain(cur.text).trim())) return false;
  if (edit?.id === cur.id && document.activeElement === edText) {
    // In the editor, as if typed, so its own undo works and typing carries on from it.
    edText.select();
    if (!document.execCommand('insertText', false, text)) { edText.value = text; edText.dispatchEvent(new Event('input')); }
  } else {
    if (undo) pushUndo();
    cur.text = text;
    changed(cur.id);
  }
  return true;
}

// After a block is marked with H: its text arrives while the editor is open for it.
let transcribing = 0;
const editorHint = edText.placeholder;
function liveTranscribe(c) {
  const n = idx(c.id) + 1;
  transcribing++;
  edText.placeholder = 'Transcribing… or type it yourself';
  toast(`Block #${n} marked — transcribing it`);
  transcribeBlock(c).then(
    (ok) => toast(ok ? `Block #${n} transcribed — check it, then ↵ or Esc to carry on` : `Block #${n}: Whisper didn’t hear any words`),
    (e) => toast(`Couldn’t transcribe block #${n}: ${e.message}`),
  ).finally(() => { if (!--transcribing) edText.placeholder = editorHint; });
}

// Alt+Shift+T: transcribe the selected block again, such as after changing its timing.
async function transcribeSelected() {
  if (writing()) return modeOnly('Speech to text', 'transcribe');
  const c = needSel(); if (!c) return;
  if (!stt.ready) { openStt(); return toast('Set up speech to text first'); }
  const n = selIdx() + 1;
  toast(`Transcribing block #${n}…`);
  try {
    toast(await transcribeBlock(c, { replace: true }) ? `Block #${n} transcribed` : `Block #${n}: Whisper didn’t hear any words`);
  } catch (e) { toast(`Couldn’t transcribe block #${n}: ${e.message}`); }
}

initStt({
  toast: (m) => toast(m),
  cues: () => S.cues,
  changed: () => updateInd(),
  transcribing: () => !writing(),
  beforeBatch: () => pushUndo(),
  fill: (c) => {
    if (!S.videoFile) throw new Error('open the video or audio first');
    return transcribeBlock(c, { undo: false });
  },
});

let holdKey = 'KeyH';
document.addEventListener('keyup', (e) => {
  if (e.code === holdKey) holdEnd();
});
window.addEventListener('blur', () => holdEnd());

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = pcKeys(msg);
  announce(msg, IS_MAC);
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
  const n = S.subName !== 'untitled.srt' ? S.subName : S.videoFile?.name || 'script';
  return n.replace(/\.[^.]+$/, '');
}

// The project or script name in the header, with a dot while there are unsaved changes.
function showDocName() {
  const name = S.subName === 'untitled.srt' ? 'Untitled' : S.subName;
  const el = $('subName');
  el.textContent = name + (S.dirty && S.cues.length ? ' •' : '');
  el.title = S.dirty && S.cues.length ? 'Unsaved changes: save the project with ' + (IS_MAC ? '⌘S' : 'Ctrl+S') : 'Project or script file';
  document.title = `${name}${S.dirty && S.cues.length ? ' •' : ''} · Scribecue`;
}

// ---- project files

// The last project saved or opened in place, kept between reloads (IndexedDB, since
// file handles can't go in localStorage).
const handleStore = {
  db: () => new Promise((ok, fail) => {
    const r = indexedDB.open('scribecue', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }),
  // key: 'project', or a video's mediaKey.
  async get(key = 'project') {
    try {
      const db = await this.db();
      return await new Promise((ok) => { const q = db.transaction('files').objectStore('files').get(key); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); });
    } catch { return null; }
  },
  async set(h, key = 'project') {
    try {
      const db = await this.db();
      const st = db.transaction('files', 'readwrite').objectStore('files');
      h ? st.put(h, key) : st.delete(key);
    } catch { /* ignore */ }
  },
};

// ---- remembering videos
//
// Browsers don't let a page keep a file's path, but Chrome and Edge let it keep a link to
// a file you opened. So each video opened is remembered by its name and size, which is
// how projects name their video, and opening the project, or Scribecue again, reopens it.
// After a reload the browser asks first, which needs a click: the empty video area offers
// it then.
const mediaKey = (m) => `video:${m.name}:${m.size}`;
function rememberVideo(h, file) {
  if (h?.kind === 'file') handleStore.set(h, mediaKey(file));
}
// Opens the remembered video for this media, if there is one and the browser allows it.
// ask: whether this follows a click, so the browser may be asked. Returns whether it did.
async function reopenVideo(media, { ask = false } = {}) {
  if (!media?.name || S.videoFile) return false;
  const h = await handleStore.get(mediaKey(media));
  if (!h) return false;
  let p = await h.queryPermission?.({ mode: 'read' }).catch(() => 'prompt');
  if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'read' }).catch(() => 'denied');
  if (p !== 'granted') { offerReopen(media); return false; }
  try {
    const file = await h.getFile();
    if (!sameMedia(media, file)) throw new Error('it has changed');
    loadVideoFile(file);
    return true;
  } catch (e) {
    handleStore.set(null, mediaKey(media));
    toast(`Couldn’t reopen ${media.name}${e.name === 'NotFoundError' ? ': it has been moved or deleted' : ''}. Open it with ${IS_MAC ? '⌘⇧O' : 'Ctrl+Shift+O'}`);
    offerReopen(null);
    return false;
  }
}
// The button in the empty video area that reopens the project's video with one click.
function offerReopen(media) {
  const b = $('reopenVideo');
  b.hidden = !media || !!S.videoFile;
  if (media) { b.textContent = `Reopen ${media.name}`; b.dataset.media = JSON.stringify(media); }
}
$('reopenVideo').addEventListener('click', (e) => {
  e.currentTarget.blur();
  reopenVideo(JSON.parse(e.currentTarget.dataset.media || 'null'), { ask: true });
});
// The video-only open (Ctrl/Cmd+Shift+O), through the browser's own picker where there is
// one, so the video can be remembered.
async function openVideoPicker() {
  if (!window.showOpenFilePicker) return fileVideo.click();
  try {
    const [h] = await window.showOpenFilePicker({ types: [{ description: 'Video or audio', accept: {
      'video/*': ['.mp4', '.m4v', '.mov', '.mkv', '.webm'], 'audio/*': ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus'],
    } }] });
    const file = await h.getFile();
    loadVideoFile(file);
    rememberVideo(h, file);
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Couldn’t open the file: ${e.message}`);
  }
}

const PROJECT_TYPES = [{ description: 'Scribecue project', accept: { 'application/json': [PROJECT_EXT] } }];

function projectData() {
  const m = S.videoFile ? { name: S.videoFile.name, size: S.videoFile.size, duration: S.hasVideo ? duration() : null } : S.projectMedia;
  return toProject({
    app: VERSION,
    blocks: S.cues,
    notes: S.notes,
    media: m,
    settings: { mode: S.mode, offset: S.offset, ttsBase: tts.base, ttsVoice: tts.voice || chosenVoice() },
    view: { playhead: now(), ...(selIdx() >= 0 ? { selected: selIdx() } : {}) },
  });
}

function projectSaved(name) {
  S.subName = name;
  S.dirty = false;
  showDocName();
  save();
}

// Ctrl/Cmd+S saves in place once the project has a file; Ctrl/Cmd+Shift+S always asks.
// Browsers that can't save in place download a copy instead.
async function saveProject(as = false) {
  if (!S.cues.length) return toast('Nothing to save yet');
  const text = JSON.stringify(projectData(), null, 1);
  const name = `${baseName()}${PROJECT_EXT}`;
  if (!window.showSaveFilePicker) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    projectSaved(name);
    return toast(`Saved ${name} to your downloads`);
  }
  try {
    let h = as ? null : S.handle;
    if (h && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
      (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') h = null;
    if (!h) h = await window.showSaveFilePicker({ suggestedName: name, types: PROJECT_TYPES });
    await writeFile(h, text);
    S.handle = h;
    handleStore.set(h);
    Object.assign(AUTO, { permission: 'granted', error: '' });
    projectSaved(h.name);
    toast(`Saved ${h.name}`);
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Couldn’t save the project: ${e.message}`);
  }
}

async function writeFile(h, text) {
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
}

// ---- autosave (see autosave.js)

const AUTO = { can: canAutosave(window), permission: 'prompt', saving: false, error: '', timer: 0, first: 0 };

function showAutosave() {
  const st = autosaveState({
    can: AUTO.can, file: !!S.handle, permission: AUTO.permission,
    saving: AUTO.saving, dirty: S.dirty && S.cues.length > 0, error: AUTO.error,
  });
  const b = $('autosaveBtn');
  b.hidden = !st;
  if (!st) return;
  b.textContent = AUTOSAVE_LABEL[st];
  b.dataset.state = st;
  b.dataset.tip = pcKeys(AUTOSAVE_TIP[st].replace('{mod}', '⌘').replace('{error}', AUTO.error));
}

// Whether Scribecue may write to the project file now, which the browser asks again
// after a reload.
async function checkWrite() {
  if (!AUTO.can) return showAutosave();
  AUTO.permission = S.handle ? await S.handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt') : 'prompt';
  showAutosave();
  if (AUTO.permission === 'granted' && S.dirty) scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(AUTO.timer);
  if (!AUTO.can || !S.handle || AUTO.permission !== 'granted' || AUTO.error) return showAutosave();
  const t = Date.now();
  AUTO.first ||= t;
  AUTO.timer = setTimeout(autosave, nextSave(t, S.lastChange || t, AUTO.first));
  showAutosave();
}

async function autosave() {
  const h = S.handle;
  if (AUTO.saving) return; // the save running now looks again when it's done
  AUTO.first = 0;
  if (!AUTO.can || !h || !S.dirty || !S.cues.length) return showAutosave();
  const gen = S.changeGen;
  AUTO.saving = true;
  showAutosave();
  try {
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') { AUTO.permission = 'prompt'; return; }
    await writeFile(h, JSON.stringify(projectData(), null, 1));
    AUTO.error = '';
    // Only if nothing changed while it was written; otherwise it goes round again.
    if (h === S.handle && gen === S.changeGen) projectSaved(h.name);
  } catch (e) {
    AUTO.error = e.name === 'NotFoundError' ? 'the file has been moved or deleted' : e.message || String(e);
    toast(`Couldn’t autosave ${h.name}: ${AUTO.error}. Save with ${IS_MAC ? '⌘S' : 'Ctrl+S'}`);
  } finally {
    AUTO.saving = false;
    if (S.dirty) scheduleAutosave(); else showAutosave();
  }
}

// The status next to the project name: clicking it resumes a paused or failed autosave.
// Autosave is always on, so there's nothing to do otherwise.
try { localStorage.removeItem('scribecue.autosave'); } catch { /* ignore */ } // its old off switch
$('autosaveBtn').addEventListener('click', async (e) => {
  const st = e.currentTarget.dataset.state;
  e.currentTarget.blur();
  if (st !== 'paused' && st !== 'error') return;
  AUTO.error = '';
  try { AUTO.permission = await S.handle.requestPermission({ mode: 'readwrite' }); } catch { AUTO.permission = 'denied'; }
  if (AUTO.permission === 'granted') { toast(`Autosaving to ${S.handle.name}`); autosave(); }
  else { toast(`Scribecue can’t save to ${S.handle.name} without your permission. ⌘S saves it`); showAutosave(); }
});

// Asks before replacing work that isn't saved in a project. It can still be undone.
function okToReplace(what) {
  if (!S.dirty || !S.cues.length) return true;
  return confirm(`Your changes to ${S.subName === 'untitled.srt' ? 'this project' : S.subName} aren't saved in a project file. ${what} anyway? You can undo it with ${IS_MAC ? '⌘Z' : 'Ctrl+Z'}.`);
}

async function openProject(file, handle = null) {
  let p;
  try { p = fromProject(JSON.parse(await file.text())); }
  catch (e) { return toast(`Couldn’t open ${file.name}: ${e instanceof SyntaxError ? 'the file is damaged' : e.message}`); }
  if (!okToReplace(`Open ${file.name}`)) return;
  await stopJob();
  pushUndo();
  S.cues = p.blocks.map(revive);
  S.handle = handle;
  handleStore.set(handle);
  AUTO.error = '';
  // Opening it is the moment to ask whether autosave may write to it; if the browser won't
  // ask now, autosave waits, paused, for a click.
  if (handle && AUTO.can) handle.requestPermission({ mode: 'readwrite' }).catch(() => 'prompt').then(checkWrite);
  else showAutosave();
  S.projectMedia = p.media;
  S.notes = p.notes;
  aiNotesChanged();
  const { mode, offset, ttsSpeed, ttsBase, ttsVoice } = p.settings;
  if (mode) setMode(mode, true);
  if (offset != null) setOffset(offset);
  // Projects saved before there was a base speed were read at 100%, with an overall
  // speed for blocks without their own, which becomes the base speed.
  const base = isSpeed(ttsSpeed) ? baseFromSpeed(ttsSpeed, toBase(ttsBase)) : toBase(ttsBase);
  if (base !== tts.base) setTtsOption('base', base);
  if (ttsVoice) setTtsOption('voice', ttsVoice);
  changed();
  select(S.cues[p.view.selected]?.id ?? S.cues[0]?.id ?? null, { seek: false });
  S.pendingPlayhead = p.view.playhead ?? null;
  const ready = S.videoFile && sameMedia(p.media, S.videoFile);
  if (ready && S.pendingPlayhead != null) { seek(S.pendingPlayhead); S.pendingPlayhead = null; }
  projectSaved(file.name);
  toast(`Opened ${file.name} (${S.cues.length} blocks)` + (p.media && !ready
    ? `. Now open its video, ${p.media.name}, with ${IS_MAC ? '⌘⇧O' : 'Ctrl+Shift+O'}` : ''));
  // A different video is open: this project's one replaces it, if it's remembered.
  if (p.media && !ready && S.videoFile && await handleStore.get(mediaKey(p.media))) closeVideo();
  if (p.media && !ready) reopenVideo(p.media, { ask: true }).then((ok) => { if (ok) toast(`Opened ${file.name} and its video, ${p.media.name}`); });
}

// Ctrl/Cmd+O: a project, or a script saved as SRT, VTT or .adc.
// Open: a project, a script, a video or audio file, or several at once, each opened as
// what it is. A project opened this way can be saved back to its own file.
async function openAny() {
  if (!window.showOpenFilePicker) return fileSubs.click();
  try {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [
        { description: 'Scribecue project, script, video or audio', accept: {
          'application/json': [PROJECT_EXT], 'text/plain': ['.srt', '.vtt', '.txt', '.adc'],
          'video/*': ['.mp4', '.m4v', '.mov', '.mkv', '.webm'], 'audio/*': ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus'],
        } },
      ],
    });
    // Videos first, so a project picked with its video finds it already open.
    const files = await Promise.all(handles.map(async (h) => [h, await h.getFile()]));
    const isProject = ([, f]) => f.name.toLowerCase().endsWith(PROJECT_EXT);
    for (const [h, file] of files.filter((x) => !isProject(x))) {
      openFiles([file]);
      if (!SCRIPT.test(file.name)) rememberVideo(h, file);
    }
    for (const [h, file] of files.filter(isProject)) openProject(file, h);
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Couldn’t open the file: ${e.message}`);
  }
}

// New: closes the video and clears the blocks, after asking.
// New: a choice between clearing only the blocks and starting a whole new project.
const newDlg = $('newDlg');
function startAgain() {
  const blocks = S.cues.length, media = S.videoFile?.name;
  if (!blocks && !media) return newProject(false);
  const n = blocks === 1 ? '1 block' : `${blocks} blocks`;
  $('newWhat').textContent = blocks ? `This project has ${n}${media ? `, with ${media} open` : ''}.` : `${media} is open, with no blocks yet.`;
  newDlg.querySelector('[data-choice="blocks"]').hidden = !blocks;
  newDlg.showModal();
  newDlg.querySelector(`[data-choice="${blocks ? 'blocks' : 'project'}"]`).focus();
}
for (const b of newDlg.querySelectorAll('.wzchoice')) {
  b.addEventListener('click', () => {
    newDlg.close();
    if (b.dataset.choice === 'blocks') clearBlocks(); else newProject(false);
  });
}
$('newCancel').addEventListener('click', () => newDlg.close());
newDlg.addEventListener('click', (e) => { if (e.target === newDlg) newDlg.close(); });
document.addEventListener('keydown', (e) => { if (newDlg.open) e.stopPropagation(); }, true);

// Removes every block, keeping the video, the project file and the notes.
function clearBlocks() {
  const n = S.cues.length;
  if (!n) return;
  stopJob();
  pushUndo();
  S.cues = [];
  changed();
  select(null);
  toast(`Cleared ${n === 1 ? 'the 1 block' : `all ${n} blocks`} — ${IS_MAC ? '⌘' : 'Ctrl+'}Z brings them back`);
}

// ask: false when the choice was already made in the Start again dialog.
function newProject(ask = true) {
  const blocks = S.cues.length, media = S.videoFile?.name;
  if (ask && (blocks || media)) {
    const what = [blocks && `removes ${blocks === 1 ? 'the 1 block' : `all ${blocks} blocks`}`, media && `closes ${media}`].filter(Boolean).join(' and ');
    const unsaved = blocks && S.dirty ? ' Your changes aren’t saved in a project file.' : '';
    const undo = blocks ? ` Undo (${IS_MAC ? '⌘Z' : 'Ctrl+Z'}) brings the blocks back${media ? `, but you’d need to open ${media} again` : ''}.` : '';
    if (!confirm(`Start a new project? This ${what}.${unsaved}${undo}`)) return;
  }
  stopJob();
  closeVideo();
  pushUndo();
  S.cues = [];
  S.handle = null;
  handleStore.set(null);
  showAutosave();
  S.projectMedia = null;
  S.pendingPlayhead = null;
  S.notes = '';
  aiNotesChanged();
  changed();
  select(null);
  projectSaved('untitled.srt');
  toast('New project');
}

// File keys, wherever focus is: save, export, open. Matched by the letter on the key.
function fileKeys(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); return true; }
  if (k === 'e') { e.preventDefault(); exportSubs(e.shiftKey ? 'vtt' : 'srt'); return true; }
  if (k === 'o') { e.preventDefault(); e.shiftKey ? openVideoPicker() : openAny(); return true; }
  return false;
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
  const speeds = fmt === 'srt' && S.cues.some((c) => c.speed);
  toast(`Exported ${name} (${S.cues.length} cues)` + (speeds ? '. SRT can’t store block speeds: export VTT to keep them' : ''));
}

// Scripts Scribecue opens: SRT, VTT, plain text, and Frazier's .adc files.
const SCRIPT = /\.(srt|vtt|txt|adc)$/i;
async function loadSubsFile(file) {
  const text = await file.text();
  const adc = /\.adc$/i.test(file.name) ? parseAdc(text) : null;
  const parsed = adc ? adc.cues : parseSubs(text);
  if (!parsed.length) return toast(`No cues found in ${file.name}`);
  if (!okToReplace(`Open ${file.name}`)) return;
  await stopJob();
  pushUndo();
  S.cues = parsed.map((c) => Object.assign(mk(c.start, c.end, c.text, c.speed), c.voice ? { voice: c.voice } : {}, c.say ? { say: c.say } : {}));
  S.subName = file.name;
  S.handle = null; // saving makes a project next to it, rather than overwriting the script
  handleStore.set(null);
  showAutosave();
  S.projectMedia = null;
  changed();
  S.dirty = true;
  showDocName();
  select(S.cues[0].id);
  // A Frazier script's base speed comes with it.
  const base = adc && adc.base !== tts.base ? adc.base : null;
  if (base) setTtsOption('base', base);
  toast(`Loaded ${parsed.length} cues from ${file.name}${base ? `, at a base speed of ${Math.round(base * 100)}%` : ''}${undoStack.length > 1 ? ' — undo restores previous' : ''}`);
  afterImport(file.name);
}

let videoURL = null;
function loadVideoFile(file) {
  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL = URL.createObjectURL(file);
  S.videoFile = file;
  S.hasVideo = true;
  S.fpsKnown = false;
  video.src = videoURL;
  measureFps();
  video.playbackRate = S.rate;
  document.body.classList.add('has-video');
  offerReopen(null);
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

// Closes the video or audio file: playback, its tracks and its waveform.
function closeVideo() {
  if (!S.videoFile) return;
  pause();
  resetTracks();
  resetWaveform();
  S.videoFile = null;
  S.hasVideo = false;
  S.vt = 0;
  video.removeAttribute('src');
  video.load();
  if (videoURL) { URL.revokeObjectURL(videoURL); videoURL = null; }
  document.body.classList.remove('has-video');
  const v = $('videoName');
  v.textContent = 'no media';
  v.classList.add('dim');
  showDur();
  renderOverlay(null);
  tlDirty = true;
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
    try { w = new Worker('js/wave-worker.js'); } catch { return done({ tracks: [] }); }
    w.onmessage = ({ data: m }) => { w.terminate(); done(m.type === 'tracks' ? m : { tracks: [] }); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); done({ tracks: [] }); };
    w.postMessage({ cmd: 'probe', file });
  });
}

async function loadTracks(file) {
  resetTracks();
  resetWaveform();
  S.waveStatus = 'Reading audio tracks…';
  const { tracks, fps } = await probeTracks(file);
  if (S.videoFile !== file) return;
  if (fps) setFps(fps);
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
let nudging = 0; // see nudgeFor
function syncAlt(force) {
  if (!alt) return;
  const target = video.currentTime - alt.start;
  if (target < 0) { altAudio.pause(); return; }
  const drift = altAudio.currentTime - target;
  if (force || Math.abs(drift) > 0.3) {
    altAudio.currentTime = target;
    altAudio.playbackRate = video.playbackRate;
    nudging = 0;
    return;
  }
  // Jumping again would land late again (seeking has latency) and is audible,
  // so close small gaps by playing a little faster or slower for a moment.
  nudging = nudgeFor(drift, nudging);
  const rate = video.playbackRate * (1 + NUDGE * nudging);
  if (altAudio.playbackRate !== rate) altAudio.playbackRate = rate;
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
  showDur();
  if (S.pps * duration() < tl.clientWidth) fitAll();
  tlDirty = true;
  const f = S.videoFile;
  if (f && S.projectMedia && !sameMedia(S.projectMedia, f)) {
    toast(`Loaded ${f.name}, but this project was saved with ${S.projectMedia.name}. Check it's the right video`);
  } else toast(`Loaded ${f?.name || 'media'}`);
  if (f && S.pendingPlayhead != null && sameMedia(S.projectMedia, f)) { seek(S.pendingPlayhead); S.pendingPlayhead = null; }
});
video.addEventListener('error', () => toast('This browser cannot play that file (try MP4/H.264 or WebM)'));
video.addEventListener('play', updateInd);
video.addEventListener('pause', updateInd);
video.addEventListener('click', togglePlay);

function openFiles(files) {
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(PROJECT_EXT)) openProject(f);
    else if (SCRIPT.test(f.name)) loadSubsFile(f);
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
  // Links to dropped videos, so they can be reopened later; only to be had during the drop.
  const links = [...e.dataTransfer.items].map((it) => it.getAsFileSystemHandle?.()).filter(Boolean);
  const files = [...e.dataTransfer.files];
  openFiles(files);
  Promise.all(links).then((hs) => hs.forEach((h, i) => {
    if (files[i] && !SCRIPT.test(files[i].name) && !files[i].name.toLowerCase().endsWith(PROJECT_EXT)) rememberVideo(h, files[i]);
  })).catch(() => {});
});

const actions = {
  swapSides,
  openSubs: () => openAny(),
  saveProject: () => saveProject(),
  openVideo: () => openVideoPicker(),
  exportSrt: () => exportSubs('srt'),
  exportVtt: () => exportSubs('vtt'),
  exportTrack: () => {
    if (!writing()) return modeOnly('The description track', 'write');
    openTts();
    ttsExport.scrollIntoView({ block: 'center' });
    if (!ttsExport.disabled) ttsExport.click();
  },
  exportMenu: () => toggleMenu(exportMenu),
  help: () => toggleHelp(),
  settings: () => showGeneral(),
  newProject: () => startAgain(),
  ai: () => toggleAi(),
};

// AI help: the drawer asks the editor for the script and puts drafts into blocks.
initAi({
  cues: () => S.cues,
  selIndex: () => selIdx(),
  playhead: () => now(),
  video: () => (S.hasVideo ? video : null),
  writing: () => writing(),
  toast,
  notes: () => S.notes,
  setNotes(text) {
    if (text === S.notes) return;
    S.notes = text;
    S.dirty = true;
    showDocName();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  },
  apply(id, text) {
    const c = S.cues[idx(id)];
    if (!c) { toast('That block isn’t there any more'); return false; }
    pushUndo();
    c.text = text;
    changed();
    select(c.id, { seek: false });
    toast(`Draft used for block #${idx(id) + 1} — ${IS_MAC ? '⌘' : 'Ctrl+'}Z to undo`);
    return true;
  },
});
document.querySelector('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  b.blur(); // keep Space/Enter for the editor, not the button
  if (b.getAttribute('role') === 'menuitem') closeMenus();
  actions[b.dataset.act]?.();
});

// Header menus, such as Export: open on click, close on a choice, a click elsewhere or Esc.
const exportMenu = $('exportMenu');
function toggleMenu(menu, open = menu.hidden) {
  closeMenus();
  if (!open) return;
  menu.hidden = false;
  menu.previousElementSibling.setAttribute('aria-expanded', 'true');
  menu.querySelector('[role="menuitem"]:not([hidden])')?.focus();
}
function closeMenus() {
  for (const m of document.querySelectorAll('.navmenu')) {
    m.hidden = true;
    m.previousElementSibling.setAttribute('aria-expanded', 'false');
  }
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.navwrap')) closeMenus(); });
document.addEventListener('keydown', (e) => {
  const menu = e.target.closest?.('.navmenu');
  if (!menu) return;
  e.stopPropagation();
  const items = [...menu.querySelectorAll('[role="menuitem"]')].filter((b) => b.offsetParent);
  const k = items.indexOf(e.target);
  if (e.key === 'Escape') { e.preventDefault(); closeMenus(); menu.previousElementSibling.focus(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (e.key === 'Tab') closeMenus();
}, true);

// ---------------------------------------------------------------- quick navigation / jump to timecode

const pal = $('palette'), palInput = $('palInput'), palList = $('palList'), palTitle = $('palTitle'), palHint = $('palHint');
let palMode = null, palItems = [], palPos = 0;

function openPalette(mode) {
  palMode = mode;
  palPos = 0;
  pal.hidden = false;
  palTitle.textContent = mode === 'time' ? 'Jump to timecode' : 'Quick navigation';
  palInput.placeholder = mode === 'time' ? 'hh:mm:ss:ff · hh:mm:ss.mmm · mm:ss · seconds' : 'Type text or a block number';
  palInput.value = mode === 'time' ? tc(now()) : '';
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
    const t = readTime(palInput.value);
    palHint.textContent = Number.isNaN(t) ? 'Not a valid timecode' : `Enter jumps to ${tc(clamp(t, 0, duration()))}`;
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
    r.children[1].textContent = tc(c.start);
    r.children[2].textContent = plain(c.text).replace(/\n/g, ' / ') || '(empty)';
    r.addEventListener('mousedown', (ev) => { ev.preventDefault(); palPos = k; palGo(); });
    palList.append(r);
  });
  palList.children[palPos]?.scrollIntoView({ block: 'nearest' });
}
function palGo() {
  if (palMode === 'time') {
    const t = readTime(palInput.value);
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
// The shortcuts in use: the defaults, with the person's changes on top.
let keyLookup = lookup(keyChanges());
const isPlus = (e) => e.key === '+' || e.code === 'NumpadAdd' || (e.key === '=' && !e.shiftKey);
const isMinus = (e) => e.key === '-' || e.code === 'NumpadSubtract';
const FRAZIER_ONLY = {
  KeyP: 'Glossary', KeyL: 'Glossary', KeyM: 'Markers', KeyC: 'Comments', KeyS: 'Snippets',
};

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (fileKeys(e)) return;
  if (!helpEl.hidden) {
    if (e.key === 'Escape' || isHelpKey(e) || (e.shiftKey && e.code === 'KeyO')) { e.preventDefault(); toggleHelp(false); }
    return;
  }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  // Undo and redo follow the letter on the key, like other apps, so ⌘Z is still Z on AZERTY.
  const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (mod && letter === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && letter === 'y') { e.preventDefault(); doRedo(); return; }
  if (mod) return; // leave other browser shortcuts (zoom, find, reload…) alone
  if (isHelpKey(e)) { e.preventDefault(); toggleHelp(); return; }
  if (e.key === '/' && !e.altKey) { e.preventDefault(); listSearch.focus(); listSearch.select(); return; }

  // [ ] by the character typed, since some layouts need ⌥ or AltGr for them.
  if (e.key === '[' || e.key === ']') { e.preventDefault(); stepBlockSpeed(e.key === '[' ? -1 : 1); return; }
  if (e.code === 'Escape' && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    // An open block closes, even when its text box isn't focused.
    if (edOpen) { closeEditor(true); return; }
    S.playUntil = null;
    document.activeElement?.blur();
    if (S.loopOnce) stopLoop(); else updateInd();
    return;
  }
  // Everything else is in the keymap, which people can change (see keymap.js).
  const id = keyLookup.get(comboOf(e));
  if (id) { e.preventDefault(); RUN[id](e); return; }
  if (!e.altKey && isPlus(e)) { e.preventDefault(); setRate(S.rate + 0.25); return; }
  if (!e.altKey && isMinus(e)) { e.preventDefault(); setRate(S.rate - 0.25); return; }
  // Frazier keys for features this editor doesn't have, unless they've been given a job.
  const frazier = e.altKey && e.shiftKey ? { KeyM: 'Markers', KeyC: 'Comments' }[e.code] : e.shiftKey && !e.altKey ? FRAZIER_ONLY[e.code] : null;
  if (frazier) { e.preventDefault(); toast(`${frazier} are not part of this editor`); }
});

// What each keymap action does.
const RUN = {
  play: () => togglePlay(),
  playBlock: () => playCue(),
  loopBlock: () => loopBlock(),
  loopToggle: () => toggleFlag('loop'),
  followToggle: () => toggleFlag('follow'),
  speedReset: () => setRate(1),
  frameBack: () => seekBy(-frame()),
  frameFwd: () => seekBy(frame()),
  back3: () => seekBy(-3),
  fwd3: () => seekBy(3),
  blockBack: () => playheadBlock(-1),
  blockNext: () => playheadBlock(1),
  videoStart: () => { S.playUntil = null; seek(0); },
  videoEnd: () => { S.playUntil = null; seek(duration()); },
  toStart: () => gotoSel(false),
  toEnd: () => gotoSel(true),
  jumpTime: () => openPalette('time'),
  quickNav: () => openPalette('nav'),
  createEdit: () => createOrEdit(),
  newBlock: () => newCue(),
  prevBlock: () => selectRel(-1),
  nextBlock: () => selectRel(1),
  back10Blocks: () => selectRel(-10),
  fwd10Blocks: () => selectRel(10),
  selectAtPlayhead: () => selectAtPlayhead(),
  split: () => split(),
  merge: () => merge(),
  deleteNow: () => del(),
  deleteAsk: () => confirmDelete(),
  setStart: () => setEdge('start'),
  setEnd: () => setEdge('end'),
  startBack: () => nudge('start', -0.1),
  startFwd: () => nudge('start', 0.1),
  endBack: () => nudge('end', -0.1),
  endFwd: () => nudge('end', 0.1),
  moveBack: () => nudge('move', -0.1),
  moveFwd: () => nudge('move', 0.1),
  startBack10: () => nudge('start', -0.01),
  startFwd10: () => nudge('start', 0.01),
  endBack10: () => nudge('end', -0.01),
  endFwd10: () => nudge('end', 0.01),
  moveBack10: () => nudge('move', -0.01),
  moveFwd10: () => nudge('move', 0.01),
  // The key that starts a hold ends it when it's let go, whichever key that is.
  hold: (e) => { if (!e.repeat) { holdKey = e.code; holdStart(); } },
  offset: () => cycleOffset(),
  replayToggle: () => setReplay(!S.replay),
  trackNext: () => stepTrack(1),
  trackPrev: () => stepTrack(-1),
  transcribeBlock: () => transcribeSelected(),
  findReplace: () => openFind(),
  sttPanel: () => showMarking(),
  read: () => speakBlock(false),
  fitToReading: () => speakBlock(true),
  ttsPanel: () => openTts(),
  soundsLike: () => openSay(),
  aiHelp: () => toggleAi(),
  help: () => toggleHelp(),
  settings: () => showGeneral(),
  zoomIn: () => zoom(1.5),
  zoomOut: () => zoom(1 / 1.5),
  zoomFit: () => fitAll(),
};

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
    liveSpeech(lastT, t);
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
    clockEl.textContent = tc(t);
    if (S.remaining) showDur(t);
  }
  if (tlDirty) { drawTimeline(); drawScrub(true); } else drawScrub();
  updateMark();
  placePlayhead(t);
  placeScrub(t);
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- boot

document.querySelectorAll('.mod').forEach((el) => { el.textContent = IS_MAC ? '⌘' : 'Ctrl+'; });
document.querySelectorAll('[data-tip]').forEach((el) => { el.dataset.tip = pcKeys(el.dataset.tip.replaceAll('{mod}', IS_MAC ? '⌘' : 'Ctrl+')); });
if (!IS_MAC) {
  // Rows whose keys differ off the Mac carry their own markup in data-pc.
  document.querySelectorAll('[data-pc]').forEach((el) => { el.innerHTML = el.dataset.pc; });
  for (const root of [helpEl, document.querySelector('nav'), document.querySelector('.hint'), $('stageEmpty'), $('ctrls'), $('welcome')]) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) walk.currentNode.nodeValue = pcKeys(walk.currentNode.nodeValue);
  }
  document.querySelectorAll('[aria-label]').forEach((el) => el.setAttribute('aria-label', pcKeys(el.getAttribute('aria-label'))));
  edText.placeholder = pcKeys(edText.placeholder);
}
const restored = loadSaved();
aiNotesChanged();
S.dirty = false;
showDocName();
S.pps = Math.max(20, tl.clientWidth / 20);
changed();
S.dirty = restored ? S.savedDirty : false;
showDocName();
// Keep saving in place to the project that was open before the reload.
handleStore.get().then((h) => { if (h && h.name === S.subName) { S.handle = h; checkWrite(); } });
updateInd();
setMode(S.mode, true);
showDur();
if (restored) {
  select(S.cues[0].id, { seek: false });
  toast(`Restored ${restored} cues from autosave`);
  // Its video too, straight away if the browser still allows it, or with one click.
  if (S.projectMedia) reopenVideo(S.projectMedia).then((ok) => { if (ok) toast(`Restored ${restored} cues, and reopened ${S.projectMedia.name}`); });
} else {
  toast('Ready. Press ? for keyboard shortcuts.');
}
// A new user's first-run questions, update checks included, are in the welcome wizard.
initUpdates({
  toast,
  ask: !FIRST_RUN,
  // Nothing would be lost by reloading for an update: the autosave brings the blocks back,
  // so it's enough that no video is open (it would have to be opened again), no job is
  // running, and nobody is typing or in a dialog.
  idle: () => !S.hasVideo && !measuring && !document.querySelector('dialog[open]')
    && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName),
});
initTts({
  toast,
  rate: () => S.rate,
  duck: duckAudio,
  sample: () => spoken(selCue() ? said(selCue()) : ''),
  changed: () => { fitAllAuto(); renderList(); updateEditor(); updateInd(); tlDirty = true; },
  readingChanged,
  blockVoices: () => S.cues.filter((c) => c.voice).map((c) => c.voice),
});
initTour();
$('helpTour').addEventListener('click', () => { toggleHelp(false); startTour(S.mode); });
$('helpLoop').addEventListener('click', () => { toggleHelp(false); showLoop(S.mode); });
initKeys({ mac: IS_MAC, toast, onChange: (m) => { keyLookup = m; } });
$('helpKeys').addEventListener('click', () => { toggleHelp(false); openKeys(); });
$('helpGuides').addEventListener('click', () => { toggleHelp(false); openGuide(); });
// The guides, inside Scribecue when this copy has them; the Guides button shows then.
initGuides();
guidesHere().then((ok) => { $('helpGuides').hidden = !ok; });
// What works offline, a marker while there's no connection, and keeping storage safe.
initOffline({
  toast: (m) => toast(m),
  voices: () => tts.piper.map((v) => v.name),
  whisper: () => stt.ready,
  readings: () => savedReadings(),
  clearReadings: () => clearSavedReadings(),
  openTts: () => openTts(),
  openStt: () => openStt(),
  guides: () => guidesHere(),
  unsaved: () => (S.dirty ? S.cues.length : 0),
  save: () => saveProject(),
});
initWelcome({
  getMode: () => S.mode,
  setMode,
  getOffset: () => S.offset,
  setOffset,
  getReplay: () => S.replay,
  setReplay: (on) => setReplay(on, true),
  offsets: OFFSETS,
  toast,
}, (finished) => {
  // Skipped before answering about updates: ask the usual way instead. The web version
  // updates itself, so there's nothing to ask.
  if (!finished && !HOSTED && updateChoice() === null) setTimeout(openUpdates, 300);
  // Then the loop for the mode picked, once nothing else is on screen.
  whenClear(() => maybeShowLoop(S.mode));
});

// ---------------------------------------------------------------- settings

// Everything that's set up rather than used while working, in one window. The panels
// that were windows of their own are moved in, once they've been set up above.
initSettings();
const showGeneral = () => {
  $('setVersion').textContent = VERSION;
  $('setReplay').checked = S.replay;
  renderUpdates();
  openSettings('general');
};
const showMarking = () => {
  const sel = $('setOffset');
  if (!sel.options.length) for (const v of OFFSETS) sel.append(new Option(`${Math.round(v * 1000)} ms`, String(v)));
  sel.value = String(S.offset);
  openStt();
};
$('setGeneral').append($('updMain'));
$('updMain').querySelector('h2').hidden = true;
$('updClose').parentElement.hidden = true;
if (HOSTED) $('updMain').remove();
addSection('general', 'General', { open: showGeneral, content: $('setGeneral') });
addSection('marking', 'Transcribing', { open: showMarking, content: $('setMarking') });
adopt($('sttDlg'), 'marking', { skip: ['.updbtns:has(#sttClose)'] });
addSection('tts', 'Text to speech', { open: () => openTts() });
adopt($('ttsDlg'), 'tts', { skip: ['#ttsClose'] });
addSection('ai', 'AI help', { open: openAiSettings, content: $('aiSetup') });
place($('setTmdb'), 'ai');
addSection('keys', 'Keyboard shortcuts', { open: () => openKeys() });
adopt($('keysDlg'), 'keys', { skip: ['#keysDone'] });
addSection('storage', HOSTED ? 'Offline and storage' : 'Storage', { open: () => openOffline() });
adopt($('offlineDlg'), 'storage', { skip: ['.updbtns:has(#offlineClose)'] });
$('setWhatsNew').addEventListener('click', () => openWhatsNew(VERSION));
$('setSetup').addEventListener('click', () => { closeSettings(); openWelcome(); });
$('setTour').addEventListener('click', () => { closeSettings(); startTour(S.mode); });
$('setReplay').addEventListener('change', (e) => setReplay(e.target.checked, true));
$('setOffset').addEventListener('change', (e) => setOffset(+e.target.value));

// Runs fn once no dialog, notice or tour is showing, checking for up to a minute.
function whenClear(fn, tries = 120) {
  const busy = document.querySelector('dialog[open]') || !$('tour').hidden || !$('browserAlert').hidden;
  if (!busy) return fn();
  if (tries > 0) setTimeout(() => whenClear(fn, tries - 1), 500);
}
// When this browser lacks something Scribecue uses, or is known not to do it well, say
// which. Chrome and Edge, and browsers like them, have nothing to say.
// Shown each time Scribecue opens, until "Don't show again", which lasts until the list
// changes, such as when a new problem is found.
(() => {
  const name = browserName(navigator.userAgent, navigator.userAgentData?.brands || []);
  const missing = noticeItems(name, window);
  const seen = [name, ...missing].join('|');
  let never = false;
  try { never = localStorage.getItem('scribecue.browserNotice') === seen; } catch { /* ignore */ }
  if (!needsNotice(missing) || never) return;
  $('browserAlertTitle').textContent = `You're using ${name}`;
  $('browserMissing').textContent = missing.length ? ', including:' : '.';
  $('browserList').replaceChildren(...missing.map((m) => Object.assign(document.createElement('li'), { textContent: m })));
  $('browserList').hidden = !missing.length;
  const box = $('browserAlert');
  box.hidden = false;
  $('browserOk').addEventListener('click', () => { box.hidden = true; });
  $('browserNever').addEventListener('click', () => {
    box.hidden = true;
    try { localStorage.setItem('scribecue.browserNotice', seen); } catch { /* ignore */ }
  });
})();
// After a while of unsaved work, a note asks to save it as a project.
initReminder({
  state: () => ({
    blocks: S.cues.length, dirty: S.dirty && S.cues.length > 0, lastChange: S.lastChange || 0,
    hasFile: !!S.handle || S.subName.endsWith(PROJECT_EXT), name: S.subName,
  }),
  busy: () => !!edit || !!hold || !!document.querySelector('dialog[open]') || !$('tour').hidden ||
    [...document.querySelectorAll('.updalert')].some((el) => !el.hidden),
  save: () => saveProject(),
});
// After an update, what's new since the version last used.
initWhatsNew({
  version: VERSION,
  firstRun: FIRST_RUN,
  busy: () => !!document.querySelector('dialog[open]') || !$('tour').hidden || !$('browserAlert').hidden || !$('updAlert')?.hidden,
});
// A first visit starts with the tour, then the setup, whether the tour is finished or skipped.
if (FIRST_RUN) setTimeout(() => startTour(S.mode, { then: openWelcome, finish: 'Set up Scribecue' }), 400);
else if (!welcomed()) {
  // Someone who used Scribecue before the wizard existed: mention it once.
  markWelcomed();
  setTimeout(() => toast('New: Settings at the top has setup, which walks you through choosing your task and its tools'), 2500);
}
requestAnimationFrame(tick);
