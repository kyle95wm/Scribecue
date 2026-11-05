// The Check spelling and grammar window, and the same check before an export. The rules are
// in proofing.js, and the dictionary runs in proofing-worker.js, so a long script doesn't
// hold up the page. Exporting is never blocked: this only says what looks wrong.
import {
  knownWords, mergeIssues, aiIssues, groupIssues, issueKey, applyFixes,
  aiBatches, aiCheckPrompt, aiCheckSystem, readAiCheck, defaultLanguage,
} from './proofing.js';
import { aiStatus, askAi } from './aidrawer.js';

const $ = (id) => document.getElementById(id);
const KEY = 'scribecue.proof', PAGE = 200, IDLE = 30000;
const SHOW_AFTER = 300; // ms: a quick check before an export shows no window at all
const STILL_ALLOWED = 3000; // ms: past this, the browser may refuse to open a save window
const opts = { warn: true, language: defaultLanguage(globalThis.navigator?.language) };
try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY))); } catch { /* ignore */ }
const saveOpts = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch { /* ignore */ } };

let h, dlg;
let worker = null, idle = null, job = 0;
let project = null, ignored = new Set(), accepted = new Set(), suggestions = [];
let issues = [], rows = [], shown = PAGE;
let pending = null; // the export waiting on this check
let showing = null; // the export the open window is for: closing it cancels only that one
let aiRun = null; // AbortController of the AI check under way

const withText = () => h.blocks().filter((b) => b.text.trim());

// What was ignored or accepted goes with the project.
function sameProject() {
  if (h.project() === project) return;
  project = h.project();
  ignored = new Set(); accepted = new Set(); suggestions = [];
}

function endWorker() { worker?.terminate(); worker = null; }
function runWorker(blocks, known, progress) {
  clearTimeout(idle);
  worker ||= new Worker(new URL('./proofing-worker.js', import.meta.url), { type: 'module' });
  const n = ++job;
  return new Promise((ok, no) => {
    worker.onmessage = ({ data }) => {
      if (data.job !== n) return;
      if (data.error) no(new Error(data.error));
      else if (data.issues) ok(data.issues);
      else progress(data.done, data.total);
    };
    worker.onerror = (e) => { endWorker(); no(new Error(e.message || 'the check didn’t start')); };
    worker.postMessage({ job: n, language: opts.language, known: [...known], blocks });
  }).finally(() => { idle = setTimeout(endWorker, IDLE); });
}

function showProgress(done, total) {
  const bar = $('checkBar');
  bar.hidden = false;
  bar.max = total || 1;
  bar.value = done;
}

// Checks the script as it is now, and updates what the window shows.
async function refresh() {
  sameProject();
  const blocks = withText();
  try {
    const found = await runWorker(blocks.map(({ id, text }) => ({ id, text })),
      knownWords({ words: h.words(), notes: h.notes(), blocks }), showProgress);
    issues = mergeIssues(blocks, aiIssues(suggestions, blocks), found).filter((i) => !ignored.has(issueKey(i)));
    rows = groupIssues(issues);
  } finally {
    $('checkBar').hidden = true;
  }
}

const noun = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function summary() {
  if (!rows.length) return pending ? 'No problems found. It’s ready to export.' : 'No problems found.';
  const count = new Set(issues.map((i) => i.block)).size;
  const edit = h.canEdit() ? '' : ' Text can’t be changed here: go to a block to comment on it.';
  return `${noun(rows.length, 'thing')} to look at, in ${noun(count, 'block')}.${edit}`;
}

// The words around an issue, with the issue marked.
function snippet(text, { start, end }) {
  const out = document.createElement('p');
  out.className = 'checktext';
  const from = Math.max(0, start - 50), to = Math.min(text.length, end + 50);
  const part = (a, z) => text.slice(a, z).replace(/\n/g, ' / ');
  const mark = document.createElement('mark');
  mark.textContent = part(start, end);
  out.append(`${from ? '…' : ''}${part(from, start)}`, mark, `${part(end, to)}${to < text.length ? '…' : ''}`);
  return out;
}

