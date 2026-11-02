// Recording session checks in headless, muted Chrome at 6× CPU slowdown, with Chrome's fake
// microphone. Folders are stood in for by folders in the browser's own storage. The narrator
// opens a recording with a take kept from before sessions, chooses a folder, which the take
// moves into, records, reloads, and exports a session package; then the package opens again
// on "another computer". Last, a large session is packaged, to check it stays responsive.
// Usage: node scripts/session-smoke.mjs <devtools port> <site url> <video path on the site> [minutes of takes]
// Chrome needs --use-fake-device-for-media-stream --use-fake-ui-for-media-stream.
import assert from 'node:assert/strict';
const [,, port, site, videoPath, bigMinutes = '60'] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0; const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const js=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(expression,tries=240)=>{for(let i=0;i<tries;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};
const key=async(k,code)=>{const p={key:k,code,windowsVirtualKeyCode:{Enter:13}[k]||k.toUpperCase().charCodeAt(0)};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...p});await send('Input.dispatchKeyEvent',{type:'keyUp',...p});await sleep(200);};
const text=id=>js(`document.getElementById(${JSON.stringify(id)}).textContent`);
const blocks=[{start:4,end:7,text:'He walks towards the door.'},{start:12,end:14,text:'Rain.'}];
// Stand-ins for the folder and save pickers: folders and a file in the browser's own storage.
const stubs=`window.__picks=0;window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('picked-'+(++__picks),{create:true});
 window.showSaveFilePicker=async()=>(await navigator.storage.getDirectory()).getFileHandle('out.scribecuesession',{create:true});
 window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
 window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.confirm=()=>true;true`;
const sessionTakes=dir=>js(`(async()=>{const S=await import('./js/session.js');const d=await (await navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(dir)});
  const j=S.fromSession(JSON.parse(await (await (await d.getFileHandle('session.json')).getFile()).text()));const files=[];for await (const [n] of (await d.getDirectoryHandle('takes')).entries())files.push(n);
  return {takes:j.takes.map(t=>({block:t.block,chosen:t.chosen})).sort((a,z)=>a.block-z.block),files:files.length}})()`);
