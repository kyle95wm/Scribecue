import { startNewProject } from './newproject.js';
import { createQcPlayer } from './qcplayer.js';
import { REVIEW_EXT, isReview, openReview, resaveReview, liveBlock, reviewAllowsEdits, reviewReading, playbackReading, rewriteSpec, readingVoiceChanged, appendRewrite, previousReading, storedReview, voiceReport, reviewAudioKey } from './qc.js';
import { reviewedRewrite, speechKey, rereads, canReread, bundledFor, keyName } from './qcspeech.js';
import { offerLiveVoices, initQc, refreshQc, openQcPlayback, openQcExport } from './qcdrawer.js';
import { cleanComments, commentsAllowed } from './comments.js';
import { cleanEdited, stampEdits, seedEdits, editorCount, editedLine, blockSig } from './edits.js';
import { savedName, saveName, editorId, validEditorId } from './profile.js';
import { initComments, toggleComments, refreshComments, openBlockComments, showName } from './commentsdrawer.js';
import { parseSubs, parseAdc, scriptVoices, swapVoices, toSRT, toVTT, fmtTC, fmtTime, parseTC } from './formats.js';
import { initUpdates, openUpdates, updateChoice, renderUpdates } from './update.js';
import { HOSTED } from './config.js';
import { initAi, toggleAi, aiNotesChanged, openAiSettings } from './aidrawer.js';
import { initCheck, openCheck, checkFirst } from './proofdialog.js';
import { initWelcome, openWelcome, openModeSetup, modeSetUp, welcomed, markWelcomed } from './welcome.js';
import { collaborationJob, retainHistory } from './collaboration.js';
import { initReviewCompare, openReviewCompare, finishReview } from './qcreviewdrawer.js';
import { initPending, startPending, addPending, endPending, pendingGhost, livePending } from './qcpending.js';
import { toProject, fromProject, sameMedia, PROJECT_EXT, cleanPickup, cleanNotes, cleanWords, cleanRecording, newIdentity, validIdentity, cleanReviewHistory, cleanReviewAudio } from './project.js';
import { RECORDING_EXT, isRecordingFile, toRecordingFile, fromRecordingFile, sameVideo, compareScript, newProjectId, pickupsFor, takesKey } from './recording.js';
import { readNote } from './bwf.js';
import { readZip } from './zip.js';
import { initRecord } from './record.js';
import { takesInfo, clearTakes, unpackSession, rememberSession, browserFolder, canUseFolders, canKeepInBrowser } from './takestore.js';
import { isSessionPackage, fromSession, SESSION_FILE } from './session.js';
import { picker, refused } from './pickers.js';
import { browserName, noticeItems, needsNotice, noticeTitle, isMobile, readProblem } from './browser.js';
import { afterEdit, blockFromPlayhead, nudgeFor, nudges, NUDGE, takeFrom, stopAt, returnsToStart, scrubber, cleanLead, leadFrom } from './nav.js';
import { initTour, startTour, showLoop, maybeShowLoop, loopSeen } from './tour.js';
import { initDockerTip } from './dockertip.js';
import { initWhatsNew, openWhatsNew } from './whatsnew.js';
import { initSettings, addSection, adopt, place, openSettings, closeSettings } from './settings.js';
import { initReminder } from './reminder.js';
import { announce, speakable, blockLabel, keepsFocusAfterDialog } from './a11y.js';
import { initOffline, openOffline, keepStorage } from './offline.js';
import { initGuides, openGuide, guidesHere } from './guide.js';
import { matcher, count as countMatches, replaceIn, nextMatch } from './findreplace.js';
import { autosaveState, AUTOSAVE_LABEL, AUTOSAVE_TIP, nextSave, canAutosave } from './autosave.js';
import { comboOf, lookup } from './keymap.js';
import { isExtended, blockToHold, stillHeard, extendedSecs, addedTime, extendedTimeline, timedScript, pauseList } from './extended.js';
import { initKeys, keyChanges, openKeys } from './keys.js';
import { VERSION } from './update.js';
import { FIT_MIN, MAX_SPEED, writeWav, pcmToWav, readingStarting, missingVoiceAdvice, hasGoogleKey, hasPollyKey } from './tts.js';
import { trackFormat, mixFormat, encodeMp3 } from './mp3.js';
import { ffmpegCommands, holdFilter, extendedCommand } from './ffcmd.js';
import { videoName, missing, silentSound, copiesSound, ownTrack, advice, noBrowserOpens, copyKind, TESTS } from './codecs.js';
import { createLog, watchErrors, pictureWatch, report as diagReport } from './diagnostics.js';
import { waveKey, loadWave, saveWave, loadSound, saveSound } from './wavestore.js';
import { buildDialogue, gapsOf, gapFrom, freeGaps, placeInGap, speechIn, MIN_CLASH, bestTrack, drawDialogue, dialogueKey, loadDialogue, saveDialogue } from './dialogue.js';
import { stt, initStt, openStt, transcribe, warmStt, RATE as STT_RATE } from './stt.js';
import { soundsLike, hasWord, mergeSay } from './tts.js';
import { tts, initTts, openTts, speak, stop as stopSpeech, duration as speechLength, spoken, readWav, SPEEDS, isSpeed, toBase, baseFromSpeed, speedLabel,
  isBlockSpeed, speedName, speedToFit, speedFromReadings, nextFitSpeed, bestFit, readingsOf, fixedShare, LANES,
  reviewVoices, usingAudioVoice, measure, prefetch, readAhead, renderTrack, makeReadings, chosenVoice, chosenVoiceName, voiceName, voiceLabel, fillVoiceSelect, showCloudCost, cloudOf, setTtsOption, onlyNotes, mixLevels, setMix, stepDip, dipLevel, LOUDNESS, DIP_BYS, isDip, FADES, isDipBy, typedDipBy, blockDipOf, dipFor, isVol, typedVol, volGain,
  savedReadings, clearSavedReadings, checkFfmpeg } from './tts.js';

const $ = (id) => document.getElementById(id);
// Errors, warnings and messages, kept from the start for Diagnostics in Settings.
const diagLog = createLog();
watchErrors(diagLog);

// Phones and tablets get a notice instead of the editor, which needs a keyboard and a
// bigger screen. Nothing else starts.
if (isMobile({ ua: navigator.userAgent, mobile: navigator.userAgentData?.mobile, touchPoints: navigator.maxTouchPoints })) {
  document.body.classList.add('blocked');
  $('mobileBlock').hidden = false;
  throw new Error('Scribecue needs a computer');
}

const video = $('video'), stage = $('stage'), overlay = $('overlay'), list = $('list');
const tl = $('tl'), ruler = $('ruler'), lane = $('lane'), wave = $('wave'), cuesLayer = $('cues'), takeWave = $('takeWave'), dialTrack = $('dialTrack'), dialWave = $('dialWave');
const playheadEl = $('playhead'), dragtip = $('dragtip'), overview = $('overview'), ovWin = $('ovWin');
const TEXT_HINT = $('edText').placeholder;
const edText = $('edText'), edStart = $('edStart'), edEnd = $('edEnd'), edNotes = $('edNotes');
const editor = $('editor'), edTts = $('edTts');
const edIdx = $('edIdx'), edDur = $('edDur'), edClash = $('edClash'), edStats = $('edStats'), edSpeed = $('edSpeed'), edSpeedWrap = $('edSpeedWrap'), edAuto = $('edAuto');
const clockEl = $('clock'), durEl = $('durEl'), ind = $('ind');
const toastEl = $('toast'), helpEl = $('help'), fileSubs = $('fileSubs'), fileVideo = $('fileVideo');

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// Mac key symbols as Windows and Linux users know them: ⌥⇧← becomes Alt+Shift+←.
const writing = () => S.mode === 'write';
const qc = () => S.mode === 'qc';
const canComment = () => commentsAllowed(S.mode);
// In a project shared with you, your link decides: Can review edits in QC, as suggestions;
// Can comment only comments. (myShare: what this browser keeps for the project open.)
let myShare = null;
const sharedLimited = () => myShare?.role === 'review' || myShare?.role === 'comment';
const qcEditable = () => myShare?.role === 'comment' ? false : myShare?.role === 'review' ? true : S.reviewId ? reviewAllowsEdits(S.review) : !!S.reviewAudio;
const qcLocked = () => qc() && !qcEditable();
const readingControls = () => ttsOn() || (qc() && qcEditable());
// QC blocks whose new reading is being made on its own, and what that has set (see autoRewrite).
const autoMaking = new Set(), autoAgain = new Set(), autoTimers = new Map();
// The speech each block had when last seen in QC, and the blocks whose speech changed there.
const fitFor = new WeakMap(), edited = new WeakSet();
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
const C = Object.fromEntries(['panel', 'line', 'dim', 'faint', 'accent', 'bg', 'cue', 'text'].map((k) => [k, css.getPropertyValue('--' + k).trim()]));
C.wave = '#3b7f86';
C.grid = '#1b2028';

// Modes show the features for the task at hand. Transcribe: existing audio description
// at its original timing, with hold-to-mark. Write: new audio description, with text to
// speech. Someone who already turned text to speech on starts in Write.
const savedMode = (() => { try { return localStorage.getItem('scribecue.mode'); } catch { return null; } })();
const S = {
  mode: savedMode === 'write' || savedMode === 'transcribe' || savedMode === 'qc' ? savedMode : tts.on ? 'write' : 'transcribe',
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
  // Lead-in: how many seconds before a block hearing it again starts. 0 starts at the block.
  lead: (() => { try { return cleanLead(localStorage.getItem('scribecue.lead')); } catch { return 0; } })(),
  // Return to start: stopping puts the playhead back where that playback began. Record mode
  // only (see returning). Off unless turned on.
  returnToStart: (() => { try { return localStorage.getItem('scribecue.returnToStart') === '1'; } catch { return false; } })(),
  // The total length shows the time remaining instead.
  remaining: (() => { try { return localStorage.getItem('scribecue.remaining') === '1'; } catch { return false; } })(),
  extendedAll: false, // every block with a reading pauses the video
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
  subTracks: [],    // the video's subtitle tracks, from the worker
  dialogue: null,   // the dialogue lane: { lines, spans, choice, label }
  dialStatus: '',   // and how reading it is going
  tracks: [], // audio tracks in the media file, as listed by the worker
  track: 0,
  maxEnd: 0,
  subName: 'untitled.srt', // the open project or script's file name
  dirty: false, // changed since the project was last saved or opened
  handle: null, // where the project saves to, when the browser allows saving in place
  projectMedia: null, // { name, size } of the video the open project belongs to
  pendingPlayhead: null, // where to put the playhead once that video is open
  previousAudio: null, review: null, reviewId: '', qcSource: 'video', qcPreviewVoice: '', qcSettings: null, loadingProject: false, makingReview: false,
  comments: [], // comments at fixed timeline times
  notes: '', // the writer's notes about the programme, for AI help
  words: [], // names and terms the spelling check accepts in this project
  projectId: newIdentity(), reviewHistory: null, reviewAudio: null,
  recording: null, // this project's recording files: { id, version, sent } (see cleanRecording)
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
const mk = (start, end, text = '', speed) => ({ id: nextId++, uid: newIdentity(), start, end, text, ...(isBlockSpeed(speed) ? { speed } : {}) });
// A saved block back as a block: voice (its own text to speech voice), auto (end follows
// the reading), fit (speed follows the length), pinned (speed picked by hand, so
// resizing leaves it alone), dip or dipBy (how far the programme goes down under it) and
// vol (how loud its reading is). notes: what the narrator is told, never read aloud.
const revive = (b) => Object.assign(mk(b.start, b.end, b.text, b.speed),
  validIdentity(b.uid) ? { uid: b.uid } : {},
  Number.isSafeInteger(b.qcReading) ? { qcReading: b.qcReading } : {},
  typeof b.voice === 'string' && b.voice ? { voice: b.voice } : {},
  blockDipOf(b), isVol(b.vol) ? { vol: b.vol } : {},
  b.auto ? { auto: true } : {}, b.fit ? { fit: true } : {}, b.pinned ? { pinned: true } : {},
  cleanComments(b.comments).length ? { comments: cleanComments(b.comments) } : {},
  b.say?.length ? { say: b.say } : {},
  cleanPickup(b.pickup) ? { pickup: cleanPickup(b.pickup) } : {},
  b.extended === true ? { extended: true } : {},
  cleanNotes(b.notes) ? { notes: cleanNotes(b.notes) } : {},
  cleanEdited(b.edited) ? { edited: cleanEdited(b.edited) } : {});
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
  return d > 0 ? Math.max(d, S.maxEnd) : Math.max(60, S.maxEnd + 30, commentEnd);
}
// While a drag waits for a slow seek, the playhead shows where it's going.
const scrub = scrubber(() => video.seeking, (t) => setTime(t));
const now = () => (S.hasVideo ? scrub.target ?? video.currentTime : S.vt);
const qcPlayer = createQcPlayer({ now, duck: (on) => duckAudio(on || !!tts.speaking), error: (message) => toast(message) });
// Extended audio description: the programme stops at the block's start while it's read.
// While it's held, playback still counts as playing, though the video is paused.
let extHold = null, heard = null, keepStart = null, jumpedHere = false;
const isExt = (c) => isExtended(c, S.extendedAll);
const hasExtended = () => S.cues.some((c) => isExt(c) && spoken(c.text));
// Whether exports stop the programme for extended blocks.
const withPauses = () => tts.keepPauses && hasExtended();
const isPlaying = () => (S.hasVideo ? (!video.paused && !video.ended) || !!extHold : S.vplaying);
// For return to start: where playback began, moved along by any jump while playing.
let playStart = null;
// While a lead-in plays or waits, the block it leads to, and a reading to start on reaching it.
let leadTo = null, leadRead = null;

function setTime(t) {
  leaveHold();
  heard = null;
  jumpedHere = true;
  scrub.clear();
  leadTo = null; leadRead = null;
  stopPreviousReading();
  qcPlayer.stop();
  t = clamp(t, 0, duration());
  if (tts.speaking && Math.abs(t - now()) > 0.05) stopSpeech(); // a jump ends the reading
  if (S.hasVideo) video.currentTime = t;
  else S.vt = t;
  if (isPlaying()) { playStart = t; keepStart = null; }
}
// The block clicked open in the list: the playhead goes to it when the block is closed.
// Moving the playhead yourself in the meantime cancels that.
let seekOnClose = null;
function seek(t, reveal = true) {
  seekOnClose = null;
  setTime(t);
  if (reveal) ensureVisible(now());
}
// Seeks while dragging the playhead: see scrubber in nav.js.
function scrubTo(t, reveal = true) {
  seekOnClose = null;
  if (!S.hasVideo) return seek(t, reveal);
  leaveHold();
  scrub.to(clamp(t, 0, duration()));
  if (reveal) ensureVisible(now());
  tlDirty = true;
}
function seekBy(d) {
  S.playUntil = null;
  seek(now() + d);
}
function play() {
  if (extHold) return; // it carries on when the reading ends
  stopPreviousReading();
  if (qc()) qcPlayer.unlock();
  if (S.hasVideo) {
    // Pausing before the video has started cancels the play: that's no failure.
    video.play().catch((e) => { if (e.name !== 'AbortError') toast('Playback failed: ' + e.message); });
    if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) videoWaiting(true);
  } else { S.vplaying = true; playStart = now(); }
  updateInd();
}
// A slow computer can take a moment to start the video, or to carry on after a jump, so
// say it's loading rather than look as if play did nothing. Only after a moment, so a
// quick start doesn't flicker.
let waitTimer = 0;
// Says so under the video when it's slow to load, or to show the place you jumped to.
function videoWaiting(on, seeking = false) {
  clearTimeout(waitTimer);
  if (on) waitTimer = setTimeout(() => {
    $('vidWait').textContent = seeking ? 'Seeking…' : 'Loading…';
    $('vidWait').hidden = seeking ? !video.seeking : video.paused;
  }, 300);
  else $('vidWait').hidden = true;
}
video.addEventListener('waiting', () => videoWaiting(true));
video.addEventListener('seeking', () => videoWaiting(true, true));
video.addEventListener('seeked', () => { videoWaiting(false); scrub.seeked(); });
video.addEventListener('emptied', () => { extHold = null; scrub.clear(); });
for (const ev of ['playing', 'pause', 'emptied']) video.addEventListener(ev, () => videoWaiting(false));
// Record mode plays the video itself, so where playback began is taken from the video.
video.addEventListener('play', () => { playStart = keepStart ?? video.currentTime; keepStart = null; });
const returning = () => returnsToStart(S.returnToStart, S.mode);
video.addEventListener('ended', () => { const t = stopAt(returning(), playStart, now()); if (t !== now()) seek(t); });
// Stops the programme at the block's start, and carries on when the reading ends, or if
// it can't be read. read(done): starts the reading, and calls done as it ends.
function startHold(c, read) {
  const h = { id: c.id };
  extHold = h;
  if (S.hasVideo) {
    video.pause();
    if (video.currentTime - c.start > 0.1) video.currentTime = c.start; // a slow frame went past it
  } else {
    S.vplaying = true;
    S.vt = Math.min(S.vt, c.start);
  }
  updateInd();
  read(() => {
    if (extHold !== h) return;
    extHold = null;
    heard = c;
    carryOn();
  });
}
function carryOn() {
  if (S.hasVideo) { keepStart = playStart; play(); }
  updateInd();
}
// A jump while the programme is held ends the reading, and playback carries on from there.
function leaveHold() {
  if (!extHold) return;
  extHold = null;
  stopSpeech();
  qcPlayer.stop();
  carryOn();
}
function pause() {
  extHold = null;
  leadRead = null;
  stopPreviousReading();
  qcPlayer.stop();
  stopSpeech();
  if (S.hasVideo) video.pause();
  else S.vplaying = false;
  updateInd();
}
// Only play and stop by hand go back to the start: not a block that stops at its end, nor
// a pause for editing.
function togglePlay() {
  S.playUntil = null;
  if (isPlaying()) {
    const t = stopAt(returning(), playStart, now());
    pause();
    if (t !== now()) seek(t);
    return;
  }
  play();
}
function playCue() {
  const c = selCue();
  if (!c) return togglePlay();
  leadBefore(c);
  S.playUntil = c.end;
  play();
}
// Where hearing a block again starts. Record mode has a lead-in of its own, for recording.
const heardFrom = (c) => (S.mode === 'record' ? c.start : leadFrom(c.start, S.lead));
// Goes to where hearing the block starts. read: starts its reading, now or on reaching it.
function leadBefore(c, go = setTime, read = null) {
  const t = heardFrom(c);
  go(t);
  if (t < c.start) { leadTo = c.id; leadRead = read; } else read?.();
}
// The block a lead-in is leading to, while the playhead is still in the lead-in. Keys that
// act on the block here mean this one, not whichever block the lead-in passes through.
function leadingTo(t = now()) {
  const c = leadTo != null && leadTo === S.sel ? selCue() : null;
  return c && t < c.start ? c : null;
}
// Called as the playhead moves: the lead-in ends at the block's start.
function reachBlock(t) {
  if (leadTo == null) return;
  const c = S.cues[idx(leadTo)];
  if (c && t < c.start) return;
  const read = leadRead;
  leadTo = null; leadRead = null;
  if (c) read?.();
}
function setRate(r) {
  S.rate = clamp(Math.round(r * 100) / 100, 0.25, 3);
  video.playbackRate = S.rate;
  updateInd();
  toast(`Speed ${S.rate.toFixed(2)}×`);
}

// ---------------------------------------------------------------- view

// Sizes of the timeline's parts, kept up to date as they change. Reading clientWidth on
// every frame made the browser lay out the whole page again whenever the list had
// changed, which held up slower computers in long jobs.
const sizes = new WeakMap();
const sizer = new ResizeObserver((entries) => {
  for (const e of entries) sizes.set(e.target, [e.target.clientWidth, e.target.clientHeight]);
  tlDirty = true;
});
function box(el) {
  let s = sizes.get(el);
  if (!s) { s = [el.clientWidth, el.clientHeight]; sizes.set(el, s); sizer.observe(el); }
  return s;
}
const boxW = (el) => box(el)[0];
const visSec = () => boxW(tl) / S.pps;
const xToT = (clientX) => S.view + (clientX - tl.getBoundingClientRect().left) / S.pps;
const clampView = (v) => clamp(v, 0, Math.max(0, duration() - visSec() * 0.5));
const minPps = () => Math.max(0.5, boxW(tl) / duration());

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
  takeZoom = null;
  const t = anchorT ?? (now() >= S.view && now() <= S.view + visSec() ? now() : S.view + visSec() / 2);
  const x = (t - S.view) * S.pps;
  S.pps = clamp(S.pps * f, minPps(), MAX_PPS);
  S.view = clampView(t - x / S.pps);
  tlDirty = true;
  updateInd();
}
function fitAll() {
  S.pps = clamp(boxW(tl) / duration(), 0.5, MAX_PPS);
  S.view = 0;
  takeZoom = null;
  tlDirty = true;
  updateInd();
}
// Zoom to take (Z, Record mode): the selected block's slot and take fill the timeline, for
// placing it precisely; again goes back to the zoom from before. takeZoom: { id, pps, view }.
let takeZoom = null;
function zoomToTake() {
  const c = selCue();
  if (takeZoom && (!c || takeZoom.id === c.id)) {
    ({ pps: S.pps } = takeZoom);
    S.view = clampView(takeZoom.view);
    takeZoom = null;
  } else {
    if (!c) return toast('Select a block to zoom to its take');
    const back = takeZoom || { pps: S.pps, view: S.view };
    const { start, end } = recorder.span(selIdx());
    const pad = Math.max(0.15, (end - start) * 0.08);
    S.pps = clamp(boxW(tl) / (end - start + pad * 2), minPps(), MAX_PPS);
    S.view = clampView(start - pad);
    takeZoom = { id: c.id, pps: back.pps, view: back.view };
  }
  tlDirty = true;
  updateInd();
}
$('tlZoom').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  b.blur(); // keep the keys for the timeline
  ({ in: () => zoom(1.5), out: () => zoom(1 / 1.5), fit: fitAll, take: zoomToTake })[b.dataset.zoom]();
});
function followPlayhead(t) {
  const vis = visSec();
  if (t > S.view + vis * 0.92 || t < S.view) setView(t - vis * 0.08);
}

// ---------------------------------------------------------------- undo

const undoStack = [], redoStack = [];
let lastUndoTag = null, lastUndoTime = 0;
// Checkpoints are immutable: undo shares them rather than copying whole scripts.
const snapshot = () => ({ data: JSON.stringify({ cues: S.cues, sel: S.sel, comments: S.comments, projectId: S.projectId, extendedAll: S.extendedAll }), reviewHistory: S.reviewHistory, reviewAudio: S.reviewAudio, authorReadings: S.reviewId ? null : S.review });