function button(label, click, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', click);
  return b;
}

function rowFor(row) {
  const blocks = h.blocks(), first = row.items[0];
  const i = blocks.findIndex((b) => b.id === first.block), block = blocks[i];
  const el = document.createElement('div');
  el.className = 'checkrow';
  const head = document.createElement('div');
  head.className = 'checkhead';
  const where = document.createElement('span');
  where.className = 'where';
  where.textContent = `#${i + 1} ${h.tc(block.start)}${row.items.length > 1 ? ` +${row.items.length - 1}` : ''}`;
  const why = document.createElement('span');
  why.className = 'dim';
  why.textContent = row.kind === 'ai' ? `AI help: ${row.why}` : row.why;
  head.append(where, why);
  const btns = document.createElement('div');
  btns.className = 'checkbtns';
  if (h.canEdit()) {
    for (const fix of row.fixes) btns.append(button(fix.trim() ? fix : 'Fix', () => applyRow(row, fix), 'fix'));
  }
  btns.append(button('Go to block', () => { dlg.close(); h.go(first.block); }), button('Ignore', () => ignore(row)));
  if (row.kind === 'spelling' && h.canEdit()) btns.append(button('Add to project', () => addWord(row)));
  el.append(head, snippet(block.text, first), btns);
  return el;
}

function render() {
  if (!dlg.open) return;
  const list = $('checkList'), top = list.scrollTop;
  const place = [...list.children].findIndex((r) => r.contains(document.activeElement));
  list.textContent = '';
  list.append(...rows.slice(0, shown).map(rowFor));
  list.scrollTop = top;
  $('checkSummary').textContent = summary();
  $('checkMore').hidden = rows.length <= shown;
  $('checkGo').hidden = !pending;
  $('checkGo').textContent = rows.length ? 'Export anyway' : 'Export';
  $('checkClose').textContent = pending ? 'Cancel' : 'Close';
  if (place >= 0) (list.children[Math.min(place, list.children.length - 1)]?.querySelector('button') || $('checkClose')).focus();
  renderAi();
}

function renderAi() {
  const s = aiStatus(), ai = $('checkAi'), note = $('checkAiNote');
  $('checkAiStop').hidden = !aiRun;
  if (aiRun) return;
  ai.disabled = s.offline;
  ai.textContent = s.ready ? 'Check grammar with AI' : 'Connect AI help';
  if (note.dataset.result) return;
  note.textContent = !s.ready ? 'AI help catches harder grammar mistakes.'
    : s.offline ? `You’re offline, so ${s.name} can’t be reached.`
      : s.local ? `The script stays on this computer, with ${s.name}.`
        : `Sends the script to ${s.name}. This may cost money.`;
}

async function again() {
  try { await refresh(); render(); }
  catch (e) { h.toast(`Couldn’t check the script: ${e.message}`); }
}

