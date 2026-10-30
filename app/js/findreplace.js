// Find and replace across every block's text. What you type is found as written (no
// patterns), ignoring case unless Match case is on, and with Whole words only, not inside
// longer words. The replacement goes in exactly as typed.

// The search, or null when there's nothing to find.
export function matcher(find, { matchCase = false, wholeWords = false } = {}) {
  if (!find) return null;
  const text = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const src = wholeWords ? `(?<![\\p{L}\\p{N}_])${text}(?![\\p{L}\\p{N}_])` : text;
  return new RegExp(src, `gu${matchCase ? '' : 'i'}`);
}

// How many times it's found, and in how many blocks.
export function count(cues, re) {
  let matches = 0, blocks = 0;
  if (!re) return { matches, blocks };
  for (const c of cues) {
    const n = (c.text.match(re) || []).length;
    if (n) { matches += n; blocks++; }
  }
  return { matches, blocks };
}

// The text with every match replaced by exactly what was typed.
export const replaceIn = (text, re, withText) => text.replace(re, () => withText);

// The index of the next block after `from` with a match, going round to the start, or -1.
export function nextMatch(cues, re, from) {
  if (!re) return -1;
  for (let k = 1; k <= cues.length; k++) {
    const i = (from + k) % cues.length;
    re.lastIndex = 0;
    if (re.test(cues[i].text)) { re.lastIndex = 0; return i; }
  }
  return -1;
}
