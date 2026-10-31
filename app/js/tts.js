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
import { TRACK_FORMATS, MIX_FORMATS } from './mp3.js';
import { layTrack } from './audio.js';

export { writeWav, resample, mixTrack, TRACK_PEAK_DB, TRACK_MAX_DB } from './audio.js';

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
// A block's own speed can also be a custom one, set by Fit speeds to timings.
export const MIN_SPEED = 0.5, MAX_SPEED = 2;
// Fitting a reading to its block never slows it below this, so a short line in a long block
// still sounds natural, with silence after it.
export const FIT_MIN = 0.85;
export const isBlockSpeed = (v) => typeof v === 'number' && v >= MIN_SPEED && v <= MAX_SPEED;
// Short form for markers: "+15%", "−30%", "normal".
export const speedLabel = (s) => (s === 1 ? 'normal' : `${s > 1 ? '+' : '−'}${Math.round(Math.abs(s - 1) * 100)}%`);
// Menu name: "fast (+15%)" for the set speeds, "custom (+12%)" for others.
export const speedName = (s) => SPEEDS.find(([v]) => v === s)?.[1] || `custom (${speedLabel(s)})`;

// The base speed, as in Frazier: every reading is made at it times its own speed, so
// a whole project can be made a little faster or slower and its speeds keep their names.
export const MIN_BASE = 0.5, MAX_BASE = 1.5;
export const toBase = (v) => (typeof v === 'number' && v >= MIN_BASE && v <= MAX_BASE ? Math.round(v * 100) / 100 : 1);
// The rate a reading is made at: a speed, times the base speed.
export const atBase = (speed, base) => (base === 1 ? speed : Math.round(speed * base * 1e4) / 1e4);
// Before there was a base speed, there was an overall speed for blocks without their own:
// it becomes the base speed, as near as it can be.
export const baseFromSpeed = (speed, base = 1) => toBase(Math.min(MAX_BASE, Math.max(MIN_BASE, base * speed)));

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

// The next speed to try when fitting a reading to secs, given the guess from
// speedFromReadings. Readings don't always change smoothly with speed (Kokoro's go in
// steps), so a guess is only tried when it's new and lies between the closest reading
// that fits and the closest that's too long. Otherwise it tries halfway between those
// two, in the speeds' 1% steps. Once a reading is within near of secs, or nothing is
// left between them, it settles on the best (see bestFit). near: how far over a
// reading can run and still fit.
const readAt = (points, s) => points.some((p) => Math.abs(p.speed - s) < 0.005);
export function nextFitSpeed(points, secs, guess, near = 0) {
  const best = bestFit(points, secs, near);
  if (best != null && points.some((p) => Math.abs(p.speed - best) < 0.005 && Math.abs(p.secs - secs) <= near)) return best;
  const fits = points.filter((p) => p.secs <= secs + near), long = points.filter((p) => p.secs > secs + near);
  const under = fits.length ? fits.reduce((a, p) => (p.secs > a.secs ? p : a)) : null;
  const over = long.length ? long.reduce((a, p) => (p.secs < a.secs ? p : a)) : null;
  // Faster than a reading that fits only gets shorter; slower than one that's too long, longer.
  const between = (s) => (!under || s < under.speed - 0.005) && (!over || s > over.speed + 0.005);
  if (guess != null && !readAt(points, guess) && between(guess)) return guess;
  if (under && over) {
    const mid = Math.round(((under.speed + over.speed) / 2) * 100) / 100;
    if (Math.abs(under.speed - over.speed) > 0.015 && !readAt(points, mid)) return mid;
  }
  return best;
}
// Of the speeds read, the one whose reading fills secs best without running over by more
// than near, or the one with the shortest reading if none fits. Always a speed that was
// read: one in 1% steps comes back without the rounding left by the base speed, but one
// that isn't stays as it is, as rounding it would give a speed with no reading, whose
// length is only an estimate.
export function bestFit(points, secs, near = 0) {
  if (!points.length) return null;
  const fits = points.filter((p) => p.secs <= secs + near);
  const p = fits.length ? fits.reduce((a, q) => (q.secs > a.secs ? q : a)) : points.reduce((a, q) => (q.secs < a.secs ? q : a));
  const step = Math.round(p.speed * 100) / 100;
  return Math.abs(step - p.speed) < 1e-6 ? step : p.speed;
}

