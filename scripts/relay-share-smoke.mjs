// Two people sharing a project through the relay, each in their own headless, muted Chrome at
// 6× CPU slowdown, with 1,500 blocks over two hours, through the Share and join dialogs. A
// makes an edit link; B opens it (a wrong password first); typing passes both ways; B reloads
// and is still in; B goes offline, edits, and catches up; A turns the link off, makes a new
// one that B opens again, then stops sharing. Takes screenshots of both dialogs if given a folder.
// Uses the relay at RELAY, by default one running locally (`npm run dev` in relay/).
// Usage: node scripts/relay-share-smoke.mjs <A's DevTools port> <B's DevTools port> <site url> [screenshot folder]
import assert from 'node:assert/strict';
const [,, portA, portB, site, shots] = process.argv;
import { writeFileSync } from 'node:fs';
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
  const wait = async (expression, what = expression, tries = 160) => { const t0 = performance.now(); for (let i = 0; i < tries; i++) { if (await js(expression).catch(() => false)) { if (process.env.VERBOSE) console.error(`${what}: ${Math.round(performance.now() - t0)} ms`); return; } await sleep(250); } throw Error('Timed out: ' + what); };
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const watch = () => js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  const open = async (n) => { await js(`document.activeElement?.blur();[...document.querySelectorAll('#list .row')][${n}].click();true`); await sleep(300); };
  const type = async (s) => { const t0 = performance.now(); for (const ch of s) await send('Input.insertText', { text: ch }); return performance.now() - t0; };
  const report = async () => { const long = await js(`__long`); assert.deepEqual(await js(`__errors`), []); return `${long.length} long tasks${long.length ? ` (longest ${Math.round(Math.max(...long))} ms)` : ''}`; };
  const shot = async (name) => { if (!shots) return; const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${shots}/${name}.png`, Buffer.from(m.result.data, 'base64')); };
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click();true`);
  const fill = (sel, v) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  return { ws, send, js, wait, watch, open, type, report, shot, click, fill };
}
const settings = (name, cues) => `localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:${JSON.stringify(name)},sharedCopy:'1',relay:${JSON.stringify(RELAY)},setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,projectId:crypto.randomUUID(),cues:${cues}}));Storage.prototype.setItem=()=>{};location.reload();true`;
const online = `window.scribecueRelay?.status==='online' && !window.scribecueRelay.unsent()`;
const rowText = (n) => `[...document.querySelectorAll('#list .row')][${n}]?.textContent||''`;

