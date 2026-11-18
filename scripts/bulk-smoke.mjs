// Ticking blocks in headless, muted Chrome at 6× CPU slowdown, with a long script: Select,
// Shift+click, All, Move…, Replace… in the ticked blocks, Extended, Delete… and undo. Then on
// the timeline: Ctrl+click and Shift+click to tick, Shift+drag to lasso, and dragging the
// ticked blocks together.
// Says how long each took and how many long tasks there were.
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

// On the timeline, with real mouse events. Blocks are 2.5 s long with 1.5 s between them, so a
// group dragged later stops 1.5 s on, short of the next block that isn't ticked.
const mouse = (type, x, y, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const at = (bid) => js(`(()=>{const r=document.querySelector('.cue[data-id="${bid}"]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
async function tlClick(bid, modifiers = 0) {
  const [x, y] = await at(bid);
  await mouse('mousePressed', x, y, modifiers); await mouse('mouseReleased', x, y, modifiers);
}
async function tlDrag(bid, dx, label, check) {
  const [x, y] = await at(bid);
  await js('__long.length=0;window.__frames=0;window.__count=true;(function f(){if(!window.__count)return;__frames++;requestAnimationFrame(f)})();true');
  const t0 = Date.now();
  await mouse('mousePressed', x, y);
  for (let k = 1; k <= 20; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (dx * k) / 20, y, button: 'left', buttons: 1 });
  await mouse('mouseReleased', x + dx, y);
  await js('new Promise(r=>requestAnimationFrame(()=>setTimeout(r)))');
  const ms = Date.now() - t0;
  await sleep(600);
  const [long, frames] = await js('window.__count=false;[__long.slice(),__frames]');
  assert.ok(await js(check), `${label}: ${check}`);
  results.push({ step: label, ms, longTasks: long.length, longest: long.length ? Math.max(...long) : 0, fps: Math.round((frames * 1000) / (ms + 600)) });
}
const ticks = `document.querySelectorAll('.cue.ticked').length`;
// Zoomed out so the first blocks show, with block 3 selected.
await js(`${$('bulkDone')}.click();for(let k=0;k<3;k++)document.querySelector('#tlZoom [data-zoom=out]').click();${click(row(2))};true`);
await sleep(800);
await js(`document.querySelector('#tlZoom [data-zoom=out]').click();true`);
await sleep(800);
await tlClick(4, 2);
assert.equal(await js(`${$('bulkCount')}.textContent`), '2 ticked', 'Ctrl+click on the timeline ticks, with the selected block');
await tlClick(6, 8);
assert.equal(await js(`${$('bulkCount')}.textContent`), '4 ticked', 'Shift+click on the timeline ticks the blocks in between');
assert.equal(await js(ticks), 4, 'the timeline shows the ticks');
await tlDrag(4, 300, 'Drag 4 ticked later', `${row(2)}.textContent.includes('00:00:09:12') && ${row(5)}.textContent.includes('00:00:21:12') && ${row(6)}.textContent.includes('00:00:24:00')`);
await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,ctrlKey:true,bubbles:true}));true`);
await sleep(600);
assert.ok(await js(`${row(2)}.textContent.includes('00:00:08:00') && ${row(5)}.textContent.includes('00:00:20:00')`), 'undo puts the dragged blocks back');
await tlDrag(3, -40, 'Drag 4 ticked earlier', `!${row(2)}.textContent.includes('00:00:08:00') && ${row(1)}.textContent.includes('00:00:04:00')`);
// Shift+drag across the empty lane, from the gap after block 1 to the gap after block 4.
const gap = (a) => js(`(()=>{const l=document.querySelector('.cue[data-id="${a}"]').getBoundingClientRect(),r=document.querySelector('.cue[data-id="${a + 1}"]').getBoundingClientRect();return [(l.right+r.left)/2,l.top+l.height/2]})()`);
await js(`${$('bulkNone')}.click();true`);
{
  const [[x0, y], [x1]] = [await gap(1), await gap(4)];
  await js('__long.length=0;true');
  await mouse('mousePressed', x0, y, 8);
  for (let k = 1; k <= 10; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * k) / 10, y, modifiers: 8, button: 'left', buttons: 1 });
  assert.equal(await js(`${$('lasso')}.hidden`), false, 'the lasso shows while dragging');
  await mouse('mouseReleased', x1, y, 8);
  await sleep(600);
  const long = await js('__long.slice()');
  results.push({ step: 'Lasso 3 blocks', ms: 0, longTasks: long.length, longest: long.length ? Math.max(...long) : 0 });
  assert.equal(await js(`${$('bulkCount')}.textContent`), '3 ticked', 'Shift+drag across the lane ticks the blocks it touches');
  assert.equal(await js(ticks), 3);
  assert.equal(await js(`${$('lasso')}.hidden`), true, 'the lasso goes when you let go');
  assert.equal(await js(`document.querySelectorAll('#list .row').length`), N, 'a lasso draws no block');
  const [gx, gy] = await gap(1);
  await mouse('mousePressed', gx, gy); await mouse('mouseReleased', gx, gy);
  assert.equal(await js(`${$('bulkCount')}.textContent`), 'None ticked', 'a click on the empty lane unticks them');
  assert.equal(await js(ticks), 0);
}
await js(`${$('bulkNone')}.click();${click(row(499))};${click(row(0), ',shiftKey:true')};true`); // ending on block 1, so the timeline shows it
await sleep(800);
assert.equal(await js(`${$('bulkCount')}.textContent`), '500 ticked');
// Earlier steps made blocks 101 to 600 short, so the group goes until block 500 meets block 501.
const tcs = (k) => `${row(k)}.textContent.match(/\\d\\d:\\d\\d:\\d\\d:\\d\\d/g)`;
await tlDrag(2, 300, 'Drag 500 ticked later', `${tcs(499)}[1]===${tcs(500)}[0] && ${tcs(0)}[0]!=='00:00:00:00'`);

console.table(results);
const errors = await js('__errors');
assert.deepEqual(errors, [], 'no errors on the page');
console.log('bulk smoke passed');
ws.close();
