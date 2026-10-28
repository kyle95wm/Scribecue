// Text to speech for audio description work, off until the user turns it on.
// It uses the browser's speech synthesis. By default only voices that run on this
// computer are offered; online voices send the text to their provider, so they
// need a separate opt-in.

export const SPEEDS = [
  [0.7, 'very slow (−30%)'],
  [0.85, 'slow (−15%)'],
  [1, 'normal'],
  [1.15, 'fast (+15%)'],
  [1.3, 'very fast (+30%)'],
  [1.5, 'experimental (+50%)'],
  [2, 'experimental (+100%)'],
];
// Characters per second at normal speed before a voice has been measured.
export const DEFAULT_CPS = 15;

// Voices the user may pick from: local ones, plus online ones if allowed, with
// voices in the user's language first.
export function pickVoices(voices, { online = false, lang = 'en' } = {}) {
  const base = lang.toLowerCase().split('-')[0];
  const rank = (v) => {
    const l = (v.lang || '').toLowerCase();
    return l === lang.toLowerCase() ? 0 : l.split(/[-_]/)[0] === base ? 1 : 2;
  };
  return voices
    .filter((v) => online || v.localService)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// Splits voices for the menu: ones that run on this computer, then online ones.
export function groupVoices(voices) {
  return [
    ['On this computer', voices.filter((v) => v.localService)],
    ['Online: the text is sent to the provider', voices.filter((v) => !v.localService)],
  ];
}

// Seconds a line takes to say, from a voice's measured characters per second.
export function estimate(text, cps = DEFAULT_CPS, speed = 1) {
  const n = spoken(text).length;
  return n ? n / (cps * speed) : 0;
}

// What the voice actually reads: no tags, no line breaks.
export const spoken = (text) => String(text).replace(/<[^>]*>|\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();

const KEY = 'scribecue.tts';
const DEFAULTS = { on: false, voice: '', speed: 1, live: true, duck: true, online: false, cps: {} };
const $ = (id) => document.getElementById(id);

export const tts = {
  ...DEFAULTS,
  available: typeof speechSynthesis !== 'undefined',
  speaking: null, // { id, manual } of the block being read, while speaking
};
try { Object.assign(tts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* ignore */ }
tts.cps = tts.cps && typeof tts.cps === 'object' ? tts.cps : {};
if (!SPEEDS.some(([s]) => s === tts.speed)) tts.speed = 1;

const save = () => {
  const { on, voice, speed, live, duck, online, cps } = tts;
  try { localStorage.setItem(KEY, JSON.stringify({ on, voice, speed, live, duck, online, cps })); } catch { /* ignore */ }
};

let hooks = { toast: () => {}, changed: () => {}, duck: () => {}, rate: () => 1 };
let voices = [];
const measured = new Map(); // voice|speed|text -> seconds of video time

function allowed() {
  return pickVoices(tts.available ? speechSynthesis.getVoices() : [], { online: tts.online, lang: navigator.language || 'en' });
}
function currentVoice() {
  return voices.find((v) => v.voiceURI === tts.voice) || voices.find((v) => v.default) || voices[0] || null;
}
const voiceKey = () => currentVoice()?.voiceURI || '';
const measureKey = (text) => `${voiceKey()}|${tts.speed}|${spoken(text)}`;

// How long the text takes to say at the chosen voice and speed, in video seconds.
// Uses the last real reading of this exact text, or an estimate.
export function duration(text) {
  const m = measured.get(measureKey(text));
  if (m != null) return { secs: m, exact: true };
  return { secs: estimate(text, tts.cps[voiceKey()] || DEFAULT_CPS, tts.speed), exact: false };
}

// The utterance being spoken. Keeping a reference also stops Chrome dropping its
// events when it would otherwise be garbage collected.
let current = null; // { u, done }
// The first reading with a voice includes loading it, which would add a few tenths of a
// second to the measured length. A short silent reading first loads it.
const warmed = new Set();
export function stop() {
  if (!tts.available) return;
  const c = current;
  current = null;
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  if (c) { tts.speaking = null; hooks.duck(false); c.done(null); }
}

// Read text aloud. done(secs) runs with the spoken length in video seconds when it
// finishes on its own, or with null if it was stopped or failed.
export function speak(text, { id = null, manual = false, done = () => {} } = {}) {
  if (!tts.available) { done(null); return false; }
  stop();
  const words = spoken(text);
  if (!words) { done(null); return false; }
  const u = new SpeechSynthesisUtterance(words);
  const voice = currentVoice();
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  const playRate = hooks.rate();
  u.rate = Math.min(10, Math.max(0.1, tts.speed * playRate));
  const key = measureKey(text);
  let t0 = 0;
  u.onstart = () => { t0 = performance.now(); };
  const finish = (ok) => {
    if (current?.u !== u) return;
    current = null;
    tts.speaking = null;
    hooks.duck(false);
    if (!ok || !t0) { done(null); return; }
    // Wall time × playback rate = time on the video's clock.
    const secs = ((performance.now() - t0) / 1000) * playRate;
    measured.set(key, secs);
    if (words.length > 8) {
      tts.cps[voiceKey()] = words.length / (secs * tts.speed);
      save();
    }
    hooks.changed();
    done(secs);
  };
  u.onend = () => finish(true);
  u.onerror = () => finish(false);
  current = { u, done };
  tts.speaking = { id, manual };
  hooks.duck(true);
  if (voice && !warmed.has(voice.voiceURI)) {
    warmed.add(voice.voiceURI);
    const w = new SpeechSynthesisUtterance('.');
    w.voice = voice; w.lang = voice.lang; w.volume = 0;
    speechSynthesis.speak(w);
  }
  speechSynthesis.speak(u);
  return true;
}

function fillVoices() {
  voices = allowed();
  const sel = $('ttsVoice');
  sel.textContent = '';
  for (const [label, list] of groupVoices(voices)) {
    const online = label.startsWith('Online');
    if (online && !tts.online) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const v of list) {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      g.append(o);
    }
    if (!list.length) {
      // Say so, rather than leaving people wondering whether the option did anything.
      const o = document.createElement('option');
      o.disabled = true;
      o.textContent = online ? 'This browser has no online voices' : 'None installed';
      g.append(o);
    }
    sel.append(g);
  }
  const cur = currentVoice();
  if (cur) sel.value = cur.voiceURI;
  sel.disabled = !voices.length;
  $('ttsNoVoices').hidden = !!voices.length || !tts.available;
  $('ttsNoVoices').textContent = tts.online
    ? 'This browser has no voices.'
    : 'No voices on this computer. Your system may need speech voices installed, or you can allow online voices below.';
}

function render() {
  $('ttsUnavailable').hidden = tts.available;
  $('ttsOn').checked = tts.on;
  $('ttsOn').disabled = !tts.available;
  $('ttsBody').classList.toggle('off', !tts.on);
  $('ttsSpeed').value = String(tts.speed);
  $('ttsLive').checked = tts.live;
  $('ttsDuck').checked = tts.duck;
  $('ttsOnline').checked = tts.online;
  if (tts.available) fillVoices();
}

export function openTts() {
  render();
  const d = $('ttsDlg');
  if (!d.open) d.showModal();
}

export function initTts(h) {
  hooks = { ...hooks, ...h };
  const sp = $('ttsSpeed');
  for (const [s, label] of SPEEDS) {
    const o = document.createElement('option');
    o.value = String(s);
    o.textContent = label;
    sp.append(o);
  }
  const d = $('ttsDlg');
  const set = (k, v) => { tts[k] = v; save(); render(); hooks.changed(); };
  $('ttsOn').addEventListener('change', (e) => { if (!e.target.checked) stop(); set('on', e.target.checked); });
  $('ttsVoice').addEventListener('change', (e) => set('voice', e.target.value));
  sp.addEventListener('change', (e) => set('speed', +e.target.value));
  $('ttsLive').addEventListener('change', (e) => set('live', e.target.checked));
  $('ttsDuck').addEventListener('change', (e) => set('duck', e.target.checked));
  $('ttsOnline').addEventListener('change', (e) => {
    // Turning online voices off also drops an online voice that was chosen.
    if (!e.target.checked && currentVoice() && !currentVoice().localService) { stop(); tts.voice = ''; }
    set('online', e.target.checked);
  });
  $('ttsTry').addEventListener('click', () => {
    const text = hooks.sample?.() || 'A pale blue streak cuts diagonally through the darkness.';
    speak(text);
  });
  $('ttsClose').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => stop());
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
  if (tts.available) {
    voices = allowed();
    speechSynthesis.addEventListener('voiceschanged', () => { voices = allowed(); if (d.open) render(); hooks.changed(); });
  }
}
