// Text to speech for audio description work, off until the user turns it on.
// Voices come from two places:
// - Piper, an optional container next to Scribecue (see docker-compose.yml). Its voices
//   run on this computer and return audio, so lengths are exact straight away and a
//   whole description track can be exported.
// - The browser's speech synthesis. By default only voices that run on this computer
//   are offered; online voices send the text to their provider, so they need a
//   separate opt-in.

import { HOSTED } from './config.js';

export const SPEEDS = [
  [0.7, 'very slow (−30%)'],
  [0.85, 'slow (−15%)'],
  [1, 'normal'],
  [1.15, 'fast (+15%)'],
  [1.3, 'very fast (+30%)'],
  [1.5, 'experimental (+50%)'],
  [2, 'experimental (+100%)'],
];
export const isSpeed = (v) => SPEEDS.some(([s]) => s === v);
// A block's own speed can also be a custom one, set by resizing the block to fit.
export const MIN_SPEED = 0.5, MAX_SPEED = 2;
export const isBlockSpeed = (v) => typeof v === 'number' && v >= MIN_SPEED && v <= MAX_SPEED;
// Short form for markers: "+15%", "−30%", "normal".
export const speedLabel = (s) => (s === 1 ? 'normal' : `${s > 1 ? '+' : '−'}${Math.round(Math.abs(s - 1) * 100)}%`);
// Menu name: "fast (+15%)" for the set speeds, "custom (+12%)" for others.
export const speedName = (s) => SPEEDS.find(([v]) => v === s)?.[1] || `custom (${speedLabel(s)})`;

// The speed at which a reading fills secs exactly. Given how long the reading takes at
// speed `at`, which is the closest it can be measured; reading time scales with 1 / speed.
export function speedToFit(readSecs, at, secs) {
  if (!(readSecs > 0) || !(secs > 0)) return null;
  const s = Math.round((at * readSecs / secs) * 100) / 100;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, s));
}

// The same from several readings of one line at different speeds, [{ speed, secs }].
// Reading time doesn't scale exactly with 1 / speed (pauses and some sounds stretch
// less), so with two readings it fits secs = a + b / speed through the two nearest the
// current speed, which lands on the length in a step or two.
export function speedFromReadings(points, secs, near = 1) {
  if (!(secs > 0) || !points.length) return null;
  const pts = [...points].sort((p, q) => Math.abs(p.speed - near) - Math.abs(q.speed - near));
  if (pts.length > 1 && Math.abs(pts[0].speed - pts[1].speed) > 1e-6) {
    const [p, q] = pts;
    const b = (p.secs - q.secs) / (1 / p.speed - 1 / q.speed), a = p.secs - b / p.speed;
    if (b > 0 && secs > a) {
      const s = Math.round((b / (secs - a)) * 100) / 100;
      return Math.min(MAX_SPEED, Math.max(MIN_SPEED, s));
    }
  }
  return speedToFit(pts[0].secs, pts[0].speed, secs);
}

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

// Splits voices for the menu: Piper, the browser's voices on this computer, then online ones.
export function groupVoices(voices) {
  return [
    ['Piper: natural voices on this computer', voices.filter((v) => v.piper)],
    ['On this computer', voices.filter((v) => v.localService && !v.piper)],
    ['Online: the text is sent to the provider', voices.filter((v) => !v.localService)],
  ];
}

// Piper's voice list, as Scribecue's voice objects: "en_GB-alba-medium" becomes
// "Alba (en-GB)".
export function piperVoiceList(json) {
  return Object.keys(json || {}).sort().map((id) => {
    const [lang = '', name = id] = id.split('-');
    const pretty = name.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
    return { voiceURI: 'piper:' + id, piper: id, name: pretty, lang: lang.replace('_', '-'), localService: true };
  });
}

