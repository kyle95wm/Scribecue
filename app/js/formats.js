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

// A block's text to speech speed, voice, dip, volume and "sounds like" words are kept in exported
// VTT files as notes just before the block. Other programs ignore notes.
const SPEED_NOTE = 'NOTE Scribecue text to speech speed:';
const VOICE_NOTE = 'NOTE Scribecue text to speech voice:';
// The dip note gives no dip (0), or, from before 0.61, an exact dip; the dip-by note how
// much more than the setting (less if negative).
const DIP_NOTE = 'NOTE Scribecue programme lowered by (dB):';
const DIP_BY_NOTE = 'NOTE Scribecue programme lowered more than set by (dB):';
const VOL_NOTE = 'NOTE Scribecue reading volume (%):';
const SAY_NOTE = 'NOTE Scribecue sounds like:';
// What a note says about the block after it: { speed }, { voice }, { dip }, { dipBy },
// { vol } or { say: [[written, said], …] }.
function readNote(block) {
  block = block.trim();
  const m = block.match(/^NOTE Scribecue text to speech speed: (\d+(?:\.\d+)?)$/);
  if (m) return { speed: +m[1] };
  const v = block.match(/^NOTE Scribecue text to speech voice: (\S.*)$/);
  if (v) return { voice: v[1].trim() };
  const d = block.match(/^NOTE Scribecue programme lowered by \(dB\): (\d+(?:\.\d+)?)$/);
  if (d) return { dip: +d[1] };
  const by = block.match(/^NOTE Scribecue programme lowered more than set by \(dB\): ([+-]?\d+)$/);
  if (by) return { dipBy: +by[1] };
  const vol = block.match(/^NOTE Scribecue reading volume \(%\): (\d+)$/);
  if (vol) return { vol: +vol[1] };
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
    if (notes.dipBy != null) cue.dipBy = notes.dipBy;
    if (notes.vol != null) cue.vol = notes.vol;
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
  return 'WEBVTT\n\n' + cues.map((c, i) => (c.speed ? `${SPEED_NOTE} ${c.speed}\n\n` : '') + (c.voice ? `${VOICE_NOTE} ${c.voice}\n\n` : '') + (c.dip != null ? `${DIP_NOTE} ${c.dip}\n\n` : '') +
    (c.dipBy ? `${DIP_BY_NOTE} ${c.dipBy > 0 ? '+' : ''}${c.dipBy}\n\n` : '') + (c.vol ? `${VOL_NOTE} ${c.vol}\n\n` : '') + say(c) +
    `${i + 1}\n${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${clean(c.text)}`).join('\n\n') + '\n';
}
