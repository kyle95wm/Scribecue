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

// What a screen reader says for a block in the list.
export function blockLabel({ n, start, secs, text, tooLong = false, ready = false }) {
  const words = String(text || '').replace(/<[^>]*>|\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  return `Block ${n}, at ${start}, ${secs} seconds${tooLong ? ', too long to read in time' : ''}${ready ? ', reading ready' : ''}: ${words || 'empty'}`;
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
