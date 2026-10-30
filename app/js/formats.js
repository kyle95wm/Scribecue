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

// Frazier's .adc scripts: JSON, with each block in cue_points as { start, end } in
// milliseconds and its text as HTML. A word marked <abbr class="speech" title="…"> is
// said as its title, which becomes one of the block's "sounds like" words. The project's
// base_speed is a percentage (100 is normal), and a block's speed is a code for one of
// Frazier's speeds, the same as Scribecue's, applied on top of it.
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
  try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch { return []; }
  if (!Array.isArray(doc?.cue_points)) return [];
  const base = doc.base_speed > 0 ? doc.base_speed / 100 : 1;
  return doc.cue_points.filter((c) => Number.isFinite(c?.start) && Number.isFinite(c?.end)).map((c) => {
    const { text: t, say } = adcText(c.text);
    const start = Math.max(0, c.start) / 1000;
    const cue = { start, end: Math.max(c.end / 1000, start), text: t };
    const speed = Math.round(base * (ADC_SPEEDS[c.speed] ?? 1) * 100) / 100;
    if (speed !== 1) cue.speed = speed;
    if (say.length) cue.say = say;
    return cue;
  }).sort((x, y) => x.start - y.start);
}
