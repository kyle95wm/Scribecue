// Searching Settings. Each entry is one heading in a section, with the words under it:
// { section, title, heading, text }. Kept apart from the page, so it can be tested.

// Lower case, without accents or curly quotes, so "cafe" finds "café" and "dont" finds "don’t".
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[’‘']/g, '').toLowerCase();

export const queryWords = (q) => fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// A word is found where a word in the text starts with it, so "voi" finds "voices" but
// "ice" doesn't. Digits and letters only, so "ctrl+f" looks for "ctrl" and "f".
const startsWord = (hay, w) => {
  for (let i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1])) return true;
  }
  return false;
};

// The entries with every word of the query in them, best first: words in the heading count
// most, then in the section's title, then under the heading. Entries marked minor, such
// as each shortcut, count for less, and aren't found by their section's title, so "key"
// doesn't find every shortcut. Ties keep the sections' order.
export function searchEntries(entries, query, { limit = 30 } = {}) {
  const words = queryWords(query);
  if (!words.length) return [];
  const out = [];
  entries.forEach((e, i) => {
    const heading = fold(e.heading), title = fold(e.title), text = fold(e.text);
    let score = 0;
    for (const w of words) {
      const s = (startsWord(heading, w) ? 6 : 0) + (!e.minor && startsWord(title, w) ? 3 : 0) + (startsWord(text, w) ? 1 : 0);
      if (!s) return;
      score += s;
    }
    if (heading.startsWith(words.join(' '))) score += 4;
    if (e.minor) score /= 2;
    out.push({ e, score, i });
  });
  return out.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((x) => x.e);
}

// A short piece of the text around the first word found, for under a result. Empty when the
// words were only in the heading.
export function snippet(text, query, { width = 110 } = {}) {
  const words = queryWords(query), flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat || !words.length) return '';
  const folded = fold(flat);
  let at = -1;
  for (const w of words) {
    for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + 1)) {
      if (i === 0 || !/[\p{L}\p{N}]/u.test(folded[i - 1])) { if (at < 0 || i < at) at = i; break; }
    }
  }
  if (at < 0) return '';
  // Folding drops accents and quotes, so find the same place in the original by counting.
  at = origIndex(flat, at);
  let start = Math.max(0, at - Math.floor(width / 3));
  if (start > 0) { const sp = flat.indexOf(' ', start); start = sp >= 0 && sp < at ? sp + 1 : start; }
  let end = Math.min(flat.length, start + width);
  if (end < flat.length) { const sp = flat.lastIndexOf(' ', end); if (sp > at) end = sp; }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

// Where the n-th character of fold(s) came from in s.
function origIndex(s, n) {
  let k = 0;
  for (let i = 0; i < s.length; i++) {
    const len = fold(s[i]).length;
    if (k + len > n) return i;
    k += len;
  }
  return s.length;
}

// Splits a string into parts, marking where query words start a word, for highlighting.
export function marks(text, query) {
  const words = queryWords(query), parts = [];
  if (!words.length) return [{ text, hit: false }];
  let i = 0, plain = '';
  while (i < text.length) {
    const before = i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);
    let len = 0;
    if (before) {
      for (const w of words) {
        // Match the word against the folded text from here, a character at a time.
        let j = i, k = 0;
        while (j < text.length && k < w.length) {
          const f = fold(text[j]);
          if (!f) { j++; continue; }
          if (w.startsWith(f, k)) { k += f.length; j++; } else break;
        }
        if (k === w.length && j - i > len) len = j - i;
      }
    }
    if (len) {
      if (plain) parts.push({ text: plain, hit: false });
      parts.push({ text: text.slice(i, i + len), hit: true });
      plain = '';
      i += len;
    } else plain += text[i++];
  }
  if (plain) parts.push({ text: plain, hit: false });
  return parts;
}