// `tag` coalesces repeated identical actions (e.g. holding a nudge key) into one undo step.
function pushUndo(snap = snapshot(), tag = null) {
  noteSpeech();
  const t = performance.now();
  if (tag && tag === lastUndoTag && t - lastUndoTime < 1000) { lastUndoTime = t; return; }
  lastUndoTag = tag; lastUndoTime = t;
  // While shared, the step also starts a new step in the shared copy's own undo.
  if (sharedUndo) snap = { ...snap, shared: sharedUndo, mark: sharedUndo.step() };
  undoStack.push(snap);
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
}
function restore(snap) {
  const o = JSON.parse(snap.data);
  if (qcLocked()) {
    S.comments = o.comments || [];
    for (const c of S.cues) c.comments = o.cues.find((b) => b.id === c.id)?.comments || [];
    changed(); return;
  }
  S.projectId = validIdentity(o.projectId) ? o.projectId : newIdentity();
  S.reviewHistory = snap.reviewHistory;
  if (!S.reviewId) { S.reviewAudio = snap.reviewAudio || null; S.review = snap.authorReadings || null; S.qcSource = S.review ? 'package' : 'video'; syncQcPermission(); }
  S.cues = o.cues;
  S.comments = o.comments || [];
  S.extendedAll = o.extendedAll === true;
  updateInd();
  nextId = S.cues.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  changed();
  select(o.sel != null && idx(o.sel) >= 0 ? o.sel : null, { seek: false });
}
function qcUndoAllowed(snap) {
  if (!qcLocked()) return true;
  const script = (cues) => JSON.stringify(cues.map(({ comments, ...b }) => b));
  if (script(JSON.parse(snap.data).cues) === script(S.cues)) return true;
  toast('This review allows comments only. Block changes cannot be undone here'); return false;
}
// While shared, undo takes back only this computer's changes, so others' words stay. The
// script's own steps still say where each step starts; parts not shared (pickups, review
// audio) come back from the step as before.
const sharedStep = (snap) => sharedUndo && snap.shared === sharedUndo;
function restoreLocal(snap) {
  if (qcLocked()) return;
  const o = JSON.parse(snap.data), keep = new Set(['id', 'uid', 'text', 'comments', ...sharedLib.SHARED_FIELDS]);
  S.reviewHistory = snap.reviewHistory;
  if (!S.reviewId) { S.reviewAudio = snap.reviewAudio || null; S.review = snap.authorReadings || null; S.qcSource = S.review ? 'package' : 'video'; syncQcPermission(); }
  S.extendedAll = o.extendedAll === true;
  const was = new Map(o.cues.map((b) => [b.uid, b]));
  for (const c of S.cues) {
    const b = was.get(c.uid);
    if (!b) continue;
    for (const k of new Set([...Object.keys(c), ...Object.keys(b)])) if (!keep.has(k)) { if (k in b) c[k] = b[k]; else delete c[k]; }
  }
  updateInd();
  changed();
  // Selection by uid: a block that came back has a new id here.
  const uid = o.cues.find((b) => b.id === o.sel)?.uid, c = uid && S.cues.find((b) => b.uid === uid);
  select(c ? c.id : null, { seek: false });
}
function doUndo() {
  if (!undoStack.length) return toast('Nothing to undo');
  const snap = undoStack.at(-1);
  if (sharedStep(snap)) {
    undoStack.pop();
    const back = sharedUndo.undoTo(snap.mark);
    redoStack.push({ ...snapshot(), shared: sharedUndo, redo: back });
    restoreLocal(snap);
  } else {
    if (!qcUndoAllowed(snap)) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  lastUndoTag = null;
  if (edit) edit.pushed = false;
  toast('Undo');
}
function doRedo() {
  if (!redoStack.length) return toast('Nothing to redo');
  const snap = redoStack.at(-1);
  if (sharedStep(snap)) {
    redoStack.pop();
    const mark = sharedUndo.depth();
    sharedUndo.redo(snap.redo);
    undoStack.push({ ...snapshot(), shared: sharedUndo, mark });
    restoreLocal(snap);
  } else {
    if (!qcUndoAllowed(snap)) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }
  lastUndoTag = null;
  if (edit) edit.pushed = false;
  toast('Redo');
}

// ---------------------------------------------------------------- change propagation

let saveTimer = 0;
let commentTimes = [], commentEnd = 0;
// Who last changed each block. Edits change the list in place; opening a file or undoing
// replaces it, and keeps the names it had. Record mode leaves the script as it is.
const editSigs = new Map();
let editList = null, editors = 0;
function noteEdits(id) {
  // Someone else's changes keep their name: remember how the blocks look, without stamping.
  if (sharedIn) {
    for (const c of S.cues) if (sharedIn.has(c.uid)) editSigs.set(c.uid, blockSig(c));
    editors = editorCount(S.cues);
    return;
  }
  if (S.cues !== editList || S.mode === 'record') { editList = S.cues; seedEdits(S.cues, editSigs); }
  else {
    const c = id == null ? null : S.cues[idx(id)];
    if (id != null && !c) return;
    const name = savedName();
    stampEdits(S.cues, editSigs, { ...(name ? { by: name } : {}), at: new Date().toISOString(), who: editorId() }, c ? c.uid : null);
  }
  editors = editorCount(S.cues);
}
// The shared copy for working with others (shared.js). Until sharing ships it's a developer
// setting, scribecue.sharedCopy in this browser's storage, so Yjs only loads when it's on.
// Tabs of this browser with the same project open share changes, as the service will.
let shared = null, sharedLib = null, sharedList = null, sharedProjectId = null, unlinkTabs = () => {};
let sharedIn = null, sharedStarting = null, sharedUndo = null, sharedToken = null; // uids being applied from others; undo of this tab's changes
const sharedOn = (() => { try { return localStorage.getItem('scribecue.sharedCopy') === '1'; } catch { return false; } })();
async function startShared() {
  const copy = new sharedLib.SharedProject(), id = S.projectId, token = sharedToken = {};
  shared = null; sharedUndo = null; sharedStarting = id; unlinkTabs(); stopRelay();
  // A project shared on the relay keeps its copy in this browser between visits.
  const record = sharedLib.getShare(id);
  myShare = record; syncQcPermission();
  const saved = record ? await handleStore.get('shared:' + id) : null;
  if (sharedToken !== token) return; // started again meanwhile
  if (saved) try { for (const d of sharedLib.DOCS) if (saved[d]) copy.apply(d, saved[d], 'saved'); } catch { /* starts again from the relay */ }
  const link = sharedLib.linkTabs(copy, id);
  unlinkTabs = link.stop;
  const joined = await link.ready;
  if (sharedToken !== token) return; // another project opened meanwhile, and started its own
  shared = copy; sharedProjectId = id; sharedList = S.cues; sharedUndo = null;
  shared.observe(applyShared);
  window.scribecueShared = shared; // for the developer tests
  // Another tab had it open: take its copy as it is. Joined but not kept here yet: take the
  // relay's. Otherwise start the copy from this script, or bring it up to date. The owner
  // starting to share sends the script; one whose copy here is lost takes the relay's.
  const fresh = !!record && !saved && !joined && (record.link !== 'owner' || record.created);
  if (joined) applyShared([...new Set([...shared.blocks.keys(), ...S.cues.map((c) => c.uid)])], true);
  else if (!fresh) writeShared(null);
  if (!record) endLive(); else refreshLive();
  // Undo from here on takes back this tab's changes only; earlier steps undo as before.
  sharedUndo = shared.undoer();
  if (record) startRelay(record, copy, fresh, saved?.seq || 0);
}
// The connection to the relay for a shared project, and keeping its copy in this browser.
let relay = null, relayOff = () => {};
function stopRelay() { relay?.stop(); relay = null; relayOff(); relayOff = () => {}; window.scribecueRelay = null; shareUi?.update(); }
async function startRelay(record, copy, fresh, seq) {
  const id = S.projectId, owner = record.link === 'owner';
  const create = owner && !record.created ? await sharedLib.signedLinks(record) : null;
  if (shared !== copy) return;
  let keep = 0;
  const persist = () => { clearTimeout(keep); keep = setTimeout(() => handleStore.set({ ...Object.fromEntries(sharedLib.DOCS.map((d) => [d, copy.update(d)])), seq: client.seq }, 'shared:' + id), 1500); };
  const client = relay = new sharedLib.RelayClient({
    url: record.relay, room: record.room, who: sharedLib.who(record), shared: copy, create, seed: !fresh,
    onStatus: (status, detail) => {
      if (relay !== client) return;
      if (status === 'online') {
        const now = sharedLib.getShare(id);
        if (now && create && !now.created) { now.created = true; sharedLib.setShare(id, now); }
        // Links changed while offline: the relay gets the newest list now.
        if (now && owner && client.links && now.n > client.links.n) sharedLib.signedLinks(now).then((l) => client.sendLinks(l));
        // Just joined: the relay's copy is the project. Blocks only here go.
        if (fresh) { fresh = false; applyShared([...new Set([...copy.blocks.keys(), ...S.cues.map((c) => c.uid)])], true); }
        persist();
      }
      if (status === 'ended') {
        toast(detail === 'room-deleted' ? 'This project is no longer shared. Your copy stays here' : 'This project is no longer shared with you. Your copy stays here');
        sharedLib.dropShare(id); handleStore.set(null, 'shared:' + id);
        // A plain project from now on: no limits, no suggestions.
        myShare = null; syncQcPermission(); endLive();
        queueMicrotask(stopRelay);
      }
      window.dispatchEvent(new CustomEvent('scribecue-relay', { detail: { status, detail } }));
    },
  });
  client.seq = seq;
  relayOff = copy.onUpdate(persist);
  window.scribecueRelay = client; // for the developer tests
  client.start();
}
// Starting to share this project, changing its links, and joining one from a link.
let shareUi = null, joinUi = null;
const sharingTools = {
  async start(passwords) {
    const record = await sharedLib.startSharing(S.projectId, sharedLib.relayUrl(), passwords);
    sharedLib.setShare(S.projectId, record);
    await startShared();
    return sharedLib.linksOf(record, location.href);
  },
  async join(url, password) {
    const record = await sharedLib.joinShare(new URL(url).hash, password, sharedLib.relayUrl());
    if (!okToReplace('Open the shared project')) return false;
    await stopJob();
    await endRecording();
    undoStack.length = 0; redoStack.length = 0;
    S.projectId = record.project || newIdentity();
    sharedLib.setShare(S.projectId, record);
    S.reviewHistory = null; S.cues = []; S.comments = []; S.handle = null; handleStore.set(null);
    changed(); // starts its shared copy, which fills from the relay
    select(null);
    setMode(record.role === 'edit' ? 'write' : 'qc', true);
    return true;
  },
  // A link for `role` with its password, starting to share if this is the first.
  async make(role, password) {
    const id = S.projectId, record = sharedLib.getShare(id);
    if (!record) { await sharingTools.start({ [role]: password }); return; }
    const next = await sharedLib.addLink(record, role, password);
    sharedLib.setShare(id, next);
    if (relay?.status === 'online') relay.sendLinks(await sharedLib.signedLinks(next));
  },
  async turnOff(linkId) {
    const id = S.projectId, next = sharedLib.removeLink(sharedLib.getShare(id), linkId);
    sharedLib.setShare(id, next);
    if (relay?.status === 'online') relay.sendLinks(await sharedLib.signedLinks(next));
    toast('Link turned off. It no longer opens this project');
  },
  // The owner ends sharing: the relay deletes its copy. This one stays, as a plain project.
  async stop() {
    if (!relay?.deleteRoom()) throw new Error('offline');
    const id = S.projectId;
    stopRelay();
    sharedLib.dropShare(id); handleStore.set(null, 'shared:' + id);
    await startShared();
    toast('Stopped sharing. Your copy stays here');
  },
  // Someone who joined leaves: their copy stays, as a project of its own.
  async leave() {
    const id = S.projectId;
    stopRelay();
    sharedLib.dropShare(id); handleStore.set(null, 'shared:' + id);
    S.projectId = newIdentity();
    changed();
    toast('Left the shared project. Your copy stays here');
  },
};
// A share link opened in this browser: ask for its password, unless it's the project here.
function openShareLink() {
  const l = sharedLib.parseLink(location.hash);
  if (!l) return;
  const clear = () => history.replaceState(null, '', location.pathname + location.search);
  if (sharedLib.shareForRoom(l.room)?.project === S.projectId) { clear(); return; }
  joinUi.open();
}
if (sharedOn) {
  Promise.all([import('./shared.js'), import('./sharing.js'), import('./relayclient.js'), import('./sharekeys.js'), import('./sharedialog.js')])
    .then(([a, b, c, d, ui]) => {
      sharedLib = { ...a, ...b, ...c, parseLink: d.parseLink };
      window.scribecueSharing = sharingTools;
      shareUi = ui.shareDialog({
        $, toast,
        record: () => sharedLib.getShare(S.projectId),
        links: () => { const r = sharedLib.getShare(S.projectId); return r ? sharedLib.linksOf(r, location.href) : []; },
        status: () => relay?.status || 'connecting',
        name: () => savedName(), setName: (v) => saveName(v),
        make: sharingTools.make, turnOff: sharingTools.turnOff, stop: sharingTools.stop, leave: sharingTools.leave,
      });
      joinUi = ui.joinDialog({
        $, name: () => savedName(), setName: (v) => saveName(v),
        join: async (password) => {
          const ok = await sharingTools.join(location.href, password);
          if (ok) { history.replaceState(null, '', location.pathname + location.search); toast('Opened the shared project. Open your copy of the video to watch along'); }
          return ok;
        },
      });
      window.addEventListener('scribecue-relay', () => shareUi.update());
      window.addEventListener('hashchange', openShareLink);
      $('shareBtn').hidden = false;
      startShared();
      openShareLink();
    })
    .catch(() => { /* stays off */ });
}
function noteShared(id) {
  if (!sharedLib || sharedIn) return;
  // A different project starts its own copy. Edits while it starts are in the script it reads.
  if (S.projectId !== (shared ? sharedProjectId : sharedStarting)) { startShared(); return; }
  if (!shared) return;
  const c = id == null ? null : S.cues[idx(id)];
  if (S.cues !== sharedList || !c) { sharedList = S.cues; writeShared(null); }
  else writeShared([c.uid]);
}
// Copies this person's changes in: block changes into the script, or as suggestions for a
// reviewer; a commenter's go no further than their comments.
function writeShared(only) {
  const role = myShare?.role;
  shared.write(S.cues, S.comments, only, { script: role !== 'review' && role !== 'comment' });
  if (role === 'review') shared.propose(S.cues, only, { link: myShare.link, name: savedName(), who: editorId() });
}
// The caret, after someone else's letters arrive in the text being typed: it stays with the
// letters around it.
function keepCaret(was, now) {
  const [a, b] = [edText.selectionStart, edText.selectionEnd];
  let start = 0;
  while (start < was.length && start < now.length && was[start] === now[start]) start++;
  let end = 0;
  while (end < was.length - start && end < now.length - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end++;
  const move = (p) => p <= start ? p : p >= was.length - end ? p + now.length - was.length : start + (now.length - start - end);
  edText.value = now;
  edText.setSelectionRange(move(a), move(b));
}
// Puts others' changes into the script: blocks by uid, with their comments, and the timeline
// comments. Pickups, readings and selection here stay as they are.
function applyShared(uids, timeline, suggestions = false) {
  if (!uids.length && !timeline) return;
  // Suggestions are for the owner and editors to choose from; a reviewer sees their own.
  if (suggestions && myShare?.role !== 'review') { refreshLive(); return; }
  const incoming = shared.readBlocks(uids);
  if (myShare?.role === 'review') {
    const mine = shared.myProposals(myShare.link);
    for (const uid of uids) {
      if (!mine.has(uid)) continue;
      const p = mine.get(uid), now = incoming.get(uid);
      incoming.set(uid, p ? { ...p, uid, ...(now?.edited ? { edited: now.edited } : {}), ...(now?.comments ? { comments: now.comments } : {}) } : null);
    }
  }
  const at = new Map(S.cues.map((c, i) => [c.uid, i]));
  let one = null, many = false, gone = false;
  for (const [uid, b] of incoming) {
    const i = at.get(uid);
    if (!b) { gone ||= i != null; continue; }
    if (i == null) { S.cues.push(revive(b)); many = true; continue; }
    const c = S.cues[i], was = c.text;
    c.text = b.text;
    for (const k of sharedLib.SHARED_FIELDS) if (k in b) c[k] = b[k]; else delete c[k];
    if (b.comments) c.comments = b.comments; else delete c.comments;
    if (edit?.id === c.id && document.activeElement === edText && was !== c.text) keepCaret(was, c.text);
    if (one == null) one = c.id; else many = true;
  }
  let lostSel = false;
  if (gone) for (let i = S.cues.length - 1; i >= 0; i--) {
    const c = S.cues[i];
    if (!incoming.has(c.uid) || incoming.get(c.uid)) continue;
    if (edit?.id === c.id) { edit = null; edText.blur(); }
    lostSel ||= c.id === S.sel;
    S.cues.splice(i, 1);
  }
  if (timeline) S.comments = shared.readTimeline();
  sharedIn = new Set(uids);
  try { changed(gone || many || timeline || one == null ? null : one); } finally { sharedIn = null; }
  if (lostSel) select(null, { seek: false });
  if (!suggestions) refreshLive();
}
// Reviewers' suggestions, in Pending review for the owner and editors, as they come.
const LIVE = { name: 'Suggestions', live: true };
let liveCount = 0;
const blockBody = (c) => Object.fromEntries(['text', ...sharedLib.SHARED_FIELDS].filter((k) => k !== 'edited' && c[k] !== undefined && c[k] !== null && c[k] !== false).map((k) => [k, c[k]]));
function endLive() { if (livePending(LIVE, [])) liveCount = 0; }
function refreshLive() {
  if (!shared || !myShare || (myShare.role !== 'owner' && myShare.role !== 'edit')) return;
  const at = new Map(S.cues.map((c) => [c.uid, c]));
  const items = shared.readProposals().map((p) => {
    const c = at.get(p.uid), ours = c ? blockBody(c) : null;
    const theirs = p.block ? { ...p.block, edited: { by: p.name || 'a reviewer', suggested: true } } : null;
    return { kind: 'block', uid: p.uid, conflict: false, start: Math.min(c?.start ?? Infinity, p.block?.start ?? Infinity), ours, theirs, name: p.name };
  }).filter((i) => (i.ours || i.theirs) && JSON.stringify(i.ours) !== JSON.stringify(i.theirs && blockBody(i.theirs)))
    .sort((a, z) => a.start - z.start);
  if (!livePending(LIVE, items)) return;
  if (items.length > liveCount) {
    const names = [...new Set(items.map((i) => i.name).filter(Boolean))];
    toast(`${names.length === 1 ? names[0] : 'Reviewers'} suggested ${items.length === 1 ? 'a block change' : items.length + ' block changes'}. See Pending review`);
  }
  liveCount = items.length;
}
// The owner's or an editor's choices: accepted suggestions go into the script, credited to
// whoever suggested them; every suggestion chosen leaves the list, for everyone.
function acceptLive(decisions) {
  const props = new Map(shared.readProposals().map((p) => [p.uid, p])), done = [];
  pushUndo();
  for (const d of decisions) {
    if (d.kind !== 'block') continue;
    done.push(d.uid);
    const p = props.get(d.uid);
    if (!p || d.choice !== 'remote') continue;
    const i = S.cues.findIndex((c) => c.uid === d.uid), block = p.block && { ...p.block, ...(d.edit || {}) };
    if (!block) {
      if (i < 0) continue;
      const c = S.cues[i];
      if (edit?.id === c.id) { edit = null; edText.blur(); }
      if (S.sel === c.id) select(null, { seek: false });
      S.cues.splice(i, 1);
      continue;
    }
    let c = S.cues[i];
    if (!c) { c = revive({ uid: d.uid, ...block }); S.cues.push(c); }
    c.text = block.text;
    for (const k of sharedLib.SHARED_FIELDS) if (k !== 'edited') { if (k in block) c[k] = block[k]; else delete c[k]; }
    const stamp = { by: p.name, at: p.at, who: p.who };
    if (validEditorId(p.who)) c.edited = Object.fromEntries(Object.entries(stamp).filter(([, v]) => v));
    editSigs.set(c.uid, blockSig(c));
  }
  changed();
  shared.clearProposals(done);
  liveCount = 0;
  refreshLive();
  toast('Done. Accepted changes are in the script for everyone');
}
function changed(id = null) {
  noteEdits(id);
  noteShared(id);
  stopPreviousReading();
  S.lastChange = Date.now();
  S.changeGen = (S.changeGen || 0) + 1;
  commentEnd = S.comments.reduce((end, c) => Math.max(end, c.time + 5), 0);
  commentTimes = [...S.comments.filter((c) => !c.resolved).map((c) => c.time), ...S.cues.filter((b) => b.comments?.some((c) => !c.resolved)).map((b) => b.start)].sort((a, b) => a - b);
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
  refreshComments();
  configureQcAudio();
  if (id != null && !sharedIn) { const c = S.cues[idx(id)]; if (c && qc() && !qcLocked()) noteEdit(c); scheduleAutoRewrite(id); }
  S.activeId = undefined; // force overlay/active refresh
  tlDirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
  if (S.dirty) scheduleAutosave();
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      projectId: S.projectId, reviewHistory: S.reviewHistory, reviewAudio: S.reviewId ? null : S.reviewAudio,
      subName: S.subName,
      dirty: S.dirty,
      // The open video, so it can be reopened after a reload, or else the project's.
      projectMedia: S.videoFile ? { name: S.videoFile.name, size: S.videoFile.size } : S.projectMedia,
      notes: S.notes,
      words: S.words,
      comments: S.comments,
      extendedAll: S.extendedAll,
      reviewId: S.reviewId, qcSettings: S.qcSettings, recording: S.recording,
      cues: S.cues.map(({ uid, start, end, text, speed, voice, dip, dipBy, vol, auto, fit, pinned, say, comments, qcReading, pickup, extended, notes, edited }) => ({ uid, start, end, text, speed, voice, dip, dipBy, vol, auto, fit, pinned, say, comments, qcReading, pickup, extended, notes, edited })),
    }));
  } catch { /* storage full or blocked */ }
}
function loadSaved() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY));
    if (o && (o.cues?.length || o.comments?.length || validIdentity(o.projectId))) {
      S.projectId = validIdentity(o.projectId) ? o.projectId : newIdentity();
      S.reviewHistory = cleanReviewHistory(o.reviewHistory);
      S.cues = (o.cues || []).map(revive);
      S.comments = cleanComments(o.comments, true);
      S.reviewId = typeof o.reviewId === 'string' ? o.reviewId : '';
      S.reviewAudio = S.reviewId ? null : cleanReviewAudio(o.reviewAudio);
      S.qcSettings = o.qcSettings && typeof o.qcSettings === 'object' ? o.qcSettings : null;
      S.subName = o.subName || S.subName;
      S.savedDirty = o.dirty !== false;
      S.projectMedia = o.projectMedia || null;
      S.notes = typeof o.notes === 'string' ? o.notes : '';
      S.extendedAll = o.extendedAll === true;
      S.words = cleanWords(o.words);
      S.recording = cleanRecording(o.recording);
      return S.cues.length || S.comments.length;
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
  refreshComments();
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
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
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
  if (qcLocked()) return;
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
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
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
$('edComment').addEventListener('click', () => openBlockComments());
// Pickup: the block goes in the next recording file as one to record again, with a note.
$('edPickup').addEventListener('click', () => {
  const c = selCue();
  if (!c) return;
  pushUndo();
  if (c.pickup) delete c.pickup; else c.pickup = { note: '' };
  changed(c.id);
  updateEditor();
  if (c.pickup) $('edPickupNote').focus();
});
$('edExtended').addEventListener('click', () => {
  const c = selCue();
  if (!c || S.extendedAll) return;
  pushUndo();
  if (c.extended) delete c.extended; else { holdLength(c); c.extended = true; }
  settleExtended(c);
  changed(c.id);
  tlDirty = true;
  toast(`Block #${idx(c.id) + 1} ${c.extended ? 'pauses the video while it’s read' : 'reads over the video again'}`);
});
// An extended block is a short marker, so the length it had by hand is kept for when it
// stops being one. A block that follows its reading goes back to following it.
function holdLength(c) {
  if (!c.auto && c.ownSecs == null) c.ownSecs = c.end - c.start;
}
function settleExtended(c) {
  if (!isExt(c) && c.ownSecs != null) {
    const { hi } = bounds(idx(c.id));
    c.end = clamp(c.start + c.ownSecs, c.start + MIN_DUR, Math.max(hi, c.start + MIN_DUR));
    delete c.ownSecs;
    delete c.auto;
    return;
  }
  adapt(c);
  fitAuto(c);
}
// Extended for the whole project, and how much it adds, shown in the text to speech settings.
function showExtended() {
  $('ttsExtendedAll').setAttribute('aria-pressed', String(S.extendedAll));
  const { secs, blocks, exact } = extendedSecs(S.cues.filter((c) => spoken(c.text)), S.extendedAll, (c) => speechLength(said(c), c.speed, c.voice));
  $('ttsExtendedTotal').textContent = blocks ? `${blocks === 1 ? '1 block pauses' : `${blocks} blocks pause`} the video, adding ${exact ? '' : 'about '}${addedTime(secs)} to the running time.` : '';
  const any = hasExtended();
  $('ttsExtExports').hidden = $('ttsExtVideo').hidden = !any;
  $('ttsMixLonger').hidden = !withPauses() || !tts.ffmpeg;
  $('ttsMixInto').disabled = !tts.ffmpeg || withPauses();
}
$('ttsExtendedAll').addEventListener('click', () => {
  pushUndo();
  if (!S.extendedAll) S.cues.forEach(holdLength);
  S.extendedAll = !S.extendedAll;
  S.cues.forEach(settleExtended);
  changed();
  tlDirty = true;
  updateInd();
  showExtended();
});
$('edPickupNote').addEventListener('focus', () => pushUndo(snapshot(), 'pickupNote'));
$('edPickupNote').addEventListener('input', (e) => {
  const c = selCue();
  if (!c?.pickup) return;
  c.pickup.note = e.target.value;
  changed(c.id);
});
$('edPickupNote').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.target.blur(); } });
// Notes: for the narrator only. Text to speech never reads them, and they leave the timing alone.
edNotes.addEventListener('focus', () => { if (!edNotes.readOnly) pushUndo(snapshot(), 'notes'); });
edNotes.addEventListener('input', () => {
  const c = selCue();
  if (!c || edNotes.readOnly) return;
  if (edNotes.value.trim()) c.notes = edNotes.value; else delete c.notes;
  changed(c.id);
});
edNotes.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (editorKeys(e, edNotes)) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); closeEditor(true); return; }
  fileKeys(e);
});
// A package's Piper blocks have no saved audio: this computer reads them.
const liveRead = (c) => liveBlock(S.review, c, reviewSettings());
const liveVoiceOf = (c) => c.voice || reviewSettings().ttsVoice;
const liveVoiceHere = (c) => reviewVoices().some((v) => v.id === liveVoiceOf(c));
function stopPreviousReading() {
  if (!S.previousAudio) return;
  S.previousAudio.audio.pause(); URL.revokeObjectURL(S.previousAudio.url); S.previousAudio = null;
  $('qcPrevious').textContent = 'Hear previous reading';
  $('qcPrevious').setAttribute('aria-pressed', 'false');
}
// Makes the new reading of a QC block's changed wording or speed and saves it in the
// package. Returns it, or null when the block changed again meanwhile. The reviewer's own
// key goes first; if it fails, the writer's key in the package reads it instead.
async function makeRewrite(block) {
  const review = S.review, reviewId = S.reviewId;
  const spec = rewriteSpec(review, block, reviewSettings());
  if (!spec) return null;
  const captured = { ...block, say: block.say?.map((p) => [...p]) }, project = projectData();
  let fellBack = false;
  const made = await reviewedRewrite(spec, bundledFor(review.reviewAccess, spec.voice), () => {
    const current = S.cues.find((b) => b.id === block.id), currentSpec = current && rewriteSpec(S.review, current, reviewSettings());
    fellBack = qc() && S.review === review && S.reviewId === reviewId && !!currentSpec && speechKey(currentSpec) === speechKey(spec);
    return fellBack;
  });
  if (S.review !== review || S.reviewId !== reviewId) return null;
  const next = await appendRewrite(review, project, captured, made);
  if (S.review !== review || S.reviewId !== reviewId) return null;
  S.review = next;
  const kept = await storedReview({ id: reviewId, file: next.file });
  if (S.review !== next || S.reviewId !== reviewId) return null;
  changed();
  if (fellBack) toast(`Your ${keyName(spec.voice)} key didn’t work, so the writer’s key read block #${idx(block.id) + 1}`);
  else if (!kept) toast('Reading ready. Save the QC package to keep it');
  const current = S.cues.find((b) => b.id === block.id), currentSpec = current && rewriteSpec(next, current, reviewSettings());
  if (!currentSpec || speechKey(currentSpec) !== speechKey(spec)) return null;
  return playbackReading(next, current, reviewSettings());
}
// A changed Google or Polly block is read once the edit ends, as in Write mode, and its end
// moves to where the new reading finishes. It needs a key for that voice: the reviewer's own,
// or the writer's in the package. The end can still
// be set by hand afterwards: it only follows a reading the first time it's heard.
// Such a block keeps its voice, since a new one would need a fresh package. The list
// stays for a block whose voice was already changed, so it can be changed back. A block
// added in review reads with the package's voice, so it has no list either.
function voiceFixed(c) {
  if (!qc() || !S.review) return false;
  const previous = previousReading(S.review, c), voice = previous?.voice || c.voice || reviewSettings().ttsVoice;
  if (!autoRewrites(voice)) return false;
  if (previous) return rereads(previous.voice) && !readingVoiceChanged(S.review, c, reviewSettings());
  return !!S.review.byUid?.size && !!S.review.rereadVoices?.has(voice);
}
function autoRewrites(voice) { return qc() && !!S.reviewId && qcEditable() && canReread(voice, S.review?.reviewAccess); }
// Whether any of the package's voices can make new readings here.
const packageRereads = () => [...(S.review?.rereadVoices || [])].some((v) => canReread(v, S.review.reviewAccess));
// Edits in QC can change a block's reading: a new reading, or back to the original.
function scheduleAutoRewrite(id) {
  if (!qc() || qcLocked() || !S.review) return;
  if (autoMaking.has(id)) { autoAgain.add(id); return; }
  clearTimeout(autoTimers.get(id));
  autoTimers.set(id, setTimeout(() => { autoTimers.delete(id); autoRewrite(id); }, 500));
}
async function autoRewrite(id) {
  const block = S.cues.find((b) => b.id === id), reviewId = S.reviewId;
  // A block being typed in is read when the typing ends, since every reading is counted.
  if (!qc() || qcLocked() || !S.review || !block || edit?.id === id || autoMaking.has(id)) return;
  let r = playbackReading(S.review, block, reviewSettings());
  const spec = !r && rewriteSpec(S.review, block, reviewSettings());
  if (spec && autoRewrites(spec.voice)) {
    autoMaking.add(id); updateEditor();
    try { r = await makeRewrite(block); }
    catch (error) { if (S.reviewId === reviewId) toast(`Block #${idx(id) + 1}: ${error.message}`); }
    finally {
      autoMaking.delete(id); updateEditor(); refreshQc();
      // Changed again while it was being read: read the latest.
      if (autoAgain.delete(id)) scheduleAutoRewrite(id);
    }
  }
  if (!r) return;
  const review = S.review, secs = await voiceSecs(review, r), c = S.cues.find((b) => b.id === id);
  if (!c || S.review !== review || playbackReading(review, c, reviewSettings()) !== r || !fitQc(c, secs)) return;
  changed(c.id);
  if (c.end < c.start + secs - 0.05) toast(`Block #${idx(id) + 1}: the reading takes ${secs.toFixed(1)} s, but the next block starts first, so the end stops there`);
}
// Where the voice stops in a packaged reading. Packages made before 0.73.4 give the whole
// file's length, with the silence at its end, so that's read from the audio, once.
const voiceEnds = new WeakMap();
async function voiceSecs(review, r) {
  if (!voiceEnds.has(r)) {
    let secs = r.secs;
    try { secs = readWav(await review.file.slice(r.offset, r.offset + r.bytes).arrayBuffer()).secs; } catch { /* the stated length */ }
    voiceEnds.set(r, Math.min(secs, r.secs));
  }
  return voiceEnds.get(r);
}
// In QC, as in Write mode, a block marked auto ends where its reading finishes. New words
// or a new speed mark it; setting its end by hand unmarks it.
function speechOf(c) { return JSON.stringify([said(c), c.speed || 1, c.voice || reviewSettings().ttsVoice]); }
function noteSpeech() { if (qc()) for (const c of S.cues) if (!fitFor.has(c)) fitFor.set(c, speechOf(c)); }
function noteEdit(c) {
  const key = speechOf(c), was = fitFor.get(c);
  fitFor.set(c, key);
  if (was === key || (was == null && previousReading(S.review, c))) return; // a block added in review has no reading yet
  c.auto = true;
  edited.add(c);
}
function fitQc(c, secs) {
  if (!c.auto || qcLocked() || isExt(c)) return false;
  const i = idx(c.id);
  if (i < 0) return false;
  const { hi } = bounds(i);
  const end = clamp(c.start + secs, c.start + MIN_DUR, Math.max(hi, c.start + MIN_DUR));
  if (Math.abs(end - c.end) < 0.0005) return false;
  c.end = end;
  return true;
}
// On opening a package, or coming to QC: blocks with new readings that don't end where
// those finish, such as ones saved by earlier versions. The writer's own readings keep
// the writer's timings.
async function fitQcAll() {
  const review = S.review;
  if (!qc() || qcLocked() || !review) return;
  let any = false;
  for (const c of [...S.cues]) {
    const r = c.auto && playbackReading(review, c, reviewSettings());
    if (!r || r === previousReading(review, c)) continue;
    const secs = await voiceSecs(review, r);
    if (S.review === review && S.cues.includes(c) && playbackReading(review, c, reviewSettings()) === r && fitQc(c, secs)) any = true;
  }
  if (any) changed();
}
$('qcPrevious').addEventListener('click', () => {
  const c = selCue(), r = c && previousReading(S.review, c);
  if (!qc() || !r) return;
  if (S.previousAudio?.kind === 'original') { stopPreviousReading(); return; }
  pause(); stopSpeech(); stopPreviousReading();
  const url = URL.createObjectURL(S.review.file.slice(r.offset, r.offset + r.bytes, 'audio/wav'));
  const audio = new Audio(url); S.previousAudio = { audio, url, kind: 'original' };
  $('qcPrevious').textContent = 'Stop previous reading'; $('qcPrevious').setAttribute('aria-pressed', 'true');
  audio.onended = () => { if (S.previousAudio?.audio === audio) stopPreviousReading(); };
  audio.onerror = () => { if (S.previousAudio?.audio === audio) { stopPreviousReading(); toast('The previous reading could not play'); } };
  audio.play().catch(() => { stopPreviousReading(); toast('The previous reading could not play'); });
  toast('Previous reading only: it does not match the edited block. Programme playback is paused');
});
$('edDel').addEventListener('click', (e) => { e.currentTarget.blur(); del(); });

