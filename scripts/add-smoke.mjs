// File → Add a script… in headless, muted Chrome at 6× CPU slowdown: a project with a long
// script, then an SRT episode and a Scribecue project episode added after it. Checks the
// starts offered, a start that isn't a time, the added blocks ticked, their bookmarks,
// comments and words, and that undo takes it all back. Says how long each took and how many
// long tasks there were.
// Usage: node scripts/add-smoke.mjs <devtools port> <site url> [blocks]
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toSRT } from '../app/js/formats.js';
import { toProject } from '../app/js/project.js';

const [,, port, site, blocks = '1000'] = process.argv;
const N = +blocks, EP = 500;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails));
  return m.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two episodes, each 2000 s long, with blocks from 10 s in.
const dir = mkdtempSync(join(tmpdir(), 'scribecue-add-'));
const ep = (k) => Array.from({ length: EP }, (_, i) => ({ start: 10 + i * 4, end: 12 + i * 4, text: `Episode ${k}, block ${i + 1}.` }));
const srt = join(dir, 'Show S01E02.srt'), proj = join(dir, 'Show S01E03.scribecue');
writeFileSync(srt, toSRT(ep(2)));
writeFileSync(proj, JSON.stringify(toProject({
  blocks: ep(3).map((b, i) => (i === 0 ? { ...b, comments: [{ text: 'Check this', author: 'A', created: '2026-01-01' }] } : b)),
  bookmarks: [{ time: 5, title: 'Opening titles', notes: '', kind: 'scene' }],
  comments: [{ text: 'Loud here', author: 'B', created: '2026-01-02', time: 30 }],
  words: ['Zorblax'],
  recording: { id: 'abcdef0123456789', version: 2 },
  settings: { ttsVoice: 'piper:other', ttsBase: 1.2 },
})));

await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: site }); await sleep(800);
const cues = Array.from({ length: N }, (_, i) => ({ id: i + 1, start: i * 4, end: i * 4 + 2.5, text: `Mara walks to the door, block ${i + 1}.` }));
await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',tts:'{"on":true}',loops:'{"write":true,"transcribe":true}',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(cues)},dirty:false}));true`);
await send('Page.reload', { ignoreCache: true }); await sleep(8000);
await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())__long.push(Math.round(e.duration))}).observe({type:'longtask'});true`);
assert.equal(await js(`document.querySelectorAll('#list .row').length`), N, 'every block has a row');
const last = (N - 1) * 4 + 2.5;

const results = [];
async function step(name, action, check) {
  await js('__long.length=0;true');
  const t0 = Date.now();
  await action();
  await js('new Promise(r=>requestAnimationFrame(()=>setTimeout(r)))');
  const ms = Date.now() - t0;
  await sleep(600);
  const long = await js('__long.slice()');
  if (check) assert.ok(await js(check), `${name}: ${check}`);
  results.push({ step: name, ms, longTasks: long.length, longest: long.length ? Math.max(...long) : 0 });
}
const $ = (el) => `document.getElementById('${el}')`;
const run = (expr) => () => js(`{${expr}};true`);
const savedWords = `JSON.parse(localStorage.getItem('scribecue.v1')).words||[]`;
const savedMarks = `(JSON.parse(localStorage.getItem('scribecue.v1')).bookmarks||[]).length`;

// The key opens the file chooser; in headless Chrome the files are set on it straight away.
await send('Page.enable');
await send('Page.setInterceptFileChooserDialog', { enabled: true });
const chooser = new Promise((r) => ws.addEventListener('message', (e) => { if (JSON.parse(e.data).method === 'Page.fileChooserOpened') r(true); }));
await js('document.activeElement?.blur();true');
for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: 9, key: 'M', code: 'KeyM', windowsVirtualKeyCode: 77 });
assert.ok(await Promise.race([chooser, sleep(3000).then(() => false)]), 'Alt+Shift+M opens the file chooser');
await send('Page.setInterceptFileChooserDialog', { enabled: false });

const { root } = await send('DOM.getDocument').then((m) => m.result);
const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileAdd' })).result;
await step('Choose two episodes', () => send('DOM.setFileInputFiles', { nodeId, files: [srt, proj] }),
  `${$('addDlg')}.open && document.querySelectorAll('#addList li').length===2`);
const starts = await js(`[...document.querySelectorAll('#addList input')].map(i=>i.value)`);
assert.equal(starts[0], await js(`'${fmt(last)}'`), 'the first starts after the last block');
assert.equal(starts[1], fmt(last + 2 + (EP - 1) * 4 + 10), 'the second starts after the first');
assert.match(await js(`${$('addLeft')}.textContent`), /Recordings and takes/);
await step('A start that isn’t a time', run(`const i=document.querySelector('#addList input');i.value='soon';i.dispatchEvent(new Event('input'))`),
  `${$('addGo')}.disabled && document.querySelector('#addList .addnote').textContent.includes('Type a time')`);
await step('Start at 01:10:00:00', run(`const i=document.querySelector('#addList input');i.value='01:10:00:00';i.dispatchEvent(new Event('input'))`), `!${$('addGo')}.disabled`);
await step('Second after the first', run(`document.querySelectorAll('#addList li')[1].querySelectorAll('button')[1].click()`),
  `document.querySelectorAll('#addList input')[1].value==='${fmt(4200 + 2 + (EP - 1) * 4 + 10)}'`);
await step(`Add ${EP * 2} blocks`, run(`${$('addGo')}.click()`),
  `!${$('addDlg')}.open && document.querySelectorAll('#list .row').length===${N + EP * 2} && ${$('bulkCount')}.textContent==='${EP * 2} ticked'`);
assert.ok((await js(savedWords)).includes('Zorblax'), 'the project’s words come too');
assert.equal(await js(savedMarks), 3, 'a bookmark where each starts, and the project’s own');
const said = await js(`document.getElementById('toast').textContent`);
console.log('Toast:', said);
assert.match(said, /Added 1000 blocks from 2 scripts/);
await step('Delete the ticked', run(`${$('bulkDel')}.click();${$('bulkDelGo')}.click()`), `document.querySelectorAll('#list .row').length===${N}`);
const undo = `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,ctrlKey:true,bubbles:true}))`;
await step('Undo the delete', run(undo), `document.querySelectorAll('#list .row').length===${N + EP * 2}`);
await step('Undo the add', run(undo), `document.querySelectorAll('#list .row').length===${N}`);
await sleep(600);
assert.ok(!(await js(savedWords)).includes('Zorblax'), 'undo takes the words back');
assert.equal(await js(savedMarks), 0, 'undo takes the bookmarks back');
const redo = `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,ctrlKey:true,shiftKey:true,bubbles:true}))`;
await step('Redo the add', run(redo), `document.querySelectorAll('#list .row').length===${N + EP * 2}`);
await sleep(600);
assert.ok((await js(savedWords)).includes('Zorblax'), 'redo brings the words back');

console.table(results);
const errors = await js('__errors');
assert.deepEqual(errors, [], 'no errors on the page');
console.log('add smoke passed');
ws.close();

function fmt(t) {
  const n = Math.ceil(t * 25 - 1e-6), p = (x) => String(x).padStart(2, '0');
  return `${p(Math.floor(n / 90000))}:${p(Math.floor(n / 1500) % 60)}:${p(Math.floor(n / 25) % 60)}:${p(n % 25)}`;
}
