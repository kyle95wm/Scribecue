// No-go zones in headless, muted Chrome at 6× CPU slowdown, with a long script: importing a
// segment list, blocks stopping at a zone's edge, no new block inside one, Alt+drag to draw
// one, right-click to delete it, undo, QC hiding them, and keeping them after a reload.
// Says how long each step took and how many long tasks there were.
// Usage: node scripts/nogo-smoke.mjs <devtools port> <site url> [blocks]
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
// Blocks 2.5 s long, every 4 s: block k (from 1) runs from 4(k − 1).
const cues = Array.from({ length: N }, (_, i) => ({ id: i + 1, start: i * 4, end: i * 4 + 2.5, text: `Mara walks to the door, block ${i + 1}.` }));
await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',tts:'{"on":false}',loops:'{"write":true,"transcribe":true}',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(cues)},dirty:false}));true`);
await send('Page.reload', { ignoreCache: true }); await sleep(8000);
const watch = `window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())__long.push(Math.round(e.duration))}).observe({type:'longtask'});true`;
await js(watch);

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
const toast = () => js(`${$('toast')}.textContent`);
const key = (code, k, mods = '') => `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',code:'${code}',bubbles:true${mods}}))`;
const undo = key('KeyZ', 'z', ',metaKey:true,ctrlKey:true');
const zones = `document.querySelectorAll('#zones .zone').length`;
const nogo = `document.querySelectorAll('.cue.nogo').length`;

// Segment 1 from 1 s to 20 s, segment 2 from 30 s to 1:39:00, its OUT at 1:39:59. Repeated,
// as broadcasters' lists sometimes are. Zones: 0–1 s, 20–30 s, and 1:39:00 to 1:39:59 (no video).
const LIST = `Seg 1\nIN: 00:00:00:00\n(Description can come in after 00:00:01:00)\nOUT: 00:00:20:10\n(Description must conclude by 00:00:20:00)\n\n${'Seg 2\nIN: 00:00:29:00\n(Description can come in after 00:00:30:00)\nOUT: 01:39:59:00\n(Description must conclude by 01:39:00:00)\n\n'.repeat(2)}`;
const inZones = cues.filter((c) => c.start < 1 || (c.end > 20 && c.start < 30) || c.end > 5940).length;

// Zoomed out so the first 45 s or so show, with both zones near the start.
await js(`for(let k=0;k<2;k++)document.querySelector('#tlZoom [data-zoom=out]').click();true`); await sleep(800);
await step('Open Import no-go zones', key('KeyN', 'N', ',altKey:true,shiftKey:true'), `${$('zonesDlg')}.open`);
await step('Paste a segment list', `${$('zonesText')}.value=${JSON.stringify(LIST)};${$('zonesText')}.dispatchEvent(new Event('input'))`, `${$('zonesFound')}.textContent.startsWith('2 segments, so 3 no-go zones') && !${$('zonesGo')}.disabled`);
await step('Import', `${$('zonesGo')}.click()`, `!${$('zonesDlg')}.open && ${zones}===2`);
const said = await toast();
assert.match(said, new RegExp(`^Imported 3 no-go zones — ${inZones} blocks are in a no-go zone`), said);
assert.ok(await js(`${nogo}>=4`), 'blocks in zones are marked');
assert.equal(await js(`document.querySelector('#zones .zone .zn').textContent`), 'Before Seg 1');

// Block 5 runs 16–18.5 s: the move key takes it only as far as the zone at 20 s.
await step('Select block 5', `${row(4)}.dispatchEvent(new MouseEvent('click',{bubbles:true}))`, `${row(4)}.getAttribute('aria-selected')==='true'`);
await js(`${key('Escape', 'Escape')};true`); await sleep(300);
await step('Move key ×30 into a zone', `for(let k=0;k<30;k++)${key('Period', '.', ',repeat:true')}`, `${row(4)}.textContent.includes('00:00:17:12')`);
await js(`${undo};true`); await sleep(400);
assert.ok(await js(`${row(4)}.textContent.includes('00:00:16:00')`), 'undo puts it back');

