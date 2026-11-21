// Merging two blocks' text: the next block's words follow on as another sentence, on the
// same line, rather than on a line of their own.

// A sentence already ends here: a full stop, question mark, exclamation mark or ellipsis,
// maybe inside closing quotes or brackets.
const ENDED = /[.?!…]["'”’)\]]*$/;

// A comma, semicolon or colon left at the end gives way to the full stop.
const OPEN = /[,;:]+$/;

export function joinSentences(a = '', b = '') {
  const first = a.trimEnd(), next = b.trimStart();
  if (!first) return next;
  if (!next) return first;
  return ENDED.test(first) ? `${first} ${next}` : `${first.replace(OPEN, '')}. ${next}`;
}