function applyRow(row, fix) {
  const texts = new Map(), blocks = h.blocks();
  for (const id of new Set(row.items.map((i) => i.block))) {
    const b = blocks.find((x) => x.id === id);
    const text = b && applyFixes(b.text, row.items.filter((i) => i.block === id), fix);
    if (text != null) texts.set(id, text);
  }
  if (texts.size) h.apply(texts);
  again();
}
function ignore(row) {
  for (const i of row.items) ignored.add(issueKey(i));
  issues = issues.filter((i) => !ignored.has(issueKey(i)));
  rows = groupIssues(issues);
  render();
}
function addWord(row) {
  h.addWord(row.found.replace(/['’]s$/, ''));
  again();
}

async function checkWithAi() {
  if (!aiStatus().ready) { dlg.close(); return h.openAiSettings(); }
  const batches = aiBatches(withText()), note = $('checkAiNote');
  const run = new AbortController();
  const before = rows.length;
  let unread = 0;
  aiRun = run;
  delete note.dataset.result;
  suggestions = [];
  $('checkAi').disabled = true;
  renderAi();
  try {
    for (const [i, batch] of batches.entries()) {
      note.textContent = `Part ${i + 1} of ${batches.length}…`;
      showProgress(i, batches.length);
      const reply = await askAi(aiCheckSystem(h.notes()), aiCheckPrompt(batch), run.signal);
      try { suggestions.push(...readAiCheck(reply, batch)); } catch { unread++; }
      await refresh();
      showProgress(i + 1, batches.length);
      render();
    }
    const more = rows.length - before;
    note.dataset.result = note.textContent = `${more > 0 ? `AI help found ${more} more` : 'AI help found nothing more'}.${unread ? ` It couldn’t read ${noun(unread, 'answer')}, so part of the script wasn’t checked.` : ''}`;
  } catch (e) {
    if (e.name !== 'AbortError') note.dataset.result = note.textContent = `AI help stopped: ${e.message}`;
    else note.dataset.result = note.textContent = 'Stopped.';
  } finally {
    aiRun = null;
    $('checkBar').hidden = true;
    if (dlg.open) render();
  }
}

function show() {
  shown = PAGE;
  showing = pending;
  delete $('checkAiNote').dataset.result;
  $('checkList').textContent = '';
  $('checkSummary').textContent = 'Checking…';
  $('checkMore').hidden = true;
  $('checkGo').hidden = true;
  $('checkClose').textContent = pending ? 'Cancel' : 'Close';
  renderAi();
  if (!dlg.open) dlg.showModal();
}

// The check on its own, from the Export menu or its key.
export async function openCheck() {
  if (h.locked()) return h.toast('The script is locked in Record mode');
  if (!withText().length) return h.toast('Nothing to check yet');
  pending = null;
  show();
  try { await refresh(); render(); }
  catch (e) { $('checkSummary').textContent = `Couldn’t check the script: ${e.message}`; }
}

// Runs an export, once the check has found nothing new or the person chooses to go ahead.
// A check that can't run never stops the export.
export async function checkFirst(run) {
  if (pending) return;
  if (!opts.warn || h.locked() || dlg.open || !withText().length) return run();
  pending = run;
  const started = performance.now();
  const waiting = setTimeout(show, SHOW_AFTER);
  const go = () => { pending = showing = null; if (dlg.open) dlg.close(); run(); };
  try { await refresh(); }
  catch (e) { clearTimeout(waiting); h.toast(`Couldn’t check the script: ${e.message}`); return go(); }
  clearTimeout(waiting);
  if (pending !== run) return; // cancelled while checking
  const fresh = issues.some((i) => !accepted.has(issueKey(i)));
  if (!fresh && performance.now() - started < STILL_ALLOWED) return go();
  show();
  render();
}

export function initCheck(hooks) {
  h = hooks;
  dlg = $('checkDlg');
  $('checkClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { if (showing && pending === showing) pending = null; showing = null; aiRun?.abort(); });
  $('checkMore').addEventListener('click', () => { shown += PAGE; render(); });
  $('checkAi').addEventListener('click', checkWithAi);
  $('checkAiStop').addEventListener('click', () => aiRun?.abort());
  $('checkGo').addEventListener('click', () => {
    const run = pending;
    for (const i of issues) accepted.add(issueKey(i));
    pending = showing = null;
    dlg.close();
    run?.();
  });
  document.addEventListener('keydown', (e) => { if (dlg.open) e.stopPropagation(); }, true);
  const warn = $('setCheckWarn'), lang = $('setCheckLang');
  warn.setAttribute('aria-pressed', String(opts.warn));
  lang.value = opts.language;
  warn.addEventListener('click', () => {
    opts.warn = !opts.warn;
    warn.setAttribute('aria-pressed', String(opts.warn));
    saveOpts();
  });
  lang.addEventListener('change', () => { opts.language = lang.value; saveOpts(); });
}
