import { commentEntries, newCommentId } from './comments.js';
import { savedName, saveName } from './profile.js';
const $ = (id) => document.getElementById(id);
let hooks, timeline = false, page = 0, showResolved = false;
const PAGE_SIZE = 50;
const button = (label, action) => {
  const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', action); return b;
};
function showComments() {
  $('commentsDrawer').hidden = false;
  $('commentsBtn').setAttribute('aria-pressed', 'true');
  hooks.closeAi();
  page = 0; refreshComments(); $('commentText').focus();
}
// The header and shortcut start a comment at the playhead; right-click supplies a time.
export function toggleComments(open = $('commentsDrawer').hidden, time = null) {
  if (open && !hooks.canComment()) return hooks.toast('Comments are available in Write and QC. Switch modes at the top');
  if (!open) {
    $('commentsDrawer').hidden = true;
    $('commentsBtn').setAttribute('aria-pressed', 'false');
    document.activeElement?.blur();
    return;
  }
  timeline = true;
  $('commentAt').value = hooks.tc(time ?? hooks.now());
  showComments();
}
// The editor button always targets its block, including after a timeline comment.
export function openBlockComments() {
  if (!hooks.canComment() || !hooks.selected()) return;
  timeline = false;
  showComments();
}
export function refreshComments() {
  if (!hooks || $('commentsDrawer').hidden) return;
  const block = hooks.selected();
  $('commentTimeLabel').hidden = !timeline;
  $('commentTarget').textContent = timeline ? 'Comment at a fixed time' : block ? `Comment on block #${hooks.blocks().indexOf(block) + 1} · ${hooks.tc(block.start)}` : 'Click Comment in an open block';
  $('commentPost').disabled = !timeline && !block;
  const entries = commentEntries(hooks.blocks(), hooks.comments()).filter((e) => showResolved || !e.comment.resolved);
  page = Math.min(page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
  $('commentsPage').textContent = `${entries.length} comment${entries.length === 1 ? '' : 's'} · ${page + 1}/${Math.max(1, Math.ceil(entries.length / PAGE_SIZE))}`;
  $('commentsPrev').disabled = page === 0; $('commentsNext').disabled = (page + 1) * PAGE_SIZE >= entries.length;
  const log = $('commentsLog'); log.replaceChildren();
  if (!entries.length) { const p = document.createElement('p'); p.className = 'dim small'; p.textContent = showResolved ? 'No comments yet.' : 'No open comments.'; log.append(p); }
  for (const e of entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const { comment: c, block } = e;
    const row = document.createElement('article'); row.className = 'aimsg assistant';
    const location = button(`${block ? `Block #${hooks.blocks().indexOf(block) + 1} · ` : ''}${hooks.tc(e.time)}`, () => hooks.go(e));
    location.className = 'comment-location';
    const meta = document.createElement('div'); meta.className = 'comment-meta';
    const date = new Date(c.created); meta.textContent = `${c.author || 'No name'}${Number.isNaN(date.getTime()) ? '' : ' · ' + date.toLocaleString()}${c.resolved ? ' · Resolved' : ''}`;
    const body = document.createElement('p'); body.className = 'comment-body'; body.textContent = c.text;
    const acts = document.createElement('div'); acts.className = 'acts';
    acts.append(button(c.resolved ? 'Reopen' : 'Resolve', () => hooks.change(() => { c.resolved = !c.resolved; })),
      button('Edit', () => {
        const input = document.createElement('textarea'); input.value = c.text; input.rows = 3; input.setAttribute('aria-label', 'Edit comment');
        body.replaceWith(input); acts.replaceChildren(button('Save', () => {
          if (!input.value.trim()) return input.focus();
          hooks.change(() => { c.text = input.value.trim(); });
        }), button('Cancel', refreshComments)); input.focus();
      }), button('Delete', () => hooks.change(() => { (block ? block.comments : hooks.comments()).splice(e.index, 1); })));
    row.append(location, meta, body, acts); log.append(row);
  }
}
// The saved name fills the comment field. A name typed there is for this session only.
export function showName(status = '') {
  const name = savedName();
  $('setName').value = name; $('commentAuthor').value = name;
  $('setNameForget').hidden = !name; $('setNameStatus').textContent = status;
}
export function initComments(h) {
  hooks = h;
  showName();
  $('setName').addEventListener('change', (e) => showName(saveName(e.target.value) ? 'Saved.' : 'Forgotten.'));
  $('setNameForget').addEventListener('click', () => { saveName(''); showName('Forgotten.'); });
  $('commentsClose').onclick = () => toggleComments(false);
  $('commentsResolved').onclick = () => { showResolved = !showResolved; page = 0; $('commentsResolved').setAttribute('aria-pressed', String(showResolved)); refreshComments(); };
  $('commentsPrev').onclick = () => { page--; refreshComments(); };
  $('commentsNext').onclick = () => { page++; refreshComments(); };
  $('commentPost').onclick = () => {
    if (!hooks.canComment()) return;
    const text = $('commentText').value.trim(), author = $('commentAuthor').value.trim(), block = hooks.selected();
    if (!text) { $('commentStatus').textContent = 'Write a comment first'; return $('commentText').focus(); }
    const time = timeline ? hooks.readTime($('commentAt').value.trim()) : null;
    if (timeline && (!Number.isFinite(time) || time < 0 || time > hooks.duration())) { $('commentStatus').textContent = 'Enter a time within the timeline'; return $('commentAt').focus(); }
    if (!timeline && !block) return;
    hooks.change(() => {
      const comments = timeline ? hooks.comments() : (block.comments ||= []);
      comments.push({ id: newCommentId(), text, author, created: new Date().toISOString(), resolved: false, ...(timeline ? { time } : {}) });
    });
    $('commentText').value = ''; $('commentStatus').textContent = 'Comment posted'; $('commentText').focus();
  };
  $('commentsDrawer').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || ['s', 'o', 'e'].includes(e.key.toLowerCase()))) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); toggleComments(false); }
  });
}
