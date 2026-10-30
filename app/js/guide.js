// The guides (README, TRANSCRIBING, AI and INSTALL) inside Scribecue, so they open
// without a connection. The build copies them next to the app, under guides/, with their
// screenshots, and the offline copy keeps them. Links to them on GitHub open here instead,
// when they're available; otherwise they open on GitHub as before.

export const GUIDES = { 'README.md': 'Scribecue', 'TRANSCRIBING.md': 'Transcribing', 'AI.md': 'AI help', 'GOOGLE-VOICES.md': 'Google voices', 'INSTALL.md': 'Running Scribecue yourself' };
export const REPO = 'https://github.com/kyle95wm/Scribecue/blob/main/';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A heading's anchor, as GitHub makes it: lower case, punctuation dropped, spaces to -.
export const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\- _]/gu, '').replace(/ /g, '-');

// Only links that can't run anything: the web, mail, anchors and paths.
const safeHref = (h) => (/^(https?:|mailto:|#)/i.test(h) || !/^[a-z][a-z0-9+.-]*:/i.test(h) ? h : '');

// Inline Markdown in raw text: `code`, ![images](src), [links](href), <https://autolinks>,
// **bold** and *italic*. Everything is escaped first.
export function inline(raw) {
  const codes = [];
  let s = raw.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => (safeHref(src) ? `<img src="${src}" alt="${alt}" loading="lazy">` : alt))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => (safeHref(h) ? `<a href="${h}">${t}</a>` : t))
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const FENCE = /^\s*```/;
const indent = (l) => l.match(/^ */)[0].length;
const dedent = (lines, n) => lines.map((l) => l.slice(Math.min(n, indent(l))));

// Markdown blocks as HTML: headings, paragraphs, lists (nested, with anything inside),
// tables, code blocks, quotes, rules, and <details> from the README.
export function renderMarkdown(md) {
  return blocks(md.replace(/\r/g, '').split('\n'));
}

function blocks(lines) {
  const out = [];
  let i = 0;
  const startsBlock = (l) => !l.trim() || FENCE.test(l) || /^#{1,6}\s/.test(l) || LIST.test(l) || /^\s*\|/.test(l) || /^\s*>/.test(l) || /^\s*<\/?(details|summary)/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (FENCE.test(l)) {
      const pad = indent(l), code = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i].slice(Math.min(pad, indent(lines[i]))));
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      const n = Math.min(m[1].length + 1, 6); // the guide's own title is the window's
      out.push(`<h${n} id="${esc(slug(m[2]))}">${inline(m[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(l) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if ((m = l.match(/^\s*<summary>(.*)<\/summary>\s*$/))) { out.push(`<summary>${inline(m[1].replace(/<\/?strong>/g, '**'))}</summary>`); i++; continue; }
    if (/^\s*<details\b[^>]*>\s*$/.test(l)) { out.push(/\bopen\b/.test(l) ? '<details open>' : '<details>'); i++; continue; }
    if (/^\s*<\/details>\s*$/.test(l)) { out.push('</details>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const q = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${blocks(q)}</blockquote>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if ((m = l.match(LIST))) {
      const base = m[1].length, ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length) {
        // blank lines between items keep the list going
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j > i && LIST.test(lines[j] || '') && lines[j].match(LIST)[1].length === base) i = j;
        const im = lines[i].match(LIST);
        if (!im || im[1].length !== base || /\d/.test(im[2]) !== ordered) break;
        const width = im[1].length + im[2].length + 1, body = [im[3]];
        for (i++; i < lines.length; i++) {
          const n = lines[i];
          if (!n.trim()) {
            // a blank line belongs to the item only if more of it follows, indented
            const next = lines.slice(i + 1).find((x) => x.trim());
            if (next !== undefined && indent(next) > base) { body.push(''); continue; }
            break;
          }
          const nm = n.match(LIST);
          if (nm && nm[1].length <= base) break;
          if (indent(n) <= base && !nm) {
            if (startsBlock(n)) break;
            body.push(n.trim()); // a lazy continuation of the item's text
            continue;
          }
          body.push(n);
        }
        let html = blocks(dedent(body, width));
        const only = html.match(/^<p>([\s\S]*)<\/p>$/);
        if (only && !only[1].includes('<p>')) html = only[1];
        items.push(`<li>${html}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para = [];
    for (; i < lines.length && !startsBlock(lines[i]); i++) para.push(lines[i].trim());
    if (!para.length) { para.push(l.trim()); i++; } // a line that starts nothing we know
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('');
}

// Which guide and anchor a link points to, if it's one of the guides: on GitHub, or
// relative from another guide. null otherwise.
export function guideLink(href) {
  const m = String(href).replace(REPO, '').match(/^(?:\.\/)?([A-Z][A-Z-]*\.md)(#[^\s]*)?$/);
  return m && GUIDES[m[1]] ? { file: m[1], hash: m[2] ? decodeURIComponent(m[2].slice(1)) : '' } : null;
}

// ---------------------------------------------------------------- the window

const $ = (id) => document.getElementById(id);
let base = 'guides/', current = null;
const back = []; // where Back goes: { file, top }
const cache = new Map();

async function fetchGuide(file) {
  if (!cache.has(file)) {
    cache.set(file, fetch(base + file).then((r) => {
      // A missing guide can come back as the app's own page, from servers that send it for
      // every path they don't have.
      if (!r.ok || /html/.test(r.headers.get('content-type') || '')) throw new Error(r.status);
      return r.text();
    }));
    cache.get(file).catch(() => cache.delete(file));
  }
  return cache.get(file);
}

// Whether the guides came with this copy of Scribecue.
export async function guidesHere() {
  try { await fetchGuide('README.md'); return true; } catch { return false; }
}

export async function openGuide(file = 'README.md', hash = '', { remember = true } = {}) {
  let md;
  try { md = await fetchGuide(file); } catch { window.open(REPO + file + (hash ? `#${hash}` : ''), '_blank', 'noopener,noreferrer'); return; }
  const d = $('guideDlg'), body = $('guideBody');
  if (remember && current && d.open) back.push({ file: current, top: body.scrollTop });
  current = file;
  $('guideTitle').textContent = GUIDES[file];
  $('guideBack').hidden = !back.length;
  $('guideWeb').href = REPO + file;
  for (const b of document.querySelectorAll('#guideTabs button')) b.classList.toggle('on', b.dataset.file === file);
  body.innerHTML = renderMarkdown(md.replace(/^# .*\n/, '')); // the title is the window's
  for (const img of body.querySelectorAll('img')) if (!/^https?:/.test(img.getAttribute('src'))) img.src = base + img.getAttribute('src');
  if (!d.open) d.showModal();
  const target = hash && body.querySelector(`#${CSS.escape(hash)}`);
  body.scrollTop = target ? target.offsetTop - body.offsetTop - 8 : 0;
}

export function initGuides({ path = 'guides/' } = {}) {
  base = path;
  const d = $('guideDlg'), body = $('guideBody');
  $('guideTabs').replaceChildren(...Object.entries(GUIDES).map(([file, name]) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.file = file;
    b.addEventListener('click', () => openGuide(file));
    return b;
  }));
  $('guideClose').addEventListener('click', () => d.close());
  $('guideBack').addEventListener('click', async () => {
    const prev = back.pop();
    if (!prev) return;
    await openGuide(prev.file, '', { remember: false });
    body.scrollTop = prev.top;
  });
  d.addEventListener('close', () => { back.length = 0; });
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true);
  // Links inside a guide: other guides and anchors stay here; anything else opens outside.
  body.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      const t = body.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`);
      if (t) body.scrollTop = t.offsetTop - body.offsetTop - 8;
      return;
    }
    const g = guideLink(href);
    if (g) return openGuide(g.file, g.hash);
    window.open(/^https?:|^mailto:/.test(href) ? href : REPO + href.replace(/^\.\//, ''), '_blank', 'noopener,noreferrer');
  });
  // Links to the guides on GitHub, anywhere in Scribecue, open here when the guides are.
  // Whether they are is known before any click, since a link can only be stopped at once.
  let here = false;
  guidesHere().then((ok) => { here = ok; });
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || body.contains(a) || !here) return;
    const g = guideLink(a.href);
    if (!g) return;
    e.preventDefault();
    openGuide(g.file, g.hash);
  }, true);
}