const a = await browser(portA), b = await browser(portB);
try {
  await a.send('Page.navigate', { url: site }); await b.send('Page.navigate', { url: site }); await sleep(800);
  await a.js(settings('Kyle', `Array.from({length:1500},(_,i)=>({uid:crypto.randomUUID(),start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.'}))`));
  await b.js(settings('Sam', '[]'));
  await a.wait(`window.scribecueSharing && window.scribecueShared`, 'A ready');
  await b.wait(`window.scribecueSharing && window.scribecueShared`, 'B ready');
  await a.watch(); await b.watch();

  // A shares from the dialog: an edit link with its password.
  assert.equal(await a.js(`!document.getElementById('shareBtn').hidden`), true, 'Share shows');
  await a.click('#shareBtn');
  await a.wait(`document.getElementById('shareDlg').open`, 'Share dialog');
  await a.shot('share-empty');
  let t0 = performance.now();
  await a.fill('#sharePw-edit', 'blue door');
  await a.click('#sharePw-edit + button');
  await a.wait(`document.querySelector('.sharelink') && ${online}`, 'A online with the link made');
  const shareMs = performance.now() - t0;
  assert.equal(await a.js(`document.getElementById('shareState').textContent`), 'Shared');
  const edit = await a.js(`document.querySelector('.sharelink').value`);
  assert.match(edit, /#share=/);
  await a.shot('share-link');
  await a.js(`document.getElementById('shareClose').click();true`);

  // B opens the link: a wrong password is refused, the right one brings the whole script.
  await b.js(`window.confirm=()=>true;location.href=${JSON.stringify(edit)};true`);
  await b.wait(`document.getElementById('joinDlg').open`, 'join dialog');
  await b.shot('join');
  await b.fill('#joinPassword', 'blue');
  await b.click('#joinOpen');
  await b.wait(`/doesn’t open/.test(document.getElementById('joinStatus').textContent)`, 'wrong password refused');
  t0 = performance.now();
  await b.fill('#joinPassword', 'blue door');
  await b.click('#joinOpen');
  await b.wait(`document.querySelectorAll('#list .row').length===1500 && ${online}`, 'B has the whole script');
  const joinMs = performance.now() - t0;
  assert.equal(await b.js(`location.hash`), '', 'the link leaves the address bar');
  assert.equal(await b.js(rowText(1)), await a.js(rowText(1)));

  // Typing both ways.
  await a.open(1);
  const aMs = await a.type(' Kyle typed this.');
  t0 = performance.now();
  await b.wait(`(${rowText(1)}).includes('Kyle typed this.')`, 'B sees A’s typing');
  const reachMs = performance.now() - t0;
  await a.js(`document.activeElement.blur();true`);
  await b.open(2);
  await b.type(' Sam typed this.');
  await b.js(`document.activeElement.blur();true`);
  await a.wait(`(${rowText(2)}).includes('Sam typed this.')`, 'A sees B’s typing');
  // Who did it shows on both sides.
  await a.open(2);
  assert.match(await a.js(`document.getElementById('edEdited').textContent`), /Sam/);

  // Who's here: A sees Sam, on the block Sam has open, editing it while Sam types there.
  await a.wait(`document.querySelector('#sharePeople .who')?.textContent==='S'`, 'A sees Sam here');
  await b.open(5);
  await b.js(`edText.focus();true`).catch(() => b.js(`document.getElementById('edText').focus();true`));
  await a.wait(`[...document.querySelectorAll('#list .row')][5]?.querySelector('.here .who.editing')`, 'A sees Sam editing block 6');
  await a.open(5);
  await a.wait(`/Sam is editing/.test(document.getElementById('edOthers').textContent)`, 'A’s editor says Sam is editing it');
  await a.shot('presence');
  await b.js(`document.activeElement.blur();true`);
  await a.js(`document.activeElement.blur();true`);
  await a.open(3);
  await a.wait(`!document.querySelector('#list .here .who.editing') && document.querySelector('#list .here .who')`, 'Sam stops editing, still there');
  await a.shot('presence-row');
  await a.js(`document.activeElement.blur();true`);

  // B reloads: still in the project, still connected, nothing to type again.
  await sleep(1800); // B's copy is kept a moment after each change
  await b.js(`window.__old=true;location.reload();true`);
  await b.wait(`!window.__old && ${online} && (${rowText(2)}).includes('Sam typed this.')`, 'B back after reloading');
  await b.watch();

  // B goes offline and edits; it arrives once B is back.
  // Chrome's offline mode doesn't always stop a new WebSocket, so B's tries to reconnect go
  // nowhere until it's back.
  // Closed before going offline: Chrome's offline mode can hold the close up for a minute.
  await b.js(`(()=>{const r=window.scribecueRelay;r.__ws=r.WebSocket;r.WebSocket=class{constructor(){return new r.__ws('ws://127.0.0.1:9')}};r.ws.close();return true})()`);
  await b.wait(`window.scribecueRelay.status!=='online'`, 'B offline');
  await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await a.wait(`document.getElementById('sharePeople').hidden`, 'A no longer shows Sam');
  await b.open(3);
  await b.type(' Written offline.');
  await b.js(`document.activeElement.blur();true`);
  await sleep(500);
  assert.ok(!(await a.js(rowText(3))).includes('Written offline.'));
  await b.js(`(()=>{const r=window.scribecueRelay;r.WebSocket=r.__ws;return true})()`);
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await a.wait(`(${rowText(3)}).includes('Written offline.')`, 'A gets B’s offline edit', 240);
  const same = async () => JSON.stringify(await a.js(`scribecueShared.read()`)) === JSON.stringify(await b.js(`scribecueShared.read()`));
  await sleep(800);
  assert.ok(await same(), 'both copies agree');

  // A turns the link off: B is told, keeps its copy, and is no longer connected. A's list
  // says where B's changes stop: B's last number.
  const [bDev, bN] = await b.js(`[scribecueRelay.dev, scribecueRelay.n]`);
  await a.click('#shareBtn');
  await a.js(`[...document.querySelectorAll('#shareLinks button')].find(b=>b.textContent==='Turn off').click();true`);
  await b.wait(`!window.scribecueRelay && document.getElementById('shareState').hidden`, 'B is let go');
  assert.equal(await b.js(`document.querySelectorAll('#list .row').length`), 1500, 'B keeps its copy');
  const offLink = `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('scribecue.share.')))).links.find(l=>l.off)`;
  assert.equal((await a.js(offLink)).upTo[bDev], bN, 'the link turned off stops at B’s last number');
  // Then A sends its whole copy and seals the link: nothing more from it counts.
  await a.wait(`${offLink}.sealed===true && scribecueRelay.links.links.get(${offLink}.id).sealed===true`, 'A seals the link');
  // A makes a new link and B opens it: B starts again from the relay's copy, not the one it kept.
  await sleep(1800);
  await a.fill('#sharePw-edit', 'red door');
  await a.click('#sharePw-edit + button');
  await a.wait(`document.querySelector('.sharelink') && ${online}`, 'A’s new link');
  const again = await a.js(`document.querySelector('.sharelink').value`);
  await b.js(`window.confirm=()=>true;location.href=${JSON.stringify(again)};true`);
  await b.wait(`document.getElementById('joinDlg').open`, 'join dialog again');
  await b.fill('#joinPassword', 'red door');
  await b.click('#joinOpen');
  await b.wait(`document.querySelectorAll('#list .row').length===1500 && (${rowText(3)}).includes('Written offline.') && ${online}`, 'B back in with the whole script');
  await sleep(800);
  assert.equal(await a.js(`scribecueShared.blocks.size`), 1500, 'A’s copy is whole');
  assert.ok(await same(), 'both copies agree again');
  // A's changes now use the project key added when the first link went off; B has it.
  assert.equal(await a.js(`scribecueRelay.cipher.count`), 2, 'a second key since the link went off');
  await a.js(`document.getElementById('shareClose').click();true`);
  await a.open(4);
  await a.type(' After the new key.');
  await a.js(`document.activeElement.blur();true`);
  await b.wait(`(${rowText(4)}).includes('After the new key.')`, 'B reads changes sealed with the new key');
  // A stops sharing: back to a plain project.
  await a.click('#shareBtn');
  await a.js(`window.confirm=()=>true;document.getElementById('shareStop').click();true`);
  await a.wait(`!window.scribecueRelay && !Object.keys(localStorage).some(k=>k.startsWith('scribecue.share.'))`, 'A stopped sharing');
  await a.js(`document.getElementById('shareClose').click();true`);

  console.log(`Relay share smoke passed at 6× with 1,500 blocks: sharing took ${Math.round(shareMs)} ms, joining ${Math.round(joinMs)} ms; A typed ${(aMs / 17).toFixed(1)} ms a character; it reached B in ${Math.round(reachMs)} ms; A ${await a.report()}; B ${await b.report()} since reloading`);
} finally { a.ws.close(); b.ws.close(); }
process.exit(0);