// Piper's readings: about a quarter of a reading at normal speed (the pauses, and the
// ends of sounds) stays the same at any speed. Learned per voice from lines read at two
// speeds, so the first guess at a speed that fills a block is close.
const SHARE = 0.23;
const shares = new Map(); // voice -> [sum, count]
export function fixedShare(uri) {
  if (!usingAudioVoice(uri)) return 0;
  const s = shares.get(voiceKey(uri));
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

// Splits voices for the menu: Piper, Kokoro, Google, the browser's voices on this
// computer, then online ones.
export function groupVoices(voices) {
  return [
    ['Piper: natural voices on this computer', voices.filter((v) => v.piper)],
    ['Kokoro: natural voices on this computer', voices.filter((v) => v.kokoro)],
    ['Google Cloud: the text is sent to Google', voices.filter((v) => v.google)],
    ['On this computer', voices.filter((v) => v.localService && !v.piper && !v.kokoro)],
    ['Online: the text is sent to the provider', voices.filter((v) => !v.localService && !v.google)],
  ];
}

// Favourite voices, pinned to the top of the voice list for switching between quickly:
// voiceURIs, in the order they were added. Pinning one that's there takes it out.
export const toggleFavourite = (favs, uri) => (favs.includes(uri) ? favs.filter((f) => f !== uri) : [...favs, uri]);
// The favourites, each with its voice, or null while it isn't available (Piper not
// running, no Google key, online voices off, or not in this browser).
export const favouriteVoices = (favs, voices) => favs.map((uri) => ({ uri, voice: voices.find((v) => v.voiceURI === uri) || null }));

// Voices that make their readings as audio, Piper's, Kokoro's and Google's: lengths are
// exact, and a description track can be exported.
export const makesAudio = (v) => !!(v?.piper || v?.kokoro || v?.google);

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

// Which saved readings to remove so the rest fit in `cap` bytes: Piper's and Kokoro's go
// before Google's, since they cost nothing to make again, and then the ones used longest
// ago. entries [{ key, bytes, at }], each key starting with its voice.
export function overCap(entries, cap) {
  let total = entries.reduce((n, e) => n + e.bytes, 0);
  const out = [];
  const paid = (e) => (String(e.key).startsWith('google:') ? 1 : 0);
  for (const e of [...entries].sort((a, b) => paid(a) - paid(b) || a.at - b.at)) {
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

// Kokoro's voice list, as Scribecue's voice objects: "af_heart" becomes "Heart (en-US)".
// Its first letter is the language and its second the gender.
const KOKORO_LANGS = { a: 'en-US', b: 'en-GB', e: 'es', f: 'fr-FR', h: 'hi', i: 'it', p: 'pt-BR' };
export function kokoroVoiceList(json) {
  return (json?.voices || []).map((v) => (typeof v === 'string' ? { id: v } : v))
    .filter((v) => /^[a-z][fm]_\w+$/.test(v.id || ''))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, lang }) => {
      const name = id.slice(3).replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      return { voiceURI: 'kokoro:' + id, kokoro: id, name, lang: lang || KOKORO_LANGS[id[0]] || '', localService: true };
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
// The rest of a reading started partway through, for a voice that can only read from the
// start of its text: from the word a fraction frac of the way in.
export function wordsFrom(text, frac) {
  const words = spoken(text).split(' ');
  return words.slice(Math.min(words.length - 1, Math.floor(Math.max(0, frac) * words.length))).join(' ');
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
// While a block is read, the programme goes down by the dip set (dB): one of DIPS, or a
// whole number of dB up to MAX_DIP typed in; or by the block's own. It takes one of FADES
// (seconds), and comes back up the same way after. Playback and the full mix share these.
export const DIPS = [6, 10, 15, 20], MAX_DIP = 40, FADES = [0.1, 0.25, 0.5];
// How far down the programme is, in dB, dt seconds on, moving towards target (the dip
// while a reading plays, 0 after). Going all the way down, or back up, takes the fade;
// from one block's dip to another's, the part of it the difference is. from: where it
// was when the target last changed, which sets the pace.
export function stepDip(db, target, dt, fade, from = db) {
  if (!(fade > 0)) return target;
  const step = Math.max(from, target) * dt / fade;
  return target > db ? Math.min(target, db + step) : Math.max(target, db - step);
}
export const dipLevel = (db) => 10 ** (-db / 20);
// A block's own dip: none (0), or a whole number of dB up to MAX_DIP.
export const isDip = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_DIP;
// A dip typed in: a whole number of dB from min to MAX_DIP, or null if it isn't one.
export function typedDip(text, min = 1) {
  const s = String(text ?? '').trim(), v = Math.round(Number(s));
  return s !== '' && Number.isFinite(v) && v >= min && v <= MAX_DIP ? v : null;
}
// Loudness targets for the full mix: LUFS, and the highest peak in dBFS.
export const LOUDNESS = {
  '': { ceiling: -1 }, // as it comes
  ebu: { lufs: -23, ceiling: -1 }, // EBU R 128, for broadcast in Europe
  atsc: { lufs: -24, ceiling: -2 }, // ATSC A/85, for broadcast in North America
  online: { lufs: -16, ceiling: -1 }, // podcasts and the web
  streaming: { lufs: -14, ceiling: -1 }, // streaming services
};
const DEFAULTS = { on: false, voice: '', base: 1, live: true, duck: true, skipNotes: false, onImport: 'ask', onChange: 'ask', online: false, cps: {}, mix: 0, favourites: [], sample: null, trackAs: 'wav', mixAs: 'wav', dipDb: 10, dipFade: 0.25, loudness: '', stems: false, mixInto: '' };
const $ = (id) => document.getElementById(id);

export const tts = {
  ...DEFAULTS,
  available: typeof speechSynthesis !== 'undefined', // the browser's own voices
  piper: [], // Piper voices, once the container has answered
  kokoro: [], // Kokoro voices, the same
  google: [], // Google Cloud voices, while there's a key
  ffmpeg: '', // ffmpeg's version, while its container is running (Docker only)
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
tts.favourites = Array.isArray(tts.favourites) ? tts.favourites.filter((f) => typeof f === 'string') : [];
tts.base = toBase(tts.base);
if (isSpeed(tts.speed) && tts.speed !== 1) tts.base = baseFromSpeed(tts.speed, tts.base);
delete tts.speed;
if (!['ask', 'ends', 'leave'].includes(tts.onChange)) tts.onChange = 'ask';
if (!isDip(tts.dipDb) || tts.dipDb < 1) tts.dipDb = DEFAULTS.dipDb;
if (!FADES.includes(tts.dipFade)) tts.dipFade = DEFAULTS.dipFade;
if (!(tts.loudness in LOUDNESS)) tts.loudness = '';
if (!['', 'add', 'replace'].includes(tts.mixInto)) tts.mixInto = '';
const rate = (speed) => atBase(speed, tts.base);

const save = () => {
  const { on, voice, base, live, duck, skipNotes, onImport, onChange, online, cps, mix, favourites, sample, trackAs, mixAs, dipDb, dipFade, loudness, stems, mixInto } = tts;
  try { localStorage.setItem(KEY, JSON.stringify({ on, voice, base, live, duck, skipNotes, onImport, onChange, online, cps, mix, favourites, sample, trackAs, mixAs, dipDb, dipFade, loudness, stems, mixInto })); } catch { /* ignore */ }
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

let hooks = { toast: () => {}, changed: () => {}, duck: () => {}, rate: () => 1, readingChanged: () => {}, blockVoices: () => [] };
let voices = [];
const measured = new Map(); // voice|speed|text -> seconds of video time

function allowed() {
  const browser = pickVoices(tts.available ? speechSynthesis.getVoices() : [], { online: tts.online, lang: navigator.language || 'en' });
  return [...tts.piper, ...tts.kokoro, ...tts.google, ...browser];
}
// The chosen voice, or a Piper or Kokoro voice if there is one, since they sound best.
function currentVoice() {
  return voices.find((v) => v.voiceURI === tts.voice) || voices.find((v) => v.piper || v.kokoro) ||
    voices.find((v) => v.default) || voices[0] || null;
}
// A block's own voice (uri), when it has one and it's here; otherwise the chosen voice.
function voiceOf(uri) {
  return (uri && voices.find((v) => v.voiceURI === uri)) || currentVoice();
}
// A voice that makes its readings as audio, with exact lengths: Piper, Kokoro or Google.
// uri: a block's own voice, if it has one, as with the functions below.
export const usingAudioVoice = (uri) => makesAudio(voiceOf(uri));

// A voice's name from its id alone, for a voice that isn't available to ask: Google's
// "google:en-US-Standard-C" is "Google Standard C (en-US)", Piper's "piper:en_US-lessac-medium"
// is "Lessac (en-US)", Kokoro's "kokoro:bf_emma" is "Kokoro Emma (en-GB)", and a browser
// voice's id ends in its name.
export function voiceLabel(uri) {
  const s = String(uri || '');
  const g = s.match(/^google:([a-z]{2,3}-[A-Z]{2})-Standard-(\w+)$/);
  if (g) return `Google Standard ${g[2]} (${g[1]})`;
  if (s.startsWith('piper:')) {
    const v = piperVoiceList({ [s.slice(6)]: 1 })[0];
    return v.lang ? `${v.name} (${v.lang})` : v.name;
  }
  if (s.startsWith('kokoro:')) {
    const v = kokoroVoiceList({ voices: [s.slice(7)] })[0];
    return v ? `Kokoro ${v.name}${v.lang ? ` (${v.lang})` : ''}` : `Kokoro ${s.slice(7)}`;
  }
  const last = s.split('.').pop() || s;
  return last.charAt(0).toUpperCase() + last.slice(1);
}
// Why a voice isn't available, and what to do: by kind, with or without a Google key.
export function missingVoiceAdvice(uri, { googleKey = false, hosted = false } = {}) {
  if (String(uri).startsWith('google:')) {
    return googleKey ? 'Your Google Cloud key doesn’t offer it here.' : 'Add your Google Cloud key in Settings, under Text to speech, to use it.';
  }
  if (String(uri).startsWith('piper:')) {
    return hosted ? 'Download it in Settings, under Text to speech.' : 'Piper isn’t running, or doesn’t have this voice. See INSTALL.md.';
  }
  if (String(uri).startsWith('kokoro:')) {
    return hosted ? 'Kokoro voices need Scribecue’s Docker version.' : 'Kokoro isn’t running, or doesn’t have this voice. See INSTALL.md.';
  }
  return 'It isn’t on this computer, or in this browser.';
}

// The chosen voice, when it isn't available here, such as a project's Google voice in a
// browser without the key. Readings carry on with another voice meanwhile, so say so,
// once for each voice, as soon as the voices are known. Kept in the settings and projects,
// so it's used again once it's back.
let piperKnown = false, missingSaid = '';
function missingVoice() {
  const uri = tts.voice;
  if (!uri || !piperKnown || voices.some((v) => v.voiceURI === uri)) return '';
  // Browser voices can arrive late, so wait for some before saying one's missing.
  if (!/^(google|piper|kokoro):/.test(uri) && tts.available && !speechSynthesis.getVoices().length) return '';
  return uri;
}
export function missingVoiceNote() {
  const uri = missingVoice();
  if (!uri) return '';
  const instead = currentVoice();
  return `This project’s voice, ${voiceLabel(uri)}, isn’t available here. ${missingVoiceAdvice(uri, { googleKey: !!googleKey(), hosted: HOSTED })} ` +
    (instead ? `Until then, blocks are read with ${instead.name}.` : 'Until then, there’s no voice to read with.');
}
function checkVoice() {
  const uri = missingVoice();
  if (!uri) { missingSaid = ''; return; }
  if (!tts.on || missingSaid === uri) return;
  missingSaid = uri;
  // Short enough for the bottom bar: Settings has the whole story.
  hooks.toast(`${voiceLabel(uri)} isn’t available here${currentVoice() ? `, so ${currentVoice().name} is reading` : ''}. See Settings, under Text to speech`);
}
// A Google voice: every new reading is sent to Google, and counts against the user's allowance.
export const usingGoogle = (uri) => !!voiceOf(uri)?.google;
// Shows the warnings that a job reading every block may cost money, with a Google voice.
export function showGoogleCost() {
  const google = usingGoogle() || hooks.blockVoices().some((uri) => usingGoogle(uri));
  for (const el of document.querySelectorAll('.googlecost')) el.hidden = !google;
}
export const anyVoices = () => tts.available || tts.piper.length > 0 || tts.kokoro.length > 0 || tts.google.length > 0;
const voiceKey = (uri) => voiceOf(uri)?.voiceURI || '';
const measureKey = (text, speed, uri) => `${voiceKey(uri)}|${rate(speed)}|${spoken(text)}`;

// Every reading of this text with the voice so far, as [{ speed, secs }], with speeds
// before the base speed, unless asMade.
export function readingsOf(text, asMade = false, uri) {
  const head = `${voiceKey(uri)}|`, tail = `|${spoken(text)}`, out = [];
  for (const [k, secs] of measured) {
    if (k.startsWith(head) && k.endsWith(tail)) {
      const speed = +k.slice(head.length, k.length - tail.length);
      if (speed > 0) out.push({ speed: asMade ? speed : speed / tts.base, secs });
    }
  }
  return out;
}

// How long the text takes to say with the voice, in video seconds, at a block's own speed
// or normal speed. Uses the last real reading of this exact text, or an estimate.
export function duration(text, speed = 1, uri) {
  const m = measured.get(measureKey(text, speed, uri));
  if (m != null) return { secs: m, exact: true };
  return { secs: estimate(text, tts.cps[voiceKey(uri)] || DEFAULT_CPS, rate(speed)), exact: false };
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
let dipCustom = false; // Custom chosen for the dip in the settings, to type one in
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
    piperKnown = true;
    hooks.changed();
    if ($('ttsDlg').open) render();
    warmUp();
    checkVoice();
    return tts.piper.length;
  }
  // Each from its own container, if it's running. Voices in the user's language first,
  // so the default suits them.
  const voicesFrom = (url, list) => fetch(url, { cache: 'no-store' })
    .then(async (r) => (r.ok ? pickVoices(list(await r.json()), { lang: navigator.language || 'en' }) : []))
    .catch(() => []);
  [tts.piper, tts.kokoro] = await Promise.all([voicesFrom('tts/voices', piperVoiceList), voicesFrom('tts/kokoro/voices', kokoroVoiceList)]);
  voices = allowed();
  piperKnown = true;
  hooks.changed();
  if ($('ttsDlg').open) render();
  checkVoice();
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
  checkVoice();
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

// Readings by Piper, Kokoro and Google are kept in the browser, by voice, speed and text,
// so a line that hasn't changed is never made twice: not when Scribecue is next opened, nor
// to export. With Google, that saves characters, which it charges for past its free
// allowance. Lines already read play straight away, and offline. Their lengths are loaded
// as Scribecue opens, so they're exact straight away. At most SAVED_MAX bytes are kept
// (see overCap).
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
  audioCache.clear();
}

// A saved reading if there is one; otherwise make() makes it, and it's kept.
async function keptOr(key, make) {
  const kept = await savedReading(key);
  if (kept) return kept;
  const buf = await make();
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
function readAudio(text, blockSpeed, voice = currentVoice(), how = 'background') {
  const words = spoken(text), speed = rate(blockSpeed);
  const key = `${voice.voiceURI}|${speed}|${words}`;
  let p = audioCache.get(key);
  if (p && how === 'now') pending.get(key)?.hurry();
  if (!p) {
    let make;
    if (voice.google) make = () => googleRead(words, voice, speed, how === 'now');
    else if (voice.kokoro) make = () => fetch('tts/kokoro/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: words, voice: voice.kokoro, speed }),
    }).then((r) => {
      if (!r.ok) throw new Error(`Kokoro answered ${r.status}`);
      return r.arrayBuffer();
    });
    else if (HOSTED) make = () => {
      const job = ask('synthesize', { voice: voice.piper, text: words, speed, urgent: how === 'now' }, how === 'bulk');
      pending.set(key, job);
      job.finally(() => pending.delete(key)).catch(() => {});
      return job;
    };
    else make = () => fetch('tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // noise_w_scale 0 turns off Piper's random variation in timing, so the same line
      // always takes the same time: lengths stay exact across sessions and in the export.
      body: JSON.stringify({ text: words, voice: voice.piper, length_scale: 1 / speed, noise_w_scale: 0 }),
    }).then((r) => {
      if (!r.ok) throw new Error(`Piper answered ${r.status}`);
      return r.arrayBuffer();
    });
    p = keptOr(key, make).then((buf) => {
      const wav = readWav(buf);
      measured.set(key, wav.secs);
      learnShare(voice.voiceURI, readingsOf(text, true, voice.voiceURI));
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
export function measure(text, speed = 1, { bulk = false, voice } = {}) {
  if (!spoken(text)) return Promise.resolve(null);
  if (usingAudioVoice(voice)) return readAudio(text, speed, voiceOf(voice), bulk ? 'bulk' : 'background').then((w) => { hooks.changed(); return w.secs; }, () => null);
  return new Promise((done) => speak(text, { silent: true, speed, voice, done }));
}

// With Piper or Google, make the reading in the background so the length shown becomes exact.
export function prefetch(text, speed = 1, uri) {
  if (usingAudioVoice(uri) && spoken(text) && !duration(text, speed, uri).exact) readAudio(text, speed, voiceOf(uri)).then(() => hooks.changed(), () => {});
}

// Has a reading in memory, ready to play straight away: made, or loaded from the browser's
// store. For the blocks just ahead of the playhead, so their readings don't start late.
export function readAhead(text, speed = 1, uri) {
  if (!usingAudioVoice(uri) || !spoken(text)) return;
  const exact = duration(text, speed, uri).exact;
  readAudio(text, speed, voiceOf(uri)).then(() => { if (!exact) hooks.changed(); }, () => {});
}

// The whole script as one audio file: each block's reading starts at the block's start.
// blocks [{ start, text, speed, voice }], secs: total length. progress(done, total) as it
// goes. Returns { samples, rate, overlaps }: mono 16-bit samples, and how many readings run
// into the next one.
export async function renderTrack(blocks, secs, progress = () => {}) {
  const made = await makeReadings(blocks, progress);
  // Laid out in a worker, as a long film makes a big track.
  const readings = made.map(({ start, w }) => ({ start, samples: w.samples, rate: w.rate, secs: w.secs }));
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./track-worker.js', import.meta.url), { type: 'module' }); } catch { return resolve(layTrack(readings, secs)); }
    w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); reject(new Error(e.message || 'the track couldn’t be laid out')); };
    w.postMessage({ readings, secs });
  });
}

// Every block's reading: [{ start, w }], w as readAudio gives it ({ samples, rate, secs }).
export async function makeReadings(blocks, progress = () => {}) {
  const missing = blocks.find((b) => !usingAudioVoice(b.voice));
  if (missing) throw new Error(`Exporting needs a Piper, Kokoro or Google voice for every block, and ${voiceOf(missing.voice)?.name || 'a block’s voice'} isn’t one`);
  const made = [];
  for (let k = 0; k < blocks.length; k++) {
    progress(k, blocks.length);
    const b = blocks[k];
    made.push({ start: b.start, w: await readAudio(b.text, b.speed ?? 1, voiceOf(b.voice), 'bulk') });
  }
  progress(blocks.length, blocks.length);
  hooks.changed();
  return made;
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

// A reading that's been asked for but isn't playing yet: being made, or the browser still
// starting it. Playing without a video, the clock waits for it (see app.js).
export function readingStarting() {
  if (!current?.piper || current.silent) return false;
  const a = readingEl;
  return current.at == null || !a || a.paused || a.currentTime <= current.at + 0.005;
}

function speakAudio(text, voice, { id, manual, silent, speed, from, done }) {
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
    // Partway in, worked out now the reading is ready, as making it can take a moment.
    const at = from?.() || 0;
    if (at >= w.secs - 0.05) return finish(null);
    a.currentTime = at;
    current.at = at;
    a.volume = mixLevels(tts.mix).reading;
    hooks.duck(true);
    a.play().catch(() => finish(null));
  }, (e) => {
    if (current?.piper !== token) return;
    hooks.toast(voice.google ? (navigator.onLine === false ? `You’re offline, so the Google voice can’t read. Choose a voice on this computer, or a Piper voice, in Settings` : e.message)
      : voice.kokoro ? 'Kokoro isn’t answering. Is its container running? See INSTALL.md'
      : HOSTED ? 'The Piper voice couldn’t read that block. Try reloading the page'
      : 'Piper isn’t answering. Is its container running? See INSTALL.md');
    finish(null);
  });
  return true;
}

// Read text aloud. done(secs) runs with the spoken length in video seconds when it
// finishes on its own, or with null if it was stopped or failed.
// silent: read at zero volume, just to measure it.
// from: for a reading picked up partway through, how far into it to start, in seconds.
export function speak(text, { id = null, manual = false, silent = false, speed = 1, voice: uri, from = null, done = () => {} } = {}) {
  const voice = voiceOf(uri);
  let words = spoken(text);
  if (!words || !voice) { stop(); done(null); return false; }
  if (makesAudio(voice)) return speakAudio(text, voice, { id, manual, silent, speed, from, done });
  // A voice in the browser can't start partway through, so it starts at the word it would
  // have reached.
  if (from) words = wordsFrom(words, from() / duration(text, speed, uri).secs);
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
  u.rate = Math.min(10, Math.max(0.1, rate(speed) * playRate));
  u.volume = silent ? 0 : mixLevels(tts.mix).reading;
  const key = measureKey(text, speed, voice.voiceURI);
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
      tts.cps[voice.voiceURI] = words.length / (secs * rate(speed));
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
  // Favourites first, so they're at hand at the top of a long list. They're also in their
  // own group below.
  const favs = favouriteVoices(tts.favourites, voices).filter((f) => f.voice);
  if (favs.length) {
    const g = document.createElement('optgroup');
    g.label = 'Favourites';
    for (const { voice: v } of favs) {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = `★ ${v.name} (${v.lang})`;
      g.append(o);
    }
    sel.append(g);
  }
  for (const [label, list] of groupVoices(voices)) {
    const online = label.startsWith('Online'), google = label.startsWith('Google');
    if (online && !tts.online) continue;
    const g = document.createElement('optgroup');
    const away = (online || google) && navigator.onLine === false; // they can't be reached
    g.label = away ? `${google ? 'Google Cloud' : 'Online'}: unavailable while you’re offline` : label;
    g.disabled = away;
    // Only when Piper or Kokoro is running, or there's a Google key.
    if ((label.startsWith('Piper') || label.startsWith('Kokoro') || google) && !list.length) continue;
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
export const chosenVoiceName = () => currentVoice()?.name || 'none';
export const voiceName = (uri) => voices.find((v) => v.voiceURI === uri)?.name || 'the voice before';

// Sounds like a real audio description, so voices can be judged on what they'll read.
const SAMPLE = 'Rain streaks the windows of an empty diner. A woman in a soaked coat slides into a booth '
  + 'and pushes a folded note across the table. The man opposite reads it, then slowly looks up.';

const testLine = () => (typeof tts.sample === 'string' ? tts.sample : SAMPLE);

// A voice picked in Settings but not applied yet: Test reads with it, so voices can be
// tried without the blocks' timings changing, until Apply.
let picked = null;
const shownVoice = () => picked ?? currentVoice()?.voiceURI ?? '';
function pickVoice(uri) {
  picked = uri && uri !== currentVoice()?.voiceURI ? uri : null;
  $('ttsVoice').value = shownVoice();
  stop();
  renderFavourites();
  renderApply();
}
function renderApply() {
  if (picked === currentVoice()?.voiceURI) picked = null;
  const v = picked && voices.find((x) => x.voiceURI === picked);
  $('ttsApply').hidden = !v;
  if (v) $('ttsApply').dataset.tip = `Read every block with ${v.name}. Until then, Test tries it without changing anything`;
}

// The favourites row: a button for each favourite, to pick it in one click, and the
// star beside the voice list, to pin or unpin the voice shown.
function renderFavourites() {
  const cur = shownVoice();
  const pinned = !!cur && tts.favourites.includes(cur);
  const star = $('ttsFav');
  star.textContent = pinned ? '★' : '☆';
  star.setAttribute('aria-pressed', String(pinned));
  star.setAttribute('aria-label', 'Favourite voice');
  star.dataset.tip = pinned ? 'Take this voice out of your favourites' : 'Add this voice to your favourites, to switch to it in one click';
  star.disabled = !cur;
  const row = $('ttsFavs');
  const favs = favouriteVoices(tts.favourites, voices);
  $('ttsFavsNone').hidden = favs.length > 0;
  row.replaceChildren(...favs.map(({ uri, voice: v }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fav';
    if (v) {
      // With its language, since voices in different languages can share a name.
      b.textContent = `${v.name} (${v.lang})`;
      b.setAttribute('aria-pressed', String(uri === cur));
      b.dataset.tip = 'Pick this voice, to try it and apply it';
      b.addEventListener('click', () => pickVoice(uri));
      return b;
    }
    // Not available now: it stays, for when it is again, and can be taken out.
    b.textContent = `${uri.replace(/^(piper|kokoro|google):/, '')} ×`;
    b.classList.add('gone');
    b.dataset.tip = 'Not available right now. Click to take it out of your favourites';
    b.addEventListener('click', () => setTtsOption('favourites', toggleFavourite(tts.favourites, uri)));
    return b;
  }));
}

function fillVoices() {
  fillVoiceSelect($('ttsVoice'), shownVoice());
  renderFavourites();
  renderApply();
  $('ttsNoVoices').hidden = !!voices.length || !anyVoices();
  $('ttsMissing').textContent = missingVoiceNote();
  $('ttsMissing').hidden = !$('ttsMissing').textContent;
  $('ttsNoOnline').hidden = !tts.online || voices.some((v) => !v.localService && !v.google);
  $('ttsNoVoices').textContent = tts.online
    ? 'This browser has no voices. Try Microsoft Edge or Google Chrome.'
    : 'No voices on this computer. Your system may need speech voices installed, or you can allow online voices below.';
}

// "3 Piper voices and 41 Kokoro voices", for the ones running.
function naturalCount() {
  const n = (k, name) => (k ? `${k} ${name} voice${k > 1 ? 's' : ''}` : '');
  return [n(tts.piper.length, 'Piper'), n(tts.kokoro.length, 'Kokoro')].filter(Boolean).join(' and ');
}

// googleError: what went wrong the last time Google was asked for its voices.
function render(googleError = '') {
  $('ttsUnavailable').hidden = anyVoices();
  $('ttsOn').checked = tts.on;
  $('ttsOn').disabled = !anyVoices();
  const piper = usingAudioVoice();
  $('ttsPiperNote').textContent = currentVoice()?.google
    ? 'Google voice: lengths are exact as soon as a block has text, and you can export a description track. Each reading sends the block’s text to Google.'
    : currentVoice()?.kokoro
    ? 'Kokoro voice: lengths are exact as soon as a block has text, and you can export a description track.'
    : tts.piper.length || tts.kokoro.length
    ? (piper ? 'Piper voice: lengths are exact as soon as a block has text, and you can export a description track.'
      : `${naturalCount()} available at the top of the list: they sound more natural and give exact lengths.`)
    : ''; // the Did you know box below explains Piper
  const key = googleKey();
  if (document.activeElement !== $('ttsGoogleKey')) $('ttsGoogleKey').value = key;
  $('ttsGoogleForget').hidden = !key;
  $('ttsGoogleStatus').textContent = googleError || (!key ? ''
    : tts.google.length ? `${tts.google.length} Standard voice${tts.google.length > 1 ? 's' : ''}, in the voice list above.`
    : 'No Standard voices yet. Reopen these settings once you’re online.');
  $('ttsGoogleStatus').classList.toggle('err', !!googleError);
  // The tip is about adding Piper to the Docker setup, which the web version doesn't have.
  $('ttsTip').hidden = tts.piper.length > 0 || tts.kokoro.length > 0 || HOSTED;
  $('ttsAllExactRow').hidden = piper;
  showGoogleCost();
  $('ttsExport').disabled = !piper;
  $('ttsMakeAll').disabled = !piper;
  // Blocks with their own voice, such as translated dialogue read by a second voice.
  const own = hooks.blockVoices();
  $('ttsBlockVoices').hidden = !own.length;
  const names = [...new Set(own)].map((uri) => voices.find((v) => v.voiceURI === uri)?.name || voiceLabel(uri));
  $('ttsBlockVoicesText').textContent = `${own.length === 1 ? '1 block has' : `${own.length} blocks have`} a voice of ${own.length === 1 ? 'its' : 'their'} own: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.`;
  $('ttsMakeNote').textContent = piper ? '' : 'Needs a Piper, Kokoro or Google voice: the browser\'s own voices can\'t be kept.';
  $('ttsExportNote').textContent = piper ? '' : 'Needs a Piper, Kokoro or Google voice: the browser\'s own voices can\'t be recorded.';
  $('ttsBody').classList.toggle('off', !tts.on);
  $('ttsBase').value = String(Math.round(tts.base * 100));
  $('ttsBaseOut').textContent = `${Math.round(tts.base * 100)}%`;
  $('ttsLive').checked = tts.live;
  $('ttsDuck').checked = tts.duck;
  $('ttsNotes').checked = tts.skipNotes;
  $('ttsImport').value = tts.onImport;
  $('ttsOnChange').value = tts.onChange;
  $('ttsTrackAs').value = TRACK_FORMATS[tts.trackAs] ? tts.trackAs : 'wav';
  renderFfmpeg();
  // A dip that isn't one of the choices is typed in, under Custom.
  if (!DIPS.includes(tts.dipDb)) dipCustom = true;
  $('ttsDipDb').value = dipCustom ? 'custom' : String(tts.dipDb);
  $('ttsDipCustomWrap').hidden = !dipCustom;
  if (document.activeElement !== $('ttsDipCustom')) $('ttsDipCustom').value = tts.dipDb;
  $('ttsDipFade').value = String(tts.dipFade);
  $('ttsLoudness').value = tts.loudness;
  $('ttsStems').checked = !!tts.stems;
  $('ttsDipDb').disabled = $('ttsDipFade').disabled = $('ttsDipCustom').disabled = !tts.duck;
  $('ttsMixExport').disabled = !piper;
  $('ttsMixNote').textContent = piper ? '' : 'Needs a Piper, Kokoro or Google voice: the browser\'s own voices can\'t be recorded.';
  $('ttsOnline').checked = tts.online;
  if (document.activeElement !== $('ttsSample')) $('ttsSample').value = testLine();
  $('ttsTest').disabled = !testLine().trim();
  fillVoices();
  renderWeb();
}

// Change a setting from outside the panel, such as the welcome wizard.
// The voice or base speed, changed by hand in Settings: every reading's length
// changes, so the blocks' ends may need to follow (see When the voice or base speed changes).
function changeReading(k, v) {
  const was = currentVoice()?.voiceURI, before = tts[k];
  setTtsOption(k, v);
  // What it was before, to go back to: for the voice, the one that was reading.
  if (k === 'voice' ? currentVoice()?.voiceURI !== was : tts[k] !== before) hooks.readingChanged(k, k === 'voice' ? was : before);
}

export function setTtsOption(k, v) {
  if (k === 'voice') picked = null;
  tts[k] = v;
  save();
  warmUp();
  if ($('ttsDlg').open) render();
  hooks.changed();
  if (k === 'voice' || k === 'on') checkVoice();
}

// ffmpeg's formats and putting the mix in the video, while its container is running.
function renderFfmpeg() {
  for (const el of document.querySelectorAll('.ffonly')) el.hidden = el.disabled = !tts.ffmpeg;
  $('ttsMixAs').value = MIX_FORMATS[tts.mixAs] && (tts.ffmpeg || !MIX_FORMATS[tts.mixAs].ffmpeg) ? tts.mixAs : 'wav';
  $('ttsMixInto').value = tts.ffmpeg ? tts.mixInto : '';
}

// Whether ffmpeg is running in Docker, for the full mix. Not in the web version.
export async function checkFfmpeg() {
  if (HOSTED) return '';
  try {
    const r = await fetch('ffmpeg/status', { cache: 'no-store' });
    tts.ffmpeg = r.ok ? (await r.json()).ffmpeg || '' : '';
  } catch { tts.ffmpeg = ''; }
  renderFfmpeg();
  return tts.ffmpeg;
}

export function openTts() {
  render();
  loadPiper(); // in case Piper was started since
  checkFfmpeg();
  if (googleKey()) loadGoogle(); // in case the key's voices have changed
  const d = $('ttsDlg');
  if (!d.open) d.showModal();
}

export function initTts(h) {
  hooks = { ...hooks, ...h };
  const d = $('ttsDlg');
  const set = (k, v) => { tts[k] = v; save(); render(); hooks.changed(); warmUp(); };
  $('ttsOn').addEventListener('change', (e) => { if (!e.target.checked) stop(); set('on', e.target.checked); });
  $('ttsVoice').addEventListener('change', (e) => pickVoice(e.target.value));
  $('ttsApply').addEventListener('click', () => { if (picked) changeReading('voice', picked); });
  $('ttsFav').addEventListener('click', () => {
    const cur = shownVoice();
    if (cur) set('favourites', toggleFavourite(tts.favourites, cur));
  });
  // The number follows the slider as it moves, and the speed changes when it's let go.
  const base = $('ttsBase');
  base.addEventListener('input', () => { $('ttsBaseOut').textContent = `${base.value}%`; });
  base.addEventListener('change', () => changeReading('base', toBase(+base.value / 100)));
  base.addEventListener('dblclick', () => changeReading('base', 1));
  $('ttsLive').addEventListener('change', (e) => set('live', e.target.checked));
  $('ttsDuck').addEventListener('change', (e) => set('duck', e.target.checked));
  $('ttsNotes').addEventListener('change', (e) => set('skipNotes', e.target.checked));
  $('ttsImport').addEventListener('change', (e) => set('onImport', e.target.value));
  $('ttsOnChange').addEventListener('change', (e) => set('onChange', e.target.value));
  $('ttsTrackAs').addEventListener('change', (e) => set('trackAs', e.target.value));
  $('ttsMixAs').addEventListener('change', (e) => set('mixAs', e.target.value));
  $('ttsMixInto').addEventListener('change', (e) => set('mixInto', e.target.value));
  $('ttsDipDb').addEventListener('change', (e) => {
    dipCustom = e.target.value === 'custom';
    if (!dipCustom) return set('dipDb', +e.target.value);
    render();
    $('ttsDipCustom').focus();
    $('ttsDipCustom').select();
  });
  $('ttsDipCustom').addEventListener('change', (e) => {
    const v = typedDip(e.target.value);
    if (v == null) e.target.value = tts.dipDb; // back to what it was
    else set('dipDb', v);
  });
  $('ttsDipFade').addEventListener('change', (e) => set('dipFade', +e.target.value));
  $('ttsLoudness').addEventListener('change', (e) => set('loudness', e.target.value));
  $('ttsStems').addEventListener('change', (e) => set('stems', e.target.checked));
  $('ttsOnline').addEventListener('change', (e) => {
    // Turning online voices off also drops an online voice that was chosen.
    if (!e.target.checked && currentVoice() && !currentVoice().localService && !currentVoice().google) { stop(); tts.voice = ''; }
    set('online', e.target.checked);
  });
  // Test reads what's in Test text, the sample until it's changed. Emptied, Test does nothing.
  const sample = $('ttsSample');
  const test = () => { const line = testLine().trim(); if (line) speak(line, { voice: shownVoice() }); };
  sample.addEventListener('input', () => { tts.sample = sample.value; save(); $('ttsTest').disabled = !sample.value.trim(); });
  sample.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); test(); } });
  $('ttsTest').addEventListener('click', test);
  $('ttsTry').addEventListener('click', () => speak(hooks.sample?.() || SAMPLE, { voice: shownVoice() }));
  $('ttsWebVoice').addEventListener('change', renderWeb);
  $('ttsWebGet').addEventListener('click', () => {
    const v = $('ttsWebVoice').value;
    if (v) (webPiper.downloaded.includes(v) ? removeVoice : downloadVoice)(v);
  });
  $('ttsGoogleGet').href = GOOGLE_KEY_PAGE;
  $('ttsGoogleKey').addEventListener('change', async (e) => {
    $('ttsGoogleStatus').textContent = e.target.value.trim() ? 'Asking Google for its voices…' : '';
    const error = await setGoogleKey(e.target.value.trim());
    if (!error && tts.google.length && !makesAudio(currentVoice())) {
      picked = null; tts.voice = tts.google[0].voiceURI; save(); render(); hooks.changed();
    }
  });
  $('ttsGoogleForget').addEventListener('click', () => setGoogleKey(''));
  $('ttsClose').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => {
    stop();
    // Closed without Apply: the voice stays as it was.
    if (picked) {
      const v = voices.find((x) => x.voiceURI === picked);
      picked = null;
      hooks.toast(`The voice is still ${chosenVoiceName()}${v ? `. To read with ${v.name}, pick it again and click Apply` : ''}`);
    }
  });
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
  voices = allowed();
  if (tts.available) {
    speechSynthesis.addEventListener('voiceschanged', () => { voices = allowed(); if (d.open) render(); hooks.changed(); checkVoice(); });
  }
  loadPiper();
  loadSavedLengths();
}
