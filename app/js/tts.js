// Text to speech for audio description work, off until the user turns it on.
// Voices come from two places:
// - Piper, an optional container next to Scribecue (see docker-compose.yml), or in the
//   web version, Piper running in the browser (piper-worker.js) with voices the user
//   downloads. Its voices run on this computer and return audio, so lengths are exact
//   straight away and a whole description track can be exported.
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
// current speed, which lands on the length in a step or two. With one reading, share is
// the part of a reading at normal speed that doesn't change with speed (see fixedShare).
export function speedFromReadings(points, secs, near = 1, share = 0) {
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
  const [p] = pts;
  if (!(share > 0)) return speedToFit(p.secs, p.speed, secs);
  // secs = whole * (share + (1 - share) / speed), with whole the length at normal speed
  const r = secs / (p.secs / (share + (1 - share) / p.speed));
  if (r <= share) return MAX_SPEED;
  const s = Math.round(((1 - share) / (r - share)) * 100) / 100;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, s));
}

// Piper's readings: about a quarter of a reading at normal speed (the pauses, and the
// ends of sounds) stays the same at any speed. Learned per voice from lines read at two
// speeds, so the first guess at a speed that fills a block is close.
const SHARE = 0.23;
const shares = new Map(); // voice -> [sum, count]
export function fixedShare() {
  if (!usingPiper()) return 0;
  const s = shares.get(voiceKey());
  return s ? s[0] / s[1] : SHARE;
}
function learnShare(voiceURI, points) {
  if (points.length < 2) return;
  const lo = points.reduce((a, p) => (p.speed < a.speed ? p : a)), hi = points.reduce((a, p) => (p.speed > a.speed ? p : a));
  if (hi.speed - lo.speed < 0.05) return;
  const b = (lo.secs - hi.secs) / (1 / lo.speed - 1 / hi.speed), a = lo.secs - b / lo.speed;
  if (!(b > 0) || a < 0) return;
  const s = shares.get(voiceURI) || [SHARE * 4, 4]; // starts as if four lines had given the usual share
  s[0] += Math.min(0.5, a / (a + b)); s[1]++;
  shares.set(voiceURI, s);
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

// ---- Piper in the browser (web version)

// Workers that run Piper. The first also downloads and removes voices. Each reading
// uses one processor core, so long jobs such as Fit speeds to timings run several
// readings at once in extra workers, which close again after a short rest.
export const LANES = HOSTED ? Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1;
const pool = []; // { w, asks: Map, queue: [], sent: id, idle: timer }
let askId = 0;
// What the site offers and what's downloaded, once the worker has said.
export const webPiper = { offered: null, engine: 0, engineReady: false, downloaded: [], downloading: null };
function startWorker() {
  const p = { w: new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' }), asks: new Map(), queue: [], sent: 0, idle: null };
  p.w.addEventListener('message', ({ data: m }) => {
    if (m.op === 'progress') { webPiper.downloading = m; if ($('ttsDlg').open) renderWeb(); return; }
    const a = p.asks.get(m.id);
    if (!a) return;
    p.asks.delete(m.id);
    if (m.id === p.sent) { p.sent = 0; sendNext(p); }
    if (m.ok) a.resolve(m.result); else a.reject(new Error(m.error));
    restLater(p);
  });
  // The worker itself failed to start, so nothing it was asked will be answered.
  p.w.addEventListener('error', () => {
    for (const a of p.asks.values()) a.reject(new Error('Piper didn’t start'));
    p.asks.clear();
    pool.splice(pool.indexOf(p), 1);
  });
  pool.push(p);
  return p;
}
function restLater(p) {
  clearTimeout(p.idle);
  if (p === pool[0] || p.asks.size) return;
  p.idle = setTimeout(() => { if (!p.asks.size) { p.w.terminate(); pool.splice(pool.indexOf(p), 1); } }, 30000);
}
// any: a reading for a long job, which can go to whichever worker is least busy. Other
// readings go to the first worker, which has the voice loaded already (see warmUp).
// Returns the promise, with .hurry() to move the request to the front of its queue.
function ask(op, extra = {}, any = false) {
  let p = pool[0] || startWorker();
  if (any) {
    p = pool.reduce((a, q) => (q.asks.size < a.asks.size ? q : a));
    if (p.asks.size && pool.length < LANES) p = startWorker();
  }
  clearTimeout(p.idle);
  const id = ++askId;
  const { urgent, ...rest } = extra;
  const msg = { id, op, ...rest };
  const promise = new Promise((resolve, reject) => {
    p.asks.set(id, { resolve, reject });
    // Checking what's downloaded is answered straight away, alongside any job.
    if (op === 'status') p.w.postMessage(msg);
    else { if (urgent) p.queue.unshift(msg); else p.queue.push(msg); sendNext(p); }
  });
  promise.hurry = () => {
    const k = p.queue.indexOf(msg);
    if (k > 0) p.queue.unshift(...p.queue.splice(k, 1));
  };
  return promise;
}
// The worker gets one job at a time, so whatever is most urgent always goes next.
function sendNext(p) {
  if (p.sent || !p.queue.length) return;
  const msg = p.queue.shift();
  p.sent = msg.id;
  p.w.postMessage(msg);
}

// Loads the chosen Piper voice in the first worker while nothing is waiting on it, so the
// first block read aloud doesn't wait for the engine and voice to load.
let warmVoice = '';
function warmUp() {
  const v = currentVoice();
  if (!HOSTED || !tts.on || !v?.piper || warmVoice === v.piper) return;
  warmVoice = v.piper;
  ask('warm', { voice: v.piper }).catch(() => { warmVoice = ''; });
}

async function downloadVoice(voice) {
  webPiper.downloading = { voice, loaded: 0, total: 0 };
  renderWeb();
  // Ask the browser to keep the voices when space runs low, rather than clearing them.
  navigator.storage?.persist?.().catch(() => {});
  try {
    await ask('download', { voice });
    tts.voice = 'piper:' + voice;
    save();
    hooks.toast('Voice downloaded. It’s now chosen, and works offline');
  } catch (e) {
    hooks.toast(`The voice didn’t download: ${e.message}`);
  }
  webPiper.downloading = null;
  await loadPiper();
}

async function removeVoice(voice) {
  if (!confirm('Remove this voice from your browser? You can download it again later.')) return;
  stop();
  await ask('remove', { voice }).catch(() => {});
  // The extra workers still have the voice loaded; let them go.
  for (const p of pool.splice(1)) {
    p.w.terminate();
    for (const a of p.asks.values()) a.reject(new Error('The voice was removed'));
  }
  if (tts.voice === 'piper:' + voice) { tts.voice = ''; save(); }
  await loadPiper();
}

const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
function renderWeb() {
  $('ttsWeb').hidden = !HOSTED || !webPiper.offered;
  if (!HOSTED || !webPiper.offered) return;
  const sel = $('ttsWebVoice');
  // Voices in the user's language first, as with the container.
  const offered = pickVoices(piperVoiceList(webPiper.offered), { lang: navigator.language || 'en' });
  const keep = sel.value || tts.voice.replace(/^piper:/, '') || offered[0]?.piper;
  sel.textContent = '';
  for (const v of offered) {
    const o = document.createElement('option');
    o.value = v.piper;
    const got = webPiper.downloaded.includes(v.piper);
    o.textContent = `${v.name} (${v.lang}) · ${got ? 'downloaded' : mb(webPiper.offered[v.piper])}`;
    sel.append(o);
  }
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  const d = webPiper.downloading;
  const got = webPiper.downloaded.includes(sel.value);
  $('ttsWebGet').textContent = got ? 'Remove' : 'Download';
  $('ttsWebGet').hidden = !!d;
  sel.disabled = !!d;
  $('ttsWebBar').hidden = !d;
  if (d) {
    $('ttsWebBar').max = d.total || 1;
    $('ttsWebBar').value = d.loaded;
    $('ttsWebStatus').textContent = d.total ? `${mb(d.loaded)} of ${mb(d.total)}` : 'Starting…';
  } else $('ttsWebStatus').textContent = '';
  $('ttsWebNote').textContent = webPiper.engineReady ? ''
    : `The first voice also downloads the speech engine, ${mb(webPiper.engine)}, which all the voices share.`;
}

export async function loadPiper() {
  if (HOSTED) {
    try {
      Object.assign(webPiper, await ask('status'));
      tts.piper = pickVoices(piperVoiceList(Object.fromEntries(webPiper.downloaded.map((v) => [v, 1]))), { lang: navigator.language || 'en' });
    } catch { tts.piper = []; }
    voices = allowed();
    hooks.changed();
    if ($('ttsDlg').open) render();
    warmUp();
    return tts.piper.length;
  }
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

// how: 'now' for a reading someone is waiting to hear, 'bulk' for one of many in a long
// job, or 'background' to have it ready.
const pending = new Map(); // key -> the worker request, while it's queued or running
function piperRead(text, speed, voice = currentVoice(), how = 'background') {
  const words = spoken(text);
  const key = `${voice.voiceURI}|${speed}|${words}`;
  let p = piperCache.get(key);
  if (p && how === 'now') pending.get(key)?.hurry();
  if (!p) {
    let reading;
    if (HOSTED) {
      reading = ask('synthesize', { voice: voice.piper, text: words, speed, urgent: how === 'now' }, how === 'bulk');
      pending.set(key, reading);
      reading.finally(() => pending.delete(key)).catch(() => {});
    } else reading = fetch('tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // noise_w_scale 0 turns off Piper's random variation in timing, so the same line
      // always takes the same time: lengths stay exact across sessions and in the export.
      body: JSON.stringify({ text: words, voice: voice.piper, length_scale: 1 / speed, noise_w_scale: 0 }),
    }).then((r) => {
      if (!r.ok) throw new Error(`Piper answered ${r.status}`);
      return r.arrayBuffer();
    });
    p = reading.then((buf) => {
      const wav = readWav(buf);
      measured.set(key, wav.secs);
      if (voice.voiceURI === voiceKey()) learnShare(voice.voiceURI, readingsOf(text));
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
// bulk: one of many readings in a long job, which can run several at once.
export function measure(text, speed = tts.speed, { bulk = false } = {}) {
  if (!spoken(text)) return Promise.resolve(null);
  if (usingPiper()) return piperRead(text, speed, currentVoice(), bulk ? 'bulk' : 'background').then((w) => { hooks.changed(); return w.secs; }, () => null);
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
    const w = await piperRead(b.text, b.speed ?? tts.speed, voice, 'bulk');
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
  piperRead(text, speed, voice, 'now').then((w) => {
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
    hooks.toast(HOSTED ? 'The Piper voice couldn’t read that block. Try reloading the page'
      : 'Piper isn’t answering. Is its container running? See the README');
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
  renderWeb();
}

// Change a setting from outside the panel, such as the welcome wizard.
export function setTtsOption(k, v) {
  tts[k] = v;
  save();
  warmUp();
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
  const set = (k, v) => { tts[k] = v; save(); render(); hooks.changed(); warmUp(); };
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
  const SAMPLE = 'A pale blue streak cuts diagonally through the darkness.';
  $('ttsTest').addEventListener('click', () => speak(SAMPLE));
  $('ttsTry').addEventListener('click', () => speak(hooks.sample?.() || SAMPLE));
  $('ttsWebVoice').addEventListener('change', renderWeb);
  $('ttsWebGet').addEventListener('click', () => {
    const v = $('ttsWebVoice').value;
    if (v) (webPiper.downloaded.includes(v) ? removeVoice : downloadVoice)(v);
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
