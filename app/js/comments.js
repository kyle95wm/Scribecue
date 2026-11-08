// Comments go with writing and review. Transcribe and Record have other jobs.
export const commentsAllowed = (mode) => mode === 'write' || mode === 'qc';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const newCommentId = () => crypto.randomUUID();
// Comments from before ids get one worked out from what they say, who wrote them and when,
// so two copies of the same old project agree on it. Repeats in one list are numbered.
function fnv(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}
export function derivedCommentId(c, repeat = 0) {
  const key = JSON.stringify([c.text, c.author, c.created, c.time ?? null, repeat]);
  const h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => fnv(key, seed)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) & 3]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// Comments stay with their block, or at a fixed time in the programme. Each has an id that
// stays with it through saves, packages and undo, so two people's comments merge one by one.
export function cleanComments(value, timed = false) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter((c) => c && typeof c.text === 'string' && c.text.trim() &&
    (!timed || (typeof c.time === 'number' && Number.isFinite(c.time) && c.time >= 0)))
    .map((c) => {
      const clean = { text: c.text.trim(), author: typeof c.author === 'string' ? c.author.trim() : '',
        created: typeof c.created === 'string' ? c.created : '', resolved: c.resolved === true,
        ...(timed ? { time: c.time } : {}) };
      let id = typeof c.id === 'string' && ID.test(c.id) && !seen.has(c.id) ? c.id : '';
      for (let repeat = 0; !id || seen.has(id); repeat++) id = derivedCommentId(clean, repeat);
      seen.add(id);
      return { id, ...clean };
    });
}

// Merges one list of comments from two copies against the list they started from, one
// comment at a time: additions from both sides are kept, and a change or deletion made on
// one side is taken. Returns null when both sides changed the same comment differently.
export function mergeComments(before = [], ours = [], theirs = [], equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  const [b, o, t] = [before, ours, theirs].map((list) => new Map(list.map((c) => [c.id, c])));
  const ids = [...new Set([...o.keys(), ...t.keys(), ...b.keys()])];
  const out = [];
  for (const id of ids) {
    const was = b.get(id), mine = o.get(id), yours = t.get(id);
    let keep;
    if (equal(mine, yours) || equal(was, yours)) keep = mine;
    else if (equal(was, mine)) keep = yours;
    else return null;
    if (keep) out.push(keep);
  }
  return out;
}

export function commentEntries(blocks, comments) {
  return [
    ...comments.map((comment, index) => ({ comment, index, block: null, time: comment.time })),
    ...blocks.flatMap((block) => (block.comments || []).map((comment, index) => ({ comment, index, block, time: block.start }))),
  ].sort((a, b) => a.time - b.time || a.comment.created.localeCompare(b.comment.created));
}
