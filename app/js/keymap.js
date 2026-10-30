// The editor's keyboard shortcuts, which people can change, share and reset. A shortcut
// is a combo such as "Alt+Shift+ArrowLeft": the modifiers, then the physical key
// (KeyboardEvent.code), so it stays put whatever the keyboard layout.
//
// Some keys aren't here and can't be changed: Ctrl/Cmd combinations (undo, open, save,
// export), keys inside text boxes, and keys that go by the character on the key so they
// suit every layout (? / [ ] + − Esc). Those combos are RESERVED.

// [id, what it does, default combos], in groups as the customize panel shows them.
export const GROUPS = [
  ['Playing', [
    ['play', 'Play / pause', ['Space']],
    ['playBlock', 'Play the selected block only', ['Shift+Space']],
    ['loopBlock', 'Loop this block and play', ['KeyL']],
    ['loopToggle', 'Loop on / off', ['KeyO']],
    ['followToggle', 'Follow the playhead on / off', ['KeyF']],
    ['speedReset', 'Reset playback speed to 1×', ['Backslash']],
  ]],
  ['Moving around', [
    ['frameBack', 'One frame back', ['ArrowLeft']],
    ['frameFwd', 'One frame forward', ['ArrowRight']],
    ['back3', 'Three seconds back', ['Shift+ArrowLeft']],
    ['fwd3', 'Three seconds forward', ['Shift+ArrowRight']],
    ['blockBack', 'Start of this block, then the previous block', ['Alt+Shift+ArrowLeft']],
    ['blockNext', 'Next block', ['Alt+Shift+ArrowRight']],
    ['videoStart', 'Beginning of the video', ['Home']],
    ['videoEnd', 'End of the video', ['End']],
    ['toStart', 'Playhead to the block’s start', ['KeyG']],
    ['toEnd', 'Playhead to the block’s end', ['Shift+KeyG']],
    ['jumpTime', 'Jump to a timecode', ['Alt+Shift+KeyJ']],
    ['quickNav', 'Quick navigation (search blocks)', ['Shift+KeyF']],
  ]],
  ['Blocks', [
    ['createEdit', 'Create or edit a block at the playhead', ['Enter', 'NumpadEnter']],
    ['newBlock', 'New block at the playhead', ['KeyN']],
    ['prevBlock', 'Previous block in the list', ['ArrowUp', 'KeyK']],
    ['nextBlock', 'Next block in the list', ['ArrowDown', 'KeyJ']],
    ['back10Blocks', 'Ten blocks back', ['PageUp']],
    ['fwd10Blocks', 'Ten blocks forward', ['PageDown']],
    ['selectAtPlayhead', 'Select the block under the playhead', ['KeyC']],
    ['split', 'Split at the playhead', ['KeyX']],
    ['merge', 'Merge with the next block', ['KeyM']],
    ['deleteNow', 'Delete the block (undoable)', ['Delete', 'Backspace']],
    ['deleteAsk', 'Delete the block, after asking', ['Alt+Shift+KeyD']],
    ['findReplace', 'Find and replace text in every block', ['Alt+Shift+KeyF']],
  ]],
  ['Timing', [
    ['setStart', 'Set the start to the playhead', ['KeyA']],
    ['setEnd', 'Set the end to the playhead', ['KeyS']],
    ['startBack', 'Start −100 ms', ['KeyQ']],
    ['startFwd', 'Start +100 ms', ['KeyW']],
    ['endBack', 'End −100 ms', ['KeyE']],
    ['endFwd', 'End +100 ms', ['KeyR']],
    ['moveBack', 'Move the block −100 ms', ['Comma']],
    ['moveFwd', 'Move the block +100 ms', ['Period']],
    ['startBack10', 'Start −10 ms', ['Shift+KeyQ']],
    ['startFwd10', 'Start +10 ms', ['Shift+KeyW']],
    ['endBack10', 'End −10 ms', ['Shift+KeyE']],
    ['endFwd10', 'End +10 ms', ['Shift+KeyR']],
    ['moveBack10', 'Move the block −10 ms', ['Shift+Comma']],
    ['moveFwd10', 'Move the block +10 ms', ['Shift+Period']],
  ]],
  ['Transcribing', [
    ['hold', 'Hold to mark a block while the narrator speaks; in Write mode, time your own read of the selected block', ['KeyH']],
    ['offset', 'Change the reaction offset for H', ['Shift+KeyH']],
    ['trackNext', 'Next audio track', ['KeyT']],
    ['trackPrev', 'Previous audio track', ['Shift+KeyT']],
    ['transcribeBlock', 'Transcribe the selected block with Whisper', ['Alt+Shift+KeyT']],
    ['sttPanel', 'Speech to text settings', ['Alt+Shift+KeyH']],
  ]],
  ['Writing', [
    ['read', 'Read the selected block aloud', ['KeyV']],
    ['fitToReading', 'Set the block’s end to where the reading finishes', ['Shift+KeyV']],
    ['ttsPanel', 'Text to speech settings', ['Alt+Shift+KeyV']],
    ['soundsLike', 'Sounds like: how words in this block are said', ['Alt+Shift+KeyP']],
    ['aiHelp', 'AI help', ['Alt+Shift+KeyA']],
  ]],
  ['View', [
    ['help', 'Keyboard shortcuts', ['Shift+KeyO']],
    ['zoomIn', 'Zoom the timeline in', ['Alt+Equal', 'Alt+NumpadAdd']],
    ['zoomOut', 'Zoom the timeline out', ['Alt+Minus', 'Alt+NumpadSubtract']],
    ['zoomFit', 'Zoom the timeline to fit', ['Alt+Digit0', 'Alt+Numpad0']],
  ]],
];

