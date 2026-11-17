// Sound cues and the quiet status in Record mode, in headless, muted Chrome at 6× CPU
// slowdown, with Chrome's fake microphone. B turns the cues on; recording a block then
// pips three times before it, once a second before its slot ends and twice at the end,
// each on time. A screen reader hears that recording started and what was saved, and
// nothing while the take is read.
// Usage: node scripts/cues-smoke.mjs <devtools port> <site url> <video path on the site>
// Chrome needs --mute-audio --use-fake-device-for-media-stream --use-fake-ui-for-media-stream.
import assert from 'node:assert/strict';
const [,, port, site, videoPath] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails)); return m.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (expression, tries = 240) => { for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(250); } throw Error('Timed out: ' + expression); };
const key = async (k, code) => { const p = { key: k, code, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p }); await sleep(300); };
const blocks = [{ start: 4, end: 7, text: 'He walks towards the door.' }, { start: 12, end: 14, text: 'Rain.' }];

await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: site }); await sleep(800);
await js(`(async()=>{localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  for(const n of ['scribecue','scribecue-takes'])await new Promise(ok=>{const q=indexedDB.deleteDatabase(n);q.onsuccess=q.onerror=q.onblocked=ok;});
  const root=await navigator.storage.getDirectory();for await (const n of root.keys())await root.removeEntry(n,{recursive:true});location.reload();return 1})()`);
await sleep(2500);
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
// Every tone, with the video time it's heard at; and everything a screen reader is given.
await js(`window.__picks=0;window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('picked-'+(++__picks),{create:true});
  window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
  window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.confirm=()=>true;
  window.__tones=[];const start=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(when=0){const v=document.querySelector('video');
    __tones.push({hz:this.frequency.value,heard:v.currentTime+(when-this.context.currentTime)*v.playbackRate,playing:!v.paused});return start.call(this,when);};
  window.__said=[];new MutationObserver(()=>{const t=document.getElementById('announce').textContent;if(t)__said.push({t,at:document.querySelector('video').currentTime,rec:document.getElementById('recGo').classList.contains('on')});})
    .observe(document.getElementById('announce'),{childList:true,characterData:true,subtree:true});true`);

const file = await js(`(async()=>{const R=await import('./js/recording.js');return JSON.parse(JSON.stringify(R.toRecordingFile({blocks:${JSON.stringify(blocks)},fps:25,project:'cuestest00000001',version:1})))})()`);
await js(`(async()=>{const v=await fetch(${JSON.stringify(videoPath)}).then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(file))}],'door.scribecuerec'));dt.items.add(new File([v],'door.mkv',{type:'video/x-matroska'}));
  window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
await wait(`document.body.classList.contains('mode-record')`);
await wait(`document.getElementById('recSessionDlg').open`);
await js(`document.getElementById('recSessionPick').click();true`);
await wait(`!document.getElementById('recSessionDlg').open`);
await wait(`document.querySelector('video').readyState>=2`);
const slotEnd = await js(`(async()=>{const R=await import('./js/recording.js');return R.slots(${JSON.stringify(blocks)},R.fromRecordingFile(${JSON.stringify(file)}).grace)[0].end})()`);

// The status under the video isn't read out as it changes.
assert.equal(await js(`document.getElementById('recStatus').getAttribute('role')`), null);
assert.equal(await js(`document.getElementById('recStatus').getAttribute('aria-live')`), null);

// Off at first; B turns them on, with a sample pip, and it's remembered.
const cuesBtn = `document.querySelector('#ind [data-key=cues]')`;
assert.equal(await js(`${cuesBtn}.getAttribute('aria-pressed')`), 'false');
await js(`document.querySelectorAll('#list .row')[0].click();document.activeElement?.blur();true`); await sleep(400);
await key('b', 'KeyB');
assert.equal(await js(`${cuesBtn}.getAttribute('aria-pressed')`), 'true');
assert.match(await js(`document.getElementById('toast').textContent`), /Sound cues on/);
assert.equal(await js(`localStorage.getItem('scribecue.rec.cues')`), '1');
assert.equal(await js(`__tones.length`), 1, 'a sample pip');
await js(`__tones=[];__said=[];__long=[];true`);

// Record block 1 past the end of its slot.
await key('r', 'KeyR'); await wait(`document.getElementById('recGo').classList.contains('on')`);
await wait(`document.querySelector('video').currentTime>${slotEnd + 0.4}`, 400);
await key('r', 'KeyR');
await wait(`/Saved take 1/.test(document.getElementById('recStatus').textContent)`);
const tones = await js(`__tones`);
const heard = (hz) => tones.filter((t) => t.hz === hz).map((t) => t.heard);
const near = (got, want, why) => { assert.equal(got.length, want.length, `${why}: ${JSON.stringify(got)}`); got.forEach((g, k) => assert.ok(Math.abs(g - want[k]) < 0.1, `${why}: heard at ${g.toFixed(3)}, should be ${want[k]}`)); };
near(heard(1000), [1, 2, 3], 'the count-in');
near(heard(660), [slotEnd - 1], 'a second before the end');
assert.equal(heard(440).length, 2, 'two low tones at the end');
assert.ok(Math.abs(heard(440)[0] - slotEnd) < 0.1, `the end: ${heard(440)[0]} should be ${slotEnd}`);

// Read out: that it's recording, at the press, and what was saved, with how far over.
const said = await js(`__said`);
assert.match(said[0].t, /^Recording block 1$/);
assert.ok(said[0].at < 3, `said before reading starts (${said[0].at})`);
assert.deepEqual(said.filter((s) => s.rec && s.at >= 3.8).map((s) => s.t), [], 'nothing while the take is read');
assert.match(await js(`document.getElementById('recStatus').textContent`), /^Saved take 1: .+, \d+\.\d s over the slot$/);
// Chrome's fake microphone is too loud: then that message is read instead.
assert.match(said.at(-1).t, /^Saved take 1: .+ over the slot$|^That take is too loud/);

// B again turns them off.
await key('b', 'KeyB');
assert.equal(await js(`${cuesBtn}.getAttribute('aria-pressed')`), 'false');
assert.equal(await js(`localStorage.getItem('scribecue.rec.cues')`), null);

assert.deepEqual(await js(`__errors`), []);
const long = await js(`__long`);
console.log(`Cues smoke passed at 6× slowdown: ${long.length} long tasks, longest ${Math.round(Math.max(0, ...long))} ms`);
ws.close();