function newCue() {
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
  const t = now();
  const covering = cueAt(t);
  if (covering) {
    select(covering.id, { seek: false });
    return toast(`Playhead is inside cue #${idx(covering.id) + 1}`);
  }
  const next = S.cues.find((c) => c.start > t);
  const end = Math.min(t + DEFAULT_LEN, next ? next.start : Infinity);
  if (end - t < MIN_DUR) return toast('No room for a cue here');
  return addBlock(t, end);
}

function addBlock(start, end) {
  pushUndo();
  const c = mk(start, end);
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
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
  const c = needSel(); if (!c) return;
  const t = now();
  if (t <= c.start + MIN_DUR || t >= c.end - MIN_DUR) return toast('Move the playhead inside the selected cue to split');
  pushUndo();
  const [a, b] = splitText(c.text);
  // The second half reads as the first did: same voice, volume, dip and chosen speed.
  const c2 = Object.assign(mk(t, c.end, b, c.speed), c.voice ? { voice: c.voice } : {}, blockDipOf(c),
    isVol(c.vol) ? { vol: c.vol } : {}, c.pinned ? { pinned: true } : {});
  if (c.extended) c2.extended = true;
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
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
  const c = needSel(); if (!c) return;
  const i = selIdx(), n = S.cues[i + 1];
  if (!n) return toast('No next cue to merge with');
  pushUndo();
  c.end = Math.max(c.end, n.end);
  c.text = [c.text, n.text].filter(Boolean).join('\n');
  const words = new Set((c.say || []).map(([w]) => w.toLocaleLowerCase()));
  const more = (n.say || []).filter(([w]) => !words.has(w.toLocaleLowerCase()));
  if (n.comments?.length) c.comments = [...(c.comments || []), ...n.comments];
  if (n.notes) c.notes = [c.notes, n.notes].filter(Boolean).join('\n');
  if (n.extended) c.extended = true;
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
  if (qcLocked()) return;
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
  // Record mode: the block is locked, but with Alt on its text box holds the narrator's wording.
  const rec = S.mode === 'record', alt = rec && !!recorder?.side;
  edText.readOnly = rec ? !alt : qcLocked();
  edStart.readOnly = rec || qcLocked();
  edText.placeholder = alt ? 'Your wording for this block. ↵ when done, then ↵ or R to record it' : TEXT_HINT;
  edText.setAttribute('aria-label', alt ? 'Alt wording' : 'Block text');
  if (rec) recorder?.render();
  edTts.hidden = !(c && readingControls());
  $('edPickup').setAttribute('aria-pressed', String(!!c?.pickup));
  const edExt = $('edExtended');
  edExt.hidden = !c || !ttsOn();
  edExt.disabled = S.extendedAll;
  edExt.setAttribute('aria-pressed', String(!!c && isExt(c)));
  $('edPickupNote').hidden = !c?.pickup;
  if (c?.pickup && document.activeElement !== $('edPickupNote')) $('edPickupNote').value = c.pickup.note || '';
  edNotes.readOnly = qcLocked() || rec;
  if (document.activeElement !== edNotes) edNotes.value = c?.notes || '';
  // QC and Record can read the notes but not change them, so an empty box would only be in the way.
  edNotes.hidden = (qcLocked() || rec) && !c?.notes;
  if (!c) {
    edSpeedWrap.hidden = true;
    edVoiceWrap.hidden = true;
    edDipWrap.hidden = true;
    edVolWrap.hidden = true;
    edAuto.hidden = true;
    edIdx.textContent = '#–';
    if (document.activeElement !== edStart) edStart.value = '';
    if (document.activeElement !== edEnd) edEnd.value = '';
    edDur.textContent = '';
    edClash.hidden = true;
    edStats.textContent = '';
    if (!edit) edText.value = '';
    return;
  }
  const i = selIdx();
  edIdx.textContent = `#${i + 1}`;
  if (document.activeElement !== edStart) edStart.value = tc(c.start);
  if (document.activeElement !== edEnd) edEnd.value = tc(c.end);
  // The end comes from the reading with text to speech on.
  edEnd.readOnly = rec || qcLocked() || following(c);
  if (edEnd.readOnly) edEnd.dataset.tip = rec ? 'The script is locked in Record mode' : qc() ? 'The script and timings are fixed in QC mode' : isExt(c) ? extendedTip : 'Where the reading ends. Change the block’s speed to move it'; else delete edEnd.dataset.tip;
  edAuto.hidden = !(c.auto && ttsOn());
  edDur.textContent = `${(c.end - c.start).toFixed(3)} s`;
  edSpeedWrap.hidden = !readingControls();
  edVoiceWrap.hidden = !readingControls() || voiceFixed(c);
  if (readingControls() && document.activeElement !== edVoice) fillEdVoice(c);
  edDipWrap.hidden = !(ttsOn() && tts.duck);
  if (!edDipWrap.hidden && document.activeElement !== edDip && document.activeElement !== edDipCustom) fillEdDip(c);
  edVolWrap.hidden = !ttsOn();
  if (ttsOn()) fillEdVol(c);
  const custom = c.speed && !isSpeed(c.speed);
  edSpeedCustom.hidden = !custom;
  edSpeedCustom.textContent = custom ? speedName(c.speed) + (c.fit ? ', fits the block' : '') : 'custom';
  if (document.activeElement !== edSpeed) edSpeed.value = custom ? 'custom' : String(c.speed || 1);
  if (rec) { if (document.activeElement !== edText) edText.value = alt ? recorder.altText(i) : c.text; }
  else if (!edit || edit.id !== c.id) edText.value = c.text;
  edStats.textContent = '';
  // A shared project shows it from the start: others are working on it.
  const editedBy = editedLine(c.edited, myShare ? Math.max(editors, 2) : editors);
  $('edEdited').textContent = editedBy; $('edEdited').hidden = !editedBy;
  $('qcPrevious').hidden = true;
  $('qcBlockInfo').textContent = '';
  if (qc()) {
    const r = playbackReading(S.review, c, reviewSettings()), previous = previousReading(S.review, c);
    $('qcPrevious').hidden = r === previous || !previous;
    const live = liveRead(c), newVoice = !live && !r && !!previous && readingVoiceChanged(S.review, c, reviewSettings());
    if (newVoice) $('qcBlockInfo').dataset.tip = 'A different voice can’t make new audio in QC. Ask the writer for a fresh package to hear it, or change the voice back';
    else delete $('qcBlockInfo').dataset.tip;
    const unread = !r && rewriteSpec(S.review, c, reviewSettings());
    $('qcBlockInfo').textContent = live && S.qcSource === 'package' ? (liveVoiceHere(c) ? `Read here with ${voiceLabel(liveVoiceOf(c))}` : `Needs ${voiceLabel(liveVoiceOf(c))}`)
      : newVoice ? 'New voice · needs a fresh package' : autoMaking.has(c.id) ? 'Making reading…'
      : unread && !autoRewrites(unread.voice) ? `Needs ${keyName(unread.voice) === 'AWS' ? 'an AWS' : 'a Google'} key` : !r && previous ? 'Original reading out of date'
      : S.qcSource === 'package' ? (r ? `${r === previous ? 'Original' : 'New reading'} ${(voiceEnds.get(r) ?? r.secs).toFixed(1)} s${isExt(c) ? ' · pauses the video' : (voiceEnds.get(r) ?? r.secs) > c.end - c.start + 0.05 ? ' · runs past block' : ''}`
          : previous || !S.review?.byUid?.size ? 'Original reading missing' : rewriteSpec(S.review, c, reviewSettings()) ? 'New block · not read yet' : 'New block · no reading')
        : S.qcSource === 'preview' ? 'Approximate TTS preview' : 'Programme sound';
  }
  if (ttsOn() && spoken(c.text)) {
    // How long the voice takes to read it: "~" until it has actually been read.
    const { secs, exact } = speechLength(said(c), c.speed, c.voice);
    const s = document.createElement('span');
    const ext = isExt(c), tooLong = !ext && secs > c.end - c.start + 0.05;
    s.textContent = `TTS ${exact ? '' : '~'}${secs.toFixed(1)} s${ext ? ' · pauses the video' : tooLong ? ' · too long' : ''}`;
    s.className = 'tts ' + (tooLong ? 'bad' : '');
    edStats.append(s);
    if (!exact) schedulePrefetch(c);
  } else if (ttsOn() && onlyNotes(c.text)) {
    const s = document.createElement('span');
    s.textContent = 'TTS: notes only';
    s.className = 'dim';
    edStats.append(s);
  }
  const clash = overDialogue(c);
  edClash.hidden = !clash;
  edClash.textContent = clash ? `${clash.toFixed(1)} s over dialogue` : '';
}

// With a Piper or Google voice, make the selected block's reading once typing pauses, so its
// length is exact rather than estimated. Google counts every reading, so with a Google voice
// a block being typed in is only read when the editing ends (see the blur handler).
let prefetchTimer = 0;
function schedulePrefetch(c) {
  clearTimeout(prefetchTimer);
  if (edit?.id === c.id && cloudOf(c.voice)) return;
  const text = said(c), { speed, voice } = c;
  prefetchTimer = setTimeout(() => prefetch(text, speed, voice), 500);
}

// Frazier "Enter": edit the block under the playhead, or create one there.
function createOrEdit() {
  const c = leadingTo() || cueAt(now()) || newCue();
  if (!c) return;
  select(c.id, { seek: false });
  editText();
}

function editText(field = edText) {
  if (!selCue()) return toast('No text block selected — press Enter to create one at the playhead');
  openEditor();
  field.focus();
  if (field === edText || field === edNotes) field.setSelectionRange(field.value.length, field.value.length);
  else field.select();
}

// finished: closed with Esc or ↵, rather than by opening something else.
function closeEditor(finished = false) {
  document.activeElement?.blur();
  if (finished) { edOpen = false; placeEditor(); }
  if (S.loopOnce) stopLoop();
  // With Replay on, the playhead goes back to the block just edited, or its lead-in, so it
  // can be heard again, and playback carries on from there if it was playing. A block
  // clicked open gets its playhead now, whether Replay is on or not.
  if (finished) {
    const c = selCue(), clicked = !!c && seekOnClose === c.id;
    if (clicked) S.playUntil = null;
    const go = c ? afterEdit(S.replay, clicked) : null;
    if (go === 'heard') leadBefore(c, seek);
    else if (go === 'start') seek(c.start);
    seekOnClose = null;
  }
  if (S.resumeAfterEdit) {
    S.resumeAfterEdit = false;
    play();
  }
}

function setReturnToStart(on) {
  S.returnToStart = on;
  try { localStorage.setItem('scribecue.returnToStart', on ? '1' : '0'); } catch { /* ignore */ }
  $('setReturn').setAttribute('aria-pressed', String(on));
  updateInd();
}

function setReplay(on, quiet = false) {
  S.replay = on;
  try { localStorage.setItem('scribecue.replay', on ? '1' : '0'); } catch { /* ignore */ }
  updateInd();
  if (!quiet) toast(on ? 'Replay on: Esc or ↵ after editing a block goes back to its start' : 'Replay off: the playhead stays put, unless you clicked the block to open it');
}

function setLead(v) {
  S.lead = cleanLead(v);
  $('setLead').value = S.lead;
  try { localStorage.setItem('scribecue.lead', String(S.lead)); } catch { /* ignore */ }
  updateInd();
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
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
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
const FIELDS = [edText, edStart, edEnd, edNotes];
function editorKeys(e, field) {
  const mod = e.metaKey || e.ctrlKey, os = e.altKey && e.shiftKey;
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); return true; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const fields = FIELDS.filter((f) => f.offsetParent), i = fields.indexOf(field);
    editText(fields[(i + (e.shiftKey ? fields.length - 1 : 1)) % fields.length]);
    return true;
  }
  if (qcLocked() && ((os && ['ArrowLeft', 'ArrowRight', 'KeyD'].includes(e.code)) || (mod && ['b','i','u','z','y'].includes(e.key.toLowerCase())))) { e.preventDefault(); return true; }
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
for (const f of FIELDS) {
  f.addEventListener('blur', () => setTimeout(() => {
    if (FIELDS.includes(document.activeElement)) return;
    S.resumeAfterEdit = false;
    if (S.loopOnce) stopLoop();
  }));
}

// In Record mode a locked field gives the focus straight back, so Enter and R still record.
for (const f of [edText, edStart, edEnd, edNotes]) f.addEventListener('focus', () => { if (S.mode === 'record' && f.readOnly) f.blur(); });
edText.addEventListener('focus', () => {
  const c = selCue();
  if (qcLocked() || S.mode === 'record') return;
  if (!c) { edText.blur(); return; }
  edit = { id: c.id, orig: c.text, pushed: false };
  editor.classList.add('editing');
});
edText.addEventListener('input', () => {
  if (S.mode === 'record') { if (recorder.side) recorder.setAltText(selIdx(), edText.value); return; }
  if (qcLocked()) { updateEditor(); return; }
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
  editor.classList.remove('editing');
  updateEditor();
  // The block just edited, even when another one is now selected: with a Google voice,
  // this is when it's read.
  if (was && ttsOn() && spoken(was.text)) prefetch(said(was), was.speed, was.voice);
  if (was) scheduleAutoRewrite(was.id);
});
edText.addEventListener('keydown', (e) => {
  e.stopPropagation();
  // The alt's wording: Enter and Esc go back to the keys, so Enter records it next.
  if (S.mode === 'record') {
    if (e.key === 'Escape' && recorder.active) recorder.finish(true);
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); edText.blur(); }
    else if (e.key === 'Tab') e.preventDefault();
    return;
  }
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
    if (qcLocked()) { updateEditorTimes(); return; }
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
    editor.classList.add('editing');
  });
  input.addEventListener('blur', () => { if (!FIELDS.includes(document.activeElement)) editor.classList.remove('editing'); });
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
  S.cues.forEach((c, i) => { const r = rowMap.get(c.id); if (r) fillRow(r, c, i); });
  showFilter();
}
function showFilter() {
  const n = query ? S.cues.reduce((k, c, i) => k + (matches(c, i) ? 1 : 0), 0) : S.cues.length;
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

// In a long script, waits for a pause in the typing rather than searching at every key.
let searchTimer = 0;
listSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const go = () => { query = listSearch.value.trim().toLowerCase(); applyFilter(); };
  if (S.cues.length > 300) searchTimer = setTimeout(go, 150); else go();
});
listSearch.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    if (recorder.active) recorder.finish(true);
    clearTimeout(searchTimer);
    if (listSearch.value || query) { listSearch.value = ''; query = ''; applyFilter(); }
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
  // Filtered out: it's filled in when it next shows.
  if (!matches(c, i)) { r.hidden = true; r.dataset.was = ''; return; }
  const [n, t, d] = r.children[0].children, tx = r.children[1];
  const times = `${tc(c.start)} – ${tc(c.end)}`;
  let dur = `${(c.end - c.start).toFixed(2)} s` + (ttsOn() && c.speed ? ` · TTS ${isSpeed(c.speed) ? '' : 'custom '}${speedLabel(c.speed)}` : '')
    + (ttsOn() && c.voice ? ` · ${blockVoiceName(c.voice)}` : '');
  // Red when the reading is longer than the block, with a sign for anyone who can't tell red.
  const reading = ttsOn() && !!spoken(c.text) ? speechLength(said(c), c.speed, c.voice) : null;
  const ext = isExt(c) && S.mode !== 'transcribe';
  const over = !ext && !!reading && reading.secs > c.end - c.start + 0.05;
  if (over) dur += ' ⚠';
  if (ext) dur += reading ? ` · pauses ${reading.exact ? '' : '~'}${reading.secs.toFixed(1)} s` : ' · extended';
  if (c.notes) dur += ' · notes';
  if (c.pickup) dur += ' · pickup';
  const clash = overDialogue(c) > 0;
  const ready = !!reading?.exact;
  // Unchanged rows are left alone: long jobs refresh the list often, and rewriting every
  // row each time made the browser lay it all out again.
  const was = `${i}|${times}|${dur}|${clash}|${ready}|${query}|${c.text}`;
  if (r.dataset.was === was) return;
  r.dataset.was = was;
  n.textContent = i + 1;
  t.textContent = times;
  d.textContent = dur;
  d.classList.toggle('over', over);
  if (clash) d.append(Object.assign(document.createElement('span'), { className: 'clash', textContent: ' · over dialogue' }));
  // A dot when the reading has been made, at this voice and speed. Piper, Kokoro and Google
  // readings are kept in the browser, so they play straight away, even after a reload.
  if (ready) {
    d.append(Object.assign(document.createElement('span'), { className: 'ready', textContent: ' ●',
      title: cloudOf(c.voice) ? `Reading kept: plays straight away, and isn't sent to ${cloudOf(c.voice)} again`
        : usingAudioVoice(c.voice) ? 'Reading kept: its length is exact, and it plays straight away' : 'Reading made: its length is exact' }));
  }
  r.setAttribute('aria-label', blockLabel({ n: i + 1, start: tc(c.start), secs: (c.end - c.start).toFixed(2), text: c.text, tooLong: over, overDialogue: clash, ready, extended: ext }) + (c.notes ? ', has notes' : '') + (c.pickup ? ', pickup' : ''));
  fillText(tx, c);
  tx.classList.toggle('blank', !c.text);
  r.hidden = false;
}

// Refreshes the rows in place when the blocks are the same ones in the same order, as
// when readings arrive; otherwise brings the list up to date.
function refreshList() {
  const same = S.cues.length === rowMap.size && S.cues.every((c, i) => { const r = rowMap.get(c.id); return r && rowOrder.get(r) === i; });
  if (!same) return renderList();
  S.cues.forEach((c, i) => fillRow(rowMap.get(c.id), c, i));
}

function newRow(c) {
  const r = document.createElement('div');
  r.className = 'row';
  r.dataset.id = c.id;
  r.id = `blk-${c.id}`;
  r.setAttribute('role', 'option');
  r.innerHTML = '<div class="rh"><span class="n"></span><span class="t"></span><span class="d"></span>' +
    // Only for the mouse: from the keyboard, Delete does it, so screen readers skip it.
    '<span class="rowdel" aria-hidden="true" data-tip="Delete this block (Del). Ctrl/Cmd+Z brings it back">×</span></div>' +
    '<div class="tx"></div>';
  return r;
}

// Brings the rows up to date with the blocks. Rows are kept and only those that changed
// are touched: building thousands again froze the page at every undo or new block.
const rowOrder = new WeakMap(); // row -> its place in the list
function renderList() {
  for (const el of [...list.children]) if (el !== editor && !el.classList.contains('row')) el.remove();
  const wanted = new Set(S.cues.map((c) => c.id));
  for (const [id, r] of rowMap) if (!wanted.has(id)) { r.remove(); rowMap.delete(id); }
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
  // The editor stays where it is, so typing in it isn't interrupted; placeEditor then
  // puts it back between the right rows.
  let at = list.firstElementChild;
  const next = () => { while (at === editor) at = at.nextElementSibling; };
  next();
  S.cues.forEach((c, i) => {
    let r = rowMap.get(c.id);
    if (!r) { r = newRow(c); rowMap.set(c.id, r); }
    fillRow(r, c, i);
    rowOrder.set(r, i);
    r.classList.toggle('sel', c.id === S.sel);
    r.setAttribute('aria-selected', String(c.id === S.sel));
    r.classList.toggle('active', c.id === S.activeId);
    if (r === at) { at = at.nextElementSibling; next(); }
    else list.insertBefore(r, at);
  });
  if (rowMap.has(S.sel)) list.setAttribute('aria-activedescendant', `blk-${S.sel}`);
  placeEditor();
  showFilter();
  tlDirty = true;
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
  // Record mode always shows the selected block open, locked, with its Original | Alt switch.
  editor.hidden = !(edOpen || S.mode === 'record') || i < 0 || !rowMap.has(S.sel);
  if (editor.hidden) return;
  // The rows are in order, so how many are above the editor is found by halving, and only
  // the rows between there and the selected block move.
  const row = (k) => rowMap.get(S.cues[k].id);
  const above = (r) => r.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING;
  let lo = 0, hi = S.cues.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (above(row(m))) lo = m + 1; else hi = m; }
  for (let k = lo; k <= i; k++) list.insertBefore(row(k), editor);
  for (let k = lo - 1; k > i; k--) editor.after(row(k));
}

list.addEventListener('click', (e) => {
  const r = e.target.closest('.row');
  if (!r) return;
  if (qcLocked()) { select(+r.dataset.id, { toTop: false }); openEditor(); return; }
  if (S.mode === 'record') { select(+r.dataset.id, { toTop: false }); return; } // the script is locked
  if (e.target.closest('.rowdel')) { e.target.blur(); del(S.cues[idx(+r.dataset.id)]); return; }
  // One click opens the block, ready to type, as in Frazier. The playhead stays where it
  // is while typing, and goes to the block when it's closed.
  const id = +r.dataset.id;
  select(id, { seek: false, toTop: false });
  seekOnClose = id;
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
  if (qc()) return;
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
  const [w, h] = box(cv), dpr = devicePixelRatio || 1;
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

// How much of the programme the timeline shows, for the zoom controls: "0.85 s", "12.0 s", "2:30 min".
function spanLabel(secs) {
  if (secs < 10) return `${secs.toFixed(2)} s`;
  if (secs < 60) return `${secs.toFixed(1)} s`;
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return s === 60 ? `${m + 1}:00 min` : `${m}:${String(s).padStart(2, '0')} min`;
}
const zoomEl = { span: $('tlZoomSpan'), in: $('tlZoom').querySelector('[data-zoom=in]'), out: $('tlZoom').querySelector('[data-zoom=out]'), take: $('tlZoom').querySelector('[data-zoom=take]') };
function drawTimeline() {
  tlDirty = false;
  const pps = S.pps, t0 = S.view;
  zoomEl.span.textContent = spanLabel(visSec());
  zoomEl.in.disabled = pps >= MAX_PPS - 1e-6;
  zoomEl.out.disabled = pps <= minPps() + 1e-6;
  zoomEl.take.setAttribute('aria-pressed', String(!!takeZoom));
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

  // Open comments mark the ruler; nearby comments share a mark.
  rc.fillStyle = C.accent;
  let lastCommentX = -10;
  for (const time of canComment() ? commentTimes : []) {
    if (time < t0) continue;
    const x = Math.round((time - t0) * pps);
    if (x > rw) break;
    if (x - lastCommentX < 6) continue;
    rc.fillRect(x, 1, 4, 4); lastCommentX = x;
  }

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
    // Zoomed in past the built waveform, a close-up of the stretch on screen is read in a
    // worker, and drawn where it covers; the built waveform fills in until it's there.
    if (pps > CLOSE_AT) wantCloseUp(t0, t0 + ww / pps);
    const D = pps > CLOSE_AT && closeUp?.file === S.videoFile && closeUp.track === S.track ? closeUp : null;
    wc.fillStyle = C.wave;
    for (let x = 0; x < ww; x++) {
      if (D) {
        const a = Math.floor((t0 + x / pps - D.from) * CLOSE_RATE), b = Math.max(a + 1, Math.floor((t0 + (x + 1) / pps - D.from) * CLOSE_RATE));
        if (a >= 0 && b <= D.data.length) {
          let m = 0;
          for (let i = a; i < b; i++) if (D.data[i] > m) m = D.data[i];
          if (m) { const h = Math.max(0.5, Math.pow(Math.min(1, m * inv), 0.7) * amp); wc.fillRect(x, mid - h, 1, h * 2); }
          continue;
        }
      }
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
  drawDialogueLane();
  if (S.mode === 'record' && recorder) recorder.drawTrack(...fitCanvas(takeWave), t0, pps);
  drawOverview();
}

const cueEls = new Map();
let ghostEl = null;
const EXT_MARK = 30; // how wide an extended block's marker is, in pixels: room for its number
function drawCues(W) {
  const t0 = S.view, t1 = t0 + W / S.pps;
  const seen = new Set(), ghost = pendingGhost();
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
    const ext = isExt(c) && (writing() || qc());
    const x = (c.start - t0) * S.pps, w = Math.max(ext ? EXT_MARK : 2, (c.end - c.start) * S.pps);
    el.style.left = x + 'px';
    el.style.width = w + 'px';
    el.classList.toggle('narrow', w < 36);
    el.classList.toggle('locked', following(c));
    el.classList.toggle('extended', ext);
    el.classList.toggle('sel', c.id === S.sel);
    el.classList.toggle('active', c.id === S.activeId);
    el.classList.toggle('faded', !matches(c, i));
    el.classList.toggle('changing', !!ghost?.theirs && c.uid === ghost.uid);
    el.classList.toggle('removing', !!ghost?.removed && c.uid === ghost.uid);
    // Too narrow to show, and a long film zoomed out draws thousands of these.
    el.classList.toggle('clash', w >= 8 && overDialogue(c) > 0);
    el.children[1].textContent = w >= EXT_MARK ? '#' + (i + 1) + (ttsOn() && c.speed && w > 70 ? ` · ${speedLabel(c.speed)}` : '') + (canComment() && c.comments?.some((n) => !n.resolved) ? ' · ●' : '') : '';
    if (el._text !== c.text) { el._text = c.text; el.children[2].textContent = c.text; }
  }
  for (const [id, el] of cueEls) if (!seen.has(id)) { el.remove(); cueEls.delete(id); }
  // The reviewer's version of the block chosen in Pending review, where it would go.
  const g = ghost?.theirs;
  if (g && g.end >= t0 && g.start <= t1) {
    if (!ghostEl) {
      ghostEl = document.createElement('div'); ghostEl.className = 'cue ghost';
      ghostEl.innerHTML = '<span class="ci"></span><span class="ct"></span>';
    }
    ghostEl.children[0].textContent = g.edited?.suggested ? 'Suggested' : 'Returned';
    const w = Math.max(2, (g.end - g.start) * S.pps);
    ghostEl.style.left = (g.start - t0) * S.pps + 'px'; ghostEl.style.width = w + 'px';
    ghostEl.classList.toggle('narrow', w < 36); ghostEl.children[1].textContent = g.text;
    if (!ghostEl.isConnected) cuesLayer.append(ghostEl);
  } else ghostEl?.remove();
}

function drawOverview() {
  const d = duration(), W = boxW(overview);
  ovWin.style.left = (S.view / d) * W + 'px';
  ovWin.style.width = Math.min(W, (visSec() / d) * W) + 'px';
}

// ---------------------------------------------------------------- scrubber

// A bar under the video for the whole programme: click or drag to move the playhead.
// Blocks show as marks along it, the selected one in the accent colour. It takes no
// keyboard focus, so the editor's keys keep working; ←/→ and the rest still move.
const scrubEl = $('scrub'), scrubMarks = $('scrubMarks'), scrubTime = $('scrubTime');
let scrubDrawn = '', scrubSec = -1;
// Moved only when it moves a pixel: in a long film that's every few seconds, and each
// move costs a layout and a repaint that a slower computer needs for the video.
let scrubPx = -1;
function placeScrub(t) {
  const d = duration(), f = d > 0 ? clamp(t / d, 0, 1) : 0;
  const px = Math.round(f * boxW(scrubMarks) * (devicePixelRatio || 1));
  if (px !== scrubPx) { scrubPx = px; scrubEl.style.setProperty('--at-f', f); }
  const sec = Math.floor(t);
  if (sec !== scrubSec) {
    scrubSec = sec;
    scrubEl.setAttribute('aria-valuemax', String(Math.round(d)));
    scrubEl.setAttribute('aria-valuenow', String(sec));
    scrubEl.setAttribute('aria-valuetext', tc(t).slice(0, 8));
  }
}
// Drawn again only when the marks change: selecting a block or moving the timeline
// leaves all but one of them where they are.
function drawScrub() {
  const w = boxW(scrubMarks), dpr = devicePixelRatio || 1;
  const drawn = `${w}|${S.changeGen}|${S.sel}|${duration()}|${S.cues.length}`;
  if (!w || drawn === scrubDrawn) return;
  scrubDrawn = drawn;
  scrubMarks.width = Math.round(w * dpr);
  scrubMarks.height = Math.round(6 * dpr);
  const g = scrubMarks.getContext('2d'), d = duration(), k = scrubMarks.width / d;
  g.clearRect(0, 0, scrubMarks.width, scrubMarks.height);
  const mark = (c, color) => {
    g.fillStyle = color;
    g.fillRect(c.start * k, 0, Math.max(dpr, (c.end - c.start) * k), scrubMarks.height);
  };
  for (const c of S.cues) mark(c, C.cue);
  const s = selCue();
  if (s) mark(s, C.accent);
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
  if (scrubEl.hasPointerCapture(e.pointerId)) scrubTo(scrubAt(e));
});
const scrubDone = (e) => {
  scrub.done();
  scrubEl.classList.remove('on');
  if (e.type !== 'pointerup' || !scrubEl.matches(':hover')) scrubTime.hidden = true;
};
scrubEl.addEventListener('pointerup', scrubDone);
scrubEl.addEventListener('pointercancel', scrubDone);
scrubEl.addEventListener('pointerleave', () => { if (!scrubEl.classList.contains('on')) scrubTime.hidden = true; });

function placePlayhead(t) {
  const x = (t - S.view) * S.pps;
  playheadEl.style.display = x < -2 || x > boxW(tl) + 2 ? 'none' : '';
  playheadEl.style.transform = `translateX(${x}px)`;
}

// ---------------------------------------------------------------- timeline interaction

let drag = null;

lane.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (qcLocked()) { const el = e.target.closest('.cue'); if (el) { select(+el.dataset.id); openEditor(); } else seek(xToT(e.clientX)); return; }
  const el = e.target.closest('.cue');
  if (el) {
    const id = +el.dataset.id, i = idx(id), c = S.cues[i];
    if (!c) return;
    if (S.sel !== id) select(id, { seek: false, reveal: false });
    if (S.mode === 'record') return; // the script is locked
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
  if (el) { select(+el.dataset.id, { seek: false, reveal: false }); if (S.mode !== 'record') editText(); }
});