// Reads a 16-bit PCM WAV file, as Piper returns.
export function readWav(buf) {
  const dv = new DataView(buf);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (buf.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let rate = 0, channels = 1, bits = 16, samples = null;
  for (let o = 12; o + 8 <= buf.byteLength;) {
    const id = tag(o), size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') { channels = dv.getUint16(o + 10, true); rate = dv.getUint32(o + 12, true); bits = dv.getUint16(o + 22, true); }
    if (id === 'data') {
      const n = Math.min(size, buf.byteLength - o - 8);
      samples = new Int16Array(buf.slice(o + 8, o + 8 + n - (n % 2)));
    }
    o += 8 + size + (size % 2);
  }
  if (!rate || !samples || bits !== 16) throw new Error('unsupported WAV format');
  return { rate, channels, samples, secs: samples.length / channels / rate };
}

// Writes mono 16-bit PCM samples as a WAV file.
export function writeWav(samples, rate) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, t) => [...t].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)));
  const bytes = samples.length * 2;
  str(0, 'RIFF'); h.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, 'data'); h.setUint32(40, bytes, true);
  return new Blob([h.buffer, samples.buffer], { type: 'audio/wav' });
}

// Lays readings out on a timeline: items [{ start, samples }], all at one sample rate,
// summed where they overlap. Returns mono samples covering secs.
export function mixTrack(items, rate, secs) {
  const out = new Int16Array(Math.max(1, Math.ceil(secs * rate)));
  for (const { start, samples } of items) {
    const at = Math.round(start * rate);
    for (let i = 0; i < samples.length && at + i < out.length; i++) {
      if (at + i < 0) continue;
      out[at + i] = Math.max(-32768, Math.min(32767, out[at + i] + samples[i]));
    }
  }
  return out;
}

// Seconds a line takes to say, from a voice's measured characters per second.
export function estimate(text, cps = DEFAULT_CPS, speed = 1) {
  const n = spoken(text).length;
  return n ? n / (cps * speed) : 0;
}

// What the voice actually reads: no tags, no line breaks, and with the setting on, no
// notes in [square brackets]. An unclosed bracket is read as it is.
export function spoken(text, skipNotes = tts.skipNotes) {
  let t = String(text).replace(/<[^>]*>|\{[^}]*\}/g, '');
  if (skipNotes) t = t.replace(/\[[^\]]*\]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
// True when a block has text, but all of it is notes that aren't read.
export const onlyNotes = (text) => !spoken(text) && !!spoken(text, false);

const KEY = 'scribecue.tts';
const DEFAULTS = { on: false, voice: '', speed: 1, live: true, duck: true, autoEnd: true, fitSpeed: true, skipNotes: false, onImport: 'ask', online: false, cps: {} };
const $ = (id) => document.getElementById(id);