export const ACTIONS = GROUPS.flatMap(([, list]) => list.map(([id, label, keys]) => ({ id, label, keys })));
const DEFAULTS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.keys]));

// Keys that keep their own meaning, so they can't be given to anything else.
export const RESERVED = {
  Escape: 'Esc stops and steps back out', Tab: 'Tab moves between fields', 'Shift+Tab': 'Tab moves between fields',
  Slash: '/ searches the block list', 'Shift+Slash': '? shows the shortcuts',
  BracketLeft: '[ slows this block’s reading', BracketRight: '] speeds this block’s reading up',
  Equal: '+ speeds playback up', 'Shift+Equal': '+ speeds playback up', NumpadAdd: '+ speeds playback up',
  Minus: '− slows playback down', NumpadSubtract: '− slows playback down',
};

const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn']);

// The combo for a key press, or null for a modifier on its own or a Ctrl/Cmd combination.
export function comboOf(e) {
  if (!e.code || MODIFIERS.has(e.code) || e.ctrlKey || e.metaKey) return null;
  return [e.altKey && 'Alt', e.shiftKey && 'Shift', e.code].filter(Boolean).join('+');
}

// Every action's combos: the defaults, with the person's changes on top.
// changes: { id: [combos] } for the actions they've changed.
export function bindings(changes = {}) {
  return Object.fromEntries(ACTIONS.map(({ id }) => [id, changes[id] ?? DEFAULTS[id]]));
}
// combo -> action id
export function lookup(changes = {}) {
  const m = new Map();
  for (const [id, combos] of Object.entries(bindings(changes))) for (const c of combos) m.set(c, id);
  return m;
}
// Only what differs from the defaults is kept.
function tidy(all) {
  const out = {};
  for (const [id, combos] of Object.entries(all)) if (JSON.stringify(combos) !== JSON.stringify(DEFAULTS[id])) out[id] = combos;
  return out;
}

// Gives combo to action id. If another action had it, that one loses it: movedFrom says which.
export function assign(changes, id, combo) {
  if (RESERVED[combo]) return { changes, refused: RESERVED[combo] };
  const all = bindings(changes);
  const movedFrom = Object.keys(all).find((k) => k !== id && all[k].includes(combo)) || null;
  if (movedFrom) all[movedFrom] = all[movedFrom].filter((c) => c !== combo);
  if (!all[id].includes(combo)) all[id] = [...all[id], combo];
  return { changes: tidy(all), movedFrom };
}
export function unassign(changes, id, combo) {
  const all = bindings(changes);
  all[id] = all[id].filter((c) => c !== combo);
  return tidy(all);
}
export function resetAction(changes, id) {
  const { [id]: _, ...rest } = changes;
  return rest;
}
// Which action has this combo now, if any.
export const ownerOf = (changes, combo) => lookup(changes).get(combo) || null;

// ---- sharing

export const KEYS_FILE = 'scribecue-shortcuts.json';
export function exportKeys(changes) {
  return { scribecue: 'shortcuts', version: 1, keys: bindings(changes) };
}
const COMBO = /^(Alt\+)?(Shift\+)?[A-Z][A-Za-z0-9]*$/;
// Reads a shortcuts file. Throws an Error that says what's wrong. Unknown actions and
// combos that can't be used are skipped, and listed in skipped.
export function importKeys(json) {
  if (!json || json.scribecue !== 'shortcuts' || typeof json.keys !== 'object') throw new Error('this isn’t a Scribecue shortcuts file');
  if (json.version > 1) throw new Error('it was saved by a newer version of Scribecue');
  const all = bindings({}), skipped = [], taken = new Map();
  for (const [id, combos] of Object.entries(json.keys)) {
    if (!(id in all) || !Array.isArray(combos)) { skipped.push(id); continue; }
    all[id] = combos.filter((c) => {
      const ok = typeof c === 'string' && COMBO.test(c) && !RESERVED[c] && !taken.has(c);
      if (!ok) skipped.push(`${id}: ${c}`); else taken.set(c, id);
      return ok;
    });
  }
  // Defaults the file didn't mention keep their keys, unless the file gave them away.
  for (const id of Object.keys(all)) {
    if (id in json.keys) continue;
    all[id] = all[id].filter((c) => !taken.has(c));
  }
  return { changes: tidy(all), skipped };
}

// ---- showing keys

const NAMES = {
  Space: 'Space', Enter: '↵', NumpadEnter: '↵', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del', Backspace: '⌫', Backslash: '\\',
  Comma: ',', Period: '.', Equal: '=', Minus: '-', Semicolon: ';', Quote: '\'', Backquote: '`', Insert: 'Ins',
  NumpadAdd: '+', NumpadSubtract: '−', NumpadMultiply: '×', NumpadDivide: '÷', NumpadDecimal: '.',
  BracketLeft: '[', BracketRight: ']', Slash: '/', IntlBackslash: '\\', Escape: 'Esc', Tab: '⇥',
};
// The keys to show for a combo, such as ['⌥', '⇧', '←'] on a Mac or ['Alt', 'Shift', '←'].
export function keyLabels(combo, mac = true) {
  const parts = combo.split('+'), code = parts.pop();
  const name = NAMES[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  return [...parts.map((m) => (m === 'Alt' ? (mac ? '⌥' : 'Alt') : (mac ? '⇧' : 'Shift'))), name];
}
export const comboText = (combo, mac = true) => keyLabels(combo, mac).join(mac ? '' : '+');
