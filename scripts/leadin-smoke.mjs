// Lead-in checks in headless, muted Chrome at 6× CPU slowdown: hearing a block again starts
// that long before it, the block stays selected through the lead-in, and 0 acts as before.
// Usage: node scripts/leadin-smoke.mjs <devtools port> <site url> (the site needs lead-test.mp4)
import assert from 'node:assert/strict';
const [,, port, site] = process.argv;
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
const wait = async (e, n = 200) => { for (let i = 0; i < n; i++) { if (await js(e)) return; await sleep(100); } throw Error('Timed out: ' + e); };
const key = async (code, k, vk, modifiers = 0) => {
  const p = { key: k, code, windowsVirtualKeyCode: vk, modifiers };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
  await sleep(250);
};
const shiftSpace = () => key('Space', ' ', 32, 8);
const esc = () => key('Escape', 'Escape', 27);
const enter = () => key('Enter', 'Enter', 13);
const t = () => js(`document.querySelector('video').currentTime`);
const paused = () => js(`document.querySelector('video').paused`);
const selected = () => js(`[...document.querySelectorAll('[aria-selected=true]')].map(r=>r.textContent).join('|')`);
const ind = () => js(`document.getElementById('ind').textContent`);
const inB = async () => { await js(`document.querySelector('video').currentTime=9;true`); await sleep(400); };
const setLead = async (v) => { await js(`{const f=document.getElementById('setLead');f.value='${v}';f.dispatchEvent(new Event('change',{bubbles:true}));}true`); await sleep(200); };
const near = (a, b, why, by = 0.35) => assert.ok(Math.abs(a - b) < by, `${why}: ${a} is not near ${b}`);
const A = 'First block of the scene.', B = 'Second block of the scene.';
const Z = 'Block at the very start.';
const blocks = [{ start: 0, end: 1.5, text: Z }, { start: 2, end: 6, text: A }, { start: 8, end: 10, text: B }];