export const tts = {
  ...DEFAULTS,
  available: typeof speechSynthesis !== 'undefined', // the browser's own voices
  piper: [], // Piper voices, once the container has answered
  speaking: null, // { id, manual } of the block being read, while speaking
};
try { Object.assign(tts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* ignore */ }
tts.cps = tts.cps && typeof tts.cps === 'object' ? tts.cps : {};
if (!isSpeed(tts.speed)) tts.speed = 1;

const save = () => {
  const { on, voice, speed, live, duck, autoEnd, fitSpeed, skipNotes, onImport, online, cps } = tts;
  try { localStorage.setItem(KEY, JSON.stringify({ on, voice, speed, live, duck, autoEnd, fitSpeed, skipNotes, onImport, online, cps })); } catch { /* ignore */ }
};

let hooks = { toast: () => {}, changed: () => {}, duck: () => {}, rate: () => 1 };
let voices = [];
const measured = new Map(); // voice|speed|text -> seconds of video time

function allowed() {
  const browser = pickVoices(tts.available ? speechSynthesis.getVoices() : [], { online: tts.online, lang: navigator.language || 'en' });
  return [...tts.piper, ...browser];
}
// The chosen voice, or a Piper voice if there is one, since they sound best.
function currentVoice() {
  return voices.find((v) => v.voiceURI === tts.voice) || voices.find((v) => v.piper) ||
    voices.find((v) => v.default) || voices[0] || null;
}
export const usingPiper = () => !!currentVoice()?.piper;
export const anyVoices = () => tts.available || tts.piper.length > 0;
const voiceKey = () => currentVoice()?.voiceURI || '';
const measureKey = (text, speed) => `${voiceKey()}|${speed}|${spoken(text)}`;

// Every reading of this text with the chosen voice so far, as [{ speed, secs }].
export function readingsOf(text) {
  const head = `${voiceKey()}|`, tail = `|${spoken(text)}`, out = [];
  for (const [k, secs] of measured) {
    if (k.startsWith(head) && k.endsWith(tail)) {
      const speed = +k.slice(head.length, k.length - tail.length);
      if (speed > 0) out.push({ speed, secs });
    }
  }
  return out;
}

// How long the text takes to say with the chosen voice, in video seconds, at a block's
// own speed or the overall one. Uses the last real reading of this exact text, or an
// estimate.
export function duration(text, speed = tts.speed) {
  const m = measured.get(measureKey(text, speed));
  if (m != null) return { secs: m, exact: true };
  return { secs: estimate(text, tts.cps[voiceKey()] || DEFAULT_CPS, speed), exact: false };
}

// ---- Piper

// Readings already made, by voice, speed and text: a promise of { samples, rate, secs, buf }.
const piperCache = new Map();
const PIPER_CACHE_MAX = 400;
let piperAudioEl = null;
const piperAudio = () => (piperAudioEl ||= new Audio());

export async function loadPiper() {
  try {
    const r = await fetch('tts/voices', { cache: 'no-store' });
    // Voices in the user's language first, so the default suits them.
    tts.piper = r.ok ? pickVoices(piperVoiceList(await r.json()), { lang: navigator.language || 'en' }) : [];
  } catch { tts.piper = []; }
  voices = allowed();
  hooks.changed();
  if ($('ttsDlg').open) render();
  return tts.piper.length;
}

function piperRead(text, speed, voice = currentVoice()) {
  const words = spoken(text);
  const key = `${voice.voiceURI}|${speed}|${words}`;
  let p = piperCache.get(key);
  if (!p) {
    p = fetch('tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // noise_w_scale 0 turns off Piper's random variation in timing, so the same line
      // always takes the same time: lengths stay exact across sessions and in the export.
      body: JSON.stringify({ text: words, voice: voice.piper, length_scale: 1 / speed, noise_w_scale: 0 }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`Piper answered ${r.status}`);
      const buf = await r.arrayBuffer();
      const wav = readWav(buf);
      measured.set(key, wav.secs);
      if (words.length > 8) { tts.cps[voice.voiceURI] = words.length / (wav.secs * speed); save(); }
      return { ...wav, buf };
    });
    p.catch(() => piperCache.delete(key));
    piperCache.set(key, p);
    if (piperCache.size > PIPER_CACHE_MAX) piperCache.delete(piperCache.keys().next().value);
  }
  return p;
}

// Measure without playing: returns the length in video seconds, or null. With Piper this
// only makes the reading; with a browser voice it reads silently in real time.
export function measure(text, speed = tts.speed) {
  if (!spoken(text)) return Promise.resolve(null);
  if (usingPiper()) return piperRead(text, speed).then((w) => { hooks.changed(); return w.secs; }, () => null);
  return new Promise((done) => speak(text, { silent: true, speed, done }));
}

// With Piper, make the reading in the background so the length shown becomes exact.
export function prefetch(text, speed = tts.speed) {
  if (usingPiper() && spoken(text) && !duration(text, speed).exact) piperRead(text, speed).then(() => hooks.changed(), () => {});
}

