// Text to speech for audio description work, off until the user turns it on.
// Voices come from three places:
// - Piper, an optional container next to Scribecue (see docker-compose.yml), or in the
//   web version, Piper running in the browser (piper-worker.js) with voices the user
//   downloads. Its voices run on this computer and return audio, so lengths are exact
//   straight away and a whole description track can be exported.
// - Google Cloud's Standard voices, with the user's own API key. They also return audio,
//   so they work like Piper, but each reading sends the block's text to Google. Adding
//   the key is the opt-in.
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
  if (!usingAudioVoice()) return 0;
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
    ['Google Cloud: the text is sent to Google', voices.filter((v) => v.google)],
    ['On this computer', voices.filter((v) => v.localService && !v.piper)],
    ['Online: the text is sent to the provider', voices.filter((v) => !v.localService && !v.google)],
  ];
}

// Voices that make their readings as audio, Piper's and Google's: lengths are exact, and
// a description track can be exported.
export const makesAudio = (v) => !!(v?.piper || v?.google);

// Google Cloud's voice list, as Scribecue's voice objects: only the Standard voices, in
// the user's languages if it has any of those. "en-GB-Standard-A" becomes
// "Google Standard A, female".
const GOOGLE = 'https://texttospeech.googleapis.com/v1';
export const GOOGLE_KEY_PAGE = 'https://console.cloud.google.com/apis/library/texttospeech.googleapis.com';
export function googleVoiceList(json, langs = ['en']) {
  const all = (json?.voices || []).filter((v) => /-Standard-/.test(v.name || '')).map((v) => {
    const gender = { FEMALE: ', female', MALE: ', male' }[v.ssmlGender] || '';
    return { voiceURI: 'google:' + v.name, google: v.name, name: `Google Standard ${v.name.split('-Standard-')[1]}${gender}`,
      lang: v.languageCodes?.[0] || v.name.split('-').slice(0, 2).join('-'), localService: false };
  });
  const bases = new Set(langs.map((l) => l.toLowerCase().split('-')[0]));
  const mine = all.filter((v) => bases.has(v.lang.toLowerCase().split('-')[0]));
  return mine.length ? mine : all;
}

// Which saved readings to remove so the rest fit in `cap` bytes: the ones used longest
// ago go first. entries [{ key, bytes, at }].
export function overCap(entries, cap) {
  let total = entries.reduce((n, e) => n + e.bytes, 0);
  const out = [];
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    if (total <= cap) break;
    out.push(e.key);
    total -= e.bytes;
  }
  return out;
}

// How every request to Google goes: no cookies, and only Scribecue's address as the
// referrer (never the page's path), so a key restricted to Scribecue's website works.
export const GOOGLE_FETCH = { credentials: 'omit', referrerPolicy: 'strict-origin' };

// The request for one reading. LINEAR16 comes back as a WAV file, base64 encoded.
export function googleRequest(text, voice, speed, key) {
  return {
    url: `${GOOGLE}/text:synthesize`,
    init: {
      ...GOOGLE_FETCH,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.lang, name: voice.google },
        audioConfig: { audioEncoding: 'LINEAR16', speakingRate: speed },
      }),
    },
  };
}

// What went wrong, from Google's answer, in words someone can act on.
export async function googleFailure(r) {
  let msg = '';
  try { msg = (await r.json())?.error?.message || ''; } catch { /* not JSON */ }
  if (r.status === 400 && /api key/i.test(msg)) return 'Google didn’t accept the key. Check it in Settings, under Text to speech';
  if (r.status === 403 && /referer|referrer/i.test(msg)) return `Google refused: the key is restricted to other websites. Add ${globalThis.location?.origin || 'Scribecue’s address'}/* to its website restrictions`;
  if (r.status === 403) return `Google refused: ${msg || 'the key may not be allowed to use Text-to-Speech'}`;
  if (r.status === 429) return 'Google says too many readings were asked for at once, or the key’s quota is used up';
  return `Google answered ${r.status}${msg ? `: ${msg}` : ''}`;
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
// Levels in the exported track, in dBFS. Voices come out of Piper at full scale; the
// track leaves headroom for mixing and mastering instead. Each reading peaks at
// TRACK_PEAK_DB, so every block is the same level, and readings that overlap and add up
// never take the track past TRACK_MAX_DB.
export const TRACK_PEAK_DB = -8, TRACK_MAX_DB = -6;
const dbToLevel = (db) => 32767 * 10 ** (db / 20);
export function mixTrack(items, rate, secs, peakDb = TRACK_PEAK_DB, maxDb = TRACK_MAX_DB) {
  const mix = new Float32Array(Math.max(1, Math.ceil(secs * rate)));
  for (const { start, samples } of items) {
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    const g = peak ? dbToLevel(peakDb) / peak : 0;
    const at = Math.round(start * rate);
    for (let i = Math.max(0, -at); i < samples.length && at + i < mix.length; i++) mix[at + i] += samples[i] * g;
  }
  let top = 0;
  for (const s of mix) top = Math.max(top, Math.abs(s));
  const g = top > dbToLevel(maxDb) ? dbToLevel(maxDb) / top : 1;
  const out = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(mix[i] * g)));
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

