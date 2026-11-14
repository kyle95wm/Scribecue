// How Scribecue looks: the highlight colour on buttons and switches that are on, the
// subtitles over the video, and the size of the text in the list and the block editor.
// Kept in this browser as `scribecue.appearance`, and in the settings file. Each choice is
// a data attribute on <html>, which style.css turns into tokens, so nothing here sets a
// colour or a size itself. A choice left at its default isn't stored.

export const KEY = 'scribecue.appearance';

// [name, choices, default]. Each choice is [value, label].
export const CHOICES = {
  accent: [[['amber', 'Amber'], ['violet', 'Violet'], ['teal', 'Teal'], ['magenta', 'Magenta']], 'amber'],
  // Burnt in: as in a video with subtitles (0.114.0 on). Classic: as before 0.114.0.
  subStyle: [[['burnt', 'Burnt in'], ['classic', 'Classic']], 'burnt'],
  subSize: [[['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']], 'm'],
  // No background by default: an outline and a shadow, as subtitles are burnt in.
  subBg: [[['none', 'None'], ['light', 'Light'], ['dark', 'Dark'], ['solid', 'Solid']], 'none'],
  subPos: [[['bottom', 'Bottom'], ['top', 'Top']], 'bottom'],
  textSize: [[['m', 'Default'], ['l', 'Large'], ['xl', 'Larger']], 'm'],
};

// What each choice is called, for setup's summary.
export const NAMES = {
  accent: 'Highlight colour',
  subStyle: 'Text over the video looks',
  subSize: 'Text over the video',
  subBg: 'Background behind it',
  subPos: 'Text over the video goes at the',
  textSize: 'Text size in the list and editor',
};

export const DEFAULTS = Object.fromEntries(Object.entries(CHOICES).map(([k, [, d]]) => [k, d]));
const allowed = (name, v) => CHOICES[name]?.[0].some(([x]) => x === v);

// The appearance kept in storage, with defaults for anything missing or not understood.
export function readAppearance(raw) {
  let v = null;
  try { v = JSON.parse(raw); } catch { /* not JSON */ }
  const out = { ...DEFAULTS };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const k of Object.keys(CHOICES)) if (allowed(k, v[k])) out[k] = v[k];
  return out;
}

// What goes into storage: only what differs from the default, or null when nothing does.
export function storedAppearance(a) {
  const out = {};
  for (const k of Object.keys(CHOICES)) if (allowed(k, a[k]) && a[k] !== DEFAULTS[k]) out[k] = a[k];
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

// The data attributes on <html> for an appearance: data-accent, data-sub-size and so on.
export const attributes = (a) => Object.fromEntries(
  Object.keys(CHOICES).map((k) => [`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, a[k]]),
);

// Puts an appearance on the page.
export function applyAppearance(a, root = document.documentElement) {
  for (const [name, value] of Object.entries(attributes(a))) root.setAttribute(name, value);
}

export function loadAppearance(storage = globalThis.localStorage) {
  let raw = null;
  try { raw = storage?.getItem(KEY) ?? null; } catch { /* storage blocked */ }
  return readAppearance(raw);
}

export function saveAppearance(a, storage = globalThis.localStorage) {
  const v = storedAppearance(a);
  try { if (v === null) storage.removeItem(KEY); else storage.setItem(KEY, v); } catch { /* storage blocked */ }
}

// The choices that differ from the default, one line each, or 'Default appearance'.
export function describeAppearance(a) {
  const lines = [];
  for (const [k, [choices, def]] of Object.entries(CHOICES)) {
    if (!allowed(k, a[k]) || a[k] === def) continue;
    const label = choices.find(([v]) => v === a[k])[1];
    lines.push(k === 'subPos' ? `${NAMES[k]} ${label.toLowerCase()}` : `${NAMES[k]}: ${label}`);
  }
  return lines.length ? lines : ['Default appearance'];
}

// Fills each [data-look] row inside root with a button for each of its choices. Clicking
// one calls pick(name, value). markChoices presses the ones in use.
export function fillChoices(root, pick) {
  for (const row of root.querySelectorAll('[data-look]')) {
    const name = row.dataset.look;
    for (const [value, label] of CHOICES[name][0]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = value;
      b.setAttribute('aria-pressed', 'false');
      if (name === 'accent') {
        const dot = document.createElement('span');
        dot.className = 'lookdot';
        dot.dataset.accent = value;
        b.append(dot);
      }
      b.append(label);
      b.addEventListener('click', () => pick(name, value));
      row.append(b);
    }
  }
}

export function markChoices(root, a) {
  for (const row of root.querySelectorAll('[data-look]')) {
    for (const b of row.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === a[row.dataset.look]));
  }
}
