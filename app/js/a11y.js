// For screen readers. Scribecue's messages and labels use key symbols such as ⌘ and ⇧, which
// screen readers read out oddly ("place of interest sign"), so announcements and labels go
// through speakable() first. announce() reads a message out without moving the focus.

const KEYS = [
  [/⌘/g, 'Command '], [/⇧/g, 'Shift '], [/↵/g, 'Enter'], [/⇥/g, 'Tab'], [/⌫/g, 'Backspace'],
  [/(^|[\s(/])←(?=[\s),.;/]|$)/g, '$1Left arrow'], [/(^|[\s(/])→(?=[\s),.;/]|$)/g, '$1Right arrow'],
  [/↑/g, 'Up arrow'], [/↓/g, 'Down arrow'],
  [/\s[—–]\s/g, ', '], [/\s·\s/g, ', '], [/•/g, ''],
];

// A message or label as a screen reader should say it. mac: whether ⌥ is Option or Alt.
export function speakable(text, mac = true) {
  let s = String(text).replace(/⌥/g, mac ? 'Option ' : 'Alt ');
  for (const [from, to] of KEYS) s = s.replace(from, to);
  return s.replace(/ {2,}/g, ' ').replace(/ ([,.;:)])/g, '$1').trim();
}

const SYMBOL = /[⌘⇧⌥↵⇥⌫←→↑↓]/;

// Key symbols in <kbd>s, as in the shortcuts overlay and the footer, are shown as they are
// and read as words. Labels with symbols are rewritten to words. Safe to run more than once.
export function speakKeys(root, mac = true) {
  for (const k of root.querySelectorAll('kbd')) {
    if (k.querySelector('.sr-only, kbd') || !SYMBOL.test(k.textContent)) continue;
    const shown = document.createElement('span');
    shown.setAttribute('aria-hidden', 'true');
    shown.append(...k.childNodes);
    const said = document.createElement('span');
    said.className = 'sr-only';
    said.textContent = ' ' + speakable(shown.textContent.replace(/\+/g, ' '), mac) + ' ';
    k.append(shown, said);
  }
  for (const el of root.querySelectorAll('[aria-label]')) {
    const v = el.getAttribute('aria-label');
    if (SYMBOL.test(v)) el.setAttribute('aria-label', speakable(v, mac));
  }
}

// The play button's name says what it will do, keeping the key at the end.
export function playLabel(current, playing) {
  const key = /\s*\([^()]*\)$/.exec(current)?.[0] || '';
  return (playing ? 'Pause' : 'Play') + key;
}

// What a screen reader says for a block in the list.
export function blockLabel({ n, start, secs, text, tooLong = false, overDialogue = false, ready = false, extended = false }) {
  const words = String(text || '').replace(/<[^>]*>|\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  return `Block ${n}, at ${start}, ${secs} seconds${tooLong ? ', too long to read in time' : ''}${overDialogue ? ', over dialogue' : ''}${extended ? ', pauses the video' : ''}${ready ? ', reading ready' : ''}: ${words || 'empty'}`;
}

// After Esc closes a dialog, whether the focus stays where the browser put it back: under
// another dialog, or in a block or drawer that's still open, so typing carries on there.
export function keepsFocusAfterDialog(active, otherDialogOpen) {
  return otherDialogOpen || !!active?.closest?.('#editor, .aidrawer');
}

let region = null, timer = 0;
// Reads a message out politely, after whatever the screen reader is saying. The same
// message twice in a row is read twice.
export function announce(text, mac = true) {
  region ||= document.getElementById('announce');
  if (!region) return;
  clearTimeout(timer);
  region.textContent = '';
  timer = setTimeout(() => { region.textContent = speakable(text, mac); }, 60);
}

// How long a message stays up, in ms: long enough to read, with more time for longer ones.
// Clicking the message closes it sooner.
export function toastMs(text) {
  const extra = Math.max(0, String(text).length - 40) * 60;
  return Math.min(6000 + extra, 12000);
}
