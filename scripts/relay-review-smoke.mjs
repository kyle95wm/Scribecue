// Reviewing and commenting on a shared project, in two headless, muted Chromes at 6× CPU
// slowdown with 1,500 blocks. A shares a review link and a comment link. B reviews: stays in
// QC, and its block change reaches A as a suggestion in Pending review, not in the script; A
// accepts one, credited to B, and rejects another, which B's copy then drops. B leaves with a
// copy and opens the comment link: comments only. B leaves again, without a copy, the default.
// Uses the relay at RELAY, by default one running locally (`npm run dev` in relay/).
// Usage: node scripts/relay-review-smoke.mjs <A's DevTools port> <B's DevTools port> <site url> [screenshot folder]
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
  const wait = async (expression, what = expression, tries = 160) => { for (let i = 0; i < tries; i++) { if (await js(expression).catch(() => false)) return; await sleep(250); } throw Error('Timed out: ' + what); };
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

const editText = async (t, n, text) => { await t.open(n); await t.js(`(()=>{const e=document.getElementById('edText');e.focus();e.setSelectionRange(e.value.length,e.value.length);return true})()`); await t.type(text); await t.js(`document.activeElement.blur();true`); };
const joinWith = async (t, url, pw) => {
  await t.js(`window.confirm=()=>true;location.href=${JSON.stringify(url)};true`);
  await t.wait(`document.getElementById('joinDlg').open`, 'join dialog');
  await t.fill('#joinPassword', pw);
  await t.click('#joinOpen');
  await t.wait(`document.querySelectorAll('#list .row').length===1500 && ${online}`, 'joined with the whole script');
};