// The whole script as one audio file: each block's reading starts at the block's start.
// blocks [{ start, text, speed }], secs: total length. progress(done, total) as it goes.
// Returns { blob, overlaps }, where overlaps counts readings that run into the next one.
export async function renderTrack(blocks, secs, progress = () => {}) {
  const voice = currentVoice();
  if (!voice?.piper) throw new Error('Exporting needs a Piper voice');
  const items = [];
  let rate = 0;
  for (let k = 0; k < blocks.length; k++) {
    progress(k, blocks.length);
    const b = blocks[k];
    const w = await piperRead(b.text, b.speed ?? tts.speed, voice);
    rate ||= w.rate;
    items.push({ start: b.start, samples: w.samples, secs: w.secs });
  }
  progress(blocks.length, blocks.length);
  let overlaps = 0;
  for (let k = 0; k + 1 < items.length; k++) if (items[k].start + items[k].secs > items[k + 1].start + 0.0005) overlaps++;
  const end = Math.max(secs, ...items.map((i) => i.start + i.secs));
  hooks.changed();
  return { blob: writeWav(mixTrack(items, rate || 22050, end), rate || 22050), overlaps };
}

// ---- reading aloud

// The utterance being spoken. Keeping a reference also stops Chrome dropping its
// events when it would otherwise be garbage collected.
let current = null; // { u, done } for a browser voice, or { piper: token, done } for Piper
// The first reading with a voice includes loading it, which would add a few tenths of a
// second to the measured length. A short silent reading first loads it.
const warmed = new Set();
export function stop() {
  const c = current;
  current = null;
  if (tts.available && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
  if (c?.piper) piperAudio().pause();
  if (c) { tts.speaking = null; if (!c.silent) hooks.duck(false); c.done(null); }
}

function speakPiper(text, voice, { id, manual, silent, speed, done }) {
  stop();
  const token = {};
  const playRate = hooks.rate();
  current = { piper: token, done, silent };
  tts.speaking = { id, manual: manual || silent };
  const finish = (secs) => {
    if (current?.piper !== token) return;
    current = null;
    tts.speaking = null;
    if (!silent) hooks.duck(false);
    hooks.changed();
    done(secs);
  };
  piperRead(text, speed, voice).then((w) => {
    if (current?.piper !== token) return;
    if (silent) return finish(w.secs);
    const a = piperAudio();
    if (a.src) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(new Blob([w.buf], { type: 'audio/wav' }));
    a.playbackRate = playRate; // in step with the video; the length on its clock stays w.secs
    a.preservesPitch = true;
    a.onended = () => finish(w.secs);
    a.onerror = () => finish(null);
    hooks.duck(true);
    a.play().catch(() => finish(null));
  }, () => {
    if (current?.piper !== token) return;
    hooks.toast('Piper isn’t answering. Is its container running? See the README');
    finish(null);
  });
  return true;
}

// Read text aloud. done(secs) runs with the spoken length in video seconds when it
// finishes on its own, or with null if it was stopped or failed.
// silent: read at zero volume, just to measure it.
export function speak(text, { id = null, manual = false, silent = false, speed = tts.speed, done = () => {} } = {}) {
  const voice = currentVoice();
  const words = spoken(text);
  if (!words || !voice) { stop(); done(null); return false; }
  if (voice.piper) return speakPiper(text, voice, { id, manual, silent, speed, done });
  if (!tts.available) { done(null); return false; }
  stop();
  const u = new SpeechSynthesisUtterance(words);
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  const playRate = hooks.rate();
  u.rate = Math.min(10, Math.max(0.1, speed * playRate));
  if (silent) u.volume = 0;
  const key = measureKey(text, speed);
  let t0 = 0;
  u.onstart = () => { t0 = performance.now(); };
  const finish = (ok) => {
    if (current?.u !== u) return;
    current = null;
    tts.speaking = null;
    if (!silent) hooks.duck(false);
    if (!ok || !t0) { done(null); return; }
    // Wall time × playback rate = time on the video's clock.
    const secs = ((performance.now() - t0) / 1000) * playRate;
    measured.set(key, secs);
    if (words.length > 8) {
      tts.cps[voiceKey()] = words.length / (secs * speed);
      save();
    }
    hooks.changed();
    done(secs);
  };
  u.onend = () => finish(true);
  u.onerror = () => finish(false);
  current = { u, done, silent };
  tts.speaking = { id, manual: manual || silent };
  if (!silent) hooks.duck(true);
  if (voice && !warmed.has(voice.voiceURI)) {
    warmed.add(voice.voiceURI);
    const w = new SpeechSynthesisUtterance('.');
    w.voice = voice; w.lang = voice.lang; w.volume = 0;
    speechSynthesis.speak(w);
  }
  speechSynthesis.speak(u);
  return true;
}

// Fills a voice menu (the panel's, or the welcome wizard's) with the voices on offer.
export function fillVoiceSelect(sel, selected = currentVoice()?.voiceURI) {
  voices = allowed();
  sel.textContent = '';
  for (const [label, list] of groupVoices(voices)) {
    const online = label.startsWith('Online');
    if (online && !tts.online) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    if (label.startsWith('Piper') && !list.length) continue; // only when Piper is running
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
      o.textContent = online ? 'None in this browser: try Edge or Chrome' : 'None installed';
      g.append(o);
    }
    sel.append(g);
  }
  if (selected) sel.value = selected;
  sel.disabled = !voices.length;
}
export const chosenVoice = () => currentVoice()?.voiceURI || '';