// A block's "sounds like" words, [[written, said], …]: each written word or phrase is
// read aloud as the other, as a whole word and whatever its case. Only the reading
// changes; the block's text stays as it is, in exports too.
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sayPattern = (words) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(reEsc).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
export function soundsLike(text, say) {
  const pairs = (say || []).filter(([w, s]) => w?.trim() && s?.trim()).map(([w, s]) => [w.trim(), s.trim()])
    .sort((a, b) => b[0].length - a[0].length); // "New York" before "York"
  if (!pairs.length) return text;
  const said = new Map(pairs.map(([w, s]) => [w.toLocaleLowerCase(), s]));
  return text.replace(sayPattern(pairs.map(([w]) => w)), (m) => said.get(m.toLocaleLowerCase()) ?? m);
}
// A block's sounds-like list with more added: a word already in it takes the new sound.
export function mergeSay(say = [], add = []) {
  const out = new Map((say || []).map(([w, s]) => [w.toLocaleLowerCase(), [w, s]]));
  for (const [w, s] of add) out.set(w.toLocaleLowerCase(), [w, s]);
  return [...out.values()];
}
// Whether the text has this word or phrase in it, as soundsLike would find it.
export const hasWord = (text, word) => !!word.trim() && sayPattern([word.trim()]).test(text);

const KEY = 'scribecue.tts';
const DEFAULTS = { on: false, voice: '', speed: 1, live: true, duck: true, autoEnd: true, fitSpeed: true, skipNotes: false, onImport: 'ask', online: false, cps: {}, mix: 0 };
const $ = (id) => document.getElementById(id);

