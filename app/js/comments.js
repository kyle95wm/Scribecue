// Comments go with writing and review. Transcribe and Record have other jobs.
export const commentsAllowed = (mode) => mode === 'write' || mode === 'qc';
// Comments stay with their block, or at a fixed time in the programme.
export function cleanComments(value, timed = false) {
  return (Array.isArray(value) ? value : []).filter((c) => c && typeof c.text === 'string' && c.text.trim() &&
    (!timed || (typeof c.time === 'number' && Number.isFinite(c.time) && c.time >= 0)))
    .map((c) => ({ text: c.text.trim(), author: typeof c.author === 'string' ? c.author.trim() : '',
      created: typeof c.created === 'string' ? c.created : '', resolved: c.resolved === true,
      ...(timed ? { time: c.time } : {}) }));
}

export function commentEntries(blocks, comments) {
  return [
    ...comments.map((comment, index) => ({ comment, index, block: null, time: comment.time })),
    ...blocks.flatMap((block) => (block.comments || []).map((comment, index) => ({ comment, index, block, time: block.start }))),
  ].sort((a, b) => a.time - b.time || a.comment.created.localeCompare(b.comment.created));
}