let scrubbing = false;
ruler.addEventListener('pointerdown', (e) => {
  scrubbing = true;
  ruler.setPointerCapture(e.pointerId);
  S.playUntil = null;
  seek(xToT(e.clientX), false);
});
ruler.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(xToT(e.clientX), false); });
ruler.addEventListener('pointerup', () => { scrubbing = false; scrub.done(); });

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
  // With Alt on in Record mode, the narrator reads the alt's wording.
  const text = (S.mode === 'record' && recorder?.altWording(idx(c.id))) || c.text;
  // allow basic <i>/<b>/<u> markup, strip everything else
  span.innerHTML = esc(text.replace(/\{[^}]*\}/g, '')).replace(/&lt;(\/?)([ibu])&gt;/gi, '<$1$2>');
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
  if (a && isPlaying() && S.follow && !S.loop && !edit && !drag && S.sel !== id && !leadingTo(t)) {
    select(id, { seek: false, reveal: false });
  }
}

const IND_TIPS = {
  speed: 'Playback speed. + and - change it; click or press \\ to reset to 1×',
  follow: 'Follow: keep the playhead in view and select each block as it plays (F)',
  loop: 'Loop: keep replaying the selected block. L loops until you finish editing; O leaves it on',
  returnToStart: 'Return to start is on: stopping puts the playhead back where playback began. Click for its settings',
  replay: 'Replay is on: Esc or ↵ after editing a block puts the playhead back at its start (⇧L). Click for its settings',
  extended: 'Extended AD: the video pauses while a block is read, then carries on. Click for its settings',
  lead: 'Lead-in: hearing a block again starts this long before it. Click for its settings',
  offset: 'Reaction offset: blocks marked, and reads timed, with H move back by this much, since you let go a moment late. ⇧H changes it; click for its settings',
  tts: 'Text to speech is on: hear blocks read aloud (V). Click for its settings, such as the voice and speed (⌥⇧V)',
  takes: 'Takes: hear the take chosen for each block as the video plays. Click to turn it off or on',
  qc: 'QC review: choose original readings, programme sound or an approximate TTS preview, or compare a returned review',
  stt: 'Speech to text is on: Whisper types what the narrator says in each block you mark. Click for its settings, or to transcribe empty blocks (⌥⇧H)',
};
function updateInd() {
  const items = [
    ['speed', `${S.rate.toFixed(2)}×`, S.rate !== 1],
    ['follow', 'FOLLOW', S.follow],
    ['loop', 'LOOP', S.loop],
    ...(!qc() ? [['offset', `H −${Math.round(S.offset * 1000)}ms`, false]] : []),
    ...(qc() ? [['qc', S.qcSource === 'package' ? (S.review?.proposals.length ? 'QC · SAVED READINGS' : 'QC · ORIGINAL READINGS') : S.qcSource === 'preview' ? 'QC · APPROXIMATE TTS' : 'QC · PROGRAMME SOUND', true]] : []),
    // Settings show only while they're on, and open their section of Settings.
    ...(extHold ? [['extended', 'EXTENDED · READING', true]] : S.extendedAll && writing() ? [['extended', 'EXTENDED', true]] : []),
    ...(S.replay ? [['replay', 'REPLAY', true]] : []),
    ...(S.lead && S.mode !== 'record' ? [['lead', `LEAD ${S.lead} s`, true]] : []),
    ...(returning() ? [['returnToStart', 'RETURN', true]] : []),
    ...(S.mode === 'transcribe' && stt.on && stt.ready ? [['stt', 'STT', true]] : []),
    ...(S.mode === 'record' ? [['takes', 'TAKES', !!recorder?.hearing]] : []),
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
    if (['follow', 'loop', 'takes'].includes(key)) s.setAttribute('aria-pressed', String(!!on));
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
  play: () => (recorder?.active ? recorder.finish() : togglePlay()),
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
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  // older path for browsers that refuse the async clipboard API
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}
clockEl.addEventListener('click', async (e) => {
  e.currentTarget.blur(); // so Space still plays
  const code = tc(now());
  const ok = await copyText(code);
  toast(ok ? `Copied ${code}` : 'Couldn’t copy: the browser blocked clipboard access');
});
ind.addEventListener('click', (e) => {
  e.target.blur?.(); // so Space still plays
  const k = e.target.dataset.key;
  if (k === 'speed') setRate(1);
  // The settings' labels open their section of Settings.
  else if (k === 'offset' || k === 'stt') showMarking();
  else if (k === 'tts') openTts();
  else if (k === 'qc') openQcPlayback();
  else if (k === 'extended') { if (qc()) openQcPlayback(); else openTts(); }
  else if (k === 'replay' || k === 'lead' || k === 'returnToStart') showGeneral();
  else if (k === 'takes') {
    recorder.setHearing(!recorder.hearing);
    updateInd();
    toast(recorder.hearing ? 'Takes on: the chosen takes play with the video' : 'Takes off');
  }
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
  const c = leadingTo() || cueAt(now()) || selCue();
  if (!c) return toast('No text block here — move the playhead into one or select one');
  const inside = now() >= c.start && now() < c.end, leading = c === leadingTo();
  select(c.id, { seek: false });
  if (!inside && !leading) { S.playUntil = null; leadBefore(c, seek); }
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
  if (qc()) { const c = selCue() || cueAt(now()); if (!c) return; if (fit) return; if (isExt(c) && S.qcSource !== 'video') return playCue(); leadBefore(c, seek); S.playUntil = S.qcSource === 'preview' || (S.qcSource === 'package' && liveRead(c)) ? null : c.end; play(); if (leadTo != null) leadRead = () => qcRead(c, true); else qcRead(c, true); return; }
  const guide = S.mode === 'record'; // a guide reading of the line, before taking it
  if (!writing() && !guide) return modeOnly('Text to speech', 'write');
  if (!tts.on && !guide) { openTts(); return toast('Turn on text to speech to hear blocks read aloud'); }
  const c = leadingTo() || cueAt(now()) || selCue();
  if (!c) return toast('No text block here — move the playhead into one or select one');
  if (!spoken(c.text)) return toast(onlyNotes(c.text) ? 'This block only has notes in [brackets], which aren’t read' : 'This block has no text to read yet');
  const ext = !guide && isExt(c);
  if (fit && ext) return toast(extendedTip);
  select(c.id, { seek: false });
  if (S.loop) { S.loop = S.loopOnce = false; updateInd(); }
  S.playUntil = null;
  const id = c.id;
  const reading = (after) => speak(said(c), {
    id, manual: true, speed: c.speed, voice: c.voice, gain: volGain(c),
    done: (secs) => {
      after?.();
      const cur = S.cues[idx(id)];
      if (secs == null || !cur) return;
      if (fit) { pause(); fitToSpeech(cur, secs); return; }
      const room = cur.end - cur.start;
      if (now() >= cur.end) pause(); else S.playUntil = cur.end;
      if (guide) return;
      if (ext) return toast(`Reading takes ${secs.toFixed(1)} s, and the video pauses for it`);
      // An auto block has just been refitted to this reading.
      if (cur.auto && room + 0.0005 >= secs) return toast(`Reading takes ${secs.toFixed(1)} s. The block now ends where the reading finishes`);
      toast(secs > room + 0.05
        ? `Reading takes ${secs.toFixed(1)} s, ${(secs - room).toFixed(1)} s longer than the block. ⇧V fits the block to it`
        : `Reading takes ${secs.toFixed(1)} s and fits, with ${(room - secs).toFixed(1)} s to spare`);
    },
  });
  const read = () => (ext ? startHold(c, reading) : reading());
  // ⇧V is measuring, so it starts straight away.
  if (fit) { setTime(c.start); read(); } else {
    leadBefore(c, setTime, read);
    if (leadTo != null) readAhead(said(c), c.speed, c.voice); // so it's ready at the block's start
  }
  play();
  toast(fit ? 'Reading the block to measure it…' : 'Reading the block…');
}

function fitToSpeech(c, secs) {
  if (qc()) return;
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
  if (S.loadingProject || S.makingReview || !c || !ttsOn() || !spoken(c.text)) return false;
  // An extended block takes no time of the programme's, so it's as short as a block can be.
  const ext = isExt(c);
  if (!c.auto && !ext) return false;
  const i = idx(c.id);
  if (i < 0) return false;
  const { hi } = bounds(i);
  const end = clamp(c.start + (ext ? MIN_DUR : speechLength(said(c), c.speed, c.voice).secs), c.start + MIN_DUR, Math.max(hi, c.start + MIN_DUR));
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
const extendedTip = 'An extended block is read while the video is paused, so it’s a short marker on the timeline';
const lockedTipFor = (c) => (isExt(c) ? extendedTip : 'With text to speech on, a block ends where its reading does. Change its speed to make it longer or shorter');
// A block's end about to be set by hand: says why it can't be, with text to speech on.
function endLocked(c) {
  if (!following(c)) return false;
  toast(lockedTipFor(c));
  return true;
}
// A block's length changed by hand: its start or end edge. With text to speech on, the end
// goes back to where the reading finishes, so a new start moves the whole block.
function resized(c, edge) {
  if (following(c)) {
    adapt(c);
    fitAuto(c);
    if (edge === 'end') toast(lockedTipFor(c));
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
  if (!c?.fit || !ttsOn() || !spoken(c.text) || isExt(c)) return false;
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

// Speeds aren't moved here: Fit speeds to timings sets them itself, each to one it has
// read, and moving one as other blocks' readings arrive left it at a speed with no reading.
function fitAllAuto() {
  let any = false;
  for (const c of S.cues) any = fitAuto(c) || any;
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
  if (qc()) return toast('The script and timings are fixed in QC mode');
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
  if (qc()) return;
  const n = blocks.length;
  if (ask && !confirm(`Update the end of ${n} block${n > 1 ? 's' : ''} from the reading? This also changes blocks marked with H or opened from a file. You can undo it.`)) {
    return (ttsAllStatus.textContent = '');
  }
  pushUndo();
  let moved = 0, short = 0, estimated = 0;
  for (let i = 0; i < S.cues.length; i++) {
    const c = S.cues[i], next = S.cues[i + 1];
    if (!spoken(c.text) || isExt(c)) continue;
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
    if (secs == null || Math.abs(secs - target) <= near) break;
    // As slow as it goes and still short, or as fast as it goes and still long.
    if ((at <= FIT_MIN && secs < target) || (at >= MAX_SPEED && secs > target)) break;
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
  if (qc()) return toast('The script and timings are fixed in QC mode');
  const blocks = S.cues.filter((c) => spoken(c.text) && !c.pinned && !isExt(c));
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
  if (qc()) return;
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
  if (qc()) return;
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
  showCloudCost();
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
  showCloudCost();
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

// Export description track: every block's Piper or Google reading in one WAV or MP3 file, each
// at its block's start, as long as the video (or the last reading, without one), and
// longer by the pauses of any extended blocks.
const ttsExport = $('ttsExport'), ttsExportStatus = $('ttsExportStatus'), ttsExportBar = $('ttsExportBar');
ttsExport.addEventListener('click', () => checkFirst(exportTrack));
async function exportTrack() {
  const pausing = withPauses();
  const blocks = S.cues.filter((c) => spoken(c.text)).map((c) => ({ start: c.start, text: said(c), speed: c.speed, voice: c.voice, gain: volGain(c), extended: pausing && isExt(c) }));
  if (!blocks.length) return (ttsExportStatus.textContent = 'There are no blocks with text yet.');
  pause();
  busy(ttsExport, ttsExportBar, true);
  try {
    const as = trackFormat(tts.trackAs);
    // With an MP3, making the readings is the first 80% of the bar and encoding the rest.
    const part = as.kbps ? 0.8 : 1;
    const { pcm, rate, overlaps } = await renderTrack(blocks, S.hasVideo ? duration() : 0,
      (k, n) => { ttsExportBar.value = part * k / n; ttsExportStatus.textContent = `Making readings: ${k} of ${n}`; });
    const blob = as.kbps
      ? await encodeMp3(pcm, rate, as.kbps, (f) => { ttsExportBar.value = part + (1 - part) * f; ttsExportStatus.textContent = `Making the MP3: ${Math.round(f * 100)}%`; })
      : pcmToWav(pcm, rate);
    const name = `${baseName()} - audio description.${as.ext}`;
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
}
// Export full mix: the programme with the readings, mixed in mix-worker.js as playback
// sounds. The readings are made first, at the level the voice gives them, as they play.
const ttsMixExport = $('ttsMixExport'), ttsMixStatus = $('ttsMixStatus'), ttsMixBar = $('ttsMixBar'), ttsMixStop = $('ttsMixStop');
let mixWorker = null, mixStopped = false;
const stopped = () => Object.assign(new Error('stopped'), { stopped: true });
// With ffmpeg in Docker: the mix, a WAV, goes to it with the video, if it's going in the
// video, and comes back in the format chosen. See ffmpeg/server.py.
const FF_VIDEOS = ['mp4', 'm4v', 'mov', 'mkv', 'webm'];
let ffJob = null, ffXhr = null;
async function ffCall(method, path, body) {
  const r = await fetch(`ffmpeg/${path}`, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const m = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(m.error || `ffmpeg answered ${r.status}`);
  return m;
}
// PUT with XHR, which shows how much has gone.
function ffPut(path, blob, progress) {
  return new Promise((resolve, reject) => {
    const x = ffXhr = new XMLHttpRequest();
    x.open('PUT', `ffmpeg/${path}`);
    x.upload.onprogress = (e) => e.lengthComputable && progress(e.loaded / e.total);
    x.onload = () => { ffXhr = null; x.status < 300 ? resolve() : reject(new Error(JSON.parse(x.responseText || '{}').error || `ffmpeg answered ${x.status}`)); };
    x.onerror = () => { ffXhr = null; reject(new Error('couldn’t reach ffmpeg')); };
    x.onabort = () => { ffXhr = null; reject(stopped()); };
    x.send(blob);
  });
}
// With pauses, it's a new video, which takes far longer: at is how much of the bar comes first.
async function ffmpegMix(mix, video, codec, name, show, pauses = null, at = 0.7) {
  const ext = video && video.name.split('.').pop().toLowerCase();
  const { id } = await ffCall('POST', 'jobs', { codec, video: video ? ext : null, replace: tts.mixInto === 'replace', name,
    ...(pauses ? { pauses: pauses.map((p) => [p.at, p.secs]) } : {}) });
  ffJob = id;
  const total = mix.size + (video?.size || 0);
  const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
  const sent = at + (1 - at) * (pauses ? 0.1 : 0.5);
  const sending = (n) => show(at + (sent - at) * n / total, `Sending to ffmpeg: ${gb(n)} of ${gb(total)}`);
  await ffPut(`jobs/${id}/mix`, mix, (f) => sending(f * mix.size));
  if (video) await ffPut(`jobs/${id}/video`, video, (f) => sending(mix.size + f * video.size));
  await ffCall('POST', `jobs/${id}/start`);
  for (;;) {
    const j = await ffCall('GET', `jobs/${id}`);
    if (j.state === 'failed') throw new Error(`ffmpeg: ${j.error}`);
    show(sent + (1 - sent) * j.done, `${pauses ? 'Making the video' : video ? 'Putting it in the video' : 'Making the file'}: ${Math.round(j.done * 100)}%`);
    if (j.state === 'done') break;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  // ffmpeg sends the file with its name, and deletes it once it has gone.
  const a = document.createElement('a');
  a.href = `ffmpeg/jobs/${id}/result`;
  a.download = '';
  a.click();
  ffJob = null;
  return name + '.' + (video ? ext : mixFormat(tts.mixAs).ext);
}
function runMix(job, transfer, progress) {
  return new Promise((resolve, reject) => {
    const w = mixWorker = new Worker('js/mix-worker.js');
    const end = (f, v) => { w.terminate(); if (mixWorker === w) mixWorker = null; f(v); };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'progress') progress(m.done);
      else if (m.type === 'mix') end(resolve, m);
      else end(reject, Object.assign(new Error(m.message), { unsupported: m.type === 'unsupported' }));
    };
    w.onerror = (e) => { e.preventDefault(); end(reject, new Error(e.message || 'the mixer didn’t load')); };
    w.stop = () => end(reject, stopped());
    w.postMessage(job, transfer);
  });
}
// The programme decoded by the browser all at once, for files the mixer can't stream,
// such as an MP3. Only works for files that fit in memory.
async function wholeProgramme(file) {
  const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await file.arrayBuffer());
  return { planes: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), rate: buf.sampleRate };
}
// Streams the programme through the mixer, or decodes it here if the mixer can't read it.
async function mixProgramme(job, file, status, mixing) {
  try {
    return await runMix({ ...job, cmd: 'mix', file, track: S.track }, [], mixing);
  } catch (e) {
    if (!e.unsupported || file.size > LEGACY_LIMIT || S.track) throw e;
    status.textContent = 'Reading the programme’s audio…';
    const whole = await wholeProgramme(file);
    if (mixStopped) throw stopped();
    return runMix({ ...job, cmd: 'mixPlanes', ...whole }, [], mixing);
  }
}
// An extended block is read during its pause, so it lowers nothing: the programme comes
// back at its own level.
const mixBlocks = (pausing) => S.cues.filter((c) => spoken(c.text)).map((c) => {
  const extended = pausing && isExt(c);
  return { start: c.start, text: said(c), speed: c.speed, voice: c.voice, dip: extended ? 0 : blockDip(c), gain: volGain(c), extended };
});
const mixing = () => !ttsMixStop.hidden || !ttsExtStop.hidden;
ttsMixExport.addEventListener('click', () => checkFirst(exportMix));
async function exportMix() {
  const file = S.videoFile;
  if (!file) return (ttsMixStatus.textContent = 'Open the programme’s video or audio first.');
  if (mixing()) return (ttsMixStatus.textContent = 'Wait for the extended video to finish first.');
  const pausing = withPauses();
  const blocks = mixBlocks(pausing);
  if (!blocks.length) return (ttsMixStatus.textContent = 'There are no blocks with text yet.');
  pause();
  busy(ttsMixExport, ttsMixBar, true);
  ttsMixStop.hidden = false;
  // ffmpeg's choices only count while it's running, as the settings show them.
  if (!HOSTED && (mixFormat(tts.mixAs).ffmpeg || tts.mixInto)) await checkFfmpeg();
  const as = mixFormat(tts.ffmpeg || !mixFormat(tts.mixAs).ffmpeg ? tts.mixAs : 'wav');
  // In the video, if it's a video ffmpeg can put it in.
  const ext = file.name.split('.').pop().toLowerCase();
  const into = !pausing && tts.ffmpeg && tts.mixInto && FF_VIDEOS.includes(ext);
  if (!pausing && tts.ffmpeg && tts.mixInto && !into) return (ttsMixStatus.textContent = `ffmpeg can put the mix in an MP4, MOV, MKV or WebM video, not a .${ext} file.`);
  const ff = !!(tts.ffmpeg && (as.ffmpeg || into));
  mixStopped = false;
  $('ttsMixCmds').hidden = true;
  // With ffmpeg, mixing ends at 70%, and sending and making the file take the rest.
  const share = ff ? 0.7 : 1;
  const show = (f, text) => { if (mixStopped) throw stopped(); ttsMixBar.value = f; ttsMixStatus.textContent = text; };
  try {
    // Making the readings is the first 20% of the bar, and mixing the rest. Each reading
    // goes to the mixer as it is, at the level the voice gives it, as it plays.
    const made = await makeReadings(blocks, (k, n) => show(0.2 * k / n, `Making readings: ${k} of ${n}`));
    const { starts, pauses } = extendedTimeline(made.map(({ start, w }, k) => ({ start, secs: w.secs, extended: blocks[k].extended })));
    const readings = made.map(({ w }, k) => ({ start: starts[k], samples: w.samples, rate: w.rate, dip: blocks[k].dip, gain: blocks[k].gain }));
    const levels = mixLevels(tts.mix), loud = LOUDNESS[tts.loudness] || LOUDNESS[''];
    const job = { readings, pauses, fade: tts.dipFade, video: levels.video, reading: levels.reading,
      kbps: as.kbps || 0, wavMix: ff, target: loud.lufs ?? null, ceiling: loud.ceiling, stems: !!tts.stems };
    // Meeting a loudness target mixes twice: measuring, then mixing.
    const progress = (f) => show(0.2 + (share - 0.2) * f, loud.lufs == null || f >= 0.5 ? `Mixing: ${Math.round(f * 100)}%` : `Measuring loudness: ${Math.round(f * 200)}%`);
    progress(0);
    const done = await mixProgramme(job, file, ttsMixStatus, progress);
    const names = { mix: 'full mix', programme: 'programme (lowered)', readings: 'readings' };
    const saved = [];
    for (const { part, blob } of done.files) {
      if (part === 'mix' && ff) {
        const name = `${baseName()} - ${into ? 'with audio description' : names.mix}`;
        saved.push(await ffmpegMix(blob, into ? file : null, as.ffmpeg || 'aac', name, show));
        await new Promise((ok) => setTimeout(ok, 300));
        continue;
      }
      // Stems from an ffmpeg format are WAVs.
      const name = `${baseName()} - ${names[part]}.${as.ffmpeg ? 'wav' : as.ext}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      saved.push(name);
      await new Promise((ok) => setTimeout(ok, 300)); // browsers can drop downloads started together
    }
    // Without ffmpeg here, the commands to put the mix in the video with ffmpeg of one's own.
    const cmds = !into && !pausing && ffmpegCommands({ video: file.name, mix: saved[0], tracks: S.tracks.length || 1,
      out: `${baseName()} - with audio description.${ext}` });
    if (cmds && S.hasVideo) {
      $('ttsCmdAdd').textContent = cmds.add;
      $('ttsCmdReplace').textContent = cmds.replace;
      $('ttsMixCmds').hidden = false;
    }
    const lufs = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : 'silent');
    report(ttsMixStatus, `Saved ${saved.join(', ')}. Loudness: ${lufs(done.loudness)}` + (done.was != null ? `, from ${lufs(done.was)}.` : '.'));
  } catch (e) {
    if (ffJob) { fetch(`ffmpeg/jobs/${ffJob}`, { method: 'DELETE' }).catch(() => {}); ffJob = null; }
    if (e.stopped || mixStopped) ttsMixStatus.textContent = 'Stopped.'; // ffmpeg may answer first
    else report(ttsMixStatus, `Couldn’t export the full mix: ${e.message}`);
  } finally {
    busy(ttsMixExport, ttsMixBar, false);
    ttsMixStop.hidden = true;
    ttsMixExport.disabled = !usingAudioVoice();
  }
}
// Export extended video: the mix, with or without the readings, goes to ffmpeg with the video
// and the pauses. Without ffmpeg, the mix and a filter file, for a command to run yourself.
const ttsExtVideoExport = $('ttsExtVideoExport'), ttsExtStatus = $('ttsExtStatus'), ttsExtBar = $('ttsExtBar'), ttsExtStop = $('ttsExtStop');
const saveBlob = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};
ttsExtVideoExport.addEventListener('click', () => checkFirst(exportExtended));
async function exportExtended() {
  const file = S.videoFile;
  if (!file || !S.hasVideo) return report(ttsExtStatus, 'Open the programme’s video first.');
  if (mixing()) return (ttsExtStatus.textContent = 'Wait for the full mix to finish first.');
  const blocks = mixBlocks(true);
  if (!blocks.some((b) => b.extended)) return report(ttsExtStatus, 'No block is extended yet.');
  pause();
  busy(ttsExtVideoExport, ttsExtBar, true);
  ttsExtStop.hidden = false;
  mixStopped = false;
  $('ttsExtCmds').hidden = true;
  const show = (f, text) => { if (mixStopped) throw stopped(); ttsExtBar.value = f; ttsExtStatus.textContent = text; };
  try {
    if (!HOSTED) await checkFfmpeg();
    const ext = file.name.split('.').pop().toLowerCase();
    if (tts.ffmpeg && !FF_VIDEOS.includes(ext)) throw new Error(`ffmpeg can make an MP4, MOV, MKV or WebM video, not a .${ext} file`);
    // With ffmpeg, the video takes the most time, so it gets most of the bar.
    const share = tts.ffmpeg ? 0.3 : 1;
    const narrate = tts.extNarration;
    const made = await makeReadings(blocks, (k, n) => show(0.2 * share * k / n, `Making readings: ${k} of ${n}`));
    const { starts, pauses } = extendedTimeline(made.map(({ start, w }, k) => ({ start, secs: w.secs, extended: blocks[k].extended })));
    const readings = narrate ? made.map(({ w }, k) => ({ start: starts[k], samples: w.samples, rate: w.rate, dip: blocks[k].dip, gain: blocks[k].gain })) : [];
    const levels = mixLevels(tts.mix), loud = LOUDNESS[tts.loudness] || LOUDNESS[''];
    // Without the narration it's the programme as it is, for mixing later.
    const job = { readings, pauses, fade: tts.dipFade, video: narrate ? levels.video : 1, reading: narrate ? levels.reading : 0,
      kbps: 0, wavMix: true, target: narrate ? loud.lufs ?? null : null, ceiling: narrate ? loud.ceiling : 0, stems: false };
    const done = await mixProgramme(job, file, ttsExtStatus, (f) => show(share * (0.2 + 0.8 * f), `Mixing: ${Math.round(f * 100)}%`));
    const mix = done.files[0].blob, base = baseName(), plain = narrate ? '' : ', no narration';
    if (tts.ffmpeg) {
      const name = await ffmpegMix(mix, file, 'aac', `${base} - extended${plain}`, show, pauses, share);
      return report(ttsExtStatus, `Saved ${name}.`);
    }
    // Without ffmpeg here, what ffmpeg of one's own needs.
    const names = { mix: `${base} - extended audio${plain}.wav`, filter: `${base} - pauses for ffmpeg.txt`, out: `${base} - extended${plain}.${ext}` };
    saveBlob(mix, names.mix);
    await new Promise((ok) => setTimeout(ok, 300));
    saveBlob(new Blob([holdFilter(pauses)], { type: 'text/plain' }), names.filter);
    $('ttsExtCmd').textContent = extendedCommand({ video: file.name, mix: names.mix, filter: names.filter, out: names.out });
    $('ttsExtCmds').hidden = false;
    report(ttsExtStatus, `Saved ${names.mix} and ${names.filter}.`);
  } catch (e) {
    if (ffJob) { fetch(`ffmpeg/jobs/${ffJob}`, { method: 'DELETE' }).catch(() => {}); ffJob = null; }
    if (e.stopped || mixStopped) ttsExtStatus.textContent = 'Stopped.';
    else report(ttsExtStatus, `Couldn’t export the extended video: ${e.message}`);
  } finally {
    busy(ttsExtVideoExport, ttsExtBar, false);
    ttsExtStop.hidden = true;
    ttsExtVideoExport.disabled = !usingAudioVoice();
  }
}
// The pause list: exact lengths where the readings can be made, and otherwise estimates.
const ttsPauseList = $('ttsPauseList'), ttsPauseStatus = $('ttsPauseStatus');
ttsPauseList.addEventListener('click', () => checkFirst(exportPauses));
async function exportPauses() {
  const cues = S.cues.filter((c) => isExt(c) && spoken(c.text));
  if (!cues.length) return report(ttsPauseStatus, 'No block is extended yet.');
  ttsPauseList.disabled = true;
  try {
    const blocks = cues.map((c) => ({ start: c.start, text: said(c), speed: c.speed, voice: c.voice }));
    const audio = blocks.every((b) => usingAudioVoice(b.voice));
    const secs = audio
      ? (await makeReadings(blocks, (k, n) => { ttsPauseStatus.textContent = `Making readings: ${k} of ${n}`; })).map(({ w }) => w.secs)
      : blocks.map((b) => speechLength(b.text, b.speed, b.voice).secs);
    const { starts } = extendedTimeline(blocks.map((b, k) => ({ start: b.start, secs: secs[k], extended: true })));
    const rows = cues.map((c, k) => ({ block: idx(c.id) + 1, programme: fmtTime(c.start, '.'), extended: fmtTime(starts[k], '.'), secs: secs[k], text: c.text }));
    const name = `${baseName()} - pauses.csv`;
    saveBlob(new Blob([pauseList(rows)], { type: 'text/csv;charset=utf-8' }), name);
    report(ttsPauseStatus, `Saved ${name}.` + (audio ? '' : ' Lengths are estimates: use a Piper, Kokoro, Google or Polly voice for exact ones.'));
  } catch (e) {
    report(ttsPauseStatus, `Couldn’t export the pause list: ${e.message}`);
  } finally {
    ttsPauseList.disabled = false;
  }
}
$('ttsExtCmdCopy').addEventListener('click', async () => toast(await copyText($('ttsExtCmd').textContent) ? 'Copied the command' : 'Couldn’t copy: the browser blocked clipboard access'));
for (const [btn, code] of [['ttsCmdAddCopy', 'ttsCmdAdd'], ['ttsCmdReplaceCopy', 'ttsCmdReplace']]) {
  $(btn).addEventListener('click', async () => toast(await copyText($(code).textContent) ? 'Copied the command' : 'Couldn’t copy: the browser blocked clipboard access'));
}
for (const stop of [ttsMixStop, ttsExtStop]) {
  stop.addEventListener('click', () => {
    mixStopped = true;
    mixWorker?.stop();
    ffXhr?.abort();
    if (ffJob) { fetch(`ffmpeg/jobs/${ffJob}`, { method: 'DELETE' }).catch(() => {}); ffJob = null; }
  });
}
ttsAllStop.addEventListener('click', () => { measuring = false; stopSpeech(); });
// A job carries on when the settings close: it shows in the bottom bar.
$('ttsDlg').addEventListener('close', () => { if (!jobActive) { ttsAllStatus.textContent = ''; ttsFitStatus.textContent = ''; ttsMakeStatus.textContent = ''; } });

// A block's own speed. Setting it to normal leaves the block without one.
function setBlockSpeed(c, v) {
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
  pushUndo(undefined, 'speed-' + c.id);
  if (!isBlockSpeed(v) || v === 1) delete c.speed;
  else c.speed = v;
  // A speed picked by hand stays put when the block is resized. Back to default, and
  // resizing fits the speed again.
  delete c.fit;
  if (c.speed) c.pinned = true; else delete c.pinned;
  // The speed was picked, so the end follows the reading instead.
  if (!qc()) c.auto = true;
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
  const mainVoice = qc() ? reviewSettings().ttsVoice : chosenVoice();
  const key = `${c.id}|${c.voice || ''}|${mainVoice}`;
  if (!force && key === edVoiceFor) return;
  edVoiceFor = key;
  fillVoiceSelect(edVoice, c.voice || '');
  edVoice.prepend(new Option(`Same as Settings (${qc() ? voiceLabel(mainVoice) : chosenVoiceName()})`, ''));
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
  if (qcLocked()) return;
  pushUndo(undefined, 'voice-' + c.id);
  if (uri) c.voice = uri; else delete c.voice;
  fitAuto(c);
  changed(c.id);
  tlDirty = true;
  schedulePrefetch(c);
  toast(c.voice ? `Block #${idx(c.id) + 1} reads with ${blockVoiceName(c.voice)}` : `Block #${idx(c.id) + 1} reads with the voice in Settings`);
}

// A block's own dip: further or less far than the setting, such as further under a loud
// scene, or not at all under music. It follows the setting, so changing that moves every
// block's dip with it.
const edDip = $('edDip'), edDipWrap = $('edDipWrap'), edDipCustom = $('edDipCustom');
const signed = (v) => (v > 0 ? `+${v}` : String(v).replace('-', '−'));
// Custom shows a box beside the menu, to type how many dB more (or less, with a minus).
function fillEdDip(c) {
  const opts = [['', 'Dip as set'], ['none', 'No dip'], ...DIP_BYS.map((d) => [String(d), `${Math.abs(d)} dB ${d > 0 ? 'more' : 'less'}`]), ['custom', 'Custom']];
  if (edDip.options.length !== opts.length || edDip.options[0].text !== opts[0][1]) edDip.replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
  edDip.value = c.dip === 0 ? 'none' : !isDipBy(c.dipBy) ? '' : DIP_BYS.includes(c.dipBy) ? String(c.dipBy) : 'custom';
  edDipCustom.hidden = edDip.value !== 'custom';
  edDipCustom.value = isDipBy(c.dipBy) ? signed(c.dipBy) : '';
}
edDip.addEventListener('change', () => {
  const c = selCue();
  if (!c) return;
  if (edDip.value !== 'custom') {
    setBlockDip(c, edDip.value === 'none' ? { dip: 0 } : edDip.value === '' ? {} : { dipBy: +edDip.value });
    return edDip.blur();
  }
  edDipCustom.value = isDipBy(c.dipBy) ? signed(c.dipBy) : '';
  edDipCustom.hidden = false;
  edDipCustom.focus();
  edDipCustom.select();
});
// Enter, or leaving the box, sets the dip typed in; Escape, or something that isn't a dip,
// puts the menu back as it was.
function setCustomDip(keep) {
  const c = selCue();
  if (!c || edDipCustom.hidden) return;
  const v = keep ? typedDipBy(edDipCustom.value) : null;
  if (v != null && (v !== (c.dipBy || 0) || c.dip === 0)) setBlockDip(c, v ? { dipBy: v } : {});
  else fillEdDip(c);
}
edDipCustom.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  setCustomDip(e.key === 'Enter');
  edDipCustom.blur();
});
edDipCustom.addEventListener('blur', () => setCustomDip(true));
// own: { dip: 0 } for none, { dipBy } for more or less than set, or {} to follow it.
function setBlockDip(c, own) {
  if (qcLocked()) return;
  pushUndo(undefined, 'dip-' + c.id);
  delete c.dip;
  delete c.dipBy;
  Object.assign(c, blockDipOf(own));
  changed(c.id);
  const at = dipFor(c, tts.dipDb), n = `Block #${idx(c.id) + 1}`;
  toast(c.dip === 0 ? `${n}: the programme isn’t lowered`
    : c.dipBy ? `${n}: the programme is lowered ${Math.abs(c.dipBy)} dB ${c.dipBy > 0 ? 'more' : 'less'} than set, ${at} dB for now`
    : `${n}: the programme is lowered as set, ${at} dB`);
}

// A block's reading volume, as a share of the Video / TTS slider's: quieter or louder than
// the rest, moving with the slider. The box takes an exact percentage.
const edVol = $('edVol'), edVolBox = $('edVolBox'), edVolWrap = $('edVolWrap');
function fillEdVol(c) {
  const v = isVol(c.vol) ? c.vol : 100;
  if (document.activeElement !== edVol) edVol.value = v;
  if (document.activeElement !== edVolBox) edVolBox.value = v;
}
function setBlockVol(c, v, { quiet = false } = {}) {
  if (qcLocked()) return;
  if ((isVol(c.vol) ? c.vol : 100) === v) return;
  pushUndo(undefined, 'vol-' + c.id);
  if (isVol(v)) c.vol = v; else delete c.vol;
  changed(c.id);
  if (!quiet) toast(`Block #${idx(c.id) + 1}: reading at ${v}%${v === 100 ? ', as the slider' : ' of the slider’s level'}`);
}
// Dragging shows the value in the box; letting go sets it. Double-click: back to 100%.
edVol.addEventListener('input', () => { edVolBox.value = edVol.value; });
edVol.addEventListener('change', () => { const c = selCue(); if (c) setBlockVol(c, +edVol.value); });
edVol.addEventListener('pointerup', () => edVol.blur());
edVol.addEventListener('dblclick', () => { const c = selCue(); if (c) setBlockVol(c, 100); fillEdVol(c || {}); });
function setTypedVol(keep) {
  const c = selCue();
  if (!c) return;
  const v = keep ? typedVol(edVolBox.value) : null;
  if (v != null) setBlockVol(c, v);
  fillEdVol(c);
}
edVolBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  setTypedVol(e.key === 'Enter');
  edVolBox.blur();
});
edVolBox.addEventListener('blur', () => setTypedVol(true));

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
  if (qcLocked()) return toast('This review allows comments only');
  if (!writing() && !qc()) return modeOnly('Text to speech', 'write');
  if (!readingControls()) return toast('Turn on text to speech first (⌥⇧V)');
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
  if (qcLocked()) return;
  if (!writing() && !qc()) return modeOnly('Sounds like', 'write');
  if (!readingControls()) { openTts(); return toast('Turn on text to speech to set how words sound'); }
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
  if (qc()) {
    if (S.qcSource !== 'preview') return toast('Choose Approximate TTS preview in QC playback to hear pronunciation changes');
    if (!sayFor) return;
    const requested = sayFor.voice || reviewSettings().ttsVoice;
    const voice = reviewVoices().some((v) => v.id === requested) ? requested : S.qcPreviewVoice;
    if (!voice) return toast('Choose a preview voice in QC playback');
    return speak(soundsLike(sayFor.text, sayPairs()), { speed: sayFor.speed, voice });
  }
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
  if (!readingControls() || document.activeElement !== edText) return '';
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
  if (qcLocked()) return;
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

// While playing, read each block as the playhead reaches its start. Played from partway
// through a block, or jumped into one, its reading picks up from there.
function liveSpeech(prevT, t, started) {
  if (!qc()) readAheadOf(t);
  else if (S.qcSource === 'package' && S.review?.live) readAheadOf(t, liveRead);
  if (extHold) return;
  if (heard && !stillHeard(heard.start, t)) heard = null;
  const jumped = jumpedHere || started || t < prevT || t - prevT >= 2;
  jumpedHere = false;
  if (qc()) return qcSpeech(prevT, t, started, jumped);
  if (!ttsOn() || !tts.live || tts.speaking?.manual || hold) return; // not over someone reading
  const a = cueAt(t);
  const e = S.mode !== 'record' && blockToHold(S.cues, prevT, t, jumped, (c) => isExt(c) && c.id !== heard?.id && !!spoken(said(c)));
  if (e) return startHold(e, (done) => speak(said(e), { id: e.id, speed: e.speed, voice: e.voice, gain: volGain(e), done }));
  if (!a || isExt(a) || tts.speaking?.id === a.id) return;
  const gap = started || t < prevT || t - prevT >= 0.5;
  if (!gap && prevT <= a.start && t > a.start) speak(said(a), { id: a.id, speed: a.speed, voice: a.voice, gain: volGain(a) });
  else if (gap && t > a.start && t - a.start < speechLength(said(a), a.speed, a.voice).secs - 0.1) {
    speak(said(a), { id: a.id, speed: a.speed, voice: a.voice, gain: volGain(a), from: () => now() - a.start });
  }
}

// Making a reading takes a moment, a second or more with Kokoro, so while playing, the
// next blocks are read ahead. Otherwise a reading would start late and run past its block.
const AHEAD_SECS = 15, AHEAD_BLOCKS = 2;
let aheadOf = '';
// only: in QC, just the blocks this computer reads, with each one's voice from the project.
function readAheadOf(t, only = null) {
  if (!only && (!ttsOn() || !tts.live)) return;
  const voiceOf = (c) => (only ? liveVoiceOf(c) : c.voice);
  const next = S.cues.filter((c) => c.start > t && c.start - t <= AHEAD_SECS && spoken(c.text) && usingAudioVoice(voiceOf(c)) && (!only || only(c)))
    .sort((a, b) => a.start - b.start).slice(0, AHEAD_BLOCKS);
  // Only when the blocks ahead, or what they say, change: this runs on every frame.
  const key = `${chosenVoice()}|${tts.base}|` + next.map((c) => `${c.id}|${c.speed}|${c.voice}|${said(c)}`).join('\n');
  if (key === aheadOf) return;
  aheadOf = key;
  for (const c of next) readAhead(said(c), c.speed, voiceOf(c));
}

// Lower the original audio while a block is read, as far and as quickly as the text to
// speech settings say, just as the full mix does, and as the mix slider says. tick()
// moves it along.
let ducked = false, dip = 0, dipTo = 0, dipFrom = 0, volumeWas = -1;
// How far the programme goes down under a block's reading, in dB: the setting, or more or
// less with the block's own, or not at all.
const blockDip = (c) => (!tts.duck ? 0 : dipFor(c, tts.dipDb));
let recVol = 1; // the video's level while recording, lowered so the narrator can follow the scene
let recorder = null;
function duckAudio(on = ducked) {
  ducked = on;
  applyDuck(0);
}
function applyDuck(dt) {
  const c = tts.speaking && S.cues.find((x) => x.id === tts.speaking.id);
  const target = !ducked ? 0 : qc() && S.qcSource === 'package'
    ? Math.max(0, ...qcPlayer.activeReadings().map(blockDip), ...(c ? [blockDip(c)] : [])) : blockDip(c);
  if (target !== dipTo) { dipTo = target; dipFrom = dip; }
  dip = stepDip(dip, target, dt, tts.dipFade, dipFrom);
  const v = dipLevel(dip) * ((writing() && tts.on) || (qc() && S.qcSource !== 'video') ? mixLevels(tts.mix).video : 1) * recVol;
  if (v === volumeWas) return;
  volumeWas = v;
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
  mixBox.hidden = !((writing() && tts.on) || (qc() && S.qcSource !== 'video'));
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

// Package permissions are read from the source file, including after browser recovery.
function syncQcPermission() {
  const lockedPackage = (!!S.reviewId && !qcEditable()) || sharedLimited();
  document.body.classList.toggle('qc-editing', qc() && qcEditable());
  document.body.classList.toggle('qc-package', !!S.reviewId);
  const authoring = !S.reviewId && !!S.reviewAudio;
  $('qcPermission').textContent = myShare?.role === 'review' ? 'Suggestions' : authoring ? 'Authoring project' : qcEditable() ? 'Edits allowed' : 'Comments only';
  $('qcPermission').dataset.tip = myShare?.role === 'review' ? 'Your block changes go to the owner as suggestions, in Pending review' : myShare?.role === 'comment' ? 'Your link allows comments only' : authoring ? 'Your authoring project: edit in QC or Write, with the original readings kept for reference' : S.reviewId ? 'Chosen when the QC package was created' : 'Use Write or Transcribe to edit a plain project';
  $('qcPermissionInfo').textContent = myShare?.role === 'review' ? 'You’re reviewing a shared project. Your block changes go to its owner as suggestions; your comments reach everyone at once.'
    : myShare?.role === 'comment' ? 'You can comment on this shared project. The script and timings stay fixed.' : authoring ? 'This is your authoring project. You can edit in QC or Write. Changed readings stay available as previous readings.' : qcEditable()
    ? (packageRereads() ? 'The package creator allows block edits. A changed Google or Amazon Polly block gets a new reading, and its end moves to fit.'
      : 'The package creator allows block edits. Timings change only when you edit them. Changed readings are marked out of date.')
    : S.reviewId ? 'The package creator allows comments only. The script and timings stay fixed.'
      : 'This project is read-only in QC. Use Write or Transcribe to edit, or ask for a QC package that allows edits.';
  for (const b of document.querySelectorAll('#modeSw button')) b.disabled = lockedPackage && b.dataset.mode !== 'qc';
  for (const b of document.querySelectorAll('input[name=wzMode]')) b.disabled = lockedPackage && b.value !== 'qc';
}

const MODE_NAMES = { transcribe: 'Transcribe', write: 'Write', qc: 'QC', record: 'Record' };
function modeOnly(feature, mode) {
  toast(`${feature} is part of ${MODE_NAMES[mode]} mode. Switch modes at the top`);
}
function setMode(m, quiet = false) {
  if (!MODE_NAMES[m]) return;
  if (m !== 'qc' && S.reviewId && !qcEditable()) return toast('This QC package allows comments only. Open the writer’s project to edit');
  if (m !== 'qc' && sharedLimited()) return toast(myShare.role === 'review' ? 'Your link is for reviewing: suggest changes in QC' : 'Your link is for comments: add them in QC');
  document.activeElement?.blur();
  extHold = null;
  heard = null;
  stopSpeech();
  S.playUntil = null;
  if (m === 'qc') measuring = false;
  if (m === 'qc' && S.mode !== 'qc') S.qcSettings = readingSettings();
  if (!commentsAllowed(m) && !$('commentsDrawer').hidden) toggleComments(false);
  if (m === 'qc' && !$('aiDrawer').hidden) toggleAi(false);
  stopPreviousReading();
  qcPlayer.stop();
  // A mode used for the first time gets its part of the setup, however it was reached:
  // the mode switch, or a file that opens in it. Read before the mode changes.
  // Record mode's comes with the recording file, even on a first visit.
  const fresh = m !== S.mode && (welcomed() || m === 'record') && !modeSetUp(m);
  S.mode = m;
  if (qc() && !S.qcSettings) S.qcSettings = readingSettings();
  $('edText').readOnly = $('edStart').readOnly = $('edEnd').readOnly = qcLocked();
  document.body.classList.toggle('mode-qc', qc());
  syncQcPermission();
  // Record mode belongs to an open recording file, so it isn't what the next visit starts in.
  if (m !== 'record') try { localStorage.setItem('scribecue.mode', m); } catch { /* ignore */ }
  document.body.classList.toggle('mode-record', m === 'record');
  document.body.classList.toggle('mode-write', m === 'write');
  document.body.classList.toggle('mode-transcribe', m === 'transcribe');
  for (const b of document.querySelectorAll('#modeSw button')) {
    const on = b.dataset.mode === m;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  }
  holdEnd();
  if (m === 'write') fitAllAuto();
  else if (qc()) fitQcAll();
  else if (m === 'transcribe' && stt.on) warmStt();
  if (qc()) S.qcLast = null;
  renderList();
  updateEditor();
  updateInd();
  tlDirty = true;
  // Once the file has finished opening and nothing else is on screen; a project that
  // passes through QC on its way to another mode doesn't count.
  if (fresh) setTimeout(() => whenClear(() => { if (S.mode === m) openModeSetup(m); }), 400);
  if (!quiet) {
    toast(m === 'qc' ? (qcEditable() ? (S.reviewId ? `QC mode: the package allows block edits. ${packageRereads() ? 'Changed Google and Amazon Polly blocks get a new reading' : 'Timings change only when you edit them'}` : 'QC mode: your authoring project is editable. Timings change only when you edit them') : 'QC mode: comments only. Click a block’s Comment button to add a note') : m === 'write'
      ? `Write mode: text to speech${tts.on ? '' : ' (turn it on in Settings, or with ⌥⇧V)'}, reading times and block speeds`
      : 'Transcribe mode: hold H while the narrator speaks to mark each line');
  }
}
// Each mode is a complete workspace; clicking the selected mode keeps it selected.
document.getElementById('modeSw').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  b.blur();
  // A mode used for the first time opens its setup instead of a toast, then its loop card.
  const m = b.dataset.mode, first = m !== S.mode && !modeSetUp(m);
  setMode(m, first);
  if (S.mode !== m) return;
  if (first) openModeSetup(m);
  else if (!qc()) maybeShowLoop(m);
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
  if (qc()) { hold = null; markEl.hidden = true; return; }
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
  if (qc()) return toast('The script and timings are fixed in QC mode');
  const text = await transcribe(await blockAudio(c));
  const cur = S.cues[idx(c.id)];
  if (qc() || !text || !cur || (!replace && plain(cur.text).trim())) return false;
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
  transcribing: () => S.mode === 'transcribe',
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
// onClick: something a click on the message does, such as bringing back a deleted take.
function toast(msg, onClick = null) {
  diagLog.add('message', msg);
  toastEl.textContent = pcKeys(msg);
  toastEl.onclick = onClick && (() => { toastEl.onclick = null; toastEl.classList.remove('act'); onClick(); });
  toastEl.classList.toggle('act', !!onClick);
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
  el.textContent = name + (S.dirty ? ' •' : '');
  el.title = S.dirty ? 'Unsaved changes: save the project with ' + (IS_MAC ? '⌘S' : 'Ctrl+S') : 'Project or script file';
  document.title = `${name}${S.dirty ? ' •' : ''} · Scribecue`;
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
    const [h] = await picker('video');
    const file = await h.getFile();
    loadVideoFile(file);
    rememberVideo(h, file);
  } catch (e) {
    if (refused(e)) fileVideo.click();
    else if (e.name !== 'AbortError') toast(`Couldn’t open the file: ${e.message}`);
  }
}

const isDoc = (name) => isReview(name) || name.toLowerCase().endsWith(PROJECT_EXT) || isRecordingFile(name) || isSessionPackage(name);

function readingSettings() {
  return { ttsVoice: tts.voice || chosenVoice(), ttsBase: tts.base, ttsSkipNotes: tts.skipNotes };
}
function reviewSettings() { return qc() && S.qcSettings ? S.qcSettings : readingSettings(); }
function projectFileData() { const p = projectData(); return S.reviewId ? resaveReview(S.review, p, { includeReviewKey: true }) : JSON.stringify(p, null, 1); }
function clearReview() { endPending(); stopPreviousReading(); S.review = null; S.reviewId = ''; S.reviewAudio = null; S.qcSource = 'video'; storedReview(null); syncQcPermission(); }
function projectData() {
  const m = S.videoFile ? { name: S.videoFile.name, size: S.videoFile.size, duration: S.hasVideo ? duration() : null } : S.projectMedia;
  return toProject({
    app: VERSION,
    projectId: S.projectId, reviewHistory: S.reviewHistory, reviewAudio: S.reviewId ? null : S.reviewAudio,
    blocks: S.cues,
    notes: S.notes,
    words: S.words,
    comments: S.comments,
    recording: S.recording,
    media: m,
    settings: { mode: S.mode, offset: S.offset, ...reviewSettings(),
      ttsDuck: tts.duck, ttsDipDb: tts.dipDb, ttsDipFade: tts.dipFade, ttsMix: tts.mix, extendedAll: S.extendedAll },
    view: { playhead: now(), ...(selIdx() >= 0 ? { selected: selIdx() } : {}) },
  });
}

async function restoreAuthorAudio(file = null) {
  const reference = S.reviewAudio, projectId = S.projectId;
  if (!reference || S.reviewId) return false;
  const stillCurrent = () => !S.reviewId && S.projectId === projectId && S.reviewAudio === reference;
  try {
    const saved = file ? null : await storedReview(undefined, reviewAudioKey(projectId, reference.baselineId));
    if (!stillCurrent() || (!file && !saved?.file)) return false;
    const result = await collaborationJob({ task: 'reviewAudio', project: projectData(), file: file || saved.file });
    if (!stillCurrent()) return false;
    S.review = result.review; S.qcSource = 'package';
    syncQcPermission(); configureQcAudio(); updateEditor(); updateInd(); refreshQc();
    return true;
  } catch (error) {
    if (file && stillCurrent()) throw error;
    return false;
  }
}
async function attachAuthorAudio(file) {
  if (S.reviewId || !S.reviewAudio || !qc()) throw new Error('Open the authoring project in QC to locate its original readings');
  const projectId = S.projectId, reference = S.reviewAudio;
  if (!await restoreAuthorAudio(file)) throw new Error('The open project changed. Choose its original readings again');
  const kept = await storedReview({ id: reference.baselineId, file: S.review.file }, reviewAudioKey(projectId, reference.baselineId));
  if (!kept) toast('Original readings opened. Keep the QC package to reopen them next time');
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
  if (S.reviewId && !S.review) return toast('Reopen the QC package to restore its audio before saving');
  if (S.mode === 'record') return toast('Takes are kept as you record them. Export the narration when you’re done');
  if (!S.cues.length && !S.comments.length && !S.dirty) return toast('Nothing to save yet');
  const text = projectFileData();
  const name = `${baseName()}${S.reviewId ? REVIEW_EXT : PROJECT_EXT}`;
  if (!window.showSaveFilePicker) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: 'application/json' }));
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
    if (!h) h = await picker('project', { suggestedName: name });
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
    saving: AUTO.saving, dirty: S.dirty, error: AUTO.error,
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
  if ((S.reviewId && !S.review) || !AUTO.can || !S.handle || AUTO.permission !== 'granted' || AUTO.error) return showAutosave();
  const t = Date.now();
  AUTO.first ||= t;
  AUTO.timer = setTimeout(autosave, nextSave(t, S.lastChange || t, AUTO.first));
  showAutosave();
}

async function autosave() {
  const h = S.handle;
  if (AUTO.saving) return; // the save running now looks again when it's done
  AUTO.first = 0;
  if (!AUTO.can || !h || !S.dirty || (S.reviewId && !S.review)) return showAutosave();
  const gen = S.changeGen;
  AUTO.saving = true;
  showAutosave();
  try {
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') { AUTO.permission = 'prompt'; return; }
    await writeFile(h, projectFileData());
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
  if (!S.dirty) return true;
  return confirm(`Your changes to ${S.subName === 'untitled.srt' ? 'this project' : S.subName} aren't saved in a project file. ${what} anyway? You can undo it with ${IS_MAC ? '⌘Z' : 'Ctrl+Z'}.`);
}

async function openProject(file, handle = null, confirmed = false, expectedGeneration = null, attachedAudio = null) {
  if (isRecordingFile(file.name)) return openRecording(file);
  if (isSessionPackage(file.name)) return openSessionPackage(file);
  let p, review = null;
  if (isReview(file.name)) toast('Opening QC package…');
  try { if (isReview(file.name)) { review = await openReview(file); p = review.parsed; } else p = fromProject(JSON.parse(await file.text())); }
  catch (e) { return toast(`Couldn’t open ${file.name}: ${e instanceof SyntaxError ? 'the file is damaged' : e.message}`); }
  if (!confirmed && !okToReplace(`Open ${file.name}`)) return;
  await stopJob();
  await endRecording();
  if (expectedGeneration != null && expectedGeneration !== S.changeGen) return false;
  pushUndo();
  endPending();
  // The project's dip and Video / TTS slider first, as its blocks' dips and volumes build
  // on them, and exact dips from older projects become the difference from its dip.
  S.loadingProject = true;
  projectSound(p.settings);
  S.extendedAll = p.settings.extendedAll === true;
  S.projectId = p.projectId || newIdentity();
  S.reviewHistory = p.reviewHistory || null;
  S.cues = p.blocks.map(revive);
  S.handle = handle;
  handleStore.set(handle);
  AUTO.error = '';
  // Opening it is the moment to ask whether autosave may write to it; if the browser won't
  // ask now, autosave waits, paused, for a click.
  if (handle && AUTO.can) handle.requestPermission({ mode: 'readwrite' }).catch(() => 'prompt').then(checkWrite);
  else showAutosave();
  S.projectMedia = p.media;
  S.comments = p.comments;
  S.notes = p.notes;
  S.words = p.words;
  S.recording = p.recording;
  aiNotesChanged();
  const { mode, offset, ttsSpeed, ttsBase, ttsVoice } = p.settings;
  // Stay out of Write while applying incoming voices: no intermediate fallback may retime blocks.
  setMode('qc', true);
  if (offset != null) setOffset(offset);
  // Projects saved before there was a base speed were read at 100%, with an overall
  // speed for blocks without their own, which becomes the base speed.
  const base = isSpeed(ttsSpeed) ? baseFromSpeed(ttsSpeed, toBase(ttsBase)) : toBase(ttsBase);
  if (base !== tts.base) setTtsOption('base', base);
  if (ttsVoice) setTtsOption('voice', ttsVoice);
  if (typeof p.settings.ttsSkipNotes === 'boolean') setTtsOption('skipNotes', p.settings.ttsSkipNotes);
  S.qcSettings = readingSettings();
  if (review) for (const c of S.cues) { const r = reviewReading(review, c, S.qcSettings); if (r && c.qcReading == null) c.qcReading = r.offset; }
  S.review = review; S.reviewId = review ? crypto.randomUUID() : ''; S.reviewAudio = review ? null : p.reviewAudio || null; S.qcSource = review ? 'package' : 'video';
  syncQcPermission();
  if (review) { const wanted = S.reviewId; storedReview({ id: wanted, file }).then((saved) => { if (!saved && S.reviewId === wanted) toast('The QC audio could not be kept for recovery. Reopen the package after reloading'); }); } else storedReview(null);
  const missing = voiceReport(S.cues, p.settings, reviewVoices()).some((v) => v.id && !v.available);
  if (!review && !missing && mode && mode !== 'qc') setMode(mode, true);
  S.loadingProject = false;
  fitQcAll();
  changed();
  select(S.cues[p.view.selected]?.id ?? S.cues[0]?.id ?? null, { seek: false });
  S.pendingPlayhead = p.view.playhead ?? null;
  const ready = S.videoFile && sameMedia(p.media, S.videoFile);
  if (ready && S.pendingPlayhead != null) { seek(S.pendingPlayhead); S.pendingPlayhead = null; }
  projectSaved(file.name);
  if (review?.live) offerLiveVoices();
  if (!review && S.reviewAudio) {
    const restoring = restoreAuthorAudio(attachedAudio);
    if (attachedAudio) await restoring;
  }
  if (missing && !review && !S.reviewAudio) openQcPlayback();
  toast(`Opened ${file.name} (${S.cues.length} blocks)` + (p.media && !ready
    ? `. Now open its video, ${p.media.name}, with ${IS_MAC ? '⌘⇧O' : 'Ctrl+Shift+O'}` : ''));
  // A different video is open: this project's one replaces it, if it's remembered.
  if (p.media && !ready && S.videoFile && await handleStore.get(mediaKey(p.media))) closeVideo();
  if (p.media && !ready) reopenVideo(p.media, { ask: true }).then((ok) => { if (ok) toast(`Opened ${file.name} and its video, ${p.media.name}`); });
  return true;
}

// ---- recording files (see record.js and Guides/RECORDING.md)

const recFileDlg = $('recFileDlg');
// 1, 2 and 3, for block numbers in sentences.
const listNums = (n) => (n.length < 2 ? String(n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
function askRecordingFile() {
  if (!S.cues.some((c) => c.text.trim())) return toast('Write some blocks first: the recording file holds the script');
  let last = '01:00:00:00';
  try { last = localStorage.getItem('scribecue.recStart') || last; } catch { /* ignore */ }
  $('recFileStart').value = last;
  $('recFileFps').textContent = String(S.fps);
  // Which version this is, and the lines it asks the narrator for again.
  const lines = narratorBlocks().filter((c) => c.text.trim()), picks = pickupsFor(lines, S.recording?.sent);
  const nums = picks.flatMap((p, i) => (p ? [idx(lines[i].id) + 1] : []));
  const v = (S.recording?.version || 0) + 1;
  $('recFileVersion').textContent = v > 1
    ? `Version ${v}. ` + (nums.length ? `It asks for ${nums.length === 1 ? 'a pickup' : `${nums.length} pickups`}: block${nums.length === 1 ? '' : 's'} ${listNums(nums)}. Takes of the other blocks carry over.` : 'It asks for no pickups. Takes carry over.')
    : nums.length ? `It asks for ${nums.length === 1 ? 'a pickup' : `${nums.length} pickups`}: block${nums.length === 1 ? '' : 's'} ${listNums(nums)}.` : '';
  $('recFileVersion').hidden = !$('recFileVersion').textContent;
  recFileDlg.showModal();
  $('recFileStart').select();
}
// The script as a narrator gets it: an extended block's marker is too short to record in,
// so its slot runs as long as its reading, up to the next block.
function narratorBlocks() {
  return S.cues.map((c) => (isExt(c) && spoken(c.text) ? { ...c, extended: true } : c));
}
function saveRecordingFile() {
  const start = readTime($('recFileStart').value.trim());
  if (start == null || !(start >= 0)) return toast('That isn’t a timecode. Type it like 01:00:00:00');
  try { localStorage.setItem('scribecue.recStart', $('recFileStart').value.trim()); } catch { /* ignore */ }
  const m = S.videoFile ? { name: S.videoFile.name, size: S.videoFile.size, duration: S.hasVideo ? duration() : null } : S.projectMedia;
  const rid = S.recording?.id || newProjectId(), version = (S.recording?.version || 0) + 1;
  const file = toRecordingFile({ app: VERSION, blocks: narratorBlocks(), media: m, start, fps: S.fps, project: rid, version, sent: S.recording?.sent });
  S.recording = { id: rid, version, sent: file.blocks.map(({ start: s, end, text }) => ({ start: s, end, text })) };
  changed();
  const name = `${baseName()}${RECORDING_EXT}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  recFileDlg.close();
  const asked = file.blocks.filter((b) => b.pickup).length;
  toast(`Saved ${name}: version ${version}, ${file.blocks.length} blocks${asked ? `, ${asked} pickup${asked === 1 ? '' : 's'}` : ''}` + (m ? '' : '. Open the video first next time, so it can check the narrator has the right copy'));
}
$('recFileGo').addEventListener('click', saveRecordingFile);
$('recFileStart').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRecordingFile(); } });
$('recFileCancel').addEventListener('click', () => recFileDlg.close());
document.addEventListener('keydown', (e) => { if (recFileDlg.open || $('recExportDlg').open || $('narrDlg').open || $('recSessionDlg').open || $('recPackDlg').open) e.stopPropagation(); }, true);

// A narration zip (from Record mode) is checked by the narration WAV inside it.
async function openPackage(f) {
  const files = (await readZip(f)) || [];
  const notes = (await Promise.all(files.filter((x) => /\.wav$/i.test(x.name)).map((x) => readNote(x.blob)))).filter(Boolean);
  const note = notes.find((n) => !n.altOnly) || notes[0];
  if (!note) return toast(`${f.name} isn’t a narration zip from Scribecue`);
  checkNarration(note, f.name);
}

// A narration WAV opened here is checked against the script that's open, rather than
// opened as audio: it says whether the narrator recorded the lines as they were sent.
function checkNarration(note, name) {
  if (!S.cues.some((c) => c.text.trim())) return toast(`${name} is a narration. Open the script it was recorded from to check it against`);
  const r = compareScript(note, narratorBlocks());
  const out = [];
  if (r.edited) out.push('The recording file was changed outside Scribecue before this was recorded.');
  out.push(r.same ? `All ${note.blocks.length} blocks match this script.`
    : 'These blocks differ from the script open now. If you haven’t changed them since you sent the recording file, the narrator’s copy was changed.');
  const list = r.lines.map((x) => `Block ${x.line} ${x.why}`).concat(r.more ? [`and ${r.more} more`] : []);
  // Pickups: which were asked for, and which this WAV brings back.
  const asked = note.blocks.flatMap((b, i) => (b.pickup ? [i + 1] : [])), got = (note.picked || []).filter((n) => asked.includes(n));
  const left = asked.filter((n) => !got.includes(n));
  const pick = [];
  if (note.only) pick.push(`This WAV holds only pickups${note.version ? `, for version ${note.version} of the recording file` : ''}.`);
  else if (note.altOnly) pick.push('This WAV holds only the narrator’s alts.');
  else if (note.version) pick.push(`Recorded against version ${note.version} of the recording file.`);
  if (got.length) pick.push(`Pickups recorded: block${got.length === 1 ? '' : 's'} ${listNums(got)}.`);
  if (left.length) pick.push(`Still to record: block${left.length === 1 ? '' : 's'} ${listNums(left)}.`);
  $('narrPickups').textContent = pick.join(' ');
  $('narrPickups').hidden = !pick.length;
  // With the script unchanged, the blocks recorded can be unmarked here.
  const clear = r.same ? got.map((n) => S.cues.filter((c) => c.text.trim())[n - 1]).filter((c) => c?.pickup) : [];
  $('narrClear').hidden = !clear.length;
  $('narrClear').textContent = `Clear ${clear.length === 1 ? 'its pickup mark' : `their ${clear.length} pickup marks`}`;
  $('narrClear').onclick = () => {
    pushUndo();
    for (const c of clear) delete c.pickup;
    changed();
    updateEditor();
    $('narrDlg').close();
    toast(`Cleared ${clear.length} pickup mark${clear.length === 1 ? '' : 's'}. Undo brings ${clear.length === 1 ? 'it' : 'them'} back`);
  };
  showAlts(note, r.same);
  $('narrTitle').textContent = r.same && !r.edited ? 'The narration matches' : 'The narration doesn’t match';
  $('narrWhat').textContent = out.join(' ');
  $('narrList').textContent = list.join('\n');
  $('narrList').hidden = !list.length;
  $('narrDlg').showModal();
}
$('narrClose').addEventListener('click', () => $('narrDlg').close());
// Alts: wording the narrator recorded as well as the block's own. With the script as sent,
// each can become the block's text. Its timing stays, since the alt was read in its slot.
function showAlts(note, same) {
  const alts = note.blocks.flatMap((b, i) => (typeof b.alt === 'string' ? [{ n: i + 1, was: b.text, alt: b.alt }] : []));
  $('narrAlts').hidden = !alts.length;
  if (!alts.length) return;
  const lines = S.cues.filter((c) => c.text.trim()), can = same && S.mode === 'write';
  $('narrAltsWhat').textContent = `The narrator recorded ${alts.length === 1 ? 'an alt' : `${alts.length} alts`}: wording of their own, as well as the script’s.`
    + (can ? ' Use one to make it the block’s text.' : same ? ' Switch to Write mode to use one.' : ' Open the script as it was sent to use them.');
  $('narrAltList').replaceChildren(...alts.map(({ n, was, alt }) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.append(Object.assign(document.createElement('span'), { className: 'num', textContent: `Block ${n}` }), ` “${alt}”`,
      Object.assign(document.createElement('span'), { className: 'dim', textContent: ` was “${was}”` }));
    li.append(text);
    if (can) {
      const use = Object.assign(document.createElement('button'), { textContent: 'Use' });
      use.setAttribute('aria-label', `Use the alt for block ${n}`);
      use.addEventListener('click', () => {
        const c = lines[n - 1];
        if (!c || c.text !== was) return toast(`Block ${n} has changed since. Edit it yourself`);
        pushUndo();
        c.text = alt;
        delete c.auto; // the alt was read in the block's slot, so the block keeps its timing
        changed(c.id);
        updateEditor();
        use.replaceWith(Object.assign(document.createElement('span'), { className: 'dim', textContent: 'Used' }));
        toast(`Block ${n} now reads as the alt. Undo brings back the old wording`);
      });
      li.append(use);
    }
    return li;
  }));
}

recorder = initRecord({
  video, toast,
  blocks: () => S.cues,
  selIdx, hasVideo: () => S.hasVideo,
  select: (i) => { if (S.cues[i] && S.cues[i].id !== S.sel) select(S.cues[i].id, { seek: false }); },
  redraw: () => { tlDirty = true; },
  retext: () => { S.activeId = undefined; updateActive(now()); },
  // The Alt switch moved: the block's text box shows the alt's wording, ready to type.
  altChanged: (focus) => {
    updateEditor();
    if (focus && selCue()) { edText.focus(); edText.setSelectionRange(edText.value.length, edText.value.length); }
    else if (document.activeElement === edText) edText.blur();
  },
  duration: () => (S.hasVideo ? duration() : 0),
  seek: (t) => seek(t),
  baseName: () => baseName().replace(/\.[^.]+$/, ''),
  volume: (on, db = 0) => { recVol = on ? 10 ** (db / 20) : 1; applyDuck(0); },
  app: VERSION,
});

// Opens a recording file in Record mode: the script, locked, ready to record against.
async function openRecording(file) {
  let r, raw;
  try { raw = JSON.parse(await file.text()); r = fromRecordingFile(raw); }
  catch (e) { return toast(`Couldn’t open ${file.name}: ${e instanceof SyntaxError ? 'the file is damaged' : e.message}`); }
  if (!okToReplace(`Open ${file.name}`)) return;
  await stopJob();
  await recorder.close();
  pushUndo();
  await enterRecording(r, file.name, raw);
  const ready = S.videoFile && sameVideo(r.media, { name: S.videoFile.name, duration: S.hasVideo ? video.duration : null });
  if (r.edited) toast(`${file.name} was changed outside Scribecue. Whoever sent it will see that when they check the narration`);
  else toast(`Record mode: ${file.name} (${S.cues.length} blocks). ` + (ready || !r.media ? 'Select a block and press Enter to record it'
    : `Now open the video, ${r.media.name}, with ${IS_MAC ? '⌘⇧O' : 'Ctrl+Shift+O'}`));
  if (r.media && !ready) reopenVideo(r.media, { ask: true });
}
// The recording that's open is remembered, so a reload comes back to it, still locked.
const REC_OPEN = 'scribecue.recOpen';
// raw: the recording file as opened, for its session (see session.js).
async function enterRecording(r, name, raw = null) {
  try { localStorage.setItem(REC_OPEN, JSON.stringify({ ...r, name, raw })); } catch { /* storage full or blocked */ }
  // Pickups as the recording file asks for them: { note?, was?, added? }.
  S.projectId = newIdentity();
  S.reviewHistory = null;
  S.cues = r.blocks.map((b) => Object.assign(revive(b), b.pickup ? { pickup: b.pickup } : {}));
  S.extendedAll = false; // each block says, in a recording file
  S.handle = null;
  handleStore.set(null);
  showAutosave();
  S.projectMedia = r.media;
  clearReview();
  S.comments = [];
  S.notes = '';
  S.words = [];
  aiNotesChanged();
  setFps(r.fps);
  setMode('record', true);
  changed();
  select(S.cues[0]?.id ?? null, { seek: false });
  projectSaved(name);
  await recorder.open(r, raw);
  $('exportPickups').hidden = !recorder.pickups;
  // Takes may be in the browser's storage, so ask it not to clear them to free up space.
  keepStorage();
}

// Opens a session package (a zip of a recording's session folder, from Record mode on any
// computer): its takes go in a folder the narrator chooses, or in the browser, and the
// recording opens in Record mode with them.
async function openSessionPackage(file) {
  let s, r;
  const files = await readZip(file);
  const index = files?.find((f) => f.name === SESSION_FILE);
  try {
    if (!index) throw new Error('it isn’t a Scribecue recording session');
    s = fromSession(JSON.parse(await index.blob.text()));
    r = fromRecordingFile(s.recording);
    if (takesKey(r) !== s.key) throw new Error('the session is damaged');
  } catch (e) { return toast(`Couldn’t open ${file.name}: ${e instanceof SyntaxError ? 'the file is damaged' : e.message}`); }
  if (!canUseFolders() && !canKeepInBrowser()) return toast(`This browser can’t open ${file.name}. Open it in Chrome, Edge or Firefox`);
  if (!okToReplace(`Open ${file.name}`)) return;
  await stopJob();
  await recorder.close();
  const n = s.takes.length, takes = `${n} take${n === 1 ? '' : 's'}`;
  const got = canUseFolders()
    ? await recorder.chooseWhere({ intro: `Choose a folder for the ${takes} in ${file.name}. They’re copied there, and new takes are saved there too.`,
      sub: file.name.replace(/\.[^.]+$/, '') })
    : 'browser';
  if (!got) return;
  const dir = got === 'browser' ? await browserFolder(s.key) : got;
  await asJob(async () => {
    jobText.textContent = `Opening ${file.name}`; jobBar.value = 0; jobBox.hidden = false;
    try {
      await unpackSession(dir, files, (done, total) => { jobBar.value = done / total; jobText.textContent = `Opening ${file.name}: ${Math.round((done / total) * 100)}%`; });
    } catch (e) { toast(`Couldn’t open ${file.name}: ${e.message}`); return; }
    await rememberSession(s.key, got === 'browser' ? 'browser' : dir);
    pushUndo();
    await enterRecording(r, file.name, s.recording);
    toast(`Record mode: ${file.name}, with ${takes}` + (got === 'browser' ? '' : `, kept in ${dir.name}`));
    const ready = S.videoFile && sameVideo(r.media, { name: S.videoFile.name, duration: S.hasVideo ? video.duration : null });
    if (r.media && !ready) reopenVideo(r.media, { ask: true });
  });
}
// The script stays locked: it closes with the recording, and neither undo nor a reload
// brings it back to edit. The video stays open.
async function endRecording() {
  if (S.mode !== 'record') return;
  try { localStorage.removeItem(REC_OPEN); } catch { /* ignore */ }
  await recorder.close();
  undoStack.length = 0;
  redoStack.length = 0;
  S.projectId = newIdentity();
  S.reviewHistory = null;
  S.cues = [];
  S.extendedAll = false;
  S.subName = 'untitled.srt';
  S.projectMedia = null;
  setMode('write', true);
  changed();
  select(null);
  S.dirty = false;
  showDocName();
  save();
}
async function leaveRecord() {
  await endRecording();
  toast('Left Record mode. Your takes are kept: open the recording file again to carry on');
}

// Projects saved before 0.62 have none of these, and leave the settings as they are.
function projectSound({ ttsDuck, ttsDipDb, ttsDipFade, ttsMix }) {
  if (typeof ttsDuck === 'boolean' && ttsDuck !== tts.duck) setTtsOption('duck', ttsDuck);
  if (isDip(ttsDipDb) && ttsDipDb >= 1 && ttsDipDb !== tts.dipDb) setTtsOption('dipDb', ttsDipDb);
  if (FADES.includes(ttsDipFade) && ttsDipFade !== tts.dipFade) setTtsOption('dipFade', ttsDipFade);
  if (ttsMix != null && ttsMix !== tts.mix) { setMix(ttsMix); showMix(); duckAudio(); }
}

// Ctrl/Cmd+O: a project, or a script saved as SRT, VTT or .adc.
// Open: a project, a script, a video or audio file, or several at once, each opened as
// what it is. A project opened this way can be saved back to its own file.
async function openAny() {
  if (!window.showOpenFilePicker) return fileSubs.click();
  try {
    const handles = await picker('open');
    // Videos first, so a project picked with its video finds it already open.
    const files = await Promise.all(handles.map(async (h) => [h, await h.getFile()]));
    const isProject = ([, f]) => isDoc(f.name);
    for (const [h, file] of files.filter((x) => !isProject(x))) {
      openFiles([file]);
      if (!SCRIPT.test(file.name)) rememberVideo(h, file);
    }
    for (const [h, file] of files.filter(isProject)) openProject(file, h);
  } catch (e) {
    if (refused(e)) fileSubs.click();
    else if (e.name !== 'AbortError') toast(`Couldn’t open the file: ${e.message}`);
  }
}

// New: closes the video and clears the blocks, after asking.
// New: a choice between clearing only the blocks and starting a whole new project.
const newDlg = $('newDlg');
function startAgain() {
  const blocks = S.cues.length, media = S.videoFile?.name;
  if (!blocks && !media && !S.comments.length && !S.dirty && !S.reviewId) return newProject(false);
  const n = blocks === 1 ? '1 block' : `${blocks} blocks`;
  $('newWhat').textContent = S.comments.length && !blocks && !media ? `This project has ${S.comments.length} timeline comments.` : blocks ? `This project has ${n}${media ? `, with ${media} open` : ''}.` : media ? `${media} is open, with no blocks yet.` : 'This project has no blocks yet.';
  newDlg.querySelector('[data-choice="blocks"]').hidden = !blocks || qc();
  $('newUnsaved').hidden = !S.dirty;
  $('newSave').hidden = !S.dirty;
  $('newProjectLabel').textContent = S.dirty ? 'Start without saving' : 'New project';
  $('newProjectNote').textContent = qc() ? 'Closes this review and the video, then opens a blank project in Write mode.' : 'Clears the blocks and notes, and closes the video, for different work.';
  $('newUndo').hidden = !!S.reviewId;
  newDlg.showModal();
  newDlg.querySelector(`[data-choice="${blocks && !qc() ? 'blocks' : 'project'}"]`).focus();
}
for (const b of newDlg.querySelectorAll('.wzchoice')) {
  b.addEventListener('click', () => {
    newDlg.close();
    if (b.dataset.choice === 'blocks') clearBlocks(); else newProject(false);
  });
}
$('newSave').addEventListener('click', async () => {
  const b = $('newSave');
  if (b.disabled) return;
  b.disabled = true;
  for (const choice of newDlg.querySelectorAll('.wzchoice')) choice.disabled = true;
  try {
    await startNewProject({ saveFirst: true, save: () => saveProject(), isDirty: () => S.dirty, start: () => { if (newDlg.open) { newDlg.close(); newProject(false); } } });
  } finally {
    b.disabled = false;
    for (const choice of newDlg.querySelectorAll('.wzchoice')) choice.disabled = false;
  }
});
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
  const leavingQc = qc(), leavingPackage = !!S.reviewId;
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
  S.projectId = newIdentity();
  S.reviewHistory = null;
  S.cues = [];
  S.handle = null;
  handleStore.set(null);
  showAutosave();
  S.projectMedia = null;
  S.pendingPlayhead = null;
  clearReview();
  S.qcSettings = null;
  S.qcPreviewVoice = '';
  S.comments = [];
  if (!$('commentsDrawer').hidden) toggleComments(false);
  S.notes = '';
  S.words = [];
  S.recording = null;
  if (leavingPackage) { undoStack.length = 0; redoStack.length = 0; }
  if (leavingQc) setMode('write', true);
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
  if (S.mode === 'record') return toast('The script is locked in Record mode');
  if (qc() && S.reviewId) return toast('To send your review back, save the QC package and send that file');
  if (!S.cues.length) return toast('Nothing to export yet');
  checkFirst(() => writeSubs(fmt));
}
function writeSubs(fmt) {
  // Blocks marked extended are short on the timeline, but not in another tool.
  const ext = hasExtended(), length = (c) => (spoken(c.text) ? speechLength(said(c), c.speed, c.voice) : { secs: 0, exact: true });
  const cues = ext ? timedScript(S.cues, S.extendedAll, (c) => length(c).secs, withPauses()) : S.cues;
  const text = fmt === 'vtt' ? toVTT(cues) : toSRT(cues);
  const name = `${baseName()}.${fmt}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  const speeds = fmt === 'srt' && S.cues.some((c) => c.speed);
  const about = ext && S.cues.some((c) => isExt(c) && !length(c).exact);
  toast(`Exported ${name} (${S.cues.length} cues)` + (withPauses() ? ', timed to the extended video' : '') + (speeds ? '. SRT can’t store block speeds: export VTT to keep them' : '') +
    (about ? '. Some reading lengths are estimates' : ''));
}

// Scripts Scribecue opens: SRT, VTT, plain text, and Frazier's .adc files.
const SCRIPT = /\.(srt|vtt|txt|adc)$/i;
async function loadSubsFile(file) {
  let text;
  try { text = await file.text(); } catch (e) { return toast(`Couldn’t read ${file.name}${readProblem(e)}`); }
  const adc = /\.adc$/i.test(file.name) ? parseAdc(text) : null;
  const parsed = adc ? adc.cues : parseSubs(text);
  if (!parsed.length) return toast(`No cues found in ${file.name}`);
  if (!okToReplace(`Open ${file.name}`)) return;
  await stopJob();
  await endRecording();
  pushUndo();
  clearReview();
  S.comments = [];
  S.projectId = newIdentity();
  S.reviewHistory = null;
  S.cues = parsed.map((c) => Object.assign(mk(c.start, c.end, c.text, c.speed), c.voice ? { voice: c.voice } : {}, blockDipOf(c), isVol(c.vol) ? { vol: c.vol } : {}, c.say ? { say: c.say } : {}));
  S.subName = file.name;
  S.recording = null; // a different script: recording files from it start again
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
  await askVoices(adc, file.name);
  afterImport(file.name);
}

// A Frazier script names a Google voice for itself, and maybe others for some blocks: ask
// whether to read with them, or with others. Closing the question, or with text to speech
// off, keeps the voice in Settings, and blocks keep their own.
const voiceDlg = $('voiceDlg');
let voiceList = [], voiceDone = null;
const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0]);
const blocksOf = (n) => `${n} block${n === 1 ? '' : 's'}`;
function askVoices(adc, name) {
  voiceList = adc ? scriptVoices({ cues: S.cues, voice: adc.voice }) : [];
  if (!ttsOn() || !voiceList.length || (voiceList.length === 1 && voiceList[0].main && [tts.voice, chosenVoice()].includes(voiceList[0].uri))) return Promise.resolve();
  const main = voiceList.find((v) => v.main), own = voiceList.filter((v) => !v.main);
  $('voiceWhat').textContent = main
    ? `${name} reads with ${voiceLabel(main.uri)}${own.length ? `, and ${andList(own.map((v) => `${blocksOf(v.blocks)} with ${voiceLabel(v.uri)}`))}` : ''}.`
    : `In ${name}, ${andList(own.map((v) => `${blocksOf(v.blocks)} ${v.blocks === 1 ? 'reads' : 'read'} with ${voiceLabel(v.uri)}`))}.`;
  const one = voiceList.length === 1;
  $('voiceTitle').textContent = one ? 'Use the script’s voice?' : 'Use the script’s voices?';
  $('voiceScript').textContent = one ? 'Use the script’s voice' : 'Use the script’s voices';
  $('voiceOther').textContent = one ? 'Choose another voice' : 'Choose other voices';
  const here = reviewVoices().map((v) => v.id);
  const away = voiceList.filter((v) => !here.includes(v.uri));
  $('voiceScriptNote').textContent = away.length
    ? `${andList(away.map((v) => voiceLabel(v.uri)))} ${away.length === 1 ? 'isn’t' : 'aren’t'} available here. ${missingVoiceAdvice(away[0].uri, { googleKey: hasGoogleKey(), pollyKey: hasPollyKey(), hosted: HOSTED }).replace(/\bit\b/, away.length === 1 ? 'it' : 'them')} Until then, blocks are read with ${chosenVoiceName()}.`
    : (main ? `The project reads with ${voiceLabel(main.uri)}${own.length ? ', and blocks keep their own voices' : ''}.` : 'Blocks keep their own voices.')
      + (voiceList.some((v) => cloudOf(v.uri) === 'Google') ? ' Each reading sends the block’s text to Google.' : '');
  $('voiceAsk').hidden = false;
  $('voicePick').hidden = true;
  voiceDlg.showModal();
  voiceDlg.querySelector('.wzchoice').focus();
  return new Promise((resolve) => { voiceDone = resolve; });
}
// One menu for each of the script's voices: the project's voice starts at the one in
// Settings, and a block voice at itself, or the project's voice.
function fillVoiceRows() {
  $('voiceRows').replaceChildren(...voiceList.map((v) => {
    const label = document.createElement('label'), sel = document.createElement('select');
    label.className = 'recfield';
    label.textContent = v.main ? `The project’s voice, instead of ${voiceLabel(v.uri)}` : `${blocksOf(v.blocks)}, instead of ${voiceLabel(v.uri)}`;
    fillVoiceSelect(sel, v.main ? chosenVoice() : v.uri);
    if (!v.main) sel.prepend(new Option('Same as the project’s voice', ''));
    if (![...sel.options].some((o) => o.value === v.uri)) sel.add(new Option(`${voiceLabel(v.uri)}: not available here`, v.uri), v.main ? 0 : 1);
    sel.value = v.main ? chosenVoice() : v.uri;
    sel.dataset.uri = v.uri;
    sel.dataset.main = v.main ? '1' : '';
    label.append(sel);
    return label;
  }));
}
function useVoices(picks) {
  const main = picks.find((p) => p.main);
  if (main && main.to && main.to !== tts.voice) setTtsOption('voice', main.to);
  const swaps = Object.fromEntries(picks.filter((p) => !p.main).map((p) => [p.uri, p.to]));
  swapVoices(S.cues, swaps, main?.to || chosenVoice());
  changed();
  voiceDlg.close();
}
for (const b of voiceDlg.querySelectorAll('.wzchoice')) {
  b.addEventListener('click', () => {
    if (b.dataset.choice === 'script') return useVoices(voiceList.map((v) => ({ ...v, to: v.uri })));
    fillVoiceRows();
    $('voiceAsk').hidden = true;
    $('voicePick').hidden = false;
    $('voiceRows').querySelector('select')?.focus();
  });
}
$('voiceBack').addEventListener('click', () => {
  $('voicePick').hidden = true;
  $('voiceAsk').hidden = false;
  voiceDlg.querySelector('[data-choice="other"]').focus();
});
$('voiceUse').addEventListener('click', () => {
  useVoices([...$('voiceRows').querySelectorAll('select')].map((sel) => ({ uri: sel.dataset.uri, main: !!sel.dataset.main, to: sel.value })));
});
voiceDlg.addEventListener('close', () => { voiceDone?.(); voiceDone = null; });
voiceDlg.addEventListener('click', (e) => { if (e.target === voiceDlg) voiceDlg.close(); });
document.addEventListener('keydown', (e) => { if (voiceDlg.open) e.stopPropagation(); }, true);

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

// Playing without a video, there's no sound to keep time by. Firefox only turns the sound
// output on when a reading starts, which takes up to half a second, and a reading can
// take a moment to make, so readings started and ended late. So while playing with text
// to speech on, silence plays, and the clock waits for it to start, as a video's does,
// and for each reading to start, for up to a second and a half.
const silence = new Audio();
silence.loop = true;
let silenceAt = 0, silenceOn = false, silenceFailed = false, waitingSince = 0;
function soundStarted(ts) {
  if (!ttsOn()) return true;
  if (!silenceOn && !silenceFailed) {
    if (silence.paused) {
      silence.src ||= URL.createObjectURL(writeWav(new Int16Array(8000), 8000));
      silenceAt = ts;
      silence.play().catch(() => { silenceFailed = true; });
      return false;
    }
    silenceOn = silence.currentTime > 0 || ts - silenceAt > 1000;
    if (!silenceOn) return false;
  }
  if (!readingStarting()) { waitingSince = 0; return true; }
  waitingSince ||= ts;
  return ts - waitingSince > 1500;
}
function stopSilence() {
  waitingSince = 0;
  if (silence.paused) return;
  silence.pause();
  silence.currentTime = 0;
  silenceOn = false;
}

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
  resetDialogue();
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
  const { tracks, fps, video: codec, subs = [] } = await probeTracks(file);
  if (S.videoFile !== file) return;
  if (fps) setFps(fps);
  startDialogue(file, subs);
  S.videoCodec = videoName(codec);
  const canPlay = (t) => video.canPlayType(t);
  const gone = [...missing([S.videoCodec, ...tracks.map((t) => t.codec)], canPlay), ...silentSound(tracks.map((t) => t.codec), canPlay)];
  if (gone.length) showCodecAlert(file, gone);
  S.tracks = tracks;
  renderTrackPicker();
  if (tracks.length < 2) return buildWaveform(file, 0, needsCopy(0));
  // transcribing description is the point, so prefer a track marked as AD
  let pick = tracks.findIndex((t) => t.ad);
  if (pick >= 0) toast(`Using the audio description track (${trackLabel(pick)}). Press T to switch tracks`);
  else {
    pick = Math.max(0, tracks.findIndex((t) => t.default));
    toast(`This file has ${tracks.length} audio tracks. Press T to switch`);
  }
  selectTrack(pick);
}

// When the browser can't play a file, as with Chromium builds without H.264 or AAC: say
// what's missing and, with ffmpeg in Docker, offer to make a copy that plays.
let codecFor = null, codecGone = [], codecJob = false;
function showCodecAlert(file, gone) {
  if (codecJob) return;
  codecFor = file;
  codecGone = gone.length ? gone : codecGone;
  const box = $('codecAlert');
  const fresh = box.hidden;
  $('codecAlertText').textContent = advice(codecGone, { file: file.name, ffmpeg: !!tts.ffmpeg });
  box.classList.toggle('nocopy', noBrowserOpens(file.name)); // ffmpeg's copy doesn't take these
  if (fresh) $('codecStatus').textContent = '';
  box.hidden = false;
  if (fresh) announce(box.querySelector('h2').textContent + '. ' + $('codecAlertText').textContent, IS_MAC);
  if (!HOSTED && !tts.ffmpeg) checkFfmpeg().then((v) => v && !box.hidden && ($('codecAlertText').textContent = advice(codecGone, { file: file.name, ffmpeg: true })));
}
$('codecOk').addEventListener('click', () => {
  if (codecJob) $('codecStop').click();
  $('codecAlert').hidden = true;
  codecGone = [];
});
$('codecStop').addEventListener('click', () => {
  mixStopped = true;
  ffXhr?.abort();
  if (ffJob) ffCall('DELETE', `jobs/${ffJob}`).catch(() => {});
});
$('codecCopy').addEventListener('click', async () => {
  const file = codecFor, ext = file?.name.split('.').pop().toLowerCase();
  const status = $('codecStatus'), bar = $('codecBar');
  if (!file || !FF_VIDEOS.includes(ext)) return (status.textContent = `ffmpeg can copy an MP4, MOV, MKV or WebM video, not a .${ext} file.`);
  const copy = copyKind(S.videoCodec, codecGone);
  const name = file.name.replace(/\.[^.]+$/, '') + ' (copy)';
  const show = (f, msg) => { bar.value = f; status.textContent = msg; };
  codecJob = true;
  mixStopped = false;
  busy($('codecCopy'), bar, true);
  $('codecStop').hidden = false;
  try {
    const { id } = await ffCall('POST', 'jobs', { copy, video: ext, name });
    ffJob = id;
    const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
    await ffPut(`jobs/${id}/video`, file, (f) => show(0.1 * f, `Sending to ffmpeg: ${gb(f * file.size)} of ${gb(file.size)}`));
    if (mixStopped) throw stopped();
    await ffCall('POST', `jobs/${id}/start`);
    for (;;) {
      if (mixStopped) throw stopped();
      const j = await ffCall('GET', `jobs/${id}`);
      if (j.state === 'failed') throw new Error(`ffmpeg: ${j.error}`);
      show(0.1 + 0.85 * j.done, `Making the copy: ${Math.round(j.done * 100)}%`);
      if (j.state === 'done') break;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    show(0.95, 'Opening the copy…');
    // ffmpeg deletes the copy once it has sent it, so it's kept here, opened, and downloaded.
    const r = await fetch(`ffmpeg/jobs/${id}/result`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`ffmpeg answered ${r.status}`);
    ffJob = null;
    const out = new File([await r.blob()], `${name}.${copy}`, { type: `video/${copy}` });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(out), download: out.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    // The project carries on with the copy, once saved.
    if (S.projectMedia && sameMedia(S.projectMedia, file)) {
      S.projectMedia = { ...S.projectMedia, name: out.name, size: out.size };
      S.dirty = true;
    }
    $('codecAlert').hidden = true;
    codecGone = [];
    loadVideoFile(out);
    toast(`Opened ${out.name}, and downloaded it so you keep it`);
  } catch (e) {
    if (ffJob) ffCall('DELETE', `jobs/${ffJob}`).catch(() => {});
    ffJob = null;
    status.textContent = e.stopped ? 'Stopped.' : `Couldn’t make the copy: ${e.message}`;
  } finally {
    codecJob = false;
    busy($('codecCopy'), bar, false);
    $('codecCopy').hidden = !tts.ffmpeg;
    $('codecStop').hidden = true;
  }
});

// A track the video can't play at all, as AC-3 is in most browsers.
const needsCopy = (i) => copiesSound(S.tracks[i]?.codec, (t) => video.canPlayType(t));

// Safari can switch tracks itself; everywhere else we copy the track out.
const nativeSwitching = () => video.audioTracks && video.audioTracks.length === S.tracks.length;

function selectTrack(i) {
  const file = S.videoFile;
  if (!file || !S.tracks[i]) return;
  S.track = i;
  renderTrackPicker();
  const multi = S.tracks.length > 1, native = multi && nativeSwitching(), copied = needsCopy(i) || (multi && !native);
  if (native) {
    for (let k = 0; k < video.audioTracks.length; k++) video.audioTracks[k].enabled = k === i;
    useNativeAudio();
  }
  const cached = trackCache.get(i);
  if (cached) {
    resetWaveform();
    Object.assign(S, { peaks: cached.peaks, peakLen: cached.peakLen, peakMax: cached.peakMax });
    if (copied) {
      if (cached.audio) useAltAudio(cached.audio);
      else {
        useNativeAudio();
        toast(`Can't play track ${i + 1} on its own: ${cached.reason}`);
      }
    }
    if (multi) toast(`Audio: ${trackLabel(i)}`);
    return;
  }
  buildWaveform(file, i, copied);
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

// ---------------------------------------------------------------- the dialogue lane
//
// A video's subtitles, on a strip of their own under the blocks, so the gaps can be seen
// (see dialogue.js). They come from a track in the file, read in a worker while the video
// stays usable, or from a subtitle file. They stay in this browser, with the video's name:
// they aren't part of the script or the project.

let dialWorker = null, dialGen = 0;
// Going through a whole file takes the CPU from a video that's playing, and the lane can
// wait, so that kind of read rests until the video stops. See paceWave.
let dialScans = false, dialWaiting = false;
let dialDrawn = '', dialGaps = [], dialGapsFor = '';
const dialColors = () => ({ bar: C.line, text: C.text, dim: C.dim, panel: C.panel });

function resetDialogue() {
  dialGen++;
  dialWorker?.terminate();
  dialWorker = null;
  S.subTracks = [];
  S.dialogue = null;
  S.dialStatus = '';
  delete $('dialSel').dataset.reading;
  renderDialPick();
  showClashes();
}

// A subtitle track's name in the picker.
function dialLabel(t) {
  let lang = t.lang;
  try { if (lang && langNames) lang = langNames.of(lang); } catch { /* unknown code */ }
  return [lang || 'Unknown language', t.forced && 'forced', t.hearing && 'SDH', t.name && `“${t.name}”`, !t.text && `${t.codec}: pictures, can’t be read`].filter(Boolean).join(' · ');
}

function renderDialPick() {
  const sel = $('dialSel'), d = S.dialogue;
  $('dialPick').hidden = !S.videoFile;
  sel.textContent = '';
  const add = (value, text, disabled = false) => {
    const o = document.createElement('option');
    Object.assign(o, { value, textContent: text, disabled });
    sel.append(o);
  };
  add('off', 'Off');
  S.subTracks.forEach((t, i) => add(`t${i}`, dialLabel(t), !t.text));
  if (d?.choice === 'file') add('file', d.label);
  add('load', 'Load a subtitle file…');
  sel.value = sel.dataset.reading || d?.choice || 'off';
  dialTrack.hidden = !d && !S.dialStatus;
  dialDrawn = '';
  tlDirty = true;
}

function useDialogue(file, entry, { keep = true } = {}) {
  S.dialogue = { ...buildDialogue(entry.lines), choice: entry.choice, label: entry.label };
  S.dialStatus = '';
  delete $('dialSel').dataset.reading;
  dialGapsFor = '';
  renderDialPick();
  showClashes();
  if (keep) saveDialogue(dialogueKey(file), { choice: entry.choice, label: entry.label, lines: S.dialogue.lines });
  return S.dialogue.lines.length;
}

function offDialogue(file) {
  dialGen++;
  dialWorker?.terminate();
  dialWorker = null;
  S.dialogue = null;
  S.dialStatus = '';
  delete $('dialSel').dataset.reading;
  renderDialPick();
  showClashes();
  saveDialogue(dialogueKey(file), { choice: 'off', label: '', lines: [] });
}

// What a video shows when it opens: what it showed last time, or its best subtitle track.
async function startDialogue(file, subs) {
  S.subTracks = subs;
  renderDialPick();
  const gen = dialGen, kept = await loadDialogue(dialogueKey(file));
  if (gen !== dialGen || S.videoFile !== file) return;
  if (kept?.choice === 'off') return;
  if (kept) { useDialogue(file, kept, { keep: false }); return; }
  const best = bestTrack(subs);
  if (best >= 0) readSubTrack(file, best);
  else if (subs.length && subs.every((t) => !t.text)) toast('This video’s subtitles are pictures, so there’s no dialogue lane. Load a subtitle file to add one');
}

function readSubTrack(file, i) {
  dialWorker?.terminate();
  const gen = ++dialGen, t = S.subTracks[i], sel = $('dialSel');
  dialScans = t.scan;
  S.dialogue = null;
  S.dialStatus = 'Reading subtitles 0%';
  sel.dataset.reading = `t${i}`;
  renderDialPick();
  let w;
  const stop = (why) => {
    w?.terminate();
    if (gen !== dialGen) return;
    dialWorker = null;
    S.dialStatus = '';
    delete sel.dataset.reading;
    renderDialPick();
    toast(`Couldn’t read the subtitles: ${why}`);
  };
  try { w = dialWorker = new Worker('js/wave-worker.js'); } catch { return stop('workers are unavailable'); }
  w.onmessage = ({ data: m }) => {
    if (gen !== dialGen) return;
    if (m.type === 'progress') { S.dialStatus = `Reading subtitles ${Math.round(m.done * 100)}%`; dialDrawn = ''; tlDirty = true; }
    else if (m.type === 'subs') {
      w.terminate();
      dialWorker = null;
      const n = useDialogue(file, { choice: `t${i}`, label: dialLabel(t), lines: m.cues });
      toast(n ? `Dialogue lane: ${n.toLocaleString('en')} subtitles. D and Shift+D jump between free gaps` : 'No dialogue found in those subtitles');
    } else if (m.type === 'unsupported' || m.type === 'error') stop(m.message);
  };
  w.onerror = (e) => { e.preventDefault(); stop('the worker crashed'); };
  w.postMessage({ cmd: 'subs', file, track: i });
  wavePace = null;
  paceWave();
}

// A subtitle file for this video, for one with no track that can be read.
async function loadDialogueFile() {
  const file = S.videoFile;
  let sub;
  if (window.showOpenFilePicker) {
    try { sub = await (await picker('subtitles'))[0].getFile(); } catch (e) {
      if (!refused(e)) { if (e.name !== 'AbortError') toast(`Couldn’t open the file: ${e.message}`); return; }
    }
  }
  sub ||= await new Promise((ok) => {
    const input = $('fileDialogue');
    input.value = '';
    input.onchange = () => ok(input.files[0]);
    input.oncancel = () => ok(null);
    input.click();
  });
  if (!sub || S.videoFile !== file) return;
  let text;
  try { text = await sub.text(); } catch (e) { return toast(`Couldn’t read ${sub.name}${readProblem(e)}`); }
  const lines = parseSubs(text);
  if (!lines.length) return toast(`No subtitles found in ${sub.name}`);
  dialGen++;
  dialWorker?.terminate();
  dialWorker = null;
  const n = useDialogue(file, { choice: 'file', label: sub.name, lines });
  toast(`Dialogue lane: ${n.toLocaleString('en')} subtitles from ${sub.name}. D and Shift+D jump between free gaps`);
}

$('dialSel').addEventListener('change', (e) => {
  const v = e.target.value, file = S.videoFile;
  e.target.blur();
  if (!file) return;
  if (v === 'off') offDialogue(file);
  else if (v === 'load') { renderDialPick(); loadDialogueFile(); }
  else if (v[0] === 't') readSubTrack(file, +v.slice(1));
});

const currentGaps = () => {
  const d = S.dialogue, dur = duration(), key = `${dur}`;
  if (!d) return [];
  if (key !== dialGapsFor) { dialGaps = gapsOf(d.spans, dur); dialGapsFor = key; }
  return dialGaps;
};

function drawDialogueLane() {
  if (dialTrack.hidden) return;
  const [w, h] = box(dialWave), drawn = `${S.view}|${S.pps}|${w}|${h}|${S.dialStatus}|${dialWaiting}|${duration()}`;
  if (drawn === dialDrawn) return;
  dialDrawn = drawn;
  const [g, W, H] = fitCanvas(dialWave);
  drawDialogue(g, W, H, S.view, S.pps, S.dialogue, currentGaps(), dialColors());
  if (S.dialStatus) {
    g.fillStyle = C.dim;
    g.font = '11px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    g.fillText(S.dialStatus + (dialWaiting ? ', waiting while the video plays' : ''), 8, H / 2);
  }
}

dialTrack.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  S.playUntil = null;
  seek(xToT(e.clientX));
});
dialTrack.addEventListener('dblclick', (e) => {
  if (S.mode !== 'record') gapBlock(xToT(e.clientX), true);
});

const NO_LANE = 'No dialogue lane. Pick subtitles next to Dialogue, under the video';

// Goes to the next stretch with room for a block, so it passes gaps already filled.
function jumpGap(dir) {
  if (!S.dialogue) return toast(NO_LANE);
  const gap = gapFrom(freeGaps(currentGaps(), S.cues), now(), dir);
  if (!gap) return toast(dir < 0 ? 'No free gap before the playhead' : 'No free gap after the playhead');
  S.playUntil = null;
  seek(gap.start);
  toast(`Gap of ${(gap.end - gap.start).toFixed(1)} s`);
}

// A block filling the free gap at t, ready to type in: from t, or from the gap's start
// when whole, as where a double-click lands on the lane doesn't mean anything.
function gapBlock(t = now(), whole = false) {
  if (qcLocked()) return toast('The script and timings are fixed in QC mode');
  if (!S.dialogue) return toast(NO_LANE);
  const near = 0.02; // a seek lands a frame or so off
  const gap = freeGaps(currentGaps(), S.cues, MIN_DUR).find((g) => g.start - near <= t && t < g.end);
  if (!gap) return toast('The playhead isn’t in a free gap');
  const { start, end } = placeInGap(gap, whole ? gap.start : t);
  if (end - start < MIN_DUR) return toast('No room for a block here');
  const c = addBlock(start, end);
  if (whole) { S.playUntil = null; seek(c.start); }
  editText();
}

// How many seconds of a block's sound fall over dialogue: its reading with text to speech
// on, otherwise the block itself. 0 if there's too little to mention. Transcribing and
// recording aren't timed around the dialogue, so it doesn't apply there.
function overDialogue(c) {
  if (!S.dialogue || !(writing() || qc()) || !c.text.trim() || isExt(c)) return 0;
  if (ttsOn() && !spoken(c.text)) return 0;
  const end = ttsOn() ? c.start + speechLength(said(c), c.speed, c.voice).secs : c.end;
  const secs = speechIn(S.dialogue.spans, c.start, end);
  return secs >= MIN_CLASH ? secs : 0;
}

function showClashes() {
  refreshList();
  updateEditor();
  tlDirty = true;
}

function jumpClash(dir) {
  if (!S.dialogue) return toast(NO_LANE);
  const t = now(), near = 0.02, over = S.cues.filter((c) => overDialogue(c));
  const c = dir > 0 ? over.find((b) => b.start > t + near) : over.findLast((b) => b.start < t - near);
  if (!c) return toast(dir < 0 ? 'No block over dialogue before the playhead' : 'No block over dialogue after the playhead');
  S.playUntil = null;
  select(c.id);
  toast(`Block #${idx(c.id) + 1}: ${overDialogue(c).toFixed(1)} s over dialogue`);
}

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
  if (alt) {
    alt = null;
    altAudio.pause();
    altAudio.removeAttribute('src');
    altAudio.load();
  }
  video.muted = false;
}
// A copied track can't play until the whole file has been read. Until then, silence is
// better than the last track's sound under the new track's waveform.
function holdSound() {
  useNativeAudio();
  video.muted = true;
}
// The video is the clock; the copied track follows it.
let nudging = 0; // see nudgeFor
const canNudge = nudges(browserName(navigator.userAgent, navigator.userAgentData?.brands || []));
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
  if (!canNudge) return;
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
// Building it steps aside for the video: it waits while the video seeks, and goes slowly
// while it plays, so a slower computer can keep up (pace in wave-worker.js). Sound that's
// still being made doesn't go slowly: the video is silent until it's done.
let wavePace = null, waveMaking = false;
let waveBuild = null; // for Diagnostics: { t0 } while building, then { ms }, or { kept }
function paceWave() {
  const pace = video.seeking ? 'hold' : isPlaying() ? 'slow' : 'go';
  if (pace === wavePace) return;
  wavePace = pace;
  waveWorker?.postMessage({ cmd: 'pace', pace: waveMaking && pace === 'slow' ? 'go' : pace });
  dialWaiting = !!dialWorker && dialScans && pace === 'slow';
  dialWorker?.postMessage({ cmd: 'pace', pace: dialWaiting ? 'hold' : pace });
  tlDirty = true;
}
for (const ev of ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked']) video.addEventListener(ev, paceWave);

// The close-up waveform, for zooming in past PEAK_RATE: { file, track, from, data }, at
// CLOSE_RATE a second from `from`. Only the stretch on screen and a screen either side is
// read, once zooming and scrolling stop, so a long film never has to be read again.
const CLOSE_RATE = 2000, CLOSE_AT = PEAK_RATE * 1.5;
let closeUp = null, closeWorker = null, closeWant = null, closeTimer = 0, closeFailed = null;
function wantCloseUp(t0, t1) {
  const file = S.videoFile, track = S.track;
  const covers = (c) => c && c.file === file && c.track === track && c.from <= Math.max(0, t0) && c.to >= Math.min(duration(), t1);
  if (!file || closeFailed === file || covers(closeUp) || covers(closeWant)) return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    const span = t1 - t0, from = Math.max(0, t0 - span), to = Math.min(duration(), t1 + span);
    closeWorker?.terminate();
    try { closeWorker = new Worker('js/wave-worker.js'); } catch { closeFailed = file; return; }
    const w = closeWorker;
    closeWant = { file, track, from, to };
    const done = () => { w.terminate(); if (closeWorker === w) { closeWorker = null; closeWant = null; } };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'peaks' || m.type === 'progress') return;
      if (m.type === 'detail' && closeWorker === w) { closeUp = { file, track, from, to, data: m.data }; tlDirty = true; }
      else if (m.type !== 'detail') closeFailed = file; // the built waveform stays
      done();
    };
    w.onerror = (e) => { e.preventDefault(); closeFailed = file; done(); };
    w.postMessage({ cmd: 'detail', file, track, from, to, rate: CLOSE_RATE });
  }, 250);
}