// Real mouse events on the lane from here.
const mouse = (type, x, y, modifiers = 0, button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, modifiers, button, buttons: type === 'mouseReleased' ? 0 : button === 'left' ? 1 : 2, clickCount: 1 });
const rect = (bid) => js(`(()=>{const r=document.querySelector('.cue[data-id="${bid}"]').getBoundingClientRect();return [r.left,r.right,r.top+r.height/2]})()`);
// The gap between blocks 6 and 7 (22.5–24 s) is inside the zone: a click there moves the
// playhead; N makes no block; dragging there draws none.
{
  const [, r6, y] = await rect(6), [l7] = await rect(7);
  const x = (r6 + l7) / 2, before = await js(`document.querySelectorAll('#list .row').length`);
  await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(400);
  await step('N inside a zone', key('KeyN', 'n'), `document.querySelectorAll('#list .row').length===${before}`);
  assert.match(await toast(), /^That’s in a no-go zone: Between Seg 1 and Seg 2/);
  await mouse('mousePressed', x - 3, y);
  for (let k = 1; k <= 5; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3 + k * 2, y, button: 'left', buttons: 1 });
  await mouse('mouseReleased', x + 7, y); await sleep(400);
  assert.equal(await js(`document.querySelectorAll('#list .row').length`), before, 'dragging inside a zone draws no block');
}
// Alt+drag across the gap between blocks 10 and 11 draws a zone; right-click deletes it.
{
  const [, r10, y] = await rect(10), [l11] = await rect(11);
  await js('__long.length=0;true');
  await mouse('mousePressed', r10 + 3, y, 1);
  for (let k = 1; k <= 10; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r10 + 3 + ((l11 - r10 - 6) * k) / 10, y, modifiers: 1, button: 'left', buttons: 1 });
  await mouse('mouseReleased', l11 - 3, y, 1); await sleep(600);
  const long = await js('__long.slice()');
  results.push({ step: 'Alt+drag a zone', ms: 0, longTasks: long.length, longest: long.length ? Math.max(...long) : 0 });
  assert.equal(await js(zones), 3, 'Alt+drag draws a zone');
  assert.match(await toast(), /^No-go zone from 00:00:38/);
  const [zx, zy] = await js(`(()=>{const r=[...document.querySelectorAll('#zones .zone')].at(-1).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
  await mouse('mousePressed', zx, zy, 0, 'right'); await mouse('mouseReleased', zx, zy, 0, 'right'); await sleep(300);
  assert.equal(await js(`${$('zoneMenu')}.hidden`), false, 'right-click opens the zone menu');
  await step('Delete the zone', `document.querySelector('[data-zone=delete]').click()`, `${zones}===2 && ${$('zoneMenu')}.hidden`);
  await step('Undo the delete', undo, `${zones}===3`);
}
// Dragging the zone's left edge, at 20 s, later by 20 px, below the blocks; undo puts it back.
{
  const [x, y] = await js(`(()=>{const r=document.querySelectorAll('#zones .zone')[1].querySelector('.zl').getBoundingClientRect();return [r.left+r.width/2,r.bottom-5]})()`);
  const w0 = await js(`document.querySelectorAll('#zones .zone')[1].getBoundingClientRect().width`);
  await mouse('mousePressed', x, y);
  for (let k = 1; k <= 5; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + k * 4, y, button: 'left', buttons: 1 });
  await mouse('mouseReleased', x + 20, y); await sleep(600);
  const w1 = await js(`document.querySelectorAll('#zones .zone')[1].getBoundingClientRect().width`);
  assert.ok(Math.abs(w0 - w1 - 20) < 2, `dragging the edge resizes the zone: ${w0} → ${w1}`);
  assert.match(await toast(), /^Between Seg 1 and Seg 2 now runs from 00:00:2\d:\d\d to 00:00:30:00/);
  await step('Undo the resize', undo, `Math.abs(document.querySelectorAll('#zones .zone')[1].getBoundingClientRect().width-${w0})<1`);
}
// Rename the first zone.
await js(`document.querySelector('#zones .zone').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:700}));document.querySelector('[data-zone=rename]').click();true`);
await step('Rename', `${$('zoneName')}.value='Opening';${$('zoneNameGo')}.click()`, `document.querySelector('#zones .zone .zn').textContent==='Opening'`);

// QC doesn't show them; Write does again.
await step('QC hides zones', `document.querySelector('[data-mode=qc]').click()`, `${zones}===0 && ${nogo}===0`);
await step('Write shows them', `document.querySelector('[data-mode=write]').click()`, `${zones}===3`);

// Kept after a reload.
await sleep(1500);
await send('Page.reload', { ignoreCache: true }); await sleep(8000);
await js(watch);
assert.deepEqual(await js(`JSON.parse(localStorage.getItem('scribecue.v1')).zones.map((z)=>z.label)`), ['Opening', 'Between Seg 1 and Seg 2', '', 'After Seg 2'], 'zones are kept after a reload');
assert.equal(await js(`document.querySelector('#zones .zone .zn').textContent`), 'Opening');

console.table(results);
const errors = await js('__errors');
assert.deepEqual(errors, [], 'no errors on the page');
console.log('no-go zones smoke passed');
ws.close();
