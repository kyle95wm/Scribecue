// What's new: after Scribecue updates, a window lists every release between the version
// someone was on and the one they have now. The notes travel with the app in
// changelog.json, written at each release (see INSTALL.md), so this works offline and
// never contacts anything.
import { newer } from './update.js';

const SEEN = 'scribecue.seenVersion';

// The releases after `from`, up to and including `to`, newest first. With no `from`
// (someone who used Scribecue before it remembered), just the release they're on.
export function entriesBetween(changelog, from, to) {
  return changelog
    .filter((e) => !newer(e.version, to) && (from ? newer(e.version, from) : e.version === to))
    .sort((a, b) => (newer(a.version, b.version) ? -1 : 1));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// **bold**, `code` and [links](https://…), in text that's already escaped.
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
// Release notes as HTML: headings, lists and paragraphs. Everything is escaped first, so
// nothing in the notes can become markup it doesn't spell out here.
export function renderNotes(md) {
  const out = [];
  let list = false, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const endList = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of md.split('\n')) {
    const line = esc(raw.trimEnd());
    const h = line.match(/^#{1,6}\s+(.*)/), li = line.match(/^\s*[-*]\s+(.*)/);
    if (h) { flush(); endList(); out.push(`<h4>${inline(h[1])}</h4>`); }
    else if (li) { flush(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (!line.trim()) { flush(); endList(); }
    else if (list && /^\s+/.test(raw)) out.push(`<li class="more">${inline(line.trim())}</li>`);
    else { endList(); para.push(line.trim()); }
  }
  flush(); endList();
  return out.join('');
}

const $ = (id) => document.getElementById(id);

async function changelog() {
  const r = await fetch('changelog.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`changelog ${r.status}`);
  return r.json();
}

function show(entries, from, to) {
  $('wnWhat').textContent = from && newer(to, from)
    ? `You've been updated from ${from} to ${to}.${entries.length > 1 ? ` Here's everything since then, newest first.` : ''}`
    : `Here's what's in Scribecue ${to}.`;
  $('wnList').innerHTML = entries.map((e) => `<section class="wnrelease"><h3>${esc(e.version)} <span class="dim small">${esc(e.date)}</span></h3>${renderNotes(e.notes)}</section>`).join('');
  const d = $('whatsNew');
  if (!d.open) d.showModal();
  $('wnClose').focus();
}

// Shows what's new for this version on demand, such as from the version number.
export async function openWhatsNew(version) {
  try { show(entriesBetween(await changelog(), null, version), null, version); } catch { /* offline with no copy */ }
}

// At start-up: after an update, list what changed since the version last seen. A first
// visit just remembers the version. wait(): whether something else is on screen first.
export async function initWhatsNew({ version, firstRun, busy = () => false }) {
  let seen = null;
  try { seen = localStorage.getItem(SEEN); localStorage.setItem(SEEN, version); } catch { return; }
  $('wnClose').addEventListener('click', () => $('whatsNew').close());
  $('whatsNew').addEventListener('click', (e) => { if (e.target === $('whatsNew')) $('whatsNew').close(); });
  document.addEventListener('keydown', (e) => { if ($('whatsNew').open) e.stopPropagation(); }, true);
  if (firstRun || seen === version || (seen && !newer(version, seen))) return;
  let entries;
  try { entries = entriesBetween(await changelog(), seen, version); } catch { return; }
  if (!entries.length) return;
  // After anything else that opens as Scribecue starts, such as a notice.
  for (let i = 0; i < 40 && busy(); i++) await new Promise((r) => setTimeout(r, 500));
  show(entries, seen, version);
}