await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const open = async (lead, tts = {}) => {
  await send('Page.navigate', { url: site }); await sleep(800);
  await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',lead:'${lead}',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.tts',${JSON.stringify(JSON.stringify(tts))});localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(blocks)},dirty:false}));true`);
  await send('Page.reload', { ignoreCache: true }); await sleep(4000);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())__long.push(e.duration)}).observe({type:'longtask'});
    window.__first=null;window.__frames=0;(function f(){__frames++;requestAnimationFrame(f)})();true`);
  await js(`(async()=>{const v=await fetch('/lead-test.mp4').then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([v],'lead-test.mp4',{type:'video/mp4'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
  await wait(`document.querySelector('video').readyState>=2`); await sleep(800);
};
// The list's second block, by clicking it.
const pick = async (text) => { await js(`[...document.querySelectorAll('[role=option]')].find(r=>r.textContent.includes(${JSON.stringify(text)})).click();document.activeElement?.blur();true`); await sleep(300); };
// Where playback starts, from the first moment the video is playing.
const startSpot = () => js(`new Promise(r=>{const v=document.querySelector('video');v.addEventListener('playing',()=>r(v.currentTime),{once:true})})`);

// 0: starts at the block, as before, and no indicator shows.
await open(0);
assert.doesNotMatch(await ind(), /LEAD/);
await pick(B);
let spot = startSpot(); await shiftSpace();
near(await spot, 8, 'with no lead-in, the block plays from its start');
await wait(`document.querySelector('video').paused`); near(await t(), 10, 'and stops at its end', 0.1);
await inB(); await enter(); await esc(); near(await t(), 8, 'and Replay goes back to its start', 0.05);

// Set in Settings: stays set and shows under the video.
await setLead(3); await sleep(100);
assert.match(await ind(), /LEAD 3 s/);
assert.equal(await js(`localStorage.getItem('scribecue.lead')`), '3');

await open(3);
assert.match(await ind(), /LEAD 3 s/);
await pick(B);
// Play the block: starts 3 s before it, in block A, and B stays selected right through.
spot = startSpot(); await shiftSpace();
const from = await spot; near(from, 5, 'play block starts in the lead-in');
await wait(`document.querySelector('video').currentTime>5.5`);
assert.match(await selected(), /Second block/, 'the block stays selected in the lead-in');
await wait(`document.querySelector('video').paused`);
near(await t(), 10, 'and still stops at the block\'s end', 0.1);
const longPlay = await js(`[__long.length,Math.max(0,...__long)]`);

// Replay, paused: the playhead waits in the lead-in. Enter means the block, not the one under it.
await inB(); await enter(); await esc();
near(await t(), 5, 'Replay goes back to the lead-in', 0.05);
await enter();
assert.equal(await js(`document.activeElement.id`), 'edText');
assert.equal(await js(`document.getElementById('edText').value`), B, 'Enter in the lead-in reopens the block');
await esc();
near(await t(), 5, 'closing it again goes back to the lead-in', 0.05);

// Loop: back to the lead-in each time, selection unmoved, and past the block's end never.
await pick(B);
await key('KeyL', 'l', 76);
await wait(`document.querySelector('video').currentTime>9.3`, 300);
await wait(`document.querySelector('video').currentTime<6.5`, 100);
assert.match(await selected(), /Second block/, 'the loop stays on the block');
await wait(`document.querySelector('video').currentTime>9`, 100);
await key('KeyL', 'l', 76);
await esc();
await js(`document.querySelector('video').pause();true`); await sleep(200);

// Stepping away ends it: a seek elsewhere leaves Enter on the block under the playhead.
await pick(B); await inB(); await enter(); await esc();
near(await t(), 5, 'in the lead-in again', 0.05);
await js(`document.querySelector('video').currentTime=3;true`); await sleep(400);
await key('ArrowRight', 'ArrowRight', 39); // a frame on, through the app
await enter();
assert.equal(await js(`document.getElementById('edText').value`), A, 'moved away, Enter means the block there');
await esc();

// Early in the film the lead-in stops at the start.
await setLead(9);
await pick(A);
spot = startSpot(); await shiftSpace();
near(await spot, 0, 'a lead-in past the start of the film starts at 0');
await esc(); await js(`document.querySelector('video').pause();true`);

// A block at the very start has no lead-in: it plays from 0 and stops at its end.
await pick(Z);
await js(`document.querySelector('video').currentTime=1;true`); await sleep(400);
spot = startSpot(); await shiftSpace();
near(await spot, 0, 'a block at 0 plays from 0');
assert.match(await selected(), /very start/, 'and stays selected');
await wait(`document.querySelector('video').paused`); near(await t(), 1.5, 'and stops at its end', 0.1);
await js(`document.querySelector('video').currentTime=1;true`); await sleep(400);
await enter(); await esc();
near(await t(), 0, 'Replay goes back to 0', 0.05);

// Reading it: V plays the lead-in, and the reading starts at the block. Shift+V doesn't wait.
await open(3, { on: true, live: false });
await js(`window.__said=[];const say=speechSynthesis.speak.bind(speechSynthesis);speechSynthesis.speak=(u)=>{if(u.text.length>1)__said.push([u.text,document.querySelector('video').currentTime]);u.volume=0;say(u)};speechSynthesis.getVoices().length`).then((n) => console.log('voices', n));
await pick(B);
await key('KeyV', 'v', 86);
const started = await t(); near(started, 5, 'V starts in the lead-in', 0.6);
assert.equal((await js(`__said`)).length, 0, 'the reading waits for the block');
assert.match(await selected(), /Second block/);
await wait(`__said.length>0`, 120);
const read = await js(`__said[0]`);
assert.ok(read[0].startsWith('Second'), `it reads the block (${read[0]})`);
near(read[1], 8, 'the reading starts at the block', 0.25);
await js(`document.querySelector('video').pause();speechSynthesis.cancel();true`); await sleep(300);
// Stopped in the lead-in, no reading follows.
await pick(B); await key('KeyV', 'v', 86); await sleep(300);
await key('Space', ' ', 32);
const n = (await js(`__said`)).length;
await key('Space', ' ', 32); await wait(`document.querySelector('video').currentTime>8.5`, 80);
assert.equal((await js(`__said`)).length, n, 'stopping in the lead-in drops the reading');
await js(`document.querySelector('video').pause();true`); await sleep(300);
console.log(`V: reading started at ${read[1].toFixed(2)} s for a block at 8 s`);
const fps = await js(`__frames`);
assert.deepEqual(await js(`__errors`), []);
console.log(`Lead-in smoke passed at 6× slowdown: started ${(from - 5).toFixed(2)} s from the mark; ${longPlay[0]} long tasks by the end of play block, longest ${Math.round(longPlay[1])} ms; ${fps} frames drawn`);
ws.close();