function resetWaveform() {
  waveWorker?.terminate();
  waveWorker = null;
  closeWorker?.terminate();
  clearTimeout(closeTimer);
  closeWorker = closeWant = closeUp = closeFailed = null;
  S.peaks = null;
  S.peakLen = 0;
  S.peakMax = 0;
  S.waveStatus = '';
  soundProgress(null);
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

// Progress over the video while its sound is made: 0..1, or null when it's not.
function soundProgress(done) {
  $('soundWait').hidden = done === null;
  if (done === null) return;
  $('soundBar').value = done;
  $('soundPct').textContent = `${Math.round(done * 100)}%`;
}

let waveGen = 0;
async function buildWaveform(file, track, mux) {
  resetWaveform();
  const gen = ++waveGen;
  const multi = S.tracks.length > 1;
  const prefix = multi ? `Track ${track + 1} · ` : '';
  const making = mux && needsCopy(track);
  const silent = making || (mux && track !== ownTrack(S.tracks)); // nothing to hear until it's copied
  S.waveStatus = `${prefix}${silent ? 'Getting the sound ready' : 'Waveform'} 0%`;
  // A waveform built before, kept in the browser. A track copied out to play still has
  // to be copied, but its waveform shows straight away.
  const key = waveKey(file, track, PEAK_RATE);
  const kept = await loadWave(key);
  const sound = making && kept ? await loadSound(key) : null;
  if (gen !== waveGen || S.videoFile !== file) return;
  waveBuild = kept ? { kept: true } : { t0: performance.now() };
  if (kept) {
    Object.assign(S, kept);
    tlDirty = true;
    if (sound) {
      const audio = { url: URL.createObjectURL(sound.blob), start: sound.start };
      S.waveStatus = '';
      trackCache.set(track, { ...kept, audio, reason: '' });
      if (S.track === track) useAltAudio(audio);
      return;
    }
    if (!mux) {
      S.waveStatus = '';
      trackCache.set(track, { ...kept, audio: null, reason: '' });
      return;
    }
    S.waveStatus = `${prefix}${silent ? 'Getting the sound ready' : 'Copying the track'}`;
  }
  if (silent) toast(`Getting the ${S.tracks[track].codec} sound ready. It’ll play when this is done`);
  let worker;
  try {
    worker = new Worker('js/wave-worker.js');
  } catch {
    return multi ? toast('No waveform: workers are unavailable') : legacyWaveform(file, 'workers are unavailable');
  }
  waveWorker = worker;
  if (silent) { holdSound(); soundProgress(0); } else if (mux) useNativeAudio();
  const entry = { audio: null, reason: '' };
  const stale = () => S.videoFile !== file || waveWorker !== worker;
  const stop = (reason) => {
    worker.terminate();
    if (stale()) return;
    waveWorker = null;
    S.waveStatus = '';
    soundProgress(null);
    if (!alt) useNativeAudio();
    tlDirty = true;
    if (S.peakLen) toast(`Waveform may be incomplete: ${reason}`);
    // the in-memory fallback can only see the default track
    else if (multi) toast(`Track ${track + 1} (${S.tracks[track].codec}): ${reason}`);
    else legacyWaveform(file, reason);
  };
  worker.onmessage = ({ data: m }) => {
    if (stale()) return;
    if (m.type === 'peaks') { if (!kept) addPeaks(m.from, m.data, m.max); }
    else if (m.type === 'progress') { S.waveStatus = `${prefix}${silent ? 'Getting the sound ready' : kept ? 'Copying the track' : 'Waveform'} ${Math.round(m.done * 100)}%`; tlDirty = true; if (silent) soundProgress(m.done); }
    else if (m.type === 'audio') {
      if (m.blob && !altAudio.canPlayType(m.mime)) entry.reason = `this browser can’t play ${S.tracks[track].codec} on its own`;
      else if (m.blob) entry.audio = { url: URL.createObjectURL(m.blob), start: m.start || 0 };
      else entry.reason = m.reason;
      if (m.made && entry.audio) saveSound(key, m.blob, m.start);
      if (S.track !== track) return;
      if (entry.audio) useAltAudio(entry.audio);
      else {
        useNativeAudio();
        toast(`Can't play track ${track + 1} on its own: ${entry.reason}`);
      }
    } else if (m.type === 'done') {
      worker.terminate();
      waveWorker = null;
      S.waveStatus = '';
      soundProgress(null);
      tlDirty = true;
      trackCache.set(track, { peaks: S.peaks, peakLen: S.peakLen, peakMax: S.peakMax, ...entry });
      if (waveBuild?.t0) waveBuild = { ms: performance.now() - waveBuild.t0 };
      if (!kept && S.peakMax) saveWave(key, S.peaks, S.peakLen, S.peakMax);
      if (!S.peakMax) toast('No waveform: the audio track is silent');
      else toast(multi ? `Audio: ${trackLabel(track)}. T switches tracks` : making && entry.audio ? 'Sound and waveform ready' : 'Waveform ready');
    } else stop(m.message);
  };
  worker.onerror = (e) => { e.preventDefault(); stop('the waveform worker crashed'); };
  worker.postMessage({ cmd: 'build', file, rate: PEAK_RATE, track, mux });
  waveMaking = silent;
  wavePace = null;
  paceWave();
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
    if (max) saveWave(waveKey(file, 0, PEAK_RATE), peaks, n, max);
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
  if (f && S.mode === 'record' && S.projectMedia && !sameVideo(S.projectMedia, { name: f.name, duration: video.duration })) {
    toast(`This recording was timed to ${S.projectMedia.name}${S.projectMedia.duration ? `, ${tc(S.projectMedia.duration)} long` : ''}. ${f.name} may be a different copy: check with whoever sent it`);
  } else if (f && S.projectMedia && !sameMedia(S.projectMedia, f)) {
    toast(`Loaded ${f.name}, but this project was saved with ${S.projectMedia.name}. Check it's the right video`);
  } else toast(`Loaded ${f?.name || 'media'}`);
  if (f && S.pendingPlayhead != null && sameMedia(S.projectMedia, f)) { seek(S.pendingPlayhead); S.pendingPlayhead = null; }
});
video.addEventListener('error', () => { if (S.videoFile && video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) showCodecAlert(S.videoFile, []); else toast('This file couldn’t be played'); });
video.addEventListener('play', updateInd);
video.addEventListener('pause', () => { if (!extHold) qcPlayer.stop(); updateInd(); });
video.addEventListener('seeking', () => { if (!extHold) qcPlayer.stop(); });
video.addEventListener('click', togglePlay);

