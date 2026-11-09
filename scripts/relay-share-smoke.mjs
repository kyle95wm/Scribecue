// Two people sharing a project through the relay, each in their own headless, muted Chrome at
// 6× CPU slowdown, with 1,500 blocks over two hours, through the Share and join dialogs. A
// makes an edit link; B opens it (a wrong password first); typing passes both ways, once each
// block is done; B reloads and is still in; B goes offline, edits, and catches up; A shares a
// separate Google key, which B reads Google voices with (Google's answers are stubbed in both
// pages, so no real key is used); A's voice becomes B's, which B can't change; A takes the key
// out; A turns the link off, makes a new one that B opens again; a link that expires lets B go
// and is turned off; B opens A's recovery link and is the owner too; then A stops sharing. Takes screenshots of both dialogs if given a folder.
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
const settings = (name, cues, on = true) => `localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:${JSON.stringify(name)},${on ? "sharedCopy:'1'," : ''}relay:${JSON.stringify(RELAY)},setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,projectId:crypto.randomUUID(),cues:${cues}}));Storage.prototype.setItem=()=>{};location.reload();true`;
const online = `window.scribecueRelay?.status==='online' && !window.scribecueRelay.unsent()`;
// Google's answers, without a real key: only "separate-test-key" is accepted.
const stubGoogle = `(()=>{const f=window.fetch;window.__googleKeys=[];window.fetch=(u,i)=>{if(!String(u).includes('texttospeech.googleapis.com'))return f(u,i);const k=i?.headers?.['x-goog-api-key'];__googleKeys.push(k);
  if(k!=='separate-test-key')return Promise.resolve(new Response(JSON.stringify({error:{message:'API key not valid. Please pass a valid API key.'}}),{status:400}));
  return Promise.resolve(new Response(JSON.stringify(String(u).endsWith('/voices')?{voices:[{name:'en-US-Standard-C',languageCodes:['en-US'],ssmlGender:'FEMALE'}]}:{audioContent:''})))};return true})()`;
const googleVoices = (site) => `import(${JSON.stringify(new URL('js/tts.js', site).href)}).then(m=>m.usingProjectGoogleKey()?m.tts.google.length:-1)`;
const rowText = (n) => `[...document.querySelectorAll('#list .row')][${n}]?.textContent||''`;

