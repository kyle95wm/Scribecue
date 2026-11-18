// Ticking blocks in headless, muted Chrome at 6× CPU slowdown, with a long script: Select,
// Shift+click, All, Move…, Replace… in the ticked blocks, Extended, Delete… and undo. Says
// how long each took and how many long tasks there were.
// Usage: node scripts/bulk-smoke.mjs <devtools port> <site url> [blocks]
import assert from 'node:assert/strict';
const [,, port, site, blocks = '1500'] = process.argv;
const N = +blocks;
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

const results = [];
async function step(name, action, check) {
  await js('__long.length=0;true');
  const t = await js(`(async()=>{const t0=performance.now();${action};await new Promise(r=>requestAnimationFrame(()=>setTimeout(r)));return Math.round(performance.now()-t0)})()`);
  await sleep(600);
  const long = await js('__long.slice()');
  if (check) assert.ok(await js(check), `${name}: ${check}`);
  results.push({ step: name, ms: t, longTasks: long.length, longest: long.length ? Math.max(...long) : 0 });
}
const $ = (el) => `document.getElementById('${el}')`;
const row = (k) => `document.querySelectorAll('#list .row')[${k}]`;
const click = (sel, opts = '') => `${sel}.dispatchEvent(new MouseEvent('click',{bubbles:true${opts}}))`;

await step('Select', `${$('selectBtn')}.click()`, `!${$('bulkBar')}.hidden`);
await step('Tick one', click(row(10)), `${$('bulkCount')}.textContent==='1 ticked'`);
await step('Shift+click 500 blocks', click(row(509), ',shiftKey:true'), `${$('bulkCount')}.textContent==='500 ticked'`);
await step('All', `${$('bulkAll')}.click()`, `${$('bulkCount')}.textContent==='${N} ticked'`);
await step('None', `${$('bulkNone')}.click()`, `${$('bulkCount')}.textContent==='None ticked'`);
await step('Tick 500 again', `${click(row(100))};${click(row(599), ',shiftKey:true')}`, `${$('bulkCount')}.textContent==='500 ticked'`);
await step('Move 500 later', `${$('bulkMove')}.click();${$('bulkMoveBy')}.value='1';${$('bulkLater')}.click()`, `document.querySelectorAll('#list .row')[100].textContent.includes('00:06:41:00')`);
await step('Replace in 500', `${$('bulkReplace')}.click();${$('frFind')}.value='door';${$('frFind')}.dispatchEvent(new Event('input'));${$('frWith')}.value='gate';${$('frAll')}.click();${$('frClose')}.click()`, `document.querySelectorAll('#list .row .tx')[100].textContent.includes('gate') && document.querySelectorAll('#list .row .tx')[99].textContent.includes('door')`);
await step('Extended on 500', `${$('bulkExt')}.click()`, `${$('bulkExt')}.getAttribute('aria-pressed')==='true'`);
await step('Delete 500', `${$('bulkDel')}.click();${$('bulkDelGo')}.click()`, `document.querySelectorAll('#list .row').length===${N - 500}`);
await step('Undo', `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,ctrlKey:true,bubbles:true}))`, `document.querySelectorAll('#list .row').length===${N}`);

console.table(results);
const errors = await js('__errors');
assert.deepEqual(errors, [], 'no errors on the page');
console.log('bulk smoke passed');
ws.close();
