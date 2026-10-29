// A short guided tour: it dims the page, lights up one part of it at a time, and says
// what it's for. Offered at the end of setup, and from the shortcuts overlay. Skippable
// at any step with Esc or Skip tour.
import { HOSTED } from './config.js';

// Each step: what to light up (a selector, or none for a card in the middle), and what to
// say. text can depend on the mode. only: shown in that mode only.
export const STEPS = [
  {
    title: 'Welcome to Scribecue',
    text: () => 'Scribecue is for writing and transcribing audio description: the narration that tells blind and partially sighted viewers what’s on screen, in the gaps between dialogue. This tour takes about a minute. Use → or Next to go on, and Esc to stop.',
  },
  {
    target: '.modesw',
    title: 'Two ways to work',
    text: () => 'Transcribe is for timing a narration that’s already recorded: hold H while the narrator speaks to mark each line. Write is for writing new descriptions, with text to speech to hear whether they fit. Switch at any time.',
  },
  {
    target: '#stage',
    title: 'Your video',
    text: () => 'Open a video or audio file with Open at the top, or drop it here. It plays straight from your computer and is never uploaded. Files with an audio description mix get an audio track picker.',
  },
  {
    target: '#tl',
    title: 'The timeline',
    text: (mode) => `Each box is a block: one description. Drag a block to move it, drag its edges to resize it, or drag across the empty lane to draw one. ${mode === 'write' ? 'Enter makes a block at the playhead, ready to type.' : 'Holding H marks a block from when you press to when you let go.'}`,
  },
  {
    target: '#editor',
    title: 'The block editor',
    text: (mode) => `The selected block’s text and its in and out times. ${mode === 'write' ? 'With text to speech on, it also shows how long the reading takes, in red if it doesn’t fit, and “sounds like” fixes how a name is said without changing the text.' : 'Type here once a block is marked; Enter or Esc carries on with the video.'}`,
  },
  {
    target: '#list',
    title: 'All your blocks',
    text: () => 'Every block in order. Click one to go to it, press / to search, and use the × at the end of a row to delete it. Ctrl/Cmd+Z undoes almost anything.',
  },
  {
    target: '.transport',
    title: 'Playing and stepping',
    text: () => 'The scrubber covers the whole video, with your blocks marked along it. The buttons step by frame, by three seconds or by block, play just the selected block, or loop it. Each one has a key, too.',
  },
  {
    target: '#ind [data-key="tts"]',
    only: 'write',
    title: 'Text to speech',
    text: () => 'Hear your blocks read aloud, to check each one fits before the next line of dialogue. Readings can set a block’s end, or a block’s speed can stretch to fill it. With a Piper voice, lengths are exact and you can export a description track.',
  },
  {
    target: '#aiBtn',
    title: 'AI help, if you want it',
    text: () => 'Connect your own AI provider, or Ollama on your own computer, to ask about a scene or draft a block from its frames. Drafts only go in when you choose. It’s off until you connect one.',
  },
  {
    target: 'nav',
    title: 'Projects and exports',
    text: () => 'Save keeps everything as a Scribecue project, so you can pick up where you left off. Export gives you the script as SRT or WebVTT to hand on, or the description track as a WAV file. New starts again.',
  },
  {
    title: 'Your work stays yours',
    text: () => `Your video, audio and scripts are opened straight from your computer and never uploaded. Your work is kept in this browser and in the project files you save. ${HOSTED ? 'Only the app itself is downloaded, from Scribecue’s site. ' : ''}Scribecue only contacts anything else when you turn it on: online voices, AI help${HOSTED ? '' : ', or update checks'}.`,
  },
  {
    target: 'nav [data-act="help"]',
    title: 'That’s the tour',
    text: () => 'Press ? any time for every keyboard shortcut. Setup at the top changes your choices, and the shortcuts overlay can show you this tour again.',
  },
];

// The steps for this mode whose part of the page is showing.
export function stepsFor(mode, visible = () => true) {
  return STEPS.filter((s) => (!s.only || s.only === mode) && (!s.target || visible(s.target)));
}

const $ = (id) => document.getElementById(id);
let state = null; // { steps, k, mode }

function place() {
  const { steps, k, mode } = state;
  const s = steps[k];
  const hole = $('tourHole'), card = $('tourCard');
  $('tourTitle').textContent = s.title;
  $('tourText').textContent = s.text(mode);
  $('tourStep').textContent = `${k + 1} of ${steps.length}`;
  $('tourBack').hidden = k === 0;
  $('tourNext').textContent = k === steps.length - 1 ? 'Finish' : 'Next';
  const el = s.target && document.querySelector(s.target);
  const pad = 6, gap = 12, vw = innerWidth, vh = innerHeight;
  if (!el) {
    hole.hidden = true;
    $('tour').classList.add('dim');
    card.style.left = `${Math.max(16, (vw - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(16, (vh - card.offsetHeight) / 2)}px`;
    return;
  }
  $('tour').classList.remove('dim');
  const r = el.getBoundingClientRect();
  const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
  const w = Math.min(vw - 8, r.right + pad) - x, h = Math.min(vh - 8, r.bottom + pad) - y;
  Object.assign(hole.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  hole.hidden = false;
  // Below the part it's about if there's room, else above it, else inside it.
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let top = y + h + gap;
  if (top + ch > vh - 8) top = y - gap - ch;
  if (top < 8) top = Math.min(vh - ch - 8, y + 16);
  const left = Math.min(Math.max(8, x + w / 2 - cw / 2), vw - cw - 8);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function go(d) {
  const k = state.k + d;
  if (k < 0) return;
  if (k >= state.steps.length) return endTour();
  state.k = k;
  place();
  $('tourNext').focus();
}

export function endTour() {
  if (!state) return;
  state = null;
  $('tour').hidden = true;
  removeEventListener('resize', place);
}

// mode: 'write' or 'transcribe'.
export function startTour(mode) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const visible = (sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0; };
  state = { steps: stepsFor(mode, visible), k: 0, mode };
  $('tour').hidden = false;
  addEventListener('resize', place);
  place();
  $('tourNext').focus();
}

export function initTour() {
  $('tourNext').addEventListener('click', () => go(1));
  $('tourBack').addEventListener('click', () => go(-1));
  $('tourSkip').addEventListener('click', endTour);
  // While the tour is on, its keys are the only ones that do anything.
  document.addEventListener('keydown', (e) => {
    if (!state) return;
    if (e.key === 'Tab') return; // moving between the card's buttons
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); endTour(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }, true);
}