function fillVoices() {
  fillVoiceSelect($('ttsVoice'));
  $('ttsNoVoices').hidden = !!voices.length || !anyVoices();
  $('ttsNoOnline').hidden = !tts.online || voices.some((v) => !v.localService);
  $('ttsNoVoices').textContent = tts.online
    ? 'This browser has no voices. Try Microsoft Edge or Google Chrome.'
    : 'No voices on this computer. Your system may need speech voices installed, or you can allow online voices below.';
}

function render() {
  $('ttsUnavailable').hidden = anyVoices();
  $('ttsOn').checked = tts.on;
  $('ttsOn').disabled = !anyVoices();
  const piper = usingPiper();
  $('ttsPiperNote').textContent = tts.piper.length
    ? (piper ? 'Piper voice: lengths are exact as soon as a block has text, and you can export a description track.'
      : `${tts.piper.length} Piper voice${tts.piper.length > 1 ? 's' : ''} available at the top of the list: they sound more natural and give exact lengths.`)
    : ''; // the Did you know box below explains Piper
  // The tip is about adding Piper to the Docker setup, which the web version doesn't have.
  $('ttsTip').hidden = tts.piper.length > 0 || HOSTED;
  $('ttsAllExactRow').hidden = piper;
  $('ttsExport').disabled = !piper;
  $('ttsExportNote').textContent = piper ? '' : 'Needs a Piper voice: the browser\'s own voices can\'t be recorded.';
  $('ttsBody').classList.toggle('off', !tts.on);
  $('ttsSpeed').value = String(tts.speed);
  $('ttsLive').checked = tts.live;
  $('ttsDuck').checked = tts.duck;
  $('ttsAuto').checked = tts.autoEnd;
  $('ttsNotes').checked = tts.skipNotes;
  $('ttsFit').checked = tts.fitSpeed;
  $('ttsImport').value = tts.onImport;
  $('ttsOnline').checked = tts.online;
  fillVoices();
}

// Change a setting from outside the panel, such as the welcome wizard.
export function setTtsOption(k, v) {
  tts[k] = v;
  save();
  if ($('ttsDlg').open) render();
  hooks.changed();
}

export function openTts() {
  render();
  loadPiper(); // in case Piper was started since
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
  $('ttsAuto').addEventListener('change', (e) => set('autoEnd', e.target.checked));
  $('ttsNotes').addEventListener('change', (e) => set('skipNotes', e.target.checked));
  $('ttsFit').addEventListener('change', (e) => set('fitSpeed', e.target.checked));
  $('ttsImport').addEventListener('change', (e) => set('onImport', e.target.value));
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
  voices = allowed();
  if (tts.available) {
    speechSynthesis.addEventListener('voiceschanged', () => { voices = allowed(); if (d.open) render(); hooks.changed(); });
  }
  loadPiper();
}
