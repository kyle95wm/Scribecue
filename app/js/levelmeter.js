// The microphone's level, drawn on a canvas: a bar from −48 to 0 dBFS, with the pocket a
// take's peak should land in (−12 to −6) in the colour for good, above it in the one for
// bad, and the held peak as a line. Lying down under the video and in setup, standing up
// in Mic check. With a scale, the pocket's edges and a few levels are numbered.
import { POCKET, judgePeak, dbText } from './recording.js';

const FLOOR = -48;
const MARKS = [0, -6, -12, -24, -48];
let C = null; // colours, from the tokens in style.css
const colours = () => {
  if (C) return C;
  const css = getComputedStyle(document.documentElement), tok = (n) => css.getPropertyValue(n).trim();
  C = { bg: tok('--bg'), ok: tok('--ok'), bad: tok('--bad'), quiet: tok('--faint'), hold: tok('--text'), dim: tok('--dim'), line: tok('--line'), mono: tok('--mono') };
  return C;
};
// The zones behind the bar, faint.
const zone = (c) => `color-mix(in srgb, ${c} 25%, transparent)`;
export const toDb = (peak) => (peak > 0 ? 20 * Math.log10(peak) : -Infinity);

// level, hold: 0…1, the peak now and the one held. The canvas is drawn at its own size
// in pixels; sizeMeter fits a canvas to its box first.
export function drawLevel(canvas, level, hold, { vertical = false, scale = false } = {}) {
  const c = colours(), g = canvas.getContext('2d');
  const r = canvas.width / (canvas.clientWidth || canvas.width) || 1; // pixels to the CSS pixel
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  // The bar's box, leaving room for the numbers when there's a scale.
  const pad = scale ? Math.round(28 * r) : 0;
  const box = vertical ? { x: pad, y: Math.round(6 * r), w: W - pad, h: H - Math.round(12 * r) } : { x: 0, y: 0, w: W, h: H - (scale ? Math.round(14 * r) : 0) };
  const at = (db) => (Math.max(FLOOR, Math.min(0, db)) - FLOOR) / -FLOOR; // 0…1 up the bar
  const fill = (from, to, colour, inset = 0) => {
    g.fillStyle = colour;
    if (vertical) g.fillRect(box.x + inset, box.y + box.h * (1 - to), box.w - inset * 2, box.h * (to - from));
    else g.fillRect(box.x + box.w * from, box.y + inset, box.w * (to - from), box.h - inset * 2);
  };
  if (scale) { // a box of its own, like the meter under the video
    g.fillStyle = c.bg; g.fillRect(box.x, box.y, box.w, box.h);
    g.strokeStyle = c.line; g.lineWidth = Math.max(1, Math.round(r));
    g.strokeRect(box.x + g.lineWidth / 2, box.y + g.lineWidth / 2, box.w - g.lineWidth, box.h - g.lineWidth);
  }
  fill(at(POCKET[0]), at(POCKET[1]), zone(c.ok));
  fill(at(POCKET[1]), 1, zone(c.bad));
  const db = toDb(level), j = judgePeak(db);
  fill(0, at(db), j === 'loud' ? c.bad : j === 'good' ? c.ok : c.quiet, Math.round(3 * r));
  if (hold > 0) {
    const h = at(toDb(hold)), t = Math.max(1, Math.round(2 * r));
    g.fillStyle = c.hold;
    if (vertical) g.fillRect(box.x, box.y + box.h * (1 - h) - t / 2, box.w, t);
    else g.fillRect(box.x + box.w * h - t / 2, box.y, t, box.h);
  }
  if (!scale) return;
  g.font = `${Math.round(10 * r)}px ${c.mono}`;
  for (const m of MARKS) {
    const p = at(m), pocket = POCKET.includes(m);
    g.fillStyle = pocket ? c.hold : c.dim;
    const label = m ? String(m).replace('-', '−') : '0';
    if (vertical) {
      const y = box.y + box.h * (1 - p);
      g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(label, pad - Math.round(5 * r), y);
      g.fillRect(pad - Math.round(3 * r), y, Math.round(3 * r), Math.max(1, Math.round(r)));
    } else {
      const x = box.x + box.w * p;
      g.textAlign = m === 0 ? 'right' : m === FLOOR ? 'left' : 'center'; g.textBaseline = 'bottom';
      g.fillText(label, x, H);
    }
  }
}

// Fits a canvas's pixels to its box on screen, so lines and numbers are sharp.
export function sizeMeter(canvas) {
  const r = devicePixelRatio || 1, w = Math.round(canvas.clientWidth * r), h = Math.round(canvas.clientHeight * r);
  if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
}

// The loudest peak so far, in words, on el: its class says how it sits against the pocket.
const SAY = {
  good: 'in the pocket',
  note: 'below the pocket, fine for quieter lines',
  quiet: 'very quiet: turn your gain up a little',
  loud: 'over −6: turn your gain down',
};
export function showLoudest(el, peak) {
  if (!el) return;
  const db = toDb(peak), j = judgePeak(db);
  const text = peak > 0 ? `Loudest: ${dbText(db)}, ${SAY[j]}` : 'Loudest: nothing yet';
  if (el.textContent !== text) el.textContent = text;
  el.className = 'loudest lvl' + (peak > 0 ? ' ' + j : '');
}
