// The welcome wizard: a short setup that picks the task (Transcribe or Write), the
// tools for it, and update checks. It opens by itself the first time Scribecue is
// used, and the Setup button at the top runs it again. Choices take effect only when
// Finish is pressed, so skipping changes nothing.

import { tts, SPEEDS, fillVoiceSelect, chosenVoice, setTtsOption, loadPiper } from './tts.js';
import { updateChoice, setUpdateChoice } from './update.js';
import { HOSTED } from './config.js';

const $ = (id) => document.getElementById(id);
const KEY = 'scribecue.welcome';
let hooks = { getMode: () => 'transcribe', setMode: () => {}, getOffset: () => 0.2, setOffset: () => {}, offsets: [], toast: () => {} };
let step = 0;
let finished = false;

const mode = () => document.querySelector('input[name=wzMode]:checked')?.value || 'transcribe';
// The steps for the chosen task: the third one depends on it.
// The web version updates itself, so it skips the question about update checks.
const steps = () => ['welcome', 'task', mode(), ...(HOSTED ? [] : ['updates']), 'done'];

function show() {
  const list = steps();
  step = Math.max(0, Math.min(step, list.length - 1));
  for (const s of document.querySelectorAll('#welcome [data-step]')) s.hidden = s.dataset.step !== list[step];
  $('wzStep').textContent = `Step ${step + 1} of ${list.length}`;
  $('wzBack').hidden = step === 0;
  $('wzNext').textContent = step === list.length - 1 ? 'Finish' : step === 0 ? 'Get started' : 'Next';
  $('wzTtsBody').classList.toggle('off', !$('wzTts').checked);
  if (list[step] === 'done') summarise();
  $('wzNext').focus();
}

function summarise() {
  const m = mode();
  const lines = [m === 'write' ? 'Write mode, for new audio description' : 'Transcribe mode, for existing audio description'];
  if (m === 'transcribe') lines.push(`Hold-to-mark reaction offset: ${Math.round(+$('wzOffset').value * 1000)} ms`);
  if (m === 'write') {
    if ($('wzTts').checked) {
      const v = $('wzVoice').selectedOptions[0]?.textContent || 'the default voice';
      lines.push(`Text to speech on, with ${v} at ${$('wzSpeed').selectedOptions[0].textContent} speed`);
    } else lines.push('Text to speech off');
  }
  const u = document.querySelector('input[name=wzUpd]:checked')?.value;
  if (!HOSTED) lines.push(u === '1' ? 'Checks for updates once a day' : u === '0' ? 'Doesn’t check for updates' : 'Update checks: not chosen yet');
  $('wzSummary').replaceChildren(...lines.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  $('wzModeKey').innerHTML = m === 'write' ? '<kbd>V</kbd>' : 'Hold <kbd>H</kbd>';
  $('wzModeDesc').textContent = m === 'write' ? 'Read the selected block aloud' : 'Mark a block while the narrator speaks';
}

function finish() {
  const m = mode();
  hooks.setMode(m, true);
  if (m === 'transcribe') hooks.setOffset(+$('wzOffset').value);
  if (m === 'write') {
    setTtsOption('on', $('wzTts').checked);
    if ($('wzTts').checked) {
      if ($('wzVoice').value) setTtsOption('voice', $('wzVoice').value);
      setTtsOption('speed', +$('wzSpeed').value);
      setTtsOption('live', $('wzLive').checked);
      setTtsOption('autoEnd', $('wzAuto').checked);
    }
  }
  const u = document.querySelector('input[name=wzUpd]:checked')?.value;
  if (u === '1' || u === '0') setUpdateChoice(u === '1');
  finished = true;
  const tour = $('wzTour').checked;
  $('welcome').close();
  if (tour) { hooks.tour?.(m); return; }
  hooks.toast(m === 'write'
    ? `All set for writing.${$('wzTts').checked ? ' Press V to hear a block.' : ''} Setup at the top runs this again`
    : 'All set for transcribing. Hold H while the narrator speaks. Setup at the top runs this again');
}

export function openWelcome() {
  finished = false;
  step = 0;
  for (const r of document.querySelectorAll('input[name=wzMode]')) r.checked = r.value === hooks.getMode();
  $('wzOffset').value = String(hooks.getOffset());
  // New users who pick Write most likely want text to speech, so it starts ticked for them.
  $('wzTts').checked = tts.on || !welcomed();
  fillVoiceSelect($('wzVoice'), chosenVoice());
  $('wzSpeed').value = String(tts.speed);
  $('wzLive').checked = tts.live;
  $('wzAuto').checked = tts.autoEnd;
  $('wzTour').checked = !welcomed(); // new users are offered the tour; it's there to tick later

  const u = updateChoice();
  for (const r of document.querySelectorAll('input[name=wzUpd]')) r.checked = r.value === u;
  piperNote();
  loadPiper().then(() => { fillVoiceSelect($('wzVoice'), $('wzVoice').value || chosenVoice()); piperNote(); });
  const d = $('welcome');
  if (!d.open) d.showModal();
  show();
}

function piperNote() {
  $('wzPiper').textContent = tts.piper.length
    ? `Piper voices are available: they sound natural, give exact lengths and can be exported as a description track.`
    : 'Tip: for natural-sounding voices that run on your computer, add Piper later (see the README).';
}

// onClose(finished) runs whenever the wizard closes, finished or skipped.
export function initWelcome(h, onClose = () => {}) {
  hooks = { ...hooks, ...h };
  const d = $('welcome');
  for (const v of hooks.offsets) $('wzOffset').add(new Option(v ? `${Math.round(v * 1000)} ms` : 'None', String(v)));
  for (const [v, label] of SPEEDS) $('wzSpeed').add(new Option(label, String(v)));
  $('wzNext').addEventListener('click', () => { if (step === steps().length - 1) finish(); else { step++; show(); } });
  $('wzBack').addEventListener('click', () => { step--; show(); });
  $('wzSkip').addEventListener('click', () => d.close());
  $('wzTts').addEventListener('change', show);
  for (const r of document.querySelectorAll('input[name=wzMode]')) r.addEventListener('change', show);
  d.addEventListener('close', () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    onClose(finished);
  });
  // Keep the editor's shortcuts from firing behind the wizard.
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
}

export const welcomed = () => { try { return localStorage.getItem(KEY) !== null; } catch { return true; } };
export const markWelcomed = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