function openFiles(files) {
  for (const f of files) {
    if (isDoc(f.name)) openProject(f);
    else if (SCRIPT.test(f.name)) loadSubsFile(f).catch((e) => { console.error(e); toast(`Couldn’t open ${f.name}${readProblem(e)}`); });
    else if (/\.wav$/i.test(f.name)) readNote(f).then((n) => (n ? checkNarration(n, f.name) : loadVideoFile(f)));
    else if (/\.zip$/i.test(f.name)) openPackage(f);
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
    if (files[i] && !SCRIPT.test(files[i].name) && !isDoc(files[i].name)) rememberVideo(h, files[i]);
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
  exportMix: () => {
    if (!writing()) return modeOnly('The full mix', 'write');
    openTts();
    ttsMixExport.scrollIntoView({ block: 'center' });
    if (!ttsMixExport.disabled) ttsMixExport.click();
  },
  exportExtended: () => {
    if (!writing()) return modeOnly('The extended video', 'write');
    openTts();
    ttsExtVideoExport.scrollIntoView({ block: 'center' });
    if (!ttsExtVideoExport.disabled) ttsExtVideoExport.click();
  },
  exportPauses: () => {
    if (!writing()) return modeOnly('The pause list', 'write');
    openTts();
    ttsPauseList.scrollIntoView({ block: 'center' });
    if (!ttsPauseList.disabled) ttsPauseList.click();
  },
  exportQc: () => (S.reviewId ? openQcExport() : checkFirst(openQcExport)),
  exportRecording: () => checkFirst(askRecordingFile),
  checkSpelling: () => openCheck(),
  exportNarration: () => recorder.exportWav(),
  exportPickups: () => recorder.exportWav(true),
  exportSession: () => recorder.exportSession(),
  exportMenu: () => toggleMenu(exportMenu),
  help: () => toggleHelp(),
  settings: () => showGeneral(),
  newProject: () => startAgain(),
  comments: () => toggleComments(),
  share: () => shareUi?.open(),
  ai: () => { if (qc()) return; if (!$('commentsDrawer').hidden) toggleComments(false); toggleAi(); },
};

function configureQcAudio() {
  if (!S.review) return qcPlayer.configure(null, []);
  const entries = [];
  for (const c of S.cues) {
    const r = playbackReading(S.review, c, reviewSettings());
    if (r) entries.push({ ...r, start: c.start, gain: volGain(c), ...blockDipOf(c), id: entries.length, uid: c.uid, held: isExt(c) });
  }
  qcPlayer.configure(S.review.file, entries);
}
let liveMissingSaid = '';
// after: runs as the reading ends. Returns whether it's reading.
function qcRead(c, manual = false, after = null) {
  if (!qc() || S.qcSource === 'video') return false;
  S.qcLast = c.id;
  const from = () => Math.max(0, now() - c.start), live = S.qcSource === 'package' && liveRead(c);
  if (S.qcSource === 'package' && !live) {
    const r = playbackReading(S.review, c, reviewSettings());
    const spec = !r && rewriteSpec(S.review, c, reviewSettings());
    if (spec) {
      // Not read yet, such as after a failed request: read it now.
      if (!autoRewrites(spec.voice)) return toast(`Add your ${keyName(spec.voice)} key in Text to speech settings to read changed blocks`);
      if (!autoMaking.has(c.id)) autoRewrite(c.id);
      return toast('Making the new reading. Play the block again when it’s ready');
    }
    if (!r) return toast('No matching original reading for this block. Ask the writer to regenerate the QC package');
    if (manual) S.playUntil = Math.max(c.end, c.start + r.secs);
    return;
  }
  const requested = c.voice || reviewSettings().ttsVoice;
  const voice = reviewVoices().some((v) => v.id === requested) ? requested : live ? '' : S.qcPreviewVoice;
  if (!voice && live) {
    if (manual || liveMissingSaid !== requested) toast(`${voiceLabel(requested)} isn’t on this computer. Click QC under the video to get it`);
    liveMissingSaid = requested;
    return;
  }
  if (!voice) return toast('Choose a preview voice in QC playback');
  // Heard from its first word, so the reading's length is all of it.
  const whole = from() * spoken(said(c)).split(' ').length < speechLength(said(c), c.speed, voice).secs;
  return speak(said(c), { id: c.id, speed: c.speed, voice, gain: volGain(c), from: after ? null : from,
    done: (secs) => {
      after?.();
      if (secs == null || !qc() || S.qcLast !== c.id) return;
      // A stand-in voice isn't the writer's reading, so only the block's own voice moves its end.
      if (whole && voice === requested && edited.has(c) && S.cues.includes(c) && fitQc(c, secs)) changed(c.id);
      if (manual) { if (now() >= c.end) pause(); else S.playUntil = c.end; }
    },
  });
}
// An extended block in QC: its reading from the package, or read here.
function holdQc(c) {
  if (S.qcSource === 'package' && !liveRead(c)) {
    if (qcPlayer.has(c.uid)) startHold(c, (done) => qcPlayer.hold(c.uid, S.rate, mixLevels(tts.mix).reading, done));
    return;
  }
  startHold(c, (done) => { if (!qcRead(c, false, done)) done(); });
}
function qcSpeech(prevT, t, started, leapt) {
  if (S.qcSource === 'package') {
    const ready = !S.hasVideo || (!video.seeking && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
    qcPlayer.sync(t, isPlaying() && ready, S.rate, mixLevels(tts.mix).reading);
  }
  const e = S.qcSource === 'video' ? null : blockToHold(S.cues, prevT, t, leapt, (c) => isExt(c) && c.id !== heard?.id);
  if (e) return holdQc(e);
  if (S.qcSource === 'package' && !S.review?.live) return;
  if (S.qcSource === 'video') return;
  const jumped = started || t < prevT || t - prevT >= 0.5;
  if (jumped) S.qcLast = null;
  const c = cueAt(t);
  if (!c || isExt(c) || tts.speaking?.id === c.id || S.qcLast === c.id) return;
  if (S.qcSource === 'package' && !liveRead(c)) return;
  if (jumped || (prevT <= c.start && t > c.start)) qcRead(c);
}
initQc({
  package: () => !!S.reviewId,
  compare: openReviewCompare,
  audioReference: () => !S.reviewId && S.reviewAudio, attachAudio: attachAuthorAudio,
  rememberReview: (history, projectId) => { if (S.projectId === projectId) { S.reviewHistory = retainHistory([...(S.reviewHistory?.checkpoints || []), ...history.checkpoints]); changed(); } },
  project: projectData, review: () => S.review, canCreate: () => !S.reviewId, toast, source: () => S.qcSource, qc,
  setSource(source, voice) { qcPlayer.stop(); stopSpeech(); S.qcLast = null; S.qcSource = source; S.qcPreviewVoice = voice; updateEditor(); updateInd(); },
  baseName, said, busy: (on) => { S.makingReview = on; },
});

initCheck({
  blocks: () => S.cues, words: () => S.words, notes: () => S.notes, project: () => S.projectId,
  locked: () => S.mode === 'record', canEdit: () => !qc() && S.mode !== 'record', toast, tc,
  addWord(word) { S.words = cleanWords([...S.words, word]); changed(); },
  // Changes several blocks as one step to undo.
  apply(texts) {
    pushUndo();
    for (const [id, text] of texts) { const c = S.cues.find((x) => x.id === id); if (c) { c.text = text; adapt(c); } }
    changed();
  },
  go: (id) => select(id),
  openAiSettings,
});

initComments({
  blocks: () => S.cues, selected: selCue, comments: () => S.comments,
  canComment, toast,
  now, tc, readTime, duration, closeAi: () => { if (!$('aiDrawer').hidden) toggleAi(false); },
  go: ({ block, time }) => { if (block) select(block.id); else { select(null, { seek: false }); seek(time); } },
  change: (apply) => { pushUndo(); apply(); changed(); },
});
// Right-click anywhere on the timeline to comment at that time.
tl.addEventListener('contextmenu', (e) => {
  if (!canComment()) return;
  e.preventDefault(); toggleComments(true, clamp(xToT(e.clientX), 0, duration()));
});

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
    if (qc()) return false;
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

document.querySelector('.recbadge button').addEventListener('click', (e) => { e.currentTarget.blur(); leaveRecord(); });

// Header menus, such as Export: open on click, close on a choice, a click elsewhere or Esc.
const exportMenu = $('exportMenu');
function toggleMenu(menu, open = menu.hidden) {
  closeMenus();
  if (!open) return;
  if (menu === exportMenu) $('exportExtended').hidden = $('exportPauses').hidden = !hasExtended();
  // With alts recorded, the narration goes out as a zip.
  if (menu === exportMenu && S.mode === 'record') {
    const [name, what] = $('exportNarration').firstElementChild.children;
    name.textContent = recorder.alts ? 'Narration zip' : 'Narration WAV';
    what.textContent = recorder.alts ? 'a zip of the narration WAV, a WAV of the alts alone and the notes, for the mixer'
      : 'the chosen takes in one timestamped file, for the mixer';
  }
  menu.hidden = false;
  menu.previousElementSibling.setAttribute('aria-expanded', 'true');
  [...menu.querySelectorAll('[role="menuitem"]')].find((b) => b.offsetParent)?.focus();
}
// A menu's button is just before it. The take menu on the timeline has none.
const menuBtn = (m) => (m.previousElementSibling?.hasAttribute('aria-haspopup') ? m.previousElementSibling : null);
function closeMenus() {
  for (const m of document.querySelectorAll('.navmenu')) {
    m.hidden = true;
    menuBtn(m)?.setAttribute('aria-expanded', 'false');
  }
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.navwrap, .navmenu')) closeMenus(); });
document.addEventListener('keydown', (e) => {
  const menu = e.target.closest?.('.navmenu');
  if (!menu) return;
  e.stopPropagation();
  const items = [...menu.querySelectorAll('[role="menuitem"]')].filter((b) => b.offsetParent);
  const k = items.indexOf(e.target);
  if (e.key === 'Escape') { e.preventDefault(); closeMenus(); document.activeElement?.blur(); }
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
  KeyP: 'Glossary', KeyL: 'Glossary', KeyM: 'Markers', KeyS: 'Snippets',
};

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (fileKeys(e)) return;
  if (!helpEl.hidden) {
    if (e.key === 'Escape' || isHelpKey(e) || (e.shiftKey && e.code === 'KeyO')) {
      e.preventDefault();
      toggleHelp(false);
      if (e.key === 'Escape') document.activeElement?.blur();
    }
    return;
  }
  if (e.code === 'Escape' && document.querySelector('dialog[open]')) return; // the browser closes it
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
    // Esc in a slider, menu or box acts as it does anywhere else.
    if (e.code !== 'Escape' || e.altKey || e.shiftKey || mod || e.isComposing) return;
  }
  // Undo and redo follow the letter on the key, like other apps, so ⌘Z is still Z on AZERTY.
  const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
  // Record mode's script is locked: ⌘Z only brings back a take just deleted.
  if (S.mode === 'record' && mod && letter === 'z' && !e.shiftKey) { e.preventDefault(); recorder.undoDelete().then((ok) => ok || toast('Nothing to bring back')); return; }
  if (S.mode === 'record' && mod && (letter === 'z' || letter === 'y')) { e.preventDefault(); return; }
  if (mod && letter === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && letter === 'y') { e.preventDefault(); doRedo(); return; }
  if (mod) return; // leave other browser shortcuts (zoom, find, reload…) alone
  if (isHelpKey(e)) { e.preventDefault(); toggleHelp(); return; }
  if (e.key === '/' && !e.altKey) { e.preventDefault(); listSearch.focus(); listSearch.select(); return; }

  // Record mode: Enter or R records the selected line, and Esc stops and discards the take. [ ] change a block's speed, which is locked.
  if (S.mode === 'record') {
    if (e.code === 'Escape' && recorder.active) { e.preventDefault(); recorder.finish(true); document.activeElement?.blur(); return; }
    if (!e.altKey && !e.shiftKey && ['Enter', 'NumpadEnter', 'KeyR'].includes(e.code)) { e.preventDefault(); if (!e.repeat) recorder.toggle(); return; }
    if (!e.altKey && e.shiftKey && ['Enter', 'NumpadEnter', 'KeyR'].includes(e.code)) { e.preventDefault(); if (!e.repeat) recorder.punch(); return; }
    if (!e.altKey && !e.shiftKey && !mod && e.code === 'KeyP') { e.preventDefault(); recorder.nextPickup(); return; }
    if (!e.altKey && !e.shiftKey && !mod && e.code === 'KeyA') { e.preventDefault(); recorder.toggleAlt(); return; }
    if (!e.altKey && !e.shiftKey && !mod && e.code === 'KeyZ') { e.preventDefault(); zoomToTake(); return; }
    if (e.key === '[' || e.key === ']') { e.preventDefault(); return; }
  }
  // [ ] by the character typed, since some layouts need ⌥ or AltGr for them.
  if (e.key === '[' || e.key === ']') { e.preventDefault(); stepBlockSpeed(e.key === '[' ? -1 : 1); return; }
  if (e.code === 'Escape' && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    closeMenus();
    // An open block closes, even when its text box isn't focused.
    if (edOpen) { closeEditor(true); return; }
    S.playUntil = null;
    leadRead = null;
    document.activeElement?.blur();
    if (S.loopOnce) stopLoop(); else updateInd();
    return;
  }
  // Everything else is in the keymap, which people can change (see keymap.js).
  const id = keyLookup.get(comboOf(e));
  if (id) {
    e.preventDefault();
    if (S.mode === 'record' && id === 'split' && recorder.splitTake()) return; // splits the take being edited
    if (S.mode === 'record' && id === 'deleteNow' && recorder.cutPart()) return; // deletes a part of it
    // Play / pause stops a recording, and keeps the take. Held down, it doesn't start playing.
    if (S.mode === 'record' && id === 'play' && (recorder.active || e.repeat)) { if (!e.repeat) recorder.finish(); return; }
    if (qc() && REC_LOCKED.has(id) && !['createEdit', 'comments'].includes(id) && (!qcEditable() || !QC_EDIT_KEYS.has(id))) return toast('The script and timings are fixed in QC mode');
    if (S.mode === 'record' && REC_LOCKED.has(id)) return toast('The script is locked in Record mode');
    RUN[id](e);
    return;
  }
  if (!e.altKey && isPlus(e)) { e.preventDefault(); setRate(S.rate + 0.25); return; }
  if (!e.altKey && isMinus(e)) { e.preventDefault(); setRate(S.rate - 0.25); return; }
  // Frazier keys for features this editor doesn't have, unless they've been given a job.
  const frazier = e.altKey && e.shiftKey ? { KeyM: 'Markers' }[e.code] : e.shiftKey && !e.altKey ? FRAZIER_ONLY[e.code] : null;
  if (frazier) { e.preventDefault(); toast(`${frazier} are not part of this editor`); }
});

// Esc out of a dialog comes back to the timeline, not to the button that opened it. The
// browser has put the focus back by the time 'close' fires.
let escapedDialog = null;
document.addEventListener('cancel', (e) => { if (e.target instanceof HTMLDialogElement) escapedDialog = e.target; }, true);
document.addEventListener('close', (e) => {
  if (e.target !== escapedDialog) return;
  escapedDialog = null;
  if (!keepsFocusAfterDialog(document.activeElement, !!document.querySelector('dialog[open]'))) document.activeElement?.blur();
}, true);

const QC_EDIT_KEYS = new Set(['newBlock', 'gapBlock', 'split', 'merge', 'deleteNow', 'deleteAsk', 'setStart', 'setEnd', 'startBack', 'startFwd', 'endBack', 'endFwd', 'moveBack', 'moveFwd', 'startBack10', 'startFwd10', 'endBack10', 'endFwd10', 'moveBack10', 'moveFwd10', 'soundsLike']);

// Keys that change the script, or help with writing it: off in Record mode.
const REC_LOCKED = new Set(['createEdit', 'newBlock', 'gapBlock', 'split', 'merge', 'deleteNow', 'deleteAsk', 'findReplace', 'setStart', 'setEnd',
  'startBack', 'startFwd', 'endBack', 'endFwd', 'moveBack', 'moveFwd', 'startBack10', 'startFwd10', 'endBack10', 'endFwd10',
  'moveBack10', 'moveFwd10', 'hold', 'transcribeBlock', 'sttPanel', 'fitToReading', 'ttsPanel', 'soundsLike', 'aiHelp', 'comments', 'offset']);

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
  gapBack: () => jumpGap(-1),
  gapNext: () => jumpGap(1),
  overBack: () => jumpClash(-1),
  overNext: () => jumpClash(1),
  videoStart: () => { S.playUntil = null; seek(0); },
  videoEnd: () => { S.playUntil = null; seek(duration()); },
  toStart: () => gotoSel(false),
  toEnd: () => gotoSel(true),
  jumpTime: () => openPalette('time'),
  quickNav: () => openPalette('nav'),
  createEdit: () => createOrEdit(),
  newBlock: () => newCue(),
  gapBlock: () => gapBlock(),
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
  checkSpelling: () => openCheck(),
  sttPanel: () => showMarking(),
  read: () => speakBlock(false),
  fitToReading: () => speakBlock(true),
  ttsPanel: () => openTts(),
  soundsLike: () => openSay(),
  comments: () => toggleComments(),
  aiHelp: () => { if (!qc()) toggleAi(); },
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
  applyDuck(dt);
  if (S.hasVideo || !S.vplaying) stopSilence();
  else if (!extHold && soundStarted(ts)) {
    S.vt += dt * S.rate;
    if (S.vt >= duration()) { S.vt = duration(); S.vplaying = false; }
  }
  const playing = isPlaying();
  if (playing) {
    const c = selCue(), t = now();
    reachBlock(t);
    liveSpeech(lastT, t, !lastPlaying);
    if (S.playUntil != null && t >= S.playUntil) {
      pause();
      setTime(S.playUntil);
      S.playUntil = null;
    } else if (S.loop && c && t >= c.end) {
      leadBefore(c);
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
  if (tlDirty) drawTimeline();
  drawScrub();
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
if (S.reviewId) { const wanted = S.reviewId; storedReview().then(async (saved) => { if (saved?.id !== wanted || S.reviewId !== wanted) return; try { const review = await openReview(saved.file); if (S.reviewId !== wanted) return; S.review = review; S.qcSource = 'package'; syncQcPermission(); fitQcAll(); configureQcAudio(); updateEditor(); if (S.dirty) scheduleAutosave(); updateInd(); refreshQc(); } catch { toast('Reopen the QC package to restore its original readings'); } }); }
if (!S.reviewId && S.reviewAudio) restoreAuthorAudio();
S.dirty = false;
showDocName();
S.pps = Math.max(20, tl.clientWidth / 20);
changed();
S.dirty = restored ? S.savedDirty : false;
showDocName();
// Keep saving in place to the project that was open before the reload.
handleStore.get().then((h) => { if (h && h.name === S.subName) { S.handle = h; checkWrite(); } });
updateInd();
setMode(S.reviewId ? 'qc' : S.mode, true);
showDur();
let reRec = null;
try { reRec = JSON.parse(localStorage.getItem(REC_OPEN)); } catch { /* ignore */ }
if (reRec) {
  enterRecording(reRec, reRec.name, reRec.raw || null);
  toast(`Back in Record mode: ${reRec.name}`);
  if (reRec.media) reopenVideo(reRec.media).then((ok) => { if (ok) toast(`Back in Record mode: ${reRec.name}, with ${reRec.media.name}`); });
} else if (restored) {
  select(S.cues[0]?.id ?? null, { seek: false });
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
// Readings were made or changed: block ends that follow them, the list and the editor.
// Long jobs make hundreds of readings, and redrawing the whole list for each one held up
// slower computers, so it's done at most four times a second: at once, then again for
// whatever arrived meanwhile.
const READINGS_EVERY = 250;
let readingsAt = 0, readingsTimer = 0;
function readingsChanged() {
  if (readingsTimer) return;
  const wait = readingsAt + READINGS_EVERY - performance.now();
  if (wait > 0) { readingsTimer = setTimeout(() => { readingsTimer = 0; readingsChanged(); }, wait); return; }
  const t0 = performance.now();
  fitAllAuto(); refreshList(); updateEditor(); updateInd(); refreshQc(); tlDirty = true;
  // On a slower computer or in a long script this takes longer, so it comes round less
  // often, and most of the time still goes to making the readings.
  readingsAt = performance.now() + Math.max(0, (performance.now() - t0) * 4 - READINGS_EVERY);
}
initTts({
  toast,
  panelOpened: () => showExtended(),
  rate: () => S.rate,
  duck: duckAudio,
  sample: () => spoken(selCue() ? said(selCue()) : ''),
  changed: readingsChanged,
  readingChanged,
  canChangeReading: () => !qc() || S.loadingProject,
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
  takes: () => takesInfo(),
  clearTakes: async () => { await clearTakes(); await recorder.refreshSession(); },
  clearReadings: () => clearSavedReadings(),
  openTts: () => openTts(),
  openStt: () => openStt(),
  guides: () => guidesHere(),
  unsaved: () => (S.dirty ? Math.max(1, S.cues.length + S.comments.length) : 0),
  save: () => saveProject(),
});
initWelcome({
  getMode: () => S.mode,
  setMode,
  getOffset: () => S.offset,
  setOffset,
  getReplay: () => S.replay,
  setReplay: (on) => setReplay(on, true),
  nameChanged: () => showName(),
  offsets: OFFSETS,
  toast,
  recording: () => recorder.open,
  mic: {
    start: (meter, out) => recorder.startCheck(meter, out),
    stop: () => recorder.stopCheck(),
    reset: () => recorder.resetLoudest(),
    get checking() { return recorder.checking; },
    devices: () => recorder.listDevices(),
    stopSync: () => recorder.stopSyncTest(),
  },
}, (finished) => {
  // Skipped before answering about updates: ask the usual way instead. The web version
  // updates itself, so there's nothing to ask.
  if (!finished && !HOSTED && updateChoice() === null) setTimeout(openUpdates, 300);
  // Then the loop for the mode picked, once nothing else is on screen. Record mode's is
  // in the recording guide instead.
  if (S.mode !== 'record') whenClear(() => maybeShowLoop(S.mode));
});

// ---------------------------------------------------------------- settings

// Everything that's set up rather than used while working, in one window. The panels
// that were windows of their own are moved in, once they've been set up above.
initSettings();
const showGeneral = () => {
  $('setVersion').textContent = VERSION;
  $('setReplay').checked = S.replay;
  $('setLead').value = S.lead;
  $('setReturn').setAttribute('aria-pressed', String(S.returnToStart));
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
// In Record mode, setup is Record mode's, so it can't switch away from the recording.
$('setSetup').addEventListener('click', () => { closeSettings(); openWelcome(S.mode === 'record' ? 'record' : null); });
$('setTour').addEventListener('click', () => { closeSettings(); startTour(S.mode); });
$('setDocker').addEventListener('click', () => { closeSettings(); openGuide('INSTALL.md'); });
// Once setup and the first loop card are done, the web version mentions running it with
// Docker, once: now, or when the tour or loop card ends.
const dockerTip = initDockerTip({ hosted: HOSTED, welcomed, loopSeen: () => loopSeen(S.mode), guide: () => openGuide('INSTALL.md') });
document.addEventListener('tourend', () => setTimeout(() => whenClear(dockerTip), 300));
whenClear(dockerTip);
$('setReplay').addEventListener('change', (e) => setReplay(e.target.checked, true));
$('setLead').addEventListener('change', (e) => setLead(e.target.value));
$('setReturn').addEventListener('click', () => setReturnToStart(!S.returnToStart));
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
  $('browserAlertTitle').textContent = noticeTitle(name);
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
    blocks: S.cues.length + S.comments.length, dirty: S.dirty, lastChange: S.lastChange || 0,
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
// Someone who opened a recording file gets Record mode's setup instead (see setMode).
if (FIRST_RUN) setTimeout(() => startTour(S.mode, { then: () => S.mode === 'record' || openWelcome(), finish: 'Set up Scribecue' }), 400);
else if (!welcomed()) {
  // Someone who used Scribecue before the wizard existed: mention it once.
  markWelcomed();
  setTimeout(() => toast('New: Settings at the top has setup, which walks you through choosing your task and its tools'), 2500);
}
initReviewCompare({
  project: projectData, generation: () => S.changeGen,
  allowed: () => qc() && (!S.reviewId || !!S.review),
  permission: () => S.reviewId && S.review ? reviewAllowsEdits(S.review) : null,
  authoring: () => !S.reviewId, authorHandle: () => S.handle,
  cacheAudio: (projectId, baselineId, file) => storedReview({ id: baselineId, file }, reviewAudioKey(projectId, baselineId)),
  applyAuthor: (project, audio, handle, name, generation) => {
    if (S.reviewId) return false;
    return openProject(new File([project], name), handle, true, generation, audio);
  },
  baseName, toast, time: tc, startPending, addPending, endPending,
  apply: (file, handle, name, generation) => openProject(new File([file], name), handle, true, generation),
});
initPending({
  time: tc, readTime, toast, authoring: () => !S.reviewId, finish: (file, decisions) => (file === LIVE ? acceptLive(decisions) : finishReview(file, decisions)),
  numbers: () => new Map(S.cues.map((c, i) => [c.uid, i + 1])),
  redraw: () => { tlDirty = true; },
  // Show the change: select your block, and bring both versions into view.
  focus(item) {
    const c = item.uid && S.cues.find((b) => b.uid === item.uid);
    if (c) select(c.id, { seek: false, reveal: false, toTop: false });
    const spans = [item.ours, item.theirs, item.block].filter((b) => b && Number.isFinite(b.start));
    if (spans.length) {
      S.playUntil = null; seek(Math.min(...spans.map((b) => b.start)), false);
      revealRange(Math.min(...spans.map((b) => b.start)), Math.max(...spans.map((b) => b.end)));
    }
    tlDirty = true;
  },
});
requestAnimationFrame(tick);

// ---------------------------------------------------------------- diagnostics

// How long each jump takes to show its picture, and the page's long tasks, for Diagnostics.
const jumpTimes = [], longTasks = [];
let jumpFrom = null;
video.addEventListener('seeking', () => { jumpFrom ??= performance.now(); });
video.addEventListener('seeked', () => {
  if (jumpFrom == null) return;
  jumpTimes.push(performance.now() - jumpFrom);
  if (jumpTimes.length > 20) jumpTimes.shift();
  jumpFrom = null;
});
video.addEventListener('emptied', () => { jumpFrom = null; jumpTimes.length = 0; });
// Whether the picture really changes. Asks for one frame at a time, not every frame.
const picture = pictureWatch();
let frameWanted = false;
const wantFrame = () => {
  if (frameWanted || !video.requestVideoFrameCallback) return;
  frameWanted = true;
  video.requestVideoFrameCallback((_, m) => {
    frameWanted = false;
    picture.frame(m.mediaTime, performance.now());
    if (picture.jumping) wantFrame();
  });
};
video.addEventListener('seeking', () => { picture.jump(video.currentTime, performance.now()); wantFrame(); });
video.addEventListener('timeupdate', () => {
  if (video.paused || video.seeking || document.hidden || !video.videoWidth) return picture.rest();
  picture.playing(video.currentTime);
  wantFrame();
});
video.addEventListener('pause', () => picture.rest());
video.addEventListener('emptied', () => picture.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) picture.away(); });
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) longTasks.push([e.startTime, e.duration]);
    if (longTasks.length > 500) longTasks.splice(0, longTasks.length - 500);
  }).observe({ type: 'longtask' });
} catch { /* only Chromium reports long tasks */ }

