// Pending review: the block changes in a returned QC review, in a tab beside the script.
// Choices are collected here; accepting the review applies them all at once, with the comments.
import { voiceLabel } from './tts.js';
const $ = (id) => document.getElementById(id);
let h, review = null, at = -1, tab = 'blocks', numbers = new Map(), drawing = 0;
const key = (c) => c.kind === 'project' ? `project:${c.field}` : `${c.kind}:${c.uid}`;

const fields = [['wording', ['text']], ['timing', ['start', 'end']], ['voice', ['voice']], ['speed', ['speed', 'auto', 'fit', 'pinned']],
  ['levels', ['vol', 'dip', 'dipBy']], ['pickup', ['pickup']], ['sounds like', ['say']]];
function changes(ours, theirs) {
  const differs = (k) => JSON.stringify(ours[k]) !== JSON.stringify(theirs[k]);
  const named = fields.filter(([, keys]) => keys.some(differs)).map(([name]) => name);
  const list = named.length ? named : ['settings'];
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
}
function what(item) {
  if (item.kind === 'project') return 'Timeline comments: both changed';
  if (item.kind === 'block-comments') return 'Comments: both changed';
  if (!item.ours) return 'Added';
  if (!item.theirs) return 'Removed';
  return `${item.conflict ? 'Both changed' : 'Changed'}: ${changes(item.ours, item.theirs)}`;
}
const comments = (value = []) => value.map((c) => `${c.time == null ? '' : h.time(c.time) + ' · '}${c.author || 'Comment'}: ${c.text}${c.resolved ? ' (resolved)' : ''}`).join('\n') || 'No comments.';
function describe(block) {
  return [block.text || '(Empty block)', block.voice && `Voice: ${voiceLabel(block.voice)}`,
    block.speed && `Speed: ${Math.round(block.speed * 100)}%`, block.auto && 'End follows reading', block.fit && 'Speed fits slot', block.pinned && 'Speed fixed',
    block.vol != null && `Volume: ${block.vol}%`, block.dip != null && `Programme dip: ${block.dip === 0 ? 'None' : '−' + block.dip + ' dB'}`,
    block.dipBy != null && `Dip adjustment: ${String(block.dipBy).replace('-', '−')} dB`, block.pickup && `Pickup: ${block.pickup.note || 'Marked'}`,
    block.say?.length && `Sounds like: ${block.say.map(([a, b]) => `${a} → ${b}`).join('; ')}`].filter(Boolean).join('\n');
}
const span = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
// One side of a change: its time and what it says, or that it isn't there.
function side(label, item, value, missing) {
  const d = document.createElement('div'); d.className = 'pside';
  const block = item.kind === 'block' ? value : item.block;
  d.append(span('pl', label), span('pt', block ? `${h.time(block.start)} – ${h.time(block.end)}` : ''));
  const tx = document.createElement('div'); tx.className = 'tx';
  tx.textContent = item.kind === 'block' ? value ? describe(value) : missing : comments(value);
  d.append(tx); return d;
}
const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 11.2 2.9 7.9 1.8 9l4.4 4.4L14.4 5.2l-1.1-1.1z"/></svg>';
const cross = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.1 3 3 4.1 6.9 8 3 11.9 4.1 13 8 9.1l3.9 3.9 1.1-1.1L9.1 8 13 4.1 11.9 3 8 6.9z"/></svg>';
function row(item, i) {
  const r = document.createElement('div'), block = item.theirs && item.kind === 'block' ? item.theirs : item.ours && item.kind === 'block' ? item.ours : item.block;
  r.className = 'row prow' + (i === at ? ' sel' : '') + (item.conflict ? ' conflict' : '');
  r.dataset.i = i; r.id = `pending-${i}`; r.setAttribute('role', 'option'); r.setAttribute('aria-selected', String(i === at));
  const rh = document.createElement('div'); rh.className = 'rh';
  const n = numbers.get(item.uid);
  rh.append(span('n', item.kind === 'project' ? '' : n ? '#' + n : 'new'), span('t', block ? h.time(block.start) : ''),
    span('d', ''));
  for (const [choiceOf, icon, label, tip] of [['remote', check, 'Accept this change', 'Accept: use the reviewer’s version'], ['local', cross, 'Reject this change', 'Reject: keep yours']]) {
    const b = document.createElement('button'); b.className = 'pick ' + choiceOf; b.innerHTML = icon; b.dataset.choice = choiceOf;
    b.setAttribute('aria-label', label); b.dataset.tip = tip;
    rh.append(b);
  }
  r.append(rh);
  if (i === at) {
    const pair = document.createElement('div'); pair.className = 'ppair';
    pair.append(side('Yours', item, item.ours, 'Not in your script.'), side('Returned', item, item.theirs, 'Removed by the reviewer.'));
    r.append(pair);
  } else {
    const tx = document.createElement('div'); tx.className = 'tx';
    tx.textContent = item.kind === 'block' ? (item.theirs || item.ours).text || '(Empty block)' : comments(item.theirs);
    r.append(tx);
  }
  mark(r, item);
  return r;
}
// The parts of a row that show its choice.
function mark(r, item) {
  const choice = review.choices.get(key(item));
  item.label ??= what(item);
  r.classList.toggle('decided', !!choice);
  r.querySelector('.d').textContent = item.label + (choice === 'remote' ? ' · accepted' : choice === 'local' ? ' · rejected' : '');
  for (const b of r.querySelectorAll('.pick')) b.setAttribute('aria-pressed', String(choice === b.dataset.choice));
}
const open = () => review ? review.items.filter((c) => !review.choices.has(key(c))).length : 0;
// Whole list on start; after that only the rows that change, so a long review stays quick.
// Rows are drawn a slice at a time, so a review of a whole film doesn't hold up the page.
function render() {
  const token = ++drawing, list = $('pendingList');
  if (review) {
    numbers = h.numbers(); list.replaceChildren();
    const slice = (from) => {
      if (token !== drawing || !review) return;
      list.append(...review.items.slice(from, from + 40).map((item, k) => row(item, from + k)));
      if (from + 40 < review.items.length) setTimeout(() => slice(from + 40));
    };
    slice(0);
  }
  summary();
}
function refresh(...rows) {
  numbers = h.numbers();
  for (const i of new Set(rows)) if (i >= 0 && review.items[i]) $(`pending-${i}`)?.replaceWith(row(review.items[i], i));
  summary();
}
function summary() {
  $('listTabs').hidden = !review;
  $('pendingCount').textContent = review ? String(open()) : '';
  document.querySelector('.listwrap').classList.toggle('pending-on', !!review && tab === 'pending');
  for (const [id, name] of [['tabBlocks', 'blocks'], ['tabPending', 'pending']]) {
    $(id).setAttribute('aria-selected', String(tab === name)); $(id).classList.toggle('on', tab === name);
  }
  if (!review) return;
  const list = $('pendingList'), left = open();
  if (at >= 0) list.setAttribute('aria-activedescendant', `pending-${at}`); else list.removeAttribute('aria-activedescendant');
  $('pendingStatus').textContent = left ? `${left} of ${review.items.length} to choose` : 'All chosen. Accept the review to apply them.';
  $('pendingRestOk').disabled = $('pendingRestNo').disabled = !left;
  $('pendingAccept').disabled = left > 0;
  $('pendingAccept').textContent = h.authoring() ? 'Accept review' : 'Save combined review';
}
function show(name) { tab = name; summary(); h.redraw(); }
function choose(i) {
  const was = at; at = i; refresh(was, i); h.focus(review.items[i]);
  $(`pending-${i}`)?.scrollIntoView({ block: 'nearest' });
}

