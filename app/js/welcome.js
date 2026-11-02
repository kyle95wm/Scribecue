// The welcome wizard: a short setup that picks the task (Transcribe, Write or QC), the
// tools for it, and update checks. It opens by itself the first time Scribecue is
// used, and Settings at the top runs it again. Choices take effect only when
// Finish is pressed, so skipping changes nothing.
//
// Switching to a mode that hasn't been set up yet runs just that mode's part of it
// (openModeSetup), once for each mode.

import { tts, SPEEDS, MAX_BASE, toBase, fillVoiceSelect, chosenVoice, setTtsOption, loadPiper, webPiper, webVoiceChoices, downloadVoice, megabytes } from './tts.js';
import { updateChoice, setUpdateChoice } from './update.js';
import { HOSTED } from './config.js';
import { drawLevel, sizeMeter, showLoudest } from './levelmeter.js';
import { savedName, saveName, cleanName } from './profile.js';

const $ = (id) => document.getElementById(id);
const KEY = 'scribecue.welcome';
let hooks = { getMode: () => 'transcribe', setMode: () => {}, getOffset: () => 0.2, setOffset: () => {}, getReplay: () => false, setReplay: () => {}, nameChanged: () => {}, offsets: [], toast: () => {}, mic: null, recording: () => false };
let step = 0;
let finished = false;
let only = null; // the one mode being set up, after switching to it for the first time

const mode = () => document.querySelector('input[name=wzMode]:checked')?.value || 'transcribe';
// The steps for the chosen task: the third one depends on it.
// The web version updates itself, so it skips the question about update checks.
// Recording has two steps of its own: the microphone, then listening and sync.
const modeSteps = (m) => (m === 'record' ? ['record-mic', 'record-listen'] : [m]);
const steps = () => only ? [...modeSteps(only), 'done'] : ['welcome', 'task', ...modeSteps(mode()), ...(HOSTED ? [] : ['updates']), 'done'];
const MODE_NAMES = { transcribe: 'Transcribe', write: 'Write', qc: 'QC', record: 'Record' };

function show() {
  const list = steps();
  step = Math.max(0, Math.min(step, list.length - 1));
  for (const s of document.querySelectorAll('#welcome [data-step]')) s.hidden = s.dataset.step !== list[step];
  $('wzStep').textContent = `${only ? `Setting up ${MODE_NAMES[only]} mode · ` : ''}Step ${step + 1} of ${list.length}`;
  $('wzBack').hidden = step === 0;
  $('wzNext').textContent = step === list.length - 1 ? 'Finish' : step === 0 && !only ? 'Get started' : 'Next';
  $('wzTtsBody').classList.toggle('off', !$('wzTts').checked);
  if (list[step] === 'record-mic') {
    hooks.mic?.devices();
    // The meter, empty, until the test starts.
    if (!hooks.mic?.checking) { sizeMeter($('wzRecMeter')); drawLevel($('wzRecMeter'), 0, 0, { scale: true }); }
  } else stopMicTest();
  if (list[step] === 'done') summarise();
  $('wzNext').focus();
}