// The browser with its version, for a problem report.
function browserVersion() {
  const ua = navigator.userAgentData;
  if (ua?.brands?.length) {
    const b = ua.brands.filter((x) => !/not.?a.?brand/i.test(x.brand));
    const pick = b.find((x) => x.brand !== 'Chromium') || b[0];
    if (pick) return `${pick.brand} ${pick.version}`;
  }
  const s = navigator.userAgent, m = /(Edg|Firefox|Chrome)\/(\d+)/.exec(s) || /Version\/(\d+).*(Safari)/.exec(s);
  if (!m) return s;
  return m[2] === 'Safari' ? `Safari ${m[1]}` : `${m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}`;
}
async function diagnosticsInfo() {
  const f = S.videoFile, now = performance.now(), minutes = 5;
  const recent = longTasks.filter(([at]) => now - at < minutes * 60e3);
  let storage = null, decode = null;
  try { const e = await navigator.storage?.estimate(); if (e) storage = { used: e.usage, quota: e.quota }; } catch { /* not available */ }
  if (f && S.hasVideo && TESTS[S.videoCodec] && navigator.mediaCapabilities) {
    try {
      decode = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: {
        contentType: TESTS[S.videoCodec], width: video.videoWidth || 1920, height: video.videoHeight || 1080,
        bitrate: Math.round((f.size * 8) / (duration() || 1)), framerate: S.fps || 24,
      } });
    } catch { /* the browser couldn't say */ }
  }
  const q = video.getVideoPlaybackQuality?.();
  return {
    now: Date.now(),
    names: [f?.name, S.projectMedia?.name, S.handle?.name, S.subName, baseName()],
    app: { version: VERSION, web: HOSTED, installed: matchMedia('(display-mode: standalone)').matches, mode: MODE_NAMES[S.mode] || S.mode },
    browser: { name: browserVersion(), platform: navigator.userAgentData?.platform || navigator.platform, cores: navigator.hardwareConcurrency,
      memory: navigator.deviceMemory, screen: `${screen.width}×${screen.height}`, dpr: devicePixelRatio || 1 },
    storage,
    video: f && S.hasVideo ? {
      name: f.name, bytes: f.size, duration: duration(), width: video.videoWidth, height: video.videoHeight,
      codec: S.videoCodec, fps: S.fps, decode, audio: S.tracks.map((t) => t.codec).filter(Boolean), separate: !!alt,
      frames: q ? { total: q.totalVideoFrames, dropped: q.droppedVideoFrames } : null,
    } : null,
    waveform: S.waveStatus ? { building: S.waveStatus.replace(/^.*?(\d+%)$/, '$1') } : waveBuild?.t0 ? { building: 'starting' } : waveBuild,
    jumps: jumpTimes,
    picture: video.requestVideoFrameCallback ? picture.info(performance.now()) : null,
    longTasks: 'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('longtask') ? { count: recent.length, longest: Math.max(0, ...recent.map(([, d]) => d)), minutes } : null,
    log: diagLog.entries,
  };
}

const diagDlg = $('diagDlg');
let diagData = null;
function showDiagnostics() {
  $('diagText').textContent = diagReport(diagData, { names: $('diagNames').getAttribute('aria-pressed') === 'true' });
}
async function openDiagnostics() {
  diagData = await diagnosticsInfo();
  showDiagnostics();
  if (!diagDlg.open) diagDlg.showModal();
}
$('setDiag').addEventListener('click', openDiagnostics);
$('diagNames').addEventListener('click', (e) => {
  e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true'));
  showDiagnostics();
});
$('diagCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('diagText').textContent); toast('Copied the diagnostics'); }
  catch { toast('Couldn’t copy. Select the text and copy it, or save it as a file'); }
});
$('diagSave').addEventListener('click', () => {
  const d = new Date(), name = `scribecue-diagnostics-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.txt`;
  const url = URL.createObjectURL(new Blob([$('diagText').textContent], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Saved ${name} to your downloads`);
});
$('diagClose').addEventListener('click', () => diagDlg.close());