export const tts = {
  ...DEFAULTS,
  available: typeof speechSynthesis !== 'undefined', // the browser's own voices
  piper: [], // Piper voices, once the container has answered
  google: [], // Google Cloud voices, while there's a key
  speaking: null, // { id, manual } of the block being read, while speaking
};
try { Object.assign(tts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* ignore */ }

// The Google Cloud key, and the voice list it last gave, kept apart from the settings.
// The list is kept so that opening Scribecue doesn't contact Google: it's only asked
// again when the key changes or Text to speech settings are opened.
const GKEY = 'scribecue.googleTts';
const googleStore = () => { try { return JSON.parse(localStorage.getItem(GKEY)) || {}; } catch { return {}; } };
const googleKey = () => googleStore().key || '';
const langs = () => [...new Set([...(navigator.languages || []), navigator.language || 'en'])];
tts.google = googleKey() ? googleVoiceList({ voices: googleStore().voices }, langs()) : [];
tts.cps = tts.cps && typeof tts.cps === 'object' ? tts.cps : {};
if (!isSpeed(tts.speed)) tts.speed = 1;

const save = () => {
  const { on, voice, speed, live, duck, autoEnd, fitSpeed, skipNotes, onImport, online, cps, mix } = tts;
  try { localStorage.setItem(KEY, JSON.stringify({ on, voice, speed, live, duck, autoEnd, fitSpeed, skipNotes, onImport, online, cps, mix })); } catch { /* ignore */ }
};

// The mix between the video's sound and the readings, from −1 (only the video) to 1
// (only the readings). In the middle both are at full volume; moving one way turns the
// other down, since a browser voice can't be made louder than full.
export function mixLevels(mix) {
  const m = Math.max(-1, Math.min(1, Number(mix) || 0));
  return { reading: m < 0 ? 1 + m : 1, video: m > 0 ? 1 - m : 1 };
}
export function setMix(mix, keep = true) {
  tts.mix = Math.max(-1, Math.min(1, Number(mix) || 0));
  if (keep) save();
  if (readingEl) readingEl.volume = mixLevels(tts.mix).reading; // a reading under way follows
}

let hooks = { toast: () => {}, changed: () => {}, duck: () => {}, rate: () => 1 };
let voices = [];
const measured = new Map(); // voice|speed|text -> seconds of video time

function allowed() {
  const browser = pickVoices(tts.available ? speechSynthesis.getVoices() : [], { online: tts.online, lang: navigator.language || 'en' });
  return [...tts.piper, ...tts.google, ...browser];
}
// The chosen voice, or a Piper voice if there is one, since they sound best.
function currentVoice() {
  return voices.find((v) => v.voiceURI === tts.voice) || voices.find((v) => v.piper) ||
    voices.find((v) => v.default) || voices[0] || null;
}
// A voice that makes its readings as audio, with exact lengths: Piper or Google.
export const usingAudioVoice = () => makesAudio(currentVoice());
export const anyVoices = () => tts.available || tts.piper.length > 0 || tts.google.length > 0;
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

// ---- Voices that make audio: Piper and Google

// Readings already made, by voice, speed and text: a promise of { samples, rate, secs, buf }.
const audioCache = new Map();
const AUDIO_CACHE_MAX = 400;
let readingEl = null;
const readingAudio = () => (readingEl ||= new Audio());

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

// The Piper voices the web version offers, the user's language first:
// [{ id, name, lang, bytes }], or [] before the list has loaded.
export function webVoiceChoices() {
  if (!webPiper.offered) return [];
  return pickVoices(piperVoiceList(webPiper.offered), { lang: navigator.language || 'en' })
    .map((v) => ({ id: v.piper, name: v.name, lang: v.lang, bytes: webPiper.offered[v.piper] }));
}
export const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

export async function downloadVoice(voice) {
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

// ---- Google Cloud

// Asks Google for the voices the key can use, keeps the list, and offers them. With no
// key, they're dropped. Returns an error message, or ''.
export async function loadGoogle() {
  const key = googleKey();
  let error = '';
  if (!key) tts.google = [];
  else if (navigator.onLine !== false) {
    try {
      const r = await fetch(`${GOOGLE}/voices`, { ...GOOGLE_FETCH, headers: { 'x-goog-api-key': key } });
      if (!r.ok) throw new Error(await googleFailure(r));
      const list = ((await r.json()).voices || []).filter((v) => /-Standard-/.test(v.name || ''))
        .map(({ name, languageCodes, ssmlGender }) => ({ name, languageCodes, ssmlGender }));
      try { localStorage.setItem(GKEY, JSON.stringify({ key, voices: list })); } catch { /* ignore */ }
      tts.google = googleVoiceList({ voices: list }, langs());
    } catch (e) { error = e.message === 'Failed to fetch' ? 'Couldn’t reach Google' : e.message; }
  }
  voices = allowed();
  hooks.changed();
  if ($('ttsDlg').open) render(error);
  return error;
}

export function setGoogleKey(key) {
  try {
    if (key) localStorage.setItem(GKEY, JSON.stringify({ key }));
    else localStorage.removeItem(GKEY);
  } catch { /* ignore */ }
  if (!key && currentVoice()?.google) { stop(); tts.voice = ''; save(); }
  return loadGoogle();
}

// Google's readings are kept in the browser, by voice, speed and text, so a line that
// hasn't changed is never sent twice: not when Scribecue is next opened, nor to export.
// That saves characters, which Google charges for past its free allowance, and lets lines
// already read play offline. Their lengths are loaded as Scribecue opens, so they're exact
// straight away. At most SAVED_MAX bytes are kept, the readings used longest ago going first.
const SAVED_DB = 'scribecue-readings';
export const SAVED_MAX = 250e6;
let savedDb = null;
function openSaved() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return (savedDb ||= new Promise((ok) => {
    const q = indexedDB.open(SAVED_DB, 1);
    q.onupgradeneeded = () => { q.result.createObjectStore('audio'); q.result.createObjectStore('meta'); };
    q.onsuccess = () => ok(q.result);
    q.onerror = q.onblocked = () => ok(null);
  }));
}
// Runs fn(stores) in one transaction, and resolves with what it sets as the result.
async function saved(mode, fn) {
  const db = await openSaved();
  if (!db) return null;
  return new Promise((ok) => {
    let out = null;
    try {
      const t = db.transaction(['audio', 'meta'], mode);
      fn({ audio: t.objectStore('audio'), meta: t.objectStore('meta') }, (v) => { out = v; });
      t.oncomplete = () => ok(out);
      t.onerror = t.onabort = () => ok(null);
    } catch { ok(null); }
  });
}
const all = (store) => new Promise((ok) => { const r = store.getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });

async function savedReading(key) {
  return saved('readwrite', ({ audio, meta }, done) => {
    const a = audio.get(key);
    a.onsuccess = () => {
      if (!a.result) return;
      done(a.result);
      const m = meta.get(key);
      m.onsuccess = () => { if (m.result) meta.put({ ...m.result, at: Date.now() }, key); };
    };
  });
}
async function saveReading(key, buf, secs) {
  await saved('readwrite', ({ audio, meta }) => {
    audio.put(buf, key);
    meta.put({ key, secs, bytes: buf.byteLength, at: Date.now() }, key);
  });
  const entries = await saved('readonly', ({ meta }, done) => all(meta).then(done));
  const drop = overCap(entries || [], SAVED_MAX);
  if (drop.length) await saved('readwrite', ({ audio, meta }) => { for (const k of drop) { audio.delete(k); meta.delete(k); } });
}
// The lengths of every saved reading, so they're exact as Scribecue opens.
async function loadSavedLengths() {
  const entries = await saved('readonly', ({ meta }, done) => all(meta).then(done));
  for (const e of entries || []) if (!measured.has(e.key)) measured.set(e.key, e.secs);
  if (entries?.length) hooks.changed();
}
// How many readings are kept, and how big they are, for Settings.
export async function savedReadings() {
  const entries = await saved('readonly', ({ meta }, done) => all(meta).then(done));
  return { count: entries?.length || 0, bytes: (entries || []).reduce((n, e) => n + e.bytes, 0) };
}
export async function clearSavedReadings() {
  await saved('readwrite', ({ audio, meta }) => { audio.clear(); meta.clear(); });
  for (const k of [...audioCache.keys()]) if (k.startsWith('google:')) audioCache.delete(k);
}

// A saved reading if there is one; otherwise Google is asked, and its reading is kept.
async function googleOrSaved(key, words, voice, speed, urgent) {
  const kept = await savedReading(key);
  if (kept) return kept;
  const buf = await googleRead(words, voice, speed, urgent);
  try { saveReading(key, buf.slice(0), readWav(buf).secs); } catch { /* not kept */ }
  return buf;
}

// A few readings at a time, so a long job doesn't send Google hundreds at once.
const GOOGLE_AT_ONCE = 4;
let googleBusy = 0;
const googleWaiting = [];
async function googleRead(words, voice, speed, urgent) {
  if (googleBusy >= GOOGLE_AT_ONCE) await new Promise((go) => (urgent ? googleWaiting.unshift(go) : googleWaiting.push(go)));
  googleBusy++;
  try {
    const { url, init } = googleRequest(words, voice, speed, googleKey());
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(await googleFailure(r));
    const b64 = (await r.json()).audioContent || '';
    return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer;
  } finally {
    googleBusy--;
    googleWaiting.shift()?.();
  }
}

// how: 'now' for a reading someone is waiting to hear, 'bulk' for one of many in a long
// job, or 'background' to have it ready.
const pending = new Map(); // key -> the worker request, while it's queued or running
function readAudio(text, speed, voice = currentVoice(), how = 'background') {
  const words = spoken(text);
  const key = `${voice.voiceURI}|${speed}|${words}`;
  let p = audioCache.get(key);
  if (p && how === 'now') pending.get(key)?.hurry();
  if (!p) {
    let reading;
    if (voice.google) reading = googleOrSaved(key, words, voice, speed, how === 'now');
    else if (HOSTED) {
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
    p.catch(() => audioCache.delete(key));
    audioCache.set(key, p);
    if (audioCache.size > AUDIO_CACHE_MAX) audioCache.delete(audioCache.keys().next().value);
  }
  return p;
}

// Measure without playing: returns the length in video seconds, or null. With Piper or
// Google this only makes the reading; with a browser voice it reads silently in real time.
// bulk: one of many readings in a long job, which can run several at once.
export function measure(text, speed = tts.speed, { bulk = false } = {}) {
  if (!spoken(text)) return Promise.resolve(null);
  if (usingAudioVoice()) return readAudio(text, speed, currentVoice(), bulk ? 'bulk' : 'background').then((w) => { hooks.changed(); return w.secs; }, () => null);
  return new Promise((done) => speak(text, { silent: true, speed, done }));
}

// With Piper or Google, make the reading in the background so the length shown becomes exact.
export function prefetch(text, speed = tts.speed) {
  if (usingAudioVoice() && spoken(text) && !duration(text, speed).exact) readAudio(text, speed).then(() => hooks.changed(), () => {});
}

// The whole script as one audio file: each block's reading starts at the block's start.
// blocks [{ start, text, speed }], secs: total length. progress(done, total) as it goes.
// Returns { blob, overlaps }, where overlaps counts readings that run into the next one.
export async function renderTrack(blocks, secs, progress = () => {}) {
  const voice = currentVoice();
  if (!makesAudio(voice)) throw new Error('Exporting needs a Piper or Google voice');
  const items = [];
  let rate = 0;
  for (let k = 0; k < blocks.length; k++) {
    progress(k, blocks.length);
    const b = blocks[k];
    const w = await readAudio(b.text, b.speed ?? tts.speed, voice, 'bulk');
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
let current = null; // { u, done } for a browser voice, or { piper: token, done } for Piper or Google
// The first reading with a voice includes loading it, which would add a few tenths of a
// second to the measured length. A short silent reading first loads it.
const warmed = new Set();
export function stop() {
  const c = current;
  current = null;
  if (tts.available && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
  if (c?.piper) readingAudio().pause();
  if (c) { tts.speaking = null; if (!c.silent) hooks.duck(false); c.done(null); }
}

function speakAudio(text, voice, { id, manual, silent, speed, done }) {
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
  readAudio(text, speed, voice, 'now').then((w) => {
    if (current?.piper !== token) return;
    if (silent) return finish(w.secs);
    const a = readingAudio();
    if (a.src) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(new Blob([w.buf], { type: 'audio/wav' }));
    a.playbackRate = playRate; // in step with the video; the length on its clock stays w.secs
    a.preservesPitch = true;
    a.onended = () => finish(w.secs);
    a.onerror = () => finish(null);
    a.volume = mixLevels(tts.mix).reading;
    hooks.duck(true);
    a.play().catch(() => finish(null));
  }, (e) => {
    if (current?.piper !== token) return;
    hooks.toast(voice.google ? (navigator.onLine === false ? `You’re offline, so the Google voice can’t read. Choose a voice on this computer, or a Piper voice, in Settings` : e.message)
      : HOSTED ? 'The Piper voice couldn’t read that block. Try reloading the page'
      : 'Piper isn’t answering. Is its container running? See INSTALL.md');
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
  if (makesAudio(voice)) return speakAudio(text, voice, { id, manual, silent, speed, done });
  if (!tts.available) { done(null); return false; }
  if (!voice.localService && navigator.onLine === false) {
    if (manual) hooks.toast(`You’re offline, so the online voice ${voice.name} can’t read. Choose a voice on this computer, or a Piper voice, in Settings`);
    done(null);
    return false;
  }
  stop();
  const u = new SpeechSynthesisUtterance(words);
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  const playRate = hooks.rate();
  u.rate = Math.min(10, Math.max(0.1, speed * playRate));
  u.volume = silent ? 0 : mixLevels(tts.mix).reading;
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
    const online = label.startsWith('Online'), google = label.startsWith('Google');
    if (online && !tts.online) continue;
    const g = document.createElement('optgroup');
    const away = (online || google) && navigator.onLine === false; // they can't be reached
    g.label = away ? `${google ? 'Google Cloud' : 'Online'}: unavailable while you’re offline` : label;
    g.disabled = away;
    // Only when Piper is running, or there's a Google key.
    if ((label.startsWith('Piper') || google) && !list.length) continue;
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
  $('ttsNoOnline').hidden = !tts.online || voices.some((v) => !v.localService && !v.google);
  $('ttsNoVoices').textContent = tts.online
    ? 'This browser has no voices. Try Microsoft Edge or Google Chrome.'
    : 'No voices on this computer. Your system may need speech voices installed, or you can allow online voices below.';
}

// googleError: what went wrong the last time Google was asked for its voices.
function render(googleError = '') {
  $('ttsUnavailable').hidden = anyVoices();
  $('ttsOn').checked = tts.on;
  $('ttsOn').disabled = !anyVoices();
  const piper = usingAudioVoice();
  $('ttsPiperNote').textContent = currentVoice()?.google
    ? 'Google voice: lengths are exact as soon as a block has text, and you can export a description track. Each reading sends the block’s text to Google.'
    : tts.piper.length
    ? (piper ? 'Piper voice: lengths are exact as soon as a block has text, and you can export a description track.'
      : `${tts.piper.length} Piper voice${tts.piper.length > 1 ? 's' : ''} available at the top of the list: they sound more natural and give exact lengths.`)
    : ''; // the Did you know box below explains Piper
  const key = googleKey();
  if (document.activeElement !== $('ttsGoogleKey')) $('ttsGoogleKey').value = key;
  $('ttsGoogleForget').hidden = !key;
  $('ttsGoogleStatus').textContent = googleError || (!key ? ''
    : tts.google.length ? `${tts.google.length} Standard voice${tts.google.length > 1 ? 's' : ''}, in the voice list above.`
    : 'No Standard voices yet. Reopen these settings once you’re online.');
  $('ttsGoogleStatus').classList.toggle('err', !!googleError);
  // The tip is about adding Piper to the Docker setup, which the web version doesn't have.
  $('ttsTip').hidden = tts.piper.length > 0 || HOSTED;
  $('ttsAllExactRow').hidden = piper;
  $('ttsExport').disabled = !piper;
  $('ttsExportNote').textContent = piper ? '' : 'Needs a Piper or Google voice: the browser\'s own voices can\'t be recorded.';
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
  if (googleKey()) loadGoogle(); // in case the key's voices have changed
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
    if (!e.target.checked && currentVoice() && !currentVoice().localService && !currentVoice().google) { stop(); tts.voice = ''; }
    set('online', e.target.checked);
  });
  // Sounds like a real audio description, so voices can be judged on what they'll read.
  const SAMPLE = 'Rain streaks the windows of an empty diner. A woman in a soaked coat slides into a booth '
    + 'and pushes a folded note across the table. The man opposite reads it, then slowly looks up.';
  $('ttsTest').addEventListener('click', () => speak(SAMPLE));
  $('ttsTry').addEventListener('click', () => speak(hooks.sample?.() || SAMPLE));
  $('ttsWebVoice').addEventListener('change', renderWeb);
  $('ttsWebGet').addEventListener('click', () => {
    const v = $('ttsWebVoice').value;
    if (v) (webPiper.downloaded.includes(v) ? removeVoice : downloadVoice)(v);
  });
  $('ttsGoogleGet').href = GOOGLE_KEY_PAGE;
  $('ttsGoogleKey').addEventListener('change', async (e) => {
    $('ttsGoogleStatus').textContent = e.target.value.trim() ? 'Asking Google for its voices…' : '';
    const error = await setGoogleKey(e.target.value.trim());
    if (!error && tts.google.length && !currentVoice()?.google && !currentVoice()?.piper) {
      tts.voice = tts.google[0].voiceURI; save(); render(); hooks.changed();
    }
  });
  $('ttsGoogleForget').addEventListener('click', () => setGoogleKey(''));
  $('ttsClose').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => stop());
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
  voices = allowed();
  if (tts.available) {
    speechSynthesis.addEventListener('voiceschanged', () => { voices = allowed(); if (d.open) render(); hooks.changed(); });
  }
  loadPiper();
  loadSavedLengths();
}
