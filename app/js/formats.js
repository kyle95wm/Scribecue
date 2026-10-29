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

// A block's text to speech speed and "sounds like" words are kept in exported VTT
// files as notes just before the block. Other programs ignore notes.
const SPEED_NOTE = 'NOTE Scribecue text to speech speed:';
const SAY_NOTE = 'NOTE Scribecue sounds like:';
// What a note says about the block after it: { speed } or { say: [[written, said], …] }.
function readNote(block) {
  block = block.trim();
  const m = block.match(/^NOTE Scribecue text to speech speed: (\d+(?:\.\d+)?)$/);
  if (m) return { speed: +m[1] };
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
  return 'WEBVTT\n\n' + cues.map((c, i) => (c.speed ? `${SPEED_NOTE} ${c.speed}\n\n` : '') + say(c) +
    `${i + 1}\n${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${clean(c.text)}`).join('\n\n') + '\n';
}
