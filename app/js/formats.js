// Subtitle parsing and serialisation (SRT + WebVTT).

const p2 = (n) => String(n).padStart(2, '0');
const p3 = (n) => String(n).padStart(3, '0');

// Accepts "01:02:03,456", "02:03.456", "3.5", "1:02" …
export function parseTime(s) {
  s = String(s).trim().replace(',', '.');
  if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(s)) return NaN;
  return s.split(':').map(Number).reduce((t, p) => t * 60 + p, 0);
}

export function fmtTime(t, sep = ',') {
  let ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000); ms -= s * 1000;
  return `${p2(h)}:${p2(m)}:${p2(s)}${sep}${p3(ms)}`;
}

// SMPTE timecode, hh:mm:ss:ff, at a video's frame rate. 29.97 and 59.94 count in drop-frame
// timecode, hh:mm:ss;ff, which skips two (or four) frame numbers each minute, except every
// tenth, so the timecode keeps to the clock. Other rates, 23.976 too, count every frame.
const nominal = (fps) => Math.round(fps);
export const isDropFrame = (fps) => nominal(fps) % 30 === 0 && Math.abs(fps - nominal(fps) * 1000 / 1001) < 0.005;
export function fmtTC(t, fps = 25) {
  const fr = nominal(fps);
  let n = Math.floor(Math.max(0, t) * fps + 1e-4); // the frame showing at t
  const df = isDropFrame(fps);
  if (df) {
    const drop = fr / 15, per10 = fr * 600 - drop * 9, perMin = fr * 60 - drop;
    const tens = Math.floor(n / per10), rest = n % per10;
    n += drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMin) : 0);
  }
  const s = Math.floor(n / fr);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}${df ? ';' : ':'}${p2(n % fr)}`;
}
// A typed time: SMPTE timecode at fps, or seconds as in parseTime.
export function parseTC(str, fps = 25) {
  const m = String(str).trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[:;](\d{1,2})$/);
  if (!m) return parseTime(str);
  const fr = nominal(fps), [h, mi, s, f] = m.slice(1).map(Number);
  if (mi > 59 || s > 59 || f >= fr) return NaN;
  let n = ((h * 60 + mi) * 60 + s) * fr + f;
  if (isDropFrame(fps)) {
    const mins = h * 60 + mi;
    n -= (fr / 15) * (mins - Math.floor(mins / 10));
  }
  return n / fps;
}

// A block's text to speech speed, voice, dip and "sounds like" words are kept in exported
// VTT files as notes just before the block. Other programs ignore notes.
const SPEED_NOTE = 'NOTE Scribecue text to speech speed:';
const VOICE_NOTE = 'NOTE Scribecue text to speech voice:';
const DIP_NOTE = 'NOTE Scribecue programme lowered by (dB):';
const SAY_NOTE = 'NOTE Scribecue sounds like:';
// What a note says about the block after it: { speed }, { voice }, { dip } or
// { say: [[written, said], …] }.
function readNote(block) {
  block = block.trim();
  const m = block.match(/^NOTE Scribecue text to speech speed: (\d+(?:\.\d+)?)$/);
  if (m) return { speed: +m[1] };
  const v = block.match(/^NOTE Scribecue text to speech voice: (\S.*)$/);
  if (v) return { voice: v[1].trim() };
  const d = block.match(/^NOTE Scribecue programme lowered by \(dB\): (\d+(?:\.\d+)?)$/);
  if (d) return { dip: +d[1] };
  if (block.startsWith(SAY_NOTE)) {
    const say = block.split('\n').slice(1).map((l) => l.split(' = ')).filter((p) => p.length >= 2 && p[0].trim())
      .map(([w, ...s]) => [w.trim(), s.join(' = ').trim()]).filter(([, s]) => s);
    return say.length ? { say } : {};
  }
  return null;
}

export function parseSubs(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  let notes = {}; // from notes since the last block, for the next one
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) { Object.assign(notes, readNote(block)); continue; }
    const [a, b = ''] = lines[i].split('-->');
    const start = parseTime(a);
    const end = parseTime(b.trim().split(/\s+/)[0] || '');
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const cue = { start, end: Math.max(end, start), text: lines.slice(i + 1).join('\n').trim() };
    if (notes.speed) cue.speed = notes.speed;
    if (notes.voice) cue.voice = notes.voice;
    if (notes.dip != null) cue.dip = notes.dip;
    if (notes.say) cue.say = notes.say;
    notes = {};
    cues.push(cue);
  }
  return cues.sort((x, y) => x.start - y.start);
}

const clean = (s) => s.replace(/\n{2,}/g, '\n').trim();

export function toSRT(cues) {
  return cues.map((c, i) =>
    `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${clean(c.text)}`).join('\n\n') + '\n';
}

export function toVTT(cues) {
  const say = (c) => (c.say?.length ? `${SAY_NOTE}\n${c.say.map(([w, s]) => `${w} = ${s}`).join('\n')}\n\n` : '');
  return 'WEBVTT\n\n' + cues.map((c, i) => (c.speed ? `${SPEED_NOTE} ${c.speed}\n\n` : '') + (c.voice ? `${VOICE_NOTE} ${c.voice}\n\n` : '') + (c.dip != null ? `${DIP_NOTE} ${c.dip}\n\n` : '') + say(c) +
    `${i + 1}\n${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${clean(c.text)}`).join('\n\n') + '\n';
}

// Frazier's .adc scripts: JSON, with each block in cue_points as { start, end } in
// milliseconds and its text as HTML. A word marked <abbr class="speech" title="…"> is
// said as its title, which becomes one of the block's "sounds like" words. A block's speed
// is a code for one of Frazier's speeds, the same as Scribecue's, and the project's
// base_speed is a percentage (100 is normal): { cues, base }, with base as a fraction.
const ADC_SPEEDS = { 0: 1, 1: 1.15, 2: 1.3, 3: 1.5, 4: 2, 99: 0.85, 98: 0.7 };
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
  return n === 160 ? ' ' : String.fromCodePoint(n);
});
export function adcText(html) {
  const say = [];
  const text = decode(String(html || '')
    .replace(/<abbr\b[^>]*\bclass="[^"]*\bspeech\b[^"]*"[^>]*>([\s\S]*?)<\/abbr>/gi, (m, inner) => {
      const title = m.match(/\btitle="([^"]*)"/i);
      const written = decode(inner.replace(/<[^>]*>/g, '')).trim();
      const said = title ? decode(title[1]).trim() : '';
      if (written && said && !say.some(([w]) => w === written)) say.push([written, said]);
      return inner;
    })
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''))
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{2,}/g, '\n').trim();
  return { text, say };
}

export function parseAdc(text) {
  let doc;
  try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch { return { cues: [], base: 1 }; }
  if (!Array.isArray(doc?.cue_points)) return { cues: [], base: 1 };
  const base = doc.base_speed >= 50 && doc.base_speed <= 150 ? Math.round(doc.base_speed) / 100 : 1;
  const cues = doc.cue_points.filter((c) => Number.isFinite(c?.start) && Number.isFinite(c?.end)).map((c) => {
    const { text: t, say } = adcText(c.text);
    const start = Math.max(0, c.start) / 1000;
    const cue = { start, end: Math.max(c.end / 1000, start), text: t };
    const speed = ADC_SPEEDS[c.speed] ?? 1;
    if (speed !== 1) cue.speed = speed;
    // Frazier names a Google voice for every block; one other than the document's is the
    // block's own, such as a second voice for translated dialogue.
    if (typeof c.voice === 'string' && /^[a-z]{2,3}-[A-Z]{2}-\w+-\w+$/.test(c.voice) && c.voice !== doc.voice) cue.voice = 'google:' + c.voice;
    if (say.length) cue.say = say;
    return cue;
  }).sort((x, y) => x.start - y.start);
  return { cues, base };
}