export const pendingReview = () => !!review;
// What the timeline should outline: the reviewer's version of the chosen block.
export function pendingGhost() {
  const item = review && tab === 'pending' ? review.items[at] : null;
  return item?.kind === 'block' ? { uid: item.uid, theirs: item.theirs, removed: !item.theirs } : null;
}
export function startPending(file, items) { review = { file, items, choices: new Map() }; at = -1; render(); show('pending'); if (items.length) choose(0); }
export function addPending(items) {
  if (!review) return;
  const known = new Set(review.items.map(key));
  review.items = [...review.items.map((c) => known.has(key(c)) && items.some((n) => key(n) === key(c)) ? items.find((n) => key(n) === key(c)) : c),
    ...items.filter((c) => !known.has(key(c)))].sort((a, z) => a.start - z.start);
  for (const c of items) review.choices.delete(key(c));
  at = -1; render(); show('pending'); const first = review.items.findIndex((c) => !review.choices.has(key(c))); if (first >= 0) choose(first);
}
export function endPending() { if (!review) return; review = null; at = -1; tab = 'blocks'; $('pendingList').replaceChildren(); summary(); h.redraw(); }

export function initPending(hooks) {
  h = hooks;
  $('tabBlocks').onclick = () => show('blocks');
  $('tabPending').onclick = () => { show('pending'); if (at >= 0) h.focus(review.items[at]); };
  $('pendingList').addEventListener('click', (e) => {
    const r = e.target.closest('.prow'); if (!r || !review) return;
    const i = +r.dataset.i, pick = e.target.closest('.pick');
    if (!pick) { if (i !== at) choose(i); return; }
    const item = review.items[i], k = key(item);
    if (review.choices.get(k) === pick.dataset.choice) review.choices.delete(k); else review.choices.set(k, pick.dataset.choice);
    // Move on to the next open choice, so each one is a single press.
    const next = review.items.findIndex((c, j) => j > i && !review.choices.has(key(c)));
    if (review.choices.has(k) && next >= 0) { refresh(i); choose(next); } else { refresh(i); $(`pending-${i}`)?.querySelector(`.pick.${pick.dataset.choice}`)?.focus(); }
  });
  $('pendingList').addEventListener('keydown', (e) => {
    if (!review || e.target.closest('.pick') || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const i = Math.max(0, Math.min(review.items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
    if (i !== at) choose(i);
  });
  for (const [id, choice] of [['pendingRestOk', 'remote'], ['pendingRestNo', 'local']]) $(id).onclick = () => {
    if (!review) return;
    review.items.forEach((c, i) => {
      if (review.choices.has(key(c))) return;
      review.choices.set(key(c), choice);
      const r = $(`pending-${i}`); if (r) mark(r, c);
    });
    summary();
  };
  $('pendingAccept').onclick = () => {
    if (!review || open()) return;
    const decisions = review.items.map(({ kind, uid, field }) => ({ kind, ...(uid ? { uid } : {}), ...(field ? { field } : {}), choice: review.choices.get(key({ kind, uid, field })) }));
    h.finish(review.file, decisions);
  };
  $('pendingDiscard').onclick = () => {
    if (review && review.choices.size && !confirm('Close Pending review? Your choices are not kept. The returned review can be compared again.')) return;
    endPending(); h.toast('Pending review closed. Nothing was changed');
  };
}
