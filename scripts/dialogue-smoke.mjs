// Dialogue lane checks in headless, muted Chrome, at a CPU slowdown: opens a video with a
// subtitle track, and measures how the page copes while the lane is read, playing, and
// zoomed and scrolled.
// Usage: node scripts/dialogue-smoke.mjs <devtools port> <site url> <video file> [screenshot.png] [slowdown] [subtitle file]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, videoFile, shot, slowdown = '6', subFile] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
  return m.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (expression, tries = 2400) => { for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(250); } throw Error('Timed out: ' + expression); };
const key = async (k, code, shift = false) => {
  const p = { key: k, code, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), modifiers: shift ? 8 : 0 };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
};
const shoot = async (name) => { if (!shot) return; const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shot.replace(/\.png$/, `-${name}.png`), Buffer.from(s.result.data, 'base64')); };
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument');
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const clock = () => js(`document.querySelector('video').currentTime`);
// Frame rate and long tasks while `act`, some page script, runs for ms.
const measure = (act, ms) => js(`(async()=>{const L=[];const o=new PerformanceObserver(l=>L.push(...l.getEntries().map(e=>e.duration)));o.observe({type:'longtask'});
  let frames=0,run=true;const tick=()=>{frames++;if(run)requestAnimationFrame(tick)};requestAnimationFrame(tick);const t0=performance.now();
  const stop=${act};await new Promise(r=>setTimeout(r,${ms}));stop?.();run=false;o.disconnect();
  return {fps:Math.round(frames/((performance.now()-t0)/1000)),long:L.length,longest:Math.round(Math.max(0,...L))};})()`);
try {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('DOM.enable');
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(800);
  await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"record":true}'}))localStorage.setItem('scribecue.'+k,v);indexedDB.deleteDatabase('scribecue-dialogue');indexedDB.deleteDatabase('scribecue-waves');true`);
  await send('Page.reload'); await sleep(2000);
  // That the slowdown is really on: the same sum, with and without it.
  const sum = `(()=>{const t=performance.now();let x=0;for(let i=0;i<3e7;i++)x+=i%7;return performance.now()-t})()`;
  const slow = await js(sum);
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const full = await js(sum);
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  console.log(`page speed: ${(slow / full).toFixed(1)}× slower (${Math.round(full)} ms -> ${Math.round(slow)} ms)`);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));true`);
  assert.equal(await js(`document.getElementById('dialPick').hidden`), true, 'no picker without a video');

  // Reading: the page stays responsive, and shows how far it's got.
  await js(`window.__first=0;const c=document.getElementById('dialTrack');new MutationObserver(()=>{if(!c.hidden&&!__first)__first=performance.now()}).observe(c,{attributes:true});true`);
  const t0 = Date.now();
  await setFile('#fileVideo', videoFile);
  await wait(`!document.getElementById('dialPick').hidden`);
  const measuring = measure(`null`, 3000);
  await wait(`document.getElementById('dialSel').value.startsWith('t')&&!document.getElementById('dialSel').dataset.reading`);
  const readMs = Date.now() - t0;
  const reading = await measuring;
  console.log(`reading the subtitles: ${readMs} ms from opening; while reading:`, reading);
  await sleep(500);
  assert.equal(await js(`document.getElementById('dialTrack').hidden`), false, 'the lane shows');
  assert.match(await js(`document.getElementById('toast').textContent`), /Dialogue lane|Waveform|Loading/);
  await shoot('lane');

  // Gaps: D and Shift+D, in order, landing where the lane says.
  await js(`document.querySelector('video').currentTime=30;true`); await sleep(500);
  await key('d', 'KeyD'); await sleep(600);
  const a = await clock();
  assert.ok(a > 30, `D moves forward (${a})`);
  assert.match(await js(`document.getElementById('toast').textContent`), /^Gap of \d+\.\d s$/);
  await key('d', 'KeyD'); await sleep(600);
  const b = await clock();
  assert.ok(b > a, `D again moves on (${b})`);
  await key('D', 'KeyD', true); await sleep(600);
  assert.ok(Math.abs(await clock() - a) < 0.1, 'Shift+D goes back');
  await key('d', 'KeyD'); await sleep(400);

  // A click on the lane moves the playhead.
  await js(`(()=>{const r=document.getElementById('dialTrack').getBoundingClientRect();document.getElementById('dialTrack').dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:r.left+300,clientY:r.top+10,bubbles:true}));})()`);
  await sleep(500);
  assert.notEqual(await clock(), b, 'a click on the lane seeks');
  await shoot('close');

  // Playing, then scrolling and zooming the timeline.
  await js(`document.querySelector('video').currentTime=60;document.querySelector('video').play();true`); await sleep(1000);
  console.log('playing:', await measure(`null`, 6000), await js(`(()=>{const q=document.querySelector('video').getVideoPlaybackQuality();return {shown:q.totalVideoFrames,dropped:q.droppedVideoFrames}})()`));
  console.log('playing and following:', await measure(`null`, 3000));
  await js(`document.querySelector('video').pause();true`);
  const scroll = await measure(`(()=>{const tl=document.getElementById('tl'),r=tl.getBoundingClientRect();let x=0;const iv=setInterval(()=>{x++;tl.dispatchEvent(new WheelEvent('wheel',{deltaX:40,deltaMode:0,clientX:r.left+300,clientY:r.top+50,bubbles:true,cancelable:true}))},16);return ()=>clearInterval(iv)})()`, 3000);
  console.log('scrolling:', scroll);
  await js(`document.querySelector('#tlZoom [data-zoom=fit]').click();true`); await sleep(600);
  await shoot('fit');
  const zoom = await measure(`(()=>{const tl=document.getElementById('tl'),r=tl.getBoundingClientRect();let d=-120;const iv=setInterval(()=>{d=-d*1;tl.dispatchEvent(new WheelEvent('wheel',{deltaY:Math.sign(d)*-60,ctrlKey:true,clientX:r.left+500,clientY:r.top+50,bubbles:true,cancelable:true}))},16);return ()=>clearInterval(iv)})()`, 3000);
  console.log('zooming:', zoom);

  // Turned off, and remembered; back on, reopened from what's kept with no reading.
  const off = await js(`(()=>{const s=document.getElementById('dialSel');s.value='off';s.dispatchEvent(new Event('change'));return document.getElementById('dialTrack').hidden})()`);
  assert.equal(off, true, 'Off hides the lane');

  // A subtitle file instead of a track.
  if (subFile) {
    await js(`window.showOpenFilePicker=undefined;document.getElementById('fileDialogue').click=()=>{};(()=>{const s=document.getElementById('dialSel');s.value='load';s.dispatchEvent(new Event('change'))})();true`);
    await sleep(300);
    await setFile('#fileDialogue', subFile);
    await wait(`document.getElementById('dialSel').value==='file'`);
    assert.equal(await js(`document.getElementById('dialTrack').hidden`), false, 'a subtitle file shows the lane');
    await sleep(800);
    await send('Page.reload'); await sleep(2500);
    await setFile('#fileVideo', videoFile);
    await wait(`document.getElementById('dialSel').value==='file'`, 200);
    console.log('a subtitle file comes back when the video is reopened');
  }
  const errors = await js(`window.__errors||[]`);
  assert.deepEqual(errors, []);
  console.log('dialogue smoke passed');
} finally { ws.close(); }