const a = await browser(portA), b = await browser(portB);
try {
  await a.send('Page.navigate', { url: site }); await b.send('Page.navigate', { url: site }); await sleep(800);
  // Neither has a name yet: each is asked for one before sharing or joining.
  await a.js(settings('', `Array.from({length:1500},(_,i)=>({uid:crypto.randomUUID(),start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.'}))`));
  // B hasn't turned sharing on: opening the link does that.
  await b.js(settings('', '[]', false));
  await a.wait(`window.scribecueSharing && !document.getElementById('shareBtn').hidden`, 'A ready');
  // A project not yet shared has no shared copy: Yjs loads once it's shared.
  assert.equal(await a.js(`!!window.scribecueShared || performance.getEntriesByType('resource').some(e=>/yjs\\.js/.test(e.name))`), false, 'nothing of the shared copy loaded yet');
  await b.wait(`document.getElementById('list') && document.readyState==='complete'`, 'B ready');
  await sleep(1500);
  assert.equal(await b.js(`!!window.scribecueSharing || !document.getElementById('shareBtn').hidden || performance.getEntriesByType('resource').some(e=>/shar/.test(e.name))`), false, 'sharing is off for B');
  await a.watch(); await b.watch();

  // A shares from the dialog: an edit link with its password.
  assert.equal(await a.js(`!document.getElementById('shareBtn').hidden`), true, 'Share shows');
  await a.click('#shareBtn');
  await a.wait(`document.getElementById('shareDlg').open`, 'Share dialog');
  await a.shot('share-empty');
  assert.equal(await a.js(`/can’t read it/.test(document.getElementById('sharePrivacy').textContent)`), true, 'the privacy note shows');
  await a.fill('#sharePw-edit', 'blue door');
  await a.click('#sharePw-edit ~ button');
  await a.wait(`document.activeElement?.id==='shareName' && /Add your name/.test(document.getElementById('toast').textContent)`, 'A is asked for a name');
  assert.equal(await a.js(`!!document.querySelector('.sharelink')`), false, 'no link without a name');
  await a.fill('#shareName', 'Kyle');
  let t0 = performance.now();
  await a.click('#sharePw-edit ~ button');
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
  assert.equal(await b.js(`localStorage.getItem('scribecue.sharedCopy')`), '1', 'the link turned sharing on');
  await b.watch();
  await b.shot('join');
  await b.fill('#joinPassword', 'blue');
  await b.click('#joinOpen');
  await b.wait(`/Add your name/.test(document.getElementById('joinStatus').textContent) && document.activeElement?.id==='joinName'`, 'B is asked for a name');
  await b.fill('#joinName', 'Sam');
  await b.click('#joinOpen');
  await b.wait(`/doesn’t open/.test(document.getElementById('joinStatus').textContent)`, 'wrong password refused');
  t0 = performance.now();
  await b.fill('#joinPassword', 'blue door');
  await b.click('#joinOpen');
  await b.wait(`document.querySelectorAll('#list .row').length===1500 && ${online}`, 'B has the whole script');
  const joinMs = performance.now() - t0;
  assert.equal(await b.js(`location.hash`), '', 'the link leaves the address bar');
  assert.equal(await b.js(rowText(1)), await a.js(rowText(1)));

  // Typing both ways. Others see a block once it's done, not letter by letter.
  await a.open(1);
  const aMs = await a.type(' Kyle typed this.');
  await sleep(1500);
  assert.ok(!(await b.js(rowText(1))).includes('Kyle typed'), 'B doesn’t see A’s letters while A types');
  await b.wait(`document.querySelector('#list .here .who.editing')`, 'B sees that A is editing');
  await a.js(`document.activeElement.blur();true`);
  t0 = performance.now();
  await b.wait(`(${rowText(1)}).includes('Kyle typed this.')`, 'B sees A’s block once done');
  const reachMs = performance.now() - t0;
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

  // A lets B use a separate Google key: a wrong one is refused, the right one reaches B, whose
  // Google voices read with it. Taking it out tells B.
  await a.js(stubGoogle); await b.js(stubGoogle);
  await a.click('#shareBtn');
  await a.wait(`!document.getElementById('shareGoogle').hidden`, 'A sees Google voices in the dialog');
  await a.click('#shareGoogleOn');
  await a.wait(`!document.getElementById('shareGoogleRow').hidden && document.activeElement?.id==='shareGoogleKey'`, 'the key field opens');
  await a.shot('share-google-key');
  await a.fill('#shareGoogleKey', 'wrong-test-key');
  await a.click('#shareGoogleSave');
  await a.wait(`/didn’t accept that key/.test(document.getElementById('toast').textContent)`, 'a wrong key is refused');
  assert.equal(await a.js(`scribecueShared.googleKey()`), '', 'nothing shared');
  await a.fill('#shareGoogleKey', 'separate-test-key');
  t0 = performance.now();
  await a.click('#shareGoogleSave');
  await a.wait(`document.getElementById('shareGoogleOn').getAttribute('aria-pressed')==='true' && !document.getElementById('shareGoogleRow').offsetParent`, 'A shared the key, and the field goes');
  await b.wait(`${googleVoices(site)}.then(n=>n===1)`, 'B reads Google voices with it');
  const keyMs = performance.now() - t0;
  assert.equal(await b.js(`__googleKeys.every(k=>k==='separate-test-key')`), true, 'B asked Google with the project’s key');
  await a.shot('share-google');

  // The project's voice is A's: it reaches B, whose voice and block voices are locked.
  const ttsJs = JSON.stringify(new URL('js/tts.js', site).href);
  t0 = performance.now();
  await a.js(`import(${ttsJs}).then(m=>{m.tts.on=true;m.setTtsOption('voice','google:en-US-Standard-C');return true})`);
  await b.wait(`import(${ttsJs}).then(m=>m.tts.voice==='google:en-US-Standard-C')`, 'B reads with A’s voice');
  const voiceMs = performance.now() - t0;
  await b.js(`import(${ttsJs}).then(m=>{m.tts.on=true;m.setTtsOption('voice','piper:en_US-lessac-medium');return true})`);
  await b.wait(`/Only this shared project’s owner changes its voices/.test(document.getElementById('toast').textContent)`, 'B can’t change it');
  assert.equal(await b.js(`import(${ttsJs}).then(m=>m.tts.voice)`), 'google:en-US-Standard-C');
  await b.open(4);
  assert.equal(await b.js(`document.getElementById('edVoiceWrap').hidden`), true, 'no block voice menu for B');
  await a.open(4);
  assert.equal(await a.js(`document.getElementById('edVoiceWrap').hidden`), false, 'A has the block voice menu');
  await a.js(`document.activeElement?.blur();true`); await b.js(`document.activeElement?.blur();true`);
  await b.js(`import(${ttsJs}).then(m=>{m.openTts();return true})`);
  await b.wait(`!document.getElementById('ttsVoiceLocked').hidden && document.getElementById('ttsVoice').disabled`, 'B’s Settings say the owner sets the voice');
  await b.shot('voice-locked');
  await a.js(`import(${ttsJs}).then(m=>{m.openTts();return true})`);
  await a.wait(`document.getElementById('ttsVoiceLocked').hidden && !document.getElementById('ttsVoice').disabled`, 'A’s Settings are as before');
  await a.shot('voice-owner');
  await a.js(`document.getElementById('ttsDlg').close();true`); await b.js(`document.getElementById('ttsDlg').close();true`);
  await a.click('#shareGoogleOn');
  await a.wait(`document.getElementById('shareGoogleOn').getAttribute('aria-pressed')==='false' && scribecueShared.googleKey()===''`, 'A takes the key out');
  await b.wait(`/Google key was taken out/.test(document.getElementById('toast').textContent)`, 'B is told');
  assert.equal(await b.js(`import(${JSON.stringify(new URL('js/tts.js', site).href)}).then(m=>m.tts.google.length)`), 0, 'B has no Google voices now');
  await a.js(`document.getElementById('shareClose').click();true`);

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
  await a.click('#sharePw-edit ~ button');
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

  // A replaces the link with one that expires after a day; B opens it.
  await a.click('#shareBtn');
  await a.js(`[...document.querySelectorAll('#shareLinks button')].find(b=>b.textContent==='Turn off').click();true`);
  await a.wait(`document.getElementById('sharePw-edit')`, 'A’s link is off');
  await b.wait(`!window.scribecueRelay`, 'B is let go again');
  await a.fill('#sharePw-edit', 'green door');
  await a.fill('#shareDays-edit', '400');
  await a.click('#sharePw-edit ~ button');
  await a.wait(`/from 1 to 365/.test(document.getElementById('toast').textContent) && !document.querySelector('.sharelink')`, 'too many days are refused');
  await a.fill('#shareDays-edit', '1');
  await a.click('#sharePw-edit ~ button');
  await a.wait(`document.querySelector('.sharelink') && /in 1 day$/.test(document.querySelector('.shareexpiry')?.textContent) && ${online}`, 'A’s link says when it expires');
  await a.shot('share-expiry');
  const dated = await a.js(`document.querySelector('.sharelink').value`);
  await b.js(`window.confirm=()=>true;location.href=${JSON.stringify(dated)};true`);
  await b.wait(`document.getElementById('joinDlg').open`, 'join dialog for the dated link');
  await b.fill('#joinPassword', 'green door');
  await b.click('#joinOpen');
  await b.wait(`document.querySelectorAll('#list .row').length===1500 && ${online}`, 'B in with the dated link');
  await b.click('#shareBtn');
  await b.wait(`/Your link expires .+, in 1 day\./.test(document.getElementById('shareIntro').textContent)`, 'B is told when its link expires');
  await b.shot('share-expiry-joined');
  await b.js(`document.getElementById('shareClose').click();true`);
  // As if a day went by: A's link now expires in a few seconds. A sends the list on
  // reconnecting, then turns the link off once it has expired.
  await a.js(`(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('scribecue.share.')),r=JSON.parse(localStorage.getItem(k)),l=r.links.find(l=>!l.off);l.expires=Date.now()+6000;r.n++;localStorage.setItem(k,JSON.stringify(r));scribecueRelay.ws.close();return true})()`);
  t0 = performance.now();
  await b.wait(`!window.scribecueRelay && /link to this project has expired/.test(document.getElementById('toast').textContent)`, 'B is told its link expired');
  const expiredMs = performance.now() - t0;
  assert.equal(await b.js(`document.querySelectorAll('#list .row').length`), 1500, 'B keeps its copy');
  await a.wait(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('scribecue.share.')))).links.filter(l=>!l.off).length===0`, 'A turns the expired link off');
  await a.wait(`document.getElementById('sharePw-edit')`, 'A’s dialog offers a new link');
  assert.equal(await a.js(`scribecueRelay.cipher.count`), 4, 'a new project key once it expired');
  // Opening it again says it expired.
  await b.js(`window.confirm=()=>true;location.href=${JSON.stringify(dated)};true`);
  await b.wait(`document.getElementById('joinDlg').open`, 'join dialog for the expired link');
  await b.wait(`/has expired/.test(document.getElementById('joinStatus').textContent) && document.getElementById('joinTitle').textContent==='Open a shared project'`, 'the dialog says it expired before a password');
  await b.fill('#joinPassword', 'green door');
  await b.click('#joinOpen');
  await b.wait(`/has expired/.test(document.getElementById('joinStatus').textContent)`, 'B is told the link expired');
  await b.js(`document.getElementById('joinDlg').close();true`);
  await a.js(`document.getElementById('shareClose').click();true`);

  // A makes a recovery link. B opens it and is the owner too: B's new link reaches A's list.
  await a.click('#shareBtn');
  await a.fill('#sharePw-recovery', 'short');
  await a.click('#sharePw-recovery ~ button');
  await a.wait(`/at least 10 characters/.test(document.getElementById('toast').textContent)`, 'a short recovery password is refused');
  await a.fill('#sharePw-recovery', 'a long recovery password');
  await a.click('#sharePw-recovery ~ button');
  await a.wait(`document.querySelector('input[aria-label="Recovery link"]') && ${online}`, 'A’s recovery link');
  await a.shot('share-recovery');
  const recovery = await a.js(`document.querySelector('input[aria-label="Recovery link"]').value`);
  await a.js(`document.getElementById('shareClose').click();true`);
  await b.js(`window.confirm=()=>true;location.href=${JSON.stringify(recovery)};true`);
  await b.wait(`document.getElementById('joinDlg').open`, 'join dialog for the recovery link');
  await b.wait(`document.getElementById('joinTitle').textContent==='Take back this project' && document.getElementById('joinOpen').textContent==='Take back project' && document.getElementById('joinVideo').hidden`, 'the dialog says it’s a recovery link');
  await b.shot('join-recovery');
  await b.fill('#joinPassword', 'not the password');
  await b.click('#joinOpen');
  await b.wait(`/isn’t this recovery link’s password/.test(document.getElementById('joinStatus').textContent)`, 'a wrong recovery password is refused');
  await b.fill('#joinPassword', 'a long recovery password');
  t0 = performance.now();
  await b.click('#joinOpen');
  await b.wait(`document.querySelectorAll('#list .row').length===1500 && ${online} && scribecueRelay.role==='owner'`, 'B is in as the owner');
  const recoverMs = performance.now() - t0;
  assert.ok(await same(), 'both copies agree');
  await b.click('#shareBtn');
  await b.wait(`document.querySelector('input[aria-label="Recovery link"]')?.value===${JSON.stringify(recovery)} && document.getElementById('sharePw-review') && !document.getElementById('shareStop').hidden`, 'B’s Share is the owner’s');
  await b.fill('#sharePw-review', 'made elsewhere');
  await b.click('#sharePw-review ~ button');
  await b.wait(`document.querySelector('.sharelink[aria-label="Can review link"]') && ${online}`, 'B makes a review link');
  const madeOnB = await b.js(`document.querySelector('.sharelink[aria-label="Can review link"]').value`);
  await a.click('#shareBtn');
  await a.wait(`document.querySelector('.sharelink[aria-label="Can review link"]')?.value===${JSON.stringify(madeOnB)}`, 'A catches up with B’s link');
  await b.js(`document.getElementById('shareClose').click();true`);
  await a.js(`document.getElementById('shareClose').click();true`);
  // A stops sharing: back to a plain project.
  await a.click('#shareBtn');
  await a.js(`window.confirm=()=>true;document.getElementById('shareStop').click();true`);
  await a.wait(`!window.scribecueRelay && !Object.keys(localStorage).some(k=>k.startsWith('scribecue.share.'))`, 'A stopped sharing');
  await a.js(`document.getElementById('shareClose').click();true`);

  console.log(`Relay share smoke passed at 6× with 1,500 blocks: sharing took ${Math.round(shareMs)} ms, joining ${Math.round(joinMs)} ms; A typed ${(aMs / 17).toFixed(1)} ms a character; it reached B in ${Math.round(reachMs)} ms; a shared Google key reached B in ${Math.round(keyMs)} ms, the project's voice in ${Math.round(voiceMs)} ms; an expired link let B go ${Math.round(expiredMs)} ms after it was set to; B recovered the owner's place in ${Math.round(recoverMs)} ms; A ${await a.report()}; B ${await b.report()} since reloading`);
} finally { a.ws.close(); b.ws.close(); }
process.exit(0);
