// Return to start checks in headless, muted Chrome at 6× CPU slowdown: it's for recording,
// so with it on, Write mode stops where it stops, and Record mode goes back to where playback began.
// Usage: node scripts/return-smoke.mjs <devtools port> <site url> (the site needs door-test.mkv)
import assert from 'node:assert/strict';
const [,, port, site] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0; const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const js=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(e,n=120)=>{for(let i=0;i<n;i++){if(await js(e))return;await sleep(250);}throw Error('Timed out: '+e);};
const space=async()=>{const p={key:' ',code:'Space',windowsVirtualKeyCode:32};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...p});await send('Input.dispatchKeyEvent',{type:'keyUp',...p});await sleep(200);};
const ind=()=>js(`document.getElementById('ind').textContent`);
const vis=()=>js(`getComputedStyle(document.getElementById('setReturn')).display!=='none'&&document.getElementById('setReturn').offsetParent!==null`);
const t=()=>js(`document.querySelector('video').currentTime`);
await send('Emulation.setFocusEmulationEnabled',{enabled:true});
await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
await send('Emulation.setCPUThrottlingRate',{rate:6});
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:site});await sleep(800);
await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',returnToStart:'1',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:4,end:7,text:'He walks towards the door.'}],dirty:false}));indexedDB.deleteDatabase('scribecue-takes');true`);await send('Page.reload',{ignoreCache:true});
await sleep(5000);
await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.confirm=()=>true;true`);
const blocks=[{start:4,end:7,text:'He walks towards the door.'}];
// Write mode, with the setting on: no RETURN, no setting, and stopping stays put.
await js(`(async()=>{const v=await fetch('/door-test.mkv').then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([v],'door.mkv',{type:'video/x-matroska'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
await wait(`document.querySelector('video').readyState>=2`);await sleep(500);
assert.doesNotMatch(await ind(),/RETURN/);
await js(`document.querySelector('nav [data-act=settings], #settingsBtn, button[aria-label=Settings]')?.click();true`);await sleep(400);
assert.equal(await vis(),false,'the setting is hidden in Write mode');
await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.activeElement?.blur();true`);await sleep(300);
await js(`document.querySelector('video').currentTime=2;true`);await sleep(300);
await space();await wait(`document.querySelector('video').currentTime>3.2`);await space();await sleep(400);
const w=await t(); assert.ok(w>3,`Write mode stays where it stopped (${w})`);
// Record mode: RETURN shows, the setting shows, and stopping goes back.
await js(`(async()=>{const R=await import('./js/recording.js');const file=JSON.parse(JSON.stringify(R.toRecordingFile({blocks:${JSON.stringify(blocks)},fps:25})));const v=await fetch('/door-test.mkv').then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(file)],'door.scribecuerec'));dt.items.add(new File([v],'door.mkv',{type:'video/x-matroska'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
await wait(`document.body.classList.contains('mode-record')`);await wait(`document.querySelector('video').readyState>=2`);await sleep(800);
assert.match(await ind(),/RETURN/);
await js(`[...document.querySelectorAll('#ind button')].find(b=>b.textContent==='RETURN').click();true`);await sleep(400);
assert.equal(await vis(),true,'the setting shows in Record mode');
await js(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.activeElement?.blur();true`);await sleep(300);
await js(`document.querySelector('video').currentTime=2;true`);await sleep(300);
await space();await wait(`document.querySelector('video').currentTime>3.2`);await space();await sleep(400);
const r=await t(); assert.ok(Math.abs(r-2)<0.1,`Record mode goes back to the start (${r})`);
assert.deepEqual(await js(`__errors`),[]);
console.log(`Return smoke passed at 6× slowdown: Write mode stopped at ${w.toFixed(2)} s, Record mode returned to ${r.toFixed(2)} s`);
ws.close();
