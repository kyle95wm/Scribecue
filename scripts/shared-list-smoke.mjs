// Shared projects in the header, with two people in their own headless, muted Chrome at 6×
// CPU slowdown and 1,500 blocks. A shares "Night shift" with an edit link; B opens it, starts a
// new project, and opens Night shift again from the list, with no link or password. A turns
// B's link off while B is elsewhere: B's list says so and takes it out of B's browser.
// Takes screenshots of the list if given a folder.
// Uses the relay at RELAY, by default one running locally (`npm run dev` in relay/).
// Usage: node scripts/shared-list-smoke.mjs <A's DevTools port> <B's DevTools port> <site url> [screenshot folder]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, portA, portB, site, shots] = process.argv;
const RELAY = process.env.RELAY || 'ws://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function browser(port) {
  const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expression) => { const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500)); return m.result.result.value; };
  const wait = async (expression, what = expression, tries = 160) => { const t0 = performance.now(); for (let i = 0; i < tries; i++) { if (await js(expression).catch(() => false)) return performance.now() - t0; await sleep(100); } throw Error('Timed out: ' + what); };
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const watch = () => js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  const report = async () => { const long = await js(`__long.splice(0)`); assert.deepEqual(await js(`__errors`), []); return `${long.length} long tasks${long.length ? ` (longest ${Math.round(Math.max(...long))} ms)` : ''}`; };
  const shot = async (name) => { if (!shots) return; const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${shots}/${name}.png`, Buffer.from(m.result.data, 'base64')); };
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click();true`);
  const fill = (sel, v) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  return { send, js, wait, watch, report, shot, click, fill };
}
const settings = (name, cues, subName = 'untitled.srt') => `localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:${JSON.stringify(name)},sharedCopy:'1',relay:${JSON.stringify(RELAY)},setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,projectId:crypto.randomUUID(),subName:${JSON.stringify(subName)},cues:${cues}}));Storage.prototype.setItem=()=>{};location.reload();true`;
const online = `window.scribecueRelay?.status==='online' && !window.scribecueRelay.unsent()`;
const rows = `document.querySelectorAll('#list .row').length`;
const listText = `[...document.querySelectorAll('#sharedList .sharedrow')].map(b=>b.innerText.replace(/\\s+/g,' ').trim())`;

const a = await browser(portA), b = await browser(portB);
try {
  await a.send('Page.navigate', { url: site }); await b.send('Page.navigate', { url: site }); await sleep(800);
  await a.js(settings('Kyle', `Array.from({length:1500},(_,i)=>({uid:crypto.randomUUID(),start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.'}))`, 'Night shift.srt'));
  await b.js(settings('Sam', '[]'));
  await a.wait(`window.scribecueSharing && !document.getElementById('shareBtn').hidden`, 'A ready');
  await b.wait(`window.scribecueSharing && !document.getElementById('shareBtn').hidden`, 'B ready');
  assert.equal(await b.js(`document.getElementById('sharedBtn').hidden`), true, 'no Shared projects button with none kept');
  await a.watch(); await b.watch();

  // A shares: the project's name goes with it.
  await a.js(`window.scribecueSharing.make('edit','blue door').then(()=>true)`);
  await a.wait(online, 'A online');
  assert.equal(await a.js(`window.scribecueShared.name()`), 'Night shift');
  await a.click('#shareBtn');
  const link = await a.js(`document.querySelector('.sharelink').value`);
  await a.click('#shareClose');
  assert.equal(await a.js(`document.getElementById('sharedBtn').hidden`), false, 'the owner has it too');
  await a.click('#sharedBtn');
  await a.wait(`document.getElementById('sharedDlg').open && /Yours/.test(${listText}.join())`, 'A list');
  assert.match((await a.js(listText))[0], /Night shift Yours · Open now/);
  await a.click('#sharedClose');

  // B joins with the link and password.
  await b.js(`location.href=${JSON.stringify(link)};true`);
  await b.wait(`document.getElementById('joinDlg').open`, 'join dialog');
  await b.fill('#joinPassword', 'blue door');
  await b.click('#joinOpen');
  await b.wait(`${online} && ${rows}===1500`, 'B joined');
  await b.wait(`JSON.parse(localStorage.getItem('scribecue.share.'+${JSON.stringify(await a.js(`Object.keys(localStorage).find(k=>k.startsWith('scribecue.share.')).slice(16)`))})||'{}').title==='Night shift'`, 'B notes the name');
  console.log('B joined:', await b.report());

  // B starts a new project: Night shift stays in B's browser.
  await b.click('[data-act="newProject"]');
  await b.click('#newDlg [data-choice="project"]');
  await b.wait(`${rows}===0 && !window.scribecueRelay`, 'B on a new project');
  assert.equal(await b.js(`document.getElementById('sharedBtn').hidden`), false, 'B has a shared project kept');

  // B opens it again from the list: no link, no password.
  await b.report();
  let t0 = performance.now();
  await b.click('#sharedBtn');
  await b.wait(`document.getElementById('sharedDlg').open`, 'B list');
  const openMs = performance.now() - t0;
  const checkMs = await b.wait(`${listText}.length===1 && !/Checking/.test(${listText}[0])`, 'B checked') + openMs;
  const first = (await b.js(listText))[0];
  assert.match(first, /^Night shift Can edit · Opened today$/, first);
  await b.shot('shared-list');
  console.log(`B list: opened in ${Math.round(openMs)} ms, checked in ${Math.round(checkMs)} ms, ${await b.report()}`);
  t0 = performance.now();
  await b.click('#sharedList .sharedrow');
  await b.wait(`!document.getElementById('sharedDlg').open && ${online} && ${rows}===1500`, 'B reopened');
  console.log(`B reopened Night shift in ${Math.round(performance.now() - t0)} ms, ${await b.report()}`);
  assert.match(await b.js(`document.getElementById('toast').textContent`), /Opened Night shift/);

  // B leaves for a new project again, and A turns B's link off meanwhile.
  await b.click('[data-act="newProject"]');
  await b.click('#newDlg [data-choice="project"]');
  await b.wait(`${rows}===0 && !window.scribecueRelay`, 'B on a new project again');
  const linkId = await a.js(`(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('scribecue.share.'));return JSON.parse(localStorage.getItem(k)).links.find(l=>!l.off).id})()`);
  await a.js(`window.scribecueSharing.turnOff(${JSON.stringify(linkId)}).then(()=>true)`);
  await a.wait(online, 'A sent the list');
  await sleep(500);

  // B's list says so, and takes it out of this browser.
  await b.click('#sharedBtn');
  await b.wait(`/No longer shared with you/.test(${listText}.join())`, 'B told');
  await b.shot('shared-list-gone');
  assert.equal(await b.js(`document.querySelector('#sharedList .sharedrow').disabled`), true, 'can’t be opened');
  assert.equal(await b.js(`Object.keys(localStorage).some(k=>k.startsWith('scribecue.share.'))`), false, 'its keys are gone');
  await b.click('#sharedClose');
  assert.equal(await b.js(`document.getElementById('sharedBtn').hidden`), true, 'the button goes with the last one');
  console.log('B told and removed:', await b.report(), '| A:', await a.report());
  console.log('Shared projects smoke test passed');
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally {
  process.exit(process.exitCode || 0);
}
