// Review the script with AI in headless, muted Chrome at a CPU slowdown, with a stand-in for
// Ollama: a video with a long script, the window and its estimate, the run (stills sent,
// comments added, the page responsive), a second review leaving out flagged blocks, and
// undo taking the comments back. Says how long it took and how many long tasks there were.
// Usage: node scripts/ai-review-smoke.mjs <devtools port> <site url> <video file> [screenshot.png] [blocks] [slowdown]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, videoFile, shot, blocks = '300', slowdown = '6'] = process.argv;
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
const wait = async (expression, what = expression, tries = 1200) => {
  for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(250); }
  throw Error(`Timed out: ${what}`);
};
const shoot = async (name) => {
  if (!shot) return;
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot.replace(/\.png$/, `-${name}.png`), Buffer.from(s.result.data, 'base64'));
};
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument');
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click();true`);
const saved = `JSON.parse(localStorage.getItem('scribecue.v1')).cues`;
const aiComments = `${saved}.flatMap(c=>(c.comments||[]).filter(m=>m.author==='AI help'))`;

const n = +blocks;
const cues = Array.from({ length: n }, (_, i) => ({ start: 1 + i * 2, end: 2.6 + i * 2, text: i % 3 ? `Mara walks along corridor ${i}.` : `We see a beautiful view ${i}.` }));
// The stand-in flags the first block of each request, and says so in a few words.
const STAND_IN = `window.__asked=[];const f=window.fetch;window.fetch=async(u,o)=>{if(!String(u).includes('/api/chat'))return f(u,o);
  const body=JSON.parse(o.body);__asked.push({images:body.messages.at(-1).images?.length||0,text:body.messages.at(-1).content,system:body.messages[0].content});
  await new Promise(r=>setTimeout(r,150));
  const first=+(/#(\\d+) \\d/.exec(body.messages.at(-1).content.split('The blocks to review:')[1])||[])[1];
  return new Response(JSON.stringify({message:{content:JSON.stringify([{block:first,kind:'style',note:'Says "we see". Describe the view instead.'}])},done:true})+'\\n')};true`;

try {
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('DOM.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(800);
  await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
    localStorage.setItem('scribecue.ai',JSON.stringify({provider:'ollama',models:{ollama:'test'},base:'http://localhost:11434',frames:3}));
    localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(cues)},dirty:false}));true`);
  await send('Page.reload'); await sleep(1500);
  await wait(`document.querySelectorAll('#list .row').length>0`, 'the list');
  await setFile('#fileVideo', videoFile);
  await wait(`document.querySelector('video').videoWidth>0`, 'the video');
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));${STAND_IN}`);

  // The window, from the drawer, with what it'll cost.
  await click('#aiBtn');
  await wait(`!document.getElementById('aiDrawer').hidden`, 'the drawer');
  await click('#aiReview');
  await wait(`document.getElementById('aiReviewDlg').open`, 'the window');
  const count = await js(`document.getElementById('aiReviewCount').textContent`);
  assert.match(count, new RegExp(`^About ${n} blocks in \\d+ requests\\. Free with Ollama`));
  assert.match(await js(`document.getElementById('aiReviewPrivacy').textContent`), /stays on this computer/);
  await shoot('window');
  // Between two times: fewer blocks, and a time that isn't one says so.
  await js(`{const r=document.getElementById('aiReviewRange');r.value='between';r.dispatchEvent(new Event('input'));document.getElementById('aiReviewFrom').value='0:00';const t=document.getElementById('aiReviewTo');t.value='zz';t.dispatchEvent(new Event('input'));}true`);
  assert.match(await js(`document.getElementById('aiReviewCount').textContent`), /Type a start and an end/);
  assert.equal(await js(`document.getElementById('aiReviewGo').disabled`), true);
  await js(`{const r=document.getElementById('aiReviewRange');r.value='all';r.dispatchEvent(new Event('input'));}true`);

  // The run: stills go with each request, a comment for each request's first block, and
  // the page stays responsive.
  const run = await js(`(async()=>{const L=[];const o=new PerformanceObserver(l=>L.push(...l.getEntries().map(e=>e.duration)));o.observe({type:'longtask'});
    let frames=0,on=true;const tick=()=>{frames++;if(on)requestAnimationFrame(tick)};requestAnimationFrame(tick);const t0=performance.now();
    document.getElementById('aiReviewGo').click();
    await new Promise(r=>{const w=()=>{if(document.getElementById('jobBox').hidden&&__asked.length)r();else setTimeout(w,200)};setTimeout(w,500)});
    on=false;o.disconnect();const s=(performance.now()-t0)/1000;
    return {secs:Math.round(s*10)/10,fps:Math.round(frames/s),long:L.length,longest:Math.round(Math.max(0,...L))};})()`);
  await wait(`${aiComments}.length>0`, 'the comments saved');
  const asked = await js(`__asked.length`);
  const comments = await js(aiComments);
  assert.equal(comments.length, asked, 'one comment for each request');
  assert.ok(comments.every((c) => c.text.startsWith('AI review · Style: Says "we see".') && !c.resolved));
  assert.ok(await js(`__asked.every(a=>a.images>0)`), 'stills with every request');
  assert.match(await js(`__asked[0].system`), /quality control reviewer/);
  assert.match(await js(`__asked[0].text`), /The blocks to review:\n#1 /);
  assert.match(await js(`document.getElementById('aiLog').textContent`), new RegExp(`AI review: ${asked} comments on ${asked} blocks, of ${n} read`));
  await shoot('done');

  // Again: the flagged blocks are left out, and said to be.
  await click('#aiReview');
  await wait(`document.getElementById('aiReviewDlg').open`, 'the window again');
  assert.match(await js(`document.getElementById('aiReviewSkipped').textContent`), new RegExp(`^${asked} blocks have an open AI review comment`));
  assert.match(await js(`document.getElementById('aiReviewCount').textContent`), new RegExp(`^About ${n - asked} blocks`));
  await click('#aiReviewCancel');

  // Comments shows them, from AI help.
  await js(`[...document.querySelectorAll('#aiLog button')].find(b=>b.textContent==='Open comments').click();true`);
  await wait(`!document.getElementById('commentsDrawer').hidden`, 'Comments');
  assert.match(await js(`document.getElementById('commentsLog').textContent`), /AI help.*AI review · Style/s);
  await sleep(800);
  await shoot('comments');

  // One undo takes them all back.
  await js(`document.activeElement?.blur();true`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: process.platform === 'darwin' ? 4 : 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: process.platform === 'darwin' ? 4 : 2 });
  await wait(`${aiComments}.length===0`, 'undo');
  assert.equal(await js(`${saved}.length`), n, 'the blocks stay');
  assert.deepEqual(await js(`__errors`), []);

  console.log(JSON.stringify({ blocks: n, requests: asked, ...run }));
  console.log('All checks passed');
} finally { ws.close(); }
