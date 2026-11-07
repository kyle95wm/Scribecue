// Clicking a block checks in headless, muted Chrome at 6× CPU slowdown: a click opens the
// block and leaves the playhead alone, and Esc or Enter then moves it to the block.
// Record mode has nothing to type, so a click there still goes straight to the block.
// Usage: node scripts/click-smoke.mjs <devtools port> <site url> (the site needs door-test.mkv)
import assert from 'node:assert/strict';
const [,, port, site] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails)); return m.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (e, n = 120) => { for (let i = 0; i < n; i++) { if (await js(e)) return; await sleep(250); } throw Error('Timed out: ' + e); };
const key = async (k, code, vk, mods = 0) => { const p = { key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p }); await sleep(400); };
const esc = () => key('Escape', 'Escape', 27);
const enter = () => key('Enter', 'Enter', 13);
const t = () => js(`document.querySelector('video').currentTime`);
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 0.1, `${why}: ${a} should be ${b}`);
const goTo = async (s) => { await js(`document.activeElement?.blur();document.querySelector('video').currentTime=${s};true`); await sleep(500); };
const rowAt = async (i) => { await js(`document.querySelectorAll('#list .row')[${i}].click();true`); await sleep(400); };
const blocks = [{ start: 4, end: 7, text: 'He walks towards the door.' }, { start: 10, end: 13, text: 'She looks up.' }];
const load = (body) => js(`(async()=>{const v=await fetch('/door-test.mkv').then(r=>r.blob());const dt=new DataTransfer();${body}dt.items.add(new File([v],'door.mkv',{type:'video/x-matroska'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);

await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: site }); await sleep(800);
await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(blocks)},dirty:false}));indexedDB.deleteDatabase('scribecue-takes');true`);
await send('Page.reload', { ignoreCache: true }); await sleep(5000);
await js(`window.showDirectoryPicker=undefined;window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.confirm=()=>true;window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
await load('');
await wait(`document.querySelector('video').readyState>=2`); await sleep(500);

// Replay on: the click stays put, typing stays put, Esc goes to the block.
await goTo(1);
await rowAt(1);
near(await t(), 1, 'a click leaves the playhead alone');
assert.equal(await js(`document.activeElement.id`), 'edText', 'a click opens the block to type in');
await send('Input.insertText', { text: ' Then away.' }); await sleep(300);
near(await t(), 1, 'typing leaves the playhead alone');
await esc();
near(await t(), 10, 'Esc goes to the block');
assert.match(await js(`document.querySelectorAll('#list .row')[1].textContent`), /Then away/);

// Enter does the same.
await goTo(1);
await rowAt(0);
near(await t(), 1, 'a second click leaves it too');
await enter();
near(await t(), 4, 'Enter goes to the block');

// Clicking one block and then another ends at the second.
await goTo(1);
await rowAt(0); await rowAt(1);
near(await t(), 1, 'clicking between blocks leaves it');
await esc();
near(await t(), 10, 'Esc goes to the last block clicked');

// While playing, the click doesn't interrupt, and Esc moves it and it carries on.
await goTo(0.5);
await key(' ', 'Space', 32); await wait(`!document.querySelector('video').paused`);
await rowAt(1);
const during = await t();
assert.ok(during < 4, `a click while playing doesn't jump (${during})`);
await esc();
const after = await t();
assert.ok(after >= 10 && after < 11.5, `Esc while playing goes to the block (${after})`);
assert.equal(await js(`document.querySelector('video').paused`), false, 'it carries on playing');
await js(`document.activeElement?.blur();true`); await key(' ', 'Space', 32);

// Replay off: a block clicked open still gets the playhead.
await goTo(1);
await key('L', 'KeyL', 76, 8);
assert.equal(await js(`localStorage.getItem('scribecue.replay')`), '0');
await rowAt(1);
near(await t(), 1, 'Replay off: a click leaves it');
await esc();
near(await t(), 10, 'Replay off: Esc goes to a block clicked open');

// Replay off: a block opened at the playhead with Enter stays where it is.
await goTo(11);
await enter();
assert.equal(await js(`document.activeElement.id`), 'edText');
await esc();
near(await t(), 11, 'Replay off: a block opened at the playhead stays put');
await key('L', 'KeyL', 76, 8);

// Record mode goes straight to the block.
await load(`const R=await import('./js/recording.js');dt.items.add(new File([JSON.stringify(JSON.parse(JSON.stringify(R.toRecordingFile({blocks:${JSON.stringify(blocks)},fps:25}))))],'door.scribecuerec'));`);
await wait(`document.body.classList.contains('mode-record')`); await wait(`document.querySelector('video').readyState>=2`); await sleep(800);
await goTo(1);
await rowAt(1);
near(await t(), 10, 'Record mode: a click goes to the block');

assert.deepEqual(await js(`__errors`), []);
const long = await js(`__long`);
console.log(`Click smoke passed at 6× slowdown: ${long.length} long tasks, longest ${Math.round(Math.max(0, ...long))} ms`);
ws.close();
