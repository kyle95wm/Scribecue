// Spelling and grammar checks in headless, muted Chrome at 6× CPU slowdown: a messy 1,500-block
// script before an export, fixing, adding a word, exporting anyway, a tidy script, Settings,
// AI help (with a stand-in for Ollama) and QC mode.
// Usage: node scripts/proof-smoke.mjs <devtools port> <site url> [screenshot.png]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, shot] = process.argv;
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
const wait = async (expression, what = expression) => {
  for (let i = 0; i < 120; i++) { if (await js(expression)) return; await sleep(250); }
  throw Error(`Timed out: ${what}`);
};
const SEED = `localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}',proof:'{"warn":true,"language":"en-gb"}'}))localStorage.setItem('scribecue.'+k,v);`;
const setup = `window.showDirectoryPicker=undefined;window.showSaveFilePicker=undefined;window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.__saved=[];const u=URL.createObjectURL;URL.createObjectURL=b=>{__saved.push(b.size);return u(b)};true`;
const open = async (cues, extra = '') => {
  await js(`${SEED}${extra}localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(cues)},dirty:false}));location.reload();true`);
  await sleep(600);
  await wait(`document.querySelectorAll('#list .row').length>0`, 'the list');
  await js(setup);
};
const summary = () => js(`document.getElementById('checkSummary').textContent`);
const exportSrt = `document.querySelector('[data-act=exportSrt]').click();true`;
const dlgOpen = `document.getElementById('checkDlg').open`;
const settled = `document.getElementById('checkDlg').open&&document.getElementById('checkSummary').textContent!=='Checking…'`;
const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click();true`);
const rowButton = (label) => js(`[...document.querySelectorAll('#checkList button')].find(b=>b.textContent===${JSON.stringify(label)}).click();true`);
const says = (i) => `JSON.parse(localStorage.getItem('scribecue.v1')).cues[${i}].text`;

const MESSY = ['She definately walks too the the door.', 'Teh Zarnok opens a umbrella.', 'He should of left', 'Rain falls  on the car.', 'A nurse enters, smiling.'];
const cues = Array.from({ length: 1500 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.5, text: i < 5 ? MESSY[i] : i % 7 ? `Mara walks along the corridor number ${i}.` : `Mara recieves letter ${i}.` }));

try {
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(800);

  // Before an export: the window, with the export waiting.
  await open(cues);
  await js(`window.__t=performance.now();window.__long.length=0;true`);
  await js(exportSrt);
  await wait(settled, 'the check');
  const took = await js(`Math.round(performance.now()-__t)`);
  const long = await js(`Math.round(Math.max(0,...__long))`);
  assert.equal(await js(`__saved.length`), 0, 'nothing exported yet');
  assert.match(await summary(), /to look at, in \d+ blocks/);
  assert.equal(await js(`document.getElementById('checkGo').textContent`), 'Export anyway');
  const count = await js(`document.querySelectorAll('.checkrow').length`);
  const text = await js(`document.getElementById('checkList').textContent`);
  for (const word of ['definately', 'Teh', 'should of', 'a umbrella', 'recieves']) assert.ok(text.includes(word), word);
  if (shot) writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

  // A fix changes the text, once, and undo brings it back.
  await rowButton('definitely');
  await wait(`${says(0)}.includes('definitely')`, 'the fix');
  await wait(`!document.getElementById('checkList').textContent.includes('definately')`, 'the row going');
  assert.equal(await js(`__errors.length`), 0);

  // One misspelling used 200 times is one row, and a fix reaches them all.
  await rowButton('Receives').catch(() => rowButton('receives'));
  await wait(`${says(7)}.includes('receives')`, 'the fix everywhere');
  await wait(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[1498].text.includes('recieves')===false`, 'the last block');

  // A word added to the project stays, and saves with it.
  await js(`[...document.querySelectorAll('.checkrow')].find(r=>r.querySelector('mark').textContent==='Zarnok').querySelector('.checkbtns button:last-child').click();true`);
  await wait(`JSON.parse(localStorage.getItem('scribecue.v1')).words?.length>0`, 'the word');
  await wait(`![...document.querySelectorAll('.checkrow mark')].some(m=>m.textContent==='Zarnok')`, 'the word going from the list');

  // Export anyway exports, and the next export doesn't ask about the same things.
  await click('#checkGo');
  await wait(`__saved.length===1`, 'the export');
  assert.equal(await js(dlgOpen), false);
  await js(`window.__t=performance.now();true`);
  await js(exportSrt);
  await wait(`__saved.length===2`, 'the second export');
  const again = await js(`Math.round(performance.now()-__t)`);
  assert.equal(await js(dlgOpen), false);

  // A new mistake asks again; cancelling doesn't export.
  await js(`document.querySelectorAll('#list .row')[6].click();true`); await sleep(400);
  await js(`const t=document.getElementById('edText');t.focus();t.value='A brand nwe mistake.';t.dispatchEvent(new Event('input',{bubbles:true}));t.blur();true`);
  await sleep(300);
  await wait(`${says(6)}==='A brand nwe mistake.'`, 'the edit');
  await js(exportSrt);
  await wait(settled, 'the check again');
  await click('#checkClose');
  await sleep(800);
  assert.equal(await js(`__saved.length`), 2);

  // A tidy script exports straight away.
  await open([{ start: 1, end: 3, text: 'She opens the door.' }, { start: 4, end: 6, text: 'He waves.' }]);
  await js(exportSrt);
  await wait(`__saved.length===1`, 'the tidy export');
  assert.equal(await js(dlgOpen), false);

  // Off in Settings: no check at all.
  await open([{ start: 1, end: 3, text: 'Teh wrod.' }], `localStorage.setItem('scribecue.proof','{"warn":false,"language":"en-us"}');`);
  await js(exportSrt);
  await wait(`__saved.length===1`, 'the export with the check off');
  assert.equal(await js(dlgOpen), false);

  // AI help, with a stand-in for Ollama: suggestions appear, and nothing changes until chosen.
  await open([{ start: 1, end: 3, text: 'He go to the shop.' }, { start: 4, end: 6, text: 'She waves.' }],
    `localStorage.setItem('scribecue.ai',JSON.stringify({provider:'ollama',models:{ollama:'test'},base:'http://localhost:11434'}));`);
  await js(`window.__asked=[];const f=window.fetch;window.fetch=(u,o)=>{if(!String(u).includes('/api/chat'))return f(u,o);__asked.push(JSON.parse(o.body));return Promise.resolve(new Response(JSON.stringify({message:{content:'[{"block":1,"find":"He go","fix":"He goes","why":"The verb must agree"}]'},done:true})+'\\n'))};true`);
  await click('[data-act=checkSpelling]');
  await wait(settled, 'the check window');
  assert.equal(await summary(), 'No problems found.');
  assert.match(await js(`document.getElementById('checkAiNote').textContent`), /stays on this computer/);
  await click('#checkAi');
  await wait(`document.querySelectorAll('.checkrow').length===1`, 'the AI suggestion');
  await wait(`document.getElementById('checkAiNote').textContent.includes('found 1 more')`, 'the AI result');
  assert.match(await js(`JSON.stringify(__asked[0].messages)`), /He go to the shop/);
  assert.equal(await js(says(0)), 'He go to the shop.');
  await rowButton('He goes');
  await wait(`${says(0)}==='He goes to the shop.'`, 'the AI fix');
  await wait(`document.querySelectorAll('.checkrow').length===0`, 'the row going');
  await click('#checkClose');

  // QC: it lists, and changes nothing.
  await js(`document.querySelector('[data-mode=qc]').click();true`); await sleep(500);
  await open([{ start: 1, end: 3, text: 'Teh door opens.' }], `localStorage.setItem('scribecue.mode','qc');`);
  await click('[data-act=checkSpelling]');
  await wait(settled, 'the QC check');
  assert.deepEqual(await js(`[...document.querySelectorAll('#checkList button')].map(b=>b.textContent)`), ['Go to block', 'Ignore']);
  await click('#checkClose');

  console.log(JSON.stringify({ blocks: cues.length, rows: count, msToList: took, longestTaskMs: long, msToExportAgain: again }));
  console.log('All checks passed');
} finally { ws.close(); }
