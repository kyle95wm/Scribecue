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

export function parseSubs(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b = ''] = lines[i].split('-->');
    const start = parseTime(a);
    const end = parseTime(b.trim().split(/\s+/)[0] || '');
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    cues.push({ start, end: Math.max(end, start), text: lines.slice(i + 1).join('\n').trim() });
  }
  return cues.sort((x, y) => x.start - y.start);
}

const clean = (s) => s.replace(/\n{2,}/g, '\n').trim();

export function toSRT(cues) {
  return cues.map((c, i) =>
    `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${clean(c.text)}`).join('\n\n') + '\n';
}

export function toVTT(cues) {
  return 'WEBVTT\n\n' + cues.map((c, i) =>
    `${i + 1}\n${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${clean(c.text)}`).join('\n\n') + '\n';
}