const longest=async()=>{const l=await js('__long');await js('__long=[];true');return {count:l.length,max:Math.round(Math.max(0,...l))};};
try {
 await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:site});await sleep(800);
 await js(`(async()=>{localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  for(const n of ['scribecue','scribecue-takes'])await new Promise(ok=>{const q=indexedDB.deleteDatabase(n);q.onsuccess=q.onerror=q.onblocked=ok;});
  const root=await navigator.storage.getDirectory();for await (const n of root.keys())await root.removeEntry(n,{recursive:true});location.reload();return 1})()`);
 await sleep(2500);
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await js(stubs);

 // A take of block 2, kept in the browser before sessions.
 const file=await js(`(async()=>{const R=await import('./js/recording.js'),B=await import('./js/bwf.js'),T=await import('./js/takestore.js');
  const file=JSON.parse(JSON.stringify(R.toRecordingFile({blocks:${JSON.stringify(blocks)},fps:25,project:'sessiontest00001',version:1})));
  const pcm=new Float32Array(48000).map((_,i)=>Math.sin(i/20)*0.2);
  await T.saveTake({id:crypto.randomUUID(),rec:R.takesKey(R.fromRecordingFile(file)),block:1,start:12.1,duration:1,peak:R.peakDb(pcm),made:Date.now(),wav:B.wav24(B.to24(pcm)),line:{start:12,end:14,text:'Rain.'},ver:1},true);
  return file})()`);

 // Opening the recording asks where to keep the takes, and says the old one will move.
 await js(`(async()=>{const v=await fetch(${JSON.stringify(videoPath)}).then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(file))}],'door.scribecuerec'));dt.items.add(new File([v],'door.mkv',{type:'video/x-matroska'}));
  window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
 await wait(`document.body.classList.contains('mode-record')`);
 await wait(`document.getElementById('recSessionDlg').open`);
 assert.match(await text('recSessionOld'),/The 1 take kept in this browser for this recording will move there/);
 // Enter in the dialog doesn't record.
 await key('r','KeyR');
 assert.equal(await js(`document.getElementById('recGo').classList.contains('on')`),false);
 await js(`document.getElementById('recSessionPick').click();true`);
 await wait(`/1 of 2 blocks have a take/.test(document.getElementById('recCount').textContent)`);
 assert.deepEqual(await sessionTakes('picked-1'),{takes:[{block:1,chosen:true}],files:1});
 assert.equal(await js(`(async()=>{const T=await import('./js/takestore.js');return (await T.takesInfo()).count})()`),0,'the browser no longer holds it');
 assert.match(await js(`document.getElementById('recCount').dataset.tip`),/kept in picked-1, a folder you can copy/);
 await wait(`document.querySelector('video').readyState>=2`);

 // Record block 1, timing the save.
 await js(`document.querySelectorAll('#list .row')[0].click();true`);await sleep(400);
 await longest();
 await key('r','KeyR');await wait(`document.getElementById('recGo').classList.contains('on')`);
 await wait(`document.querySelector('video').currentTime>6.5`,400);
 const t0=Date.now();await key('r','KeyR');await wait(`/Saved/.test(document.getElementById('recStatus').textContent)`);
 const saveMs=Date.now()-t0, recLong=await longest();
 assert.deepEqual(await sessionTakes('picked-1'),{takes:[{block:0,chosen:true},{block:1,chosen:true}],files:2});

 // A reload comes back to the recording, with its takes, from the folder remembered.
 await js('location.reload();true');await sleep(2500);await js(stubs);
 await wait(`document.body.classList.contains('mode-record')`);
 await wait(`/2 of 2 blocks have a take/.test(document.getElementById('recCount').textContent)`);
 assert.equal(await js(`document.getElementById('recSessionDlg').open`),false);

 // The session package.
 await js(`document.querySelector('[data-act=exportSession]').click();true`);
 await wait(`/Saved out\\.scribecuesession: 2 takes/.test(document.getElementById('toast').textContent)`);
 const pkg=await js(`(async()=>{const Z=await import('./js/zip.js');const f=await (await (await navigator.storage.getDirectory()).getFileHandle('out.scribecuesession')).getFile();return (await Z.readZip(f)).map(x=>x.name.replace(/[0-9a-f-]{36}/,'ID'))})()`);
 assert.deepEqual(pkg,['session.json','takes/ID.wav','takes/ID.wav']);

 // On "another computer": nothing remembered, nothing in the browser. The package opens.
 await js(`(async()=>{localStorage.removeItem('scribecue.recOpen');await new Promise(ok=>{const q=indexedDB.deleteDatabase('scribecue');q.onsuccess=q.onerror=q.onblocked=ok;});
  const root=await navigator.storage.getDirectory();await root.removeEntry('picked-1',{recursive:true});location.reload();return 1})()`);
 await sleep(2500);await js(stubs);
 await js(`window.__picks=1;(async()=>{const f=await (await (await navigator.storage.getDirectory()).getFileHandle('out.scribecuesession')).getFile();const dt=new DataTransfer();dt.items.add(new File([f],'door.scribecuesession'));
  window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
 await wait(`document.getElementById('recSessionDlg').open`);
 assert.match(await text('recSessionIntro'),/the 2 takes in door\.scribecuesession/);
 await js(`document.getElementById('recSessionPick').click();true`);
 await wait(`document.body.classList.contains('mode-record')`);
 await wait(`/2 of 2 blocks have a take/.test(document.getElementById('recCount').textContent)`);
 assert.deepEqual(await sessionTakes('picked-2'),{takes:[{block:0,chosen:true},{block:1,chosen:true}],files:2});
 assert.deepEqual(await js('__errors'),[]);

 // A large session: takes of a minute each, saved and packaged at 6× slowdown.
 const minutes=+bigMinutes;
 await send('Emulation.setCPUThrottlingRate',{rate:1});
 await js(`(async()=>{const T=await import('./js/takestore.js'),B=await import('./js/bwf.js');const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('big',{create:true});
  window.__big=await T.openSession(d,{key:'bigsession000001-0',recording:${JSON.stringify(file)},where:'browser'});
  window.__pcm=new Uint8Array(60*48000*3).map((_,i)=>(i*31)&255);return 1})()`);
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 const one=await js(`(async()=>{const B=await import('./js/bwf.js');const t0=performance.now();
  await __big.save({id:crypto.randomUUID(),block:0,start:4,duration:60,peak:-12,made:Date.now(),wav:B.wav24(__pcm)},true);return Math.round(performance.now()-t0)})()`);
 const oneLong=await longest();
 await send('Emulation.setCPUThrottlingRate',{rate:1});
 await js(`(async()=>{const B=await import('./js/bwf.js');for(let i=1;i<${minutes};i++)await __big.save({id:crypto.randomUUID(),block:i%2,start:4,duration:60,peak:-12,made:Date.now()+i,wav:B.wav24(__pcm)},true);delete window.__pcm;return 1})()`);
 await send('HeapProfiler.collectGarbage');
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await longest();
 const big=await js(`(async()=>{const Z=await import('./js/zip.js');const heap0=performance.memory.usedJSHeapSize;let heap=heap0,frames=0,run=true;
  const tick=()=>{frames++;heap=Math.max(heap,performance.memory.usedJSHeapSize);if(run)requestAnimationFrame(tick)};requestAnimationFrame(tick);
  const t0=performance.now();const files=await __big.files();const zip=await Z.storeZip(files);
  const fh=await (await navigator.storage.getDirectory()).getFileHandle('big.scribecuesession',{create:true});const w=await fh.createWritable();
  for(let at=0;at<zip.size;at+=16<<20)await w.write(zip.slice(at,at+(16<<20)));await w.close();
  const secs=(performance.now()-t0)/1000;run=false;const back=await Z.readZip(await fh.getFile());
  return {mb:Math.round(zip.size/1e6),secs:+secs.toFixed(1),fps:+(frames/secs).toFixed(1),heapGrowthMb:+((heap-heap0)/1e6).toFixed(1),files:back.length}})()`);
 const bigLong=await longest();
 assert.equal(big.files,minutes+1);
 assert.deepEqual(await js('__errors'),[]);
 console.log(JSON.stringify({ saveTakeMs: saveMs, whileRecordingLongTasks: recLong, saveMinuteTakeMs: one, minuteTakeLongTasks: oneLong, bigPackage: big, bigPackageLongTasks: bigLong }));
 console.log('Session checks passed');
} finally { await send('Emulation.setCPUThrottlingRate',{rate:1}).catch(()=>{}); ws.close(); }