const a = await browser(portA), b = await browser(portB);
try {
  await a.send('Page.navigate', { url: site }); await b.send('Page.navigate', { url: site }); await sleep(800);
  await a.js(settings('Kyle', `Array.from({length:1500},(_,i)=>({uid:crypto.randomUUID(),start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.'}))`));
  await b.js(settings('Sam', '[]'));
  await a.wait(`window.scribecueSharing && !document.getElementById('shareBtn').hidden`, 'A ready');
  // A project not yet shared has no shared copy: Yjs loads once it's shared.
  assert.equal(await a.js(`!!window.scribecueShared || performance.getEntriesByType('resource').some(e=>/yjs\\.js/.test(e.name))`), false, 'nothing of the shared copy loaded yet');
  await b.wait(`window.scribecueSharing && !document.getElementById('shareBtn').hidden`, 'B ready');
  await a.watch(); await b.watch();

  // A makes a review link and a comment link.
  await a.click('#shareBtn');
  await a.fill('#sharePw-review', 'green door');
  await a.click('#sharePw-review ~ button');
  await a.wait(`document.querySelector('.sharelink') && ${online}`, 'review link');
  await a.fill('#sharePw-comment', 'grey door');
  await a.click('#sharePw-comment ~ button');
  await a.wait(`document.querySelectorAll('.sharelink').length===2`, 'comment link');
  await a.fill('#sharePw-edit', 'blue door');
  await a.click('#sharePw-edit ~ button');
  await a.wait(`document.querySelectorAll('.sharelink').length===3`, 'edit link');
  const [edit, review, comment] = await a.js(`[...document.querySelectorAll('.sharelink')].map(e=>e.value)`);
  await a.js(`document.getElementById('shareClose').click();true`);

  // B reviews: in QC, and can't leave it.
  await joinWith(b, review, 'green door');
  assert.equal(await b.js(`document.body.classList.contains('mode-qc')`), true, 'opens in QC');
  assert.equal(await b.js(`document.getElementById('qcPermission').textContent`), 'Suggestions');
  assert.equal(await b.js(`document.querySelector('#modeSw [data-mode=write]').disabled`), true, 'Write is off');
  // QC in a shared project reads live with the project's voices: no package choices.
  assert.match(await b.js(`document.getElementById('ind').textContent`), /QC · LIVE READINGS/);
  await b.js(`document.querySelector('#ind [data-key=qc]').click();true`);
  await b.wait(`document.getElementById('qcPlaybackDlg').open`, 'QC drawer');
  assert.deepEqual(await b.js(`['qcSourceRow','qcPreviewVoiceRow','qcCompareReturned','qcAttachReadings'].filter(id=>!document.getElementById(id).hidden && getComputedStyle(document.getElementById(id)).display!=='none')`), [], 'no package choices');
  assert.match(await b.js(`document.getElementById('qcPackageInfo').textContent`), /read here with the project’s voices/);
  await b.shot('shared-qc');
  await b.click('#qcPlaybackClose');
  // New: no Clear the blocks, and it says the shared project stays here.
  await b.js(`document.querySelector('[data-act=newProject]').click();true`);
  await b.wait(`document.getElementById('newDlg').open`, 'New dialog');
  assert.equal(await b.js(`document.querySelector('#newDlg [data-choice=blocks]').hidden`), true, 'a reviewer can’t clear the blocks');
  assert.match(await b.js(`document.getElementById('newProjectNote').textContent`), /stays in this browser/);
  await b.click('#newCancel');
  // Only the owner saves and exports: B has no Save or Export, nor their keys, which only explain.
  const saveShown = `getComputedStyle(document.querySelector('[data-act=saveProject]')).display!=='none'`;
  assert.equal(await a.js(saveShown), true, 'the owner has Save');
  assert.equal(await b.js(saveShown), false, 'a reviewer has no Save');
  assert.equal(await b.js(`[...document.querySelectorAll('#help .save-key')].every(e=>getComputedStyle(e).display==='none')`), true, 'no save keys in the shortcuts');
  assert.equal(await b.js(`(()=>{const e=new KeyboardEvent('keydown',{key:'s',ctrlKey:true,metaKey:true,bubbles:true,cancelable:true});document.body.dispatchEvent(e);return e.defaultPrevented})()`), true, 'the browser doesn’t save the page');
  assert.match(await b.js(`document.getElementById('toast').textContent`), /owner saves/);
  const exportShown = `getComputedStyle(document.querySelector('.export-wrap')).display!=='none'`;
  assert.equal(await a.js(exportShown), true, 'the owner has Export');
  assert.equal(await b.js(exportShown), false, 'a reviewer has no Export');
  assert.equal(await b.js(`[...document.querySelectorAll('#help .export-key, .export-panel')].every(e=>getComputedStyle(e).display==='none')`), true, 'no export keys or panel exports');
  await b.js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,metaKey:true,bubbles:true,cancelable:true}));true`);
  assert.match(await b.js(`document.getElementById('toast').textContent`), /owner exports/);
  await a.shot('owner-header'); await b.shot('reviewer-header');

  // B changes block 2: B sees it; A gets a suggestion, and the script stays as it was.
  let t0 = performance.now();
  await editText(b, 1, ' Sam suggests this.');
  await a.wait(`document.getElementById('pendingCount').textContent==='1'`, 'A gets the suggestion');
  const suggestMs = performance.now() - t0;
  assert.ok((await b.js(rowText(1))).includes('Sam suggests this.'), 'B sees its own change');
  assert.ok(!(await a.js(rowText(1))).includes('Sam suggests this.'), 'A’s script is unchanged');
  assert.equal(await a.js(`window.scribecueShared.read().blocks[1].text`), 'Block number 2 describes the scene.');
  await a.click('#tabPending');
  await a.js(`document.querySelector('#pendingList .prow').click();true`);
  assert.match(await a.js(`document.getElementById('pendingList').textContent`), /Suggested by Sam/);
  await a.shot('pending-suggestion');

  // A second suggestion, on block 3.
  await editText(b, 2, ' Not this one.');
  await a.wait(`document.getElementById('pendingCount').textContent==='2'`, 'second suggestion');
  // B's block end follows its reading a moment later, which updates the suggestion; a
  // suggestion that changes needs choosing again, so choose once it has settled.
  let last = '';
  for (let i = 0; i < 20; i++) { const now = await a.js(`JSON.stringify(scribecueShared.readProposals())`); if (now === last) break; last = now; await sleep(700); }
  // A accepts the first and rejects the second.
  await a.js(`document.querySelectorAll('#pendingList .prow')[0].querySelector('.pick.remote').click();true`);
  await a.js(`document.querySelectorAll('#pendingList .prow')[1].querySelector('.pick.local').click();true`);
  await a.click('#pendingAccept');
  await a.wait(`(${rowText(1)}).includes('Sam suggests this.') && document.getElementById('listTabs').hidden`, 'A applied the choices');
  await b.wait(`(${rowText(1)}).includes('Sam suggests this.') && !(${rowText(2)}).includes('Not this one.')`, 'B: accepted stays, rejected goes');
  await a.open(1);
  assert.match(await a.js(`document.getElementById('edEdited').textContent`), /Sam/, 'credited to Sam');

  // B comments: it reaches A at once.
  await b.open(5);
  await b.js(`document.getElementById('edComment').click();document.getElementById('commentText').value='Pause here?';document.getElementById('commentPost').click();true`);
  await a.wait(`window.scribecueShared.read().blocks[5].comments?.[0]?.text==='Pause here?'`, 'A gets B’s comment');

  // B opens another kind of link: it replaces the review link, down to comments, then up to
  // editing. Its password is asked for again.
  const switchTo = async (url, pw, ready) => {
    await b.js(`location.href=${JSON.stringify(url)};true`);
    await b.wait(`document.getElementById('joinDlg').open`, 'switch dialog');
    assert.equal(await b.js(`document.getElementById('joinTitle').textContent`), 'Open with this link');
    await b.fill('#joinPassword', pw);
    await b.click('#joinOpen');
    await b.wait(`!document.getElementById('joinDlg').open && document.querySelectorAll('#list .row').length===1500 && ${online} && ${ready}`, 'switched link');
  };
  await switchTo(comment, 'grey door', `document.getElementById('qcPermission').textContent==='Comments only'`);
  assert.match(await b.js(`document.getElementById('toast').textContent`), /You can comment now/);
  await switchTo(edit, 'blue door', `document.body.classList.contains('mode-write')`);
  assert.equal(await b.js(`document.querySelector('#modeSw [data-mode=write]').disabled`), false, 'Write is on');
  assert.equal(await b.js(saveShown), false, 'an editor still has no Save');
  await editText(b, 4, ' Edited by Sam.');
  await a.wait(`window.scribecueShared.read().blocks[4].text.includes('Edited by Sam.')`, 'B’s edit reaches A’s script');
  // B starts something new, then opens its link again: back in, with no password.
  await b.js(`document.querySelector('[data-act=newProject]').click();true`);
  await b.wait(`document.getElementById('newDlg').open`, 'New dialog');
  await b.js(`document.querySelector('#newDlg [data-choice=project]').click();true`);
  await b.wait(`document.querySelectorAll('#list .row').length===0`, 'B started a new project');
  await b.js(`location.href=${JSON.stringify(edit)};true`);
  await b.wait(`document.querySelectorAll('#list .row').length===1500 && ${online}`, 'B reopened the shared project');
  assert.equal(await b.js(`document.getElementById('joinDlg').open`), false, 'no password asked');
  assert.match(await b.js(`document.getElementById('toast').textContent`), /Opened the shared project again/);
  await sleep(1500);
  assert.equal(await a.js(`window.scribecueShared.read().blocks.length`), 1500, 'reopening leaves everyone’s blocks alone');
  // The owner opening one of their own links stays the owner.
  await a.js(`location.href=${JSON.stringify(review)};true`);
  await a.wait(`!location.hash`, 'A’s link set aside');
  assert.equal(await a.js(`document.getElementById('joinDlg').open`), false, 'no password asked');
  assert.match(await a.js(`document.getElementById('toast').textContent`), /You stay its owner/);
  assert.equal(await a.js(saveShown), true, 'A still has Save');

  // B leaves, keeping a copy (not the default), then opens the comment link: comments only.
  await b.click('#shareBtn');
  await b.click('#shareLeave');
  assert.equal(await b.js(`document.getElementById('leaveDlg').open && document.getElementById('leaveKeep').getAttribute('aria-pressed')`), 'false', 'no copy is kept unless asked');
  await b.shot('leave');
  await b.click('#leaveKeep');
  await b.shot('leave-keep');
  await b.click('#leaveGo');
  await b.wait(`!window.scribecueRelay && !document.querySelector('#modeSw [data-mode=write]').disabled`, 'B left');
  assert.equal(await b.js(`document.querySelectorAll('#list .row').length`), 1500, 'B kept a copy');
  await joinWith(b, comment, 'grey door');
  assert.equal(await b.js(`document.getElementById('qcPermission').textContent`), 'Comments only');
  await b.open(7);
  assert.equal(await b.js(`document.getElementById('edText').readOnly`), true, 'the text can’t be changed');
  await b.js(`document.getElementById('edComment').click();document.getElementById('commentText').value='Lovely';document.getElementById('commentPost').click();true`);
  await a.wait(`window.scribecueShared.read().blocks[7].comments?.[0]?.text==='Lovely'`, 'A gets the commenter’s comment');
  await sleep(500);
  assert.equal(await a.js(`window.scribecueShared.readProposals().length`), 0, 'no suggestions from the commenter');

  // B leaves again, as it starts: without a copy. Nothing of the project stays, undo included.
  await b.click('#shareBtn');
  await b.click('#shareLeave');
  const t1 = performance.now();
  await b.click('#leaveGo');
  await b.wait(`!window.scribecueRelay && document.querySelectorAll('#list .row').length===0`, 'B left without a copy');
  const leaveMs = performance.now() - t1;
  await sleep(1500);
  await b.js(`document.body.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,ctrlKey:true,bubbles:true}));true`);
  await sleep(500);
  assert.equal(await b.js(`document.querySelectorAll('#list .row').length`), 0, 'undo doesn’t bring it back');
  assert.equal(await b.js(`Object.keys(localStorage).some(k=>k.startsWith('scribecue.share.'))`), false, 'no link kept');
  assert.equal(await b.js(`(JSON.parse(localStorage.getItem('scribecue.v1')||'{}').cues||[]).length`), 0, 'no blocks kept');

  console.log(`Relay review smoke passed at 6× with 1,500 blocks: a suggestion reached A in ${Math.round(suggestMs)} ms; leaving without a copy took ${Math.round(leaveMs)} ms; A ${await a.report()}; B ${await b.report()}`);
} finally { a.ws.close(); b.ws.close(); }
process.exit(0);
