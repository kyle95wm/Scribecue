// A short guided tour: it dims the page, lights up one part of it at a time, and says
// what it's for. It opens on a first visit, before the setup, and from the shortcuts
// overlay. Skippable at any step with Esc or Skip tour.
//
// The loop to work in has a card of its own (showLoop), shown once for each mode: after
// setup for the mode picked there, and the first time someone switches to the other.
import { HOSTED } from './config.js';
import { bindings, comboText } from './keymap.js';
import { keyChanges } from './keys.js';

// The key that does an action now, as the person has set it up, such as "⇧V".
const MAC = typeof navigator === 'undefined' || /Mac|iPhone|iPad/.test(navigator.platform);
export const keyFor = (id, changes = keyChanges()) => {
  const c = bindings(changes)[id]?.[0];
  return c ? comboText(c, MAC) : '(no key)';
};

// The loop to repeat through a programme, for each mode.
export function loop(mode, key = keyFor) {
  return mode === 'write'
    ? [
      'Most of the work is one loop, repeated through the programme:',
      `1. Find a gap. ${key('play')} plays and stops; stop where there’s room for a description, and ${key('frameBack')} ${key('frameFwd')} find the exact frame.`,
      `2. Write it. ${key('createEdit')} makes a block at the playhead. Type the line, then Esc.`,
      `3. Hear it. ${key('read')} reads it with the video. If its time is red, it doesn’t fit: shorten it, or use [ ] to read it faster. Reading it yourself instead? Hold ${key('hold')} while you read it; letting go sets its end. Need a breath? Let go, then hold ${key('hold')} again to carry on.`,
      'Then play on to the next gap.',
    ].join('\n')
    : [
      'Most of the work is one loop, repeated through the programme:',
      `1. Play to the next line with ${key('play')}.`,
      `2. Mark it. Hold ${key('hold')} while the narrator speaks, and let go when they stop. Playback pauses and the block opens.`,
      '3. Type the line, then Enter or Esc, and playback carries on.',
      `To hear a line again while you type, ${key('loopBlock')} loops its block.`,
    ].join('\n');
}

// Each step: what to light up (a selector, or none for a card in the middle), and what to
// say. text can depend on the mode, and on whether the setup comes next. only: shown in
// that mode only.
export const STEPS = [
  {
    title: 'Welcome to Scribecue',
    text: () => 'Scribecue is for writing and transcribing audio description: the narration that tells blind and partially sighted viewers what’s on screen, in the gaps between dialogue. This tour takes about a minute. Use → or Next to go on, and Esc to skip it.',
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
    target: '#ind',
    title: 'What’s on',
    text: () => `Under the video: the playback speed, FOLLOW and LOOP, and the reaction offset for ${keyFor('hold')}. Settings show here while they’re on, such as REPLAY, which takes the playhead back to a block’s start when you finish editing it, so you hear it again. Click one to change it.`,
  },
  {
    target: '#aiBtn',
    title: 'AI help, if you want it',
    text: () => 'Connect your own AI provider in Settings, or Ollama on your own computer, to ask about a scene or draft a block from its frames. Drafts only go in when you choose. It’s off until you connect one.',
  },
  {
    target: 'nav [data-act="settings"]',
    title: 'Settings',
    text: (mode) => `Everything you set up is in Settings (${keyFor('settings')}). ${mode === 'write'
      ? 'Start with Text to speech: turn it on to hear your blocks read aloud, and check each one fits before the next line of dialogue. With a Piper voice, lengths are exact and you can export a description track.'
      : `Start with Transcribing: Whisper can type each line for you. When you let go of ${keyFor('hold')}, it listens to the block and fills in what the narrator said, ready to check. It runs on your computer.`} AI help, your shortcuts and storage are there too, and so are setup and this tour.`,
  },
  {
    target: 'nav',
    title: 'Projects and exports',
    text: () => 'Save keeps everything as a Scribecue project, so you can pick up where you left off. Export gives you the script as SRT or WebVTT to hand off, or the description track as a WAV file. New starts again.',
  },
  {
    title: 'Your work stays yours',
    text: () => `Your video, audio and scripts are opened straight from your computer and never uploaded. Your work is kept in this browser and in the project files you save. ${HOSTED ? 'Only the app itself is downloaded, from Scribecue’s site. ' : ''}Scribecue only contacts anything else when you turn it on: online voices, AI help${HOSTED ? '' : ', or update checks'}.`,
  },
  {
    target: 'nav [data-act="help"]',
    title: 'That’s the tour',
    text: (mode, { setupNext = false } = {}) => `Press ? any time for every keyboard shortcut, and to change them. ${setupNext ? 'Next comes a short setup; once you’ve picked a mode, you’ll see the loop to work in. ' : ''}Settings changes your choices later, and Settings and the shortcuts overlay can show you this tour again.`,
  },
];

// The steps for this mode whose part of the page is showing.
export function stepsFor(mode, visible = () => true) {
  return STEPS.filter((s) => (!s.only || s.only === mode) && (!s.target || visible(s.target)));
}

export const LOOP_STEP = {
  title: (mode) => (mode === 'write' ? 'The writing loop' : 'The transcribing loop'),
  text: (mode) => loop(mode),
};

const $ = (id) => document.getElementById(id);
let state = null; // { steps, k, mode, then, finish, single }

function place() {
  const { steps, k, mode } = state;
  const s = steps[k];
  const hole = $('tourHole'), card = $('tourCard');
  $('tourTitle').textContent = typeof s.title === 'function' ? s.title(mode) : s.title;
  $('tourText').textContent = s.text(mode, { setupNext: !!state.then });
  $('tourStep').textContent = state.single ? '' : `${k + 1} of ${steps.length}`;
  $('tourSkip').hidden = !!state.single;
  $('tourBack').hidden = k === 0;
  $('tourNext').textContent = k === steps.length - 1 ? state.finish : 'Next';
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
  const { then } = state;
  state = null;
  $('tour').hidden = true;
  removeEventListener('resize', place);
  then?.();
}

// mode: 'write' or 'transcribe'. then: what follows when the tour ends, finished or not;
// finish: the last button's words.
export function startTour(mode, { then = null, finish = 'Finish' } = {}) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const visible = (sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0; };
  state = { steps: stepsFor(mode, visible), k: 0, mode, then, finish };
  $('tour').hidden = false;
  addEventListener('resize', place);
  place();
  $('tourNext').focus();
}

// The loop for a mode, as a card on its own.
export function showLoop(mode) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  state = { steps: [LOOP_STEP], k: 0, mode, then: null, finish: 'Got it', single: true };
  $('tour').hidden = false;
  addEventListener('resize', place);
  place();
  $('tourNext').focus();
}

// Shows a mode's loop the first time it's needed, once for each mode.
const SEEN = 'scribecue.loops';
export function loopSeen(mode) {
  try { return !!(JSON.parse(localStorage.getItem(SEEN)) || {})[mode]; } catch { return true; }
}
export function maybeShowLoop(mode) {
  if (loopSeen(mode) || state) return false;
  try { localStorage.setItem(SEEN, JSON.stringify({ ...(JSON.parse(localStorage.getItem(SEEN)) || {}), [mode]: true })); } catch { return false; }
  showLoop(mode);
  return true;
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