function summarise() {
  const m = mode();
  const lines = [m === 'qc' ? 'QC mode, with comments and editing permission set by the package creator' : m === 'write' ? 'Write mode, for new audio description'
    : m === 'record' ? 'Record mode, for reading a script against the video' : 'Transcribe mode, for existing audio description'];
  if (m === 'record') {
    lines.push(`Microphone: ${$('recDev').selectedOptions[0]?.textContent || 'Default microphone'}`);
    lines.push(`Lead-in: ${$('recLead').value} s of video before each block`);
    const sync = parseInt($('recSync').value, 10);
    lines.push(Number.isFinite(sync) ? `Sync: ${String(sync).replace('-', '−')} ms` : 'Sync: automatic, for wired headphones');
  }
  if (m === 'qc') {
    const name = cleanName($('wzName').value);
    lines.push(name ? `Comments are signed ${name}` : 'Comments carry no name. You can add one in Settings, under General');
  }
  if (m === 'transcribe') {
    lines.push(`Hold-to-mark reaction offset: ${Math.round(+$('wzOffset').value * 1000)} ms`);
    if ($('wzReplay').checked) lines.push('Goes back to each block’s start after you edit it');
  }
  if (m === 'write') {
    if ($('wzTts').checked) {
      const v = $('wzVoice').selectedOptions[0]?.textContent || 'the default voice';
      lines.push(`Text to speech on, with ${v} at ${$('wzSpeed').selectedOptions[0].textContent} speed`);
      if (!$('wzWebPiper').hidden && $('wzPiperGet').checked) {
        lines.push(`Downloads the ${$('wzPiperVoice').selectedOptions[0].textContent} Piper voice when you finish, and uses it once it’s ready`);
      }
    } else lines.push('Text to speech off');
    if ($('wzReplayWrite').checked) lines.push('Goes back to each block’s start after you edit it');
  }
  const u = document.querySelector('input[name=wzUpd]:checked')?.value;
  if (!HOSTED && !only) lines.push(u === '1' ? 'Checks for updates once a day' : u === '0' ? 'Doesn’t check for updates' : 'Update checks: not chosen yet');
  $('wzSummary').replaceChildren(...lines.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  $('wzEditKey').hidden = $('wzEditDesc').hidden = m === 'qc' || m === 'record';
  $('wzSaveKey').hidden = $('wzSaveDesc').hidden = m === 'record'; // takes are kept as they're made
  $('wzModeKey').innerHTML = m === 'qc' ? '<kbd>Alt</kbd><kbd>Shift</kbd><kbd>C</kbd>' : m === 'write' ? '<kbd>V</kbd>' : m === 'record' ? '<kbd>↵</kbd> or <kbd>R</kbd>' : 'Hold <kbd>H</kbd>';
  $('wzModeDesc').textContent = m === 'qc' ? 'Open Comments at the playhead' : m === 'write' ? 'Read the selected block aloud' : m === 'record' ? 'Record the selected block, or stop' : 'Mark a block while the narrator speaks';
}

function finish() {
  const m = mode();
  // Record mode belongs to an open recording file, so choosing it only gets it ready.
  if (m !== 'record') hooks.setMode(m, true);
  if (m === 'transcribe') { hooks.setOffset(+$('wzOffset').value); hooks.setReplay($('wzReplay').checked); }
  if (m === 'write') {
    hooks.setReplay($('wzReplayWrite').checked);
    setTtsOption('on', $('wzTts').checked);
    if ($('wzTts').checked) {
      if ($('wzVoice').value) setTtsOption('voice', $('wzVoice').value);
      setTtsOption('base', toBase(+$('wzSpeed').value));
      setTtsOption('live', $('wzLive').checked);
      setTtsOption('skipNotes', $('wzNotes').checked);
    }
  }
  if (m === 'qc') { saveName($('wzName').value); hooks.nameChanged(); }
  const u = document.querySelector('input[name=wzUpd]:checked')?.value;
  if (!only && (u === '1' || u === '0')) setUpdateChoice(u === '1');
  markModeSetUp(m);
  const piper = $('wzTts').checked && !$('wzWebPiper').hidden && $('wzPiperGet').checked ? $('wzPiperVoice').value : '';
  finished = true;
  $('welcome').close();
  if (m === 'write' && piper) {
    downloadVoice(piper); // chosen once it's downloaded; its progress is in the text to speech panel
    hooks.toast(`All set for writing. Downloading the Piper voice; it’s chosen once it’s ready, and you can carry on meanwhile`);
    return;
  }
  if (m === 'record') return hooks.toast(hooks.recording() ? 'All set for recording. Select a block and press Enter or R' : 'All set for recording. Open the recording file and its video');
  hooks.toast(m === 'qc' ? 'All set for QC. Open the project or QC package and its matching video' : m === 'write'
    ? `All set for writing.${$('wzTts').checked ? ' Press V to hear a block.' : ''} Settings at the top runs this again`
    : 'All set for transcribing. Hold H while the narrator speaks. Settings at the top runs this again');
}

export function openWelcome(just = null) {
  finished = false;
  step = 0;
  only = MODE_NAMES[just] ? just : null;
  for (const r of document.querySelectorAll('input[name=wzMode]')) r.checked = r.value === (only || hooks.getMode());
  borrow();
  $('wzRecNote').textContent = 'Your browser asks to use the microphone the first time.';
  showLoudest($('wzRecLoudest'), 0);
  $('wzRecBt').textContent = 'Only needed with Bluetooth headphones, which delay sound. Click Sync test, then raise Sync until the flash and the beep happen together.';
  $('wzOffset').value = String(hooks.getOffset());
  $('wzName').value = savedName();
  $('wzReplay').checked = $('wzReplayWrite').checked = hooks.getReplay();
  // New users who pick Write most likely want text to speech, so it starts ticked for
  // them, and for anyone setting up Write mode for the first time.
  $('wzTts').checked = tts.on || !welcomed() || only === 'write';
  fillVoiceSelect($('wzVoice'), chosenVoice());
  const ws = $('wzSpeed');
  if (![...ws.options].some((o) => +o.value === tts.base)) ws.add(new Option(`${Math.round(tts.base * 100)}%`, String(tts.base)));
  ws.value = String(tts.base);
  $('wzLive').checked = tts.live;
  $('wzNotes').checked = tts.skipNotes;
  $('wzPiperGet').checked = false; // a large download: only when asked for

  const u = updateChoice();
  for (const r of document.querySelectorAll('input[name=wzUpd]')) r.checked = r.value === u;
  piperNote();
  loadPiper().then(() => { fillVoiceSelect($('wzVoice'), $('wzVoice').value || chosenVoice()); piperNote(); });
  const d = $('welcome');
  if (!d.open) d.showModal();
  show();
}

// The web version can download a Piper voice into the browser, so setup offers one,
// unless there's one already. It's a large download, so it waits to be asked for.
function webPiperOffer() {
  const choices = HOSTED && !tts.piper.length && !webPiper.downloading ? webVoiceChoices() : [];
  $('wzWebPiper').hidden = !choices.length;
  if (!choices.length) return;
  const sel = $('wzPiperVoice'), keep = sel.value;
  if (!sel.options.length) for (const v of choices) sel.add(new Option(`${v.name} (${v.lang})`, v.id));
  if (keep) sel.value = keep;
  const v = choices.find((c) => c.id === sel.value) || choices[0];
  $('wzPiperSize').textContent = `${megabytes(v.bytes)} to download${webPiper.engineReady ? '' : `, plus ${megabytes(webPiper.engine)} for the speech engine the first time`}. It downloads when you finish, and you can carry on meanwhile; then it works offline. Lengths are exact with it, and you can export a description track.`;
  $('wzPiperVoice').disabled = !$('wzPiperGet').checked;
  for (const el of [$('wzPiperVoice').parentElement, $('wzPiperSize')]) el.classList.toggle('dimmed', !$('wzPiperGet').checked);
}

function piperNote() {
  webPiperOffer();
  $('wzPiper').hidden = !$('wzWebPiper').hidden; // the offer says it instead
  const which = [tts.piper.length && 'Piper', tts.kokoro.length && 'Kokoro'].filter(Boolean).join(' and ');
  $('wzPiper').textContent = which
    ? `${which} voices are available, and recommended: they sound natural, give exact lengths and can be exported as a description track.`
    : HOSTED ? 'Tip: for natural-sounding voices, download a Piper voice later in Settings, under Text to speech.'
      : 'Recommended: for natural-sounding voices that run on your computer, with exact lengths, add Piper (see INSTALL.md).';
}

// Recording's settings are the ones under the video, in Microphone, lead-in and sync,
// lent to the setup while it's open, so there's one of each and changes apply at once.
const LENT = ['recDev', 'recLead', 'recSync', 'recTest', 'recFlash'];
let homes = null;
function borrow() {
  if (homes || !hooks.mic) return;
  const item = (id) => $(id).closest('label') || $(id);
  homes = LENT.map((id) => { const el = item(id); return { el, parent: el.parentNode, next: el.nextSibling }; });
  $('wzRecMic').append(item('recDev'));
  $('wzRecLead').append(item('recLead'));
  $('wzRecSync').append(item('recSync'), item('recTest'), item('recFlash'));
}
function giveBack() {
  if (!homes) return;
  hooks.mic.stopSync();
  for (const { el, parent, next } of homes.reverse()) parent.insertBefore(el, next);
  homes = null;
}

async function startMicTest() {
  const note = $('wzRecNote');
  $('wzRecTest').textContent = 'Stop the test';
  note.textContent = '';
  try {
    const got = await hooks.mic.start($('wzRecMeter'), $('wzRecLoudest'));
    if (!got) return; // stopped meanwhile
    if (got.rate) note.textContent = `Your microphone runs at ${got.rate} Hz, so Scribecue converts it to 48 kHz. Set your audio interface to 48 kHz if you can.`;
    if (got.bluetooth) $('wzRecBt').textContent = 'These headphones look like Bluetooth, which delays sound. Use wired headphones if you can. If not, click Sync test, then raise Sync until the flash and the beep happen together.';
  } catch (e) {
    stopMicTest();
    note.textContent = e.name === 'NotAllowedError' ? 'Scribecue needs permission to use the microphone. Allow it in the address bar, then test again.' : `Couldn’t use the microphone: ${e.message}`;
  }
}
function stopMicTest() {
  if (!hooks.mic) return;
  hooks.mic.stop();
  $('wzRecTest').textContent = 'Test';
}

// onClose(finished) runs whenever the wizard closes, finished or skipped.
export function initWelcome(h, onClose = () => {}) {
  hooks = { ...hooks, ...h };
  const d = $('welcome');
  for (const v of hooks.offsets) $('wzOffset').add(new Option(v ? `${Math.round(v * 1000)} ms` : 'None', String(v)));
  for (const [v, label] of SPEEDS) if (v <= MAX_BASE) $('wzSpeed').add(new Option(label, String(v)));
  $('wzNext').addEventListener('click', () => { if (step === steps().length - 1) finish(); else { step++; show(); } });
  $('wzBack').addEventListener('click', () => { step--; show(); });
  $('wzSkip').addEventListener('click', () => d.close());
  $('wzTts').addEventListener('change', show);
  $('wzPiperGet').addEventListener('change', webPiperOffer);
  $('wzPiperVoice').addEventListener('change', webPiperOffer);
  for (const r of document.querySelectorAll('input[name=wzMode]')) r.addEventListener('change', show);
  $('wzRecTest').addEventListener('click', () => (hooks.mic.checking ? stopMicTest() : startMicTest()));
  $('wzRecReset').addEventListener('click', () => hooks.mic.reset());
  // A different microphone, mid-test: test that one instead.
  $('recDev').addEventListener('change', () => { if (d.open && hooks.mic?.checking) { stopMicTest(); startMicTest(); } });
  d.addEventListener('close', () => {
    stopMicTest();
    giveBack();
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    onClose(finished);
  });
  // Keep the editor's shortcuts from firing behind the wizard.
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
}

// The modes set up so far. Before this was kept, someone who'd been through setup had
// set up the mode they work in, any mode whose loop card they'd seen, and Record mode if
// they'd chosen a microphone, lead-in or sync for it.
const MODES = 'scribecue.setupModes';
export function modesSetUp(stored, { welcomed: was = false, current = '', loops = {}, recorded = false } = {}) {
  if (stored) return stored;
  if (!was) return {};
  const done = {};
  for (const m of Object.keys(MODE_NAMES)) if (m === current || loops[m] || (m === 'record' && recorded)) done[m] = true;
  return done;
}
const readModes = () => {
  let stored = null, loops = {};
  try { stored = JSON.parse(localStorage.getItem(MODES)); } catch { /* ignore */ }
  try { loops = JSON.parse(localStorage.getItem('scribecue.loops')) || {}; } catch { /* ignore */ }
  let recorded = false;
  try { recorded = ['dev', 'lead', 'sync'].some((k) => localStorage.getItem('scribecue.rec.' + k) !== null); } catch { /* ignore */ }
  const done = modesSetUp(stored, { welcomed: welcomed(), current: hooks.getMode(), loops, recorded });
  // Kept from the first read, before a switch changes the current mode.
  if (!stored && welcomed()) try { localStorage.setItem(MODES, JSON.stringify(done)); } catch { /* ignore */ }
  return done;
};
function markModeSetUp(m) {
  try { localStorage.setItem(MODES, JSON.stringify({ ...readModes(), [m]: true })); } catch { /* ignore */ }
}
export const modeSetUp = (m) => { try { return !!readModes()[m]; } catch { return true; } };
// The setup for one mode, the first time someone switches to it. Skipping it counts:
// it isn't offered again, and Settings at the top still runs the whole setup.
export function openModeSetup(m) {
  if (!MODE_NAMES[m] || modeSetUp(m) || $('welcome').open) return false;
  markModeSetUp(m);
  openWelcome(m);
  return true;
}

export const welcomed = () => { try { return localStorage.getItem(KEY) !== null; } catch { return true; } };
export const markWelcomed = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
