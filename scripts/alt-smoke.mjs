// Alt checks in headless, muted Chrome at 6× CPU slowdown, with Chrome's fake microphone:
// the narrator records an alt beside a block's take, exports the narration zip, and the
// writer opens it and uses the alt's wording. Then a two-hour package is packed, to check
// it keeps the page responsive and out of memory.
// Usage: node scripts/alt-smoke.mjs <devtools port> <site url> <video path on the site> [screenshot.png]
// Chrome needs --use-fake-device-for-media-stream --use-fake-ui-for-media-stream.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, videoPath, shot] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0; const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const js=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(expression,tries=200)=>{for(let i=0;i<tries;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};
const key=async(k,code)=>{const p={key:k,code,windowsVirtualKeyCode:{Enter:13}[k]||k.toUpperCase().charCodeAt(0)};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...p});await send('Input.dispatchKeyEvent',{type:'keyUp',...p});await sleep(200);};
const text=id=>js(`document.getElementById(${JSON.stringify(id)}).textContent`);
const takes=()=>js(`(async()=>{const T=await import('./js/takestore.js');const R=await import('./js/recording.js');return (await T.listTakes(R.takesKey(window.__rec))).map(t=>({block:t.block,chosen:t.chosen,alt:t.alt??null})).sort((a,z)=>a.block-z.block||(a.alt!=null)-(z.alt!=null))})()`);
const shoot=async name=>{if(!shot)return;const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(shot.replace(/\.png$/,`-${name}.png`),Buffer.from(s.result.data,'base64'));};
const blocks=[{start:4,end:7,text:'He walks towards the door.'},{start:12,end:14,text:'Rain.'}];
try {
 // The files as they are now, not as an earlier run's service worker kept them.
 await send('Emulation.setFocusEmulationEnabled',{enabled:true}); // focus events, as in a window in front
 await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:site});await sleep(800);
 await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);indexedDB.deleteDatabase('scribecue-takes');navigator.storage.getDirectory().then(r=>r.removeEntry('sessions',{recursive:true})).catch(()=>{}).then(()=>location.reload());true`);
 await sleep(2000);
 await js(`window.showDirectoryPicker=undefined;window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});
  window.__saved=[];HTMLAnchorElement.prototype.click=function(){if(this.download)__saved.push({name:this.download,href:this.href});};window.confirm=()=>true;true`);

 // The narrator opens the recording file and the video, and records block 1's take.
 await js(`(async()=>{const R=await import('./js/recording.js');const file=JSON.parse(JSON.stringify(R.toRecordingFile({blocks:${JSON.stringify(blocks)},fps:25})));window.__rec=R.fromRecordingFile(file);
  const v=await fetch(${JSON.stringify(videoPath)}).then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(file)],'door.scribecuerec'));dt.items.add(new File([v],'door.mkv',{type:'video/x-matroska'}));
  window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
 await wait(`document.body.classList.contains('mode-record')`);
 await wait(`document.querySelector('video').readyState>=2`);
 await js(`document.querySelectorAll('#list .row')[0].click();true`);await sleep(400);
 // The block opens, locked, with Original | Alt; its text box doesn't take the keys from it.
 assert.equal(await js(`document.getElementById('editor').hidden`),false);
 assert.equal(await js(`document.querySelector('#edAltSw .on').textContent`),'Original');
 assert.equal(await js(`document.getElementById('edText').readOnly`),true);
 await js(`document.getElementById('edText').focus();true`);
 assert.notEqual(await js(`document.activeElement.id`),'edText');
 const record=async()=>{await key('r','KeyR');await wait(`document.getElementById('recGo').classList.contains('on')`);await wait(`document.querySelector('video').currentTime>6.5`,400);await key('r','KeyR');await wait(`/Saved/.test(document.getElementById('recStatus').textContent)`);};
 await record();
 assert.deepEqual(await takes(),[{block:0,chosen:true,alt:null}]);

 // A, then the alt's wording, then Enter to leave the field and R to record it.
 await key('a','KeyA');
 assert.equal(await js(`document.querySelector('#edAltSw .on').textContent`),'Alt');
 assert.equal(await js(`document.querySelector('#edAltSw [data-side=alt]').getAttribute('aria-checked')`),'true');
 assert.equal(await js(`document.activeElement.id`),'edText');
 assert.equal(await js(`document.getElementById('edText').value`),blocks[0].text,'the alt starts from the block’s wording');
 // Unchanged wording can't be recorded as an alt.
 await key('Enter','Enter');await key('r','KeyR');
 assert.equal(await js(`document.activeElement.id`),'edText');
 await js(`const f=document.getElementById('edText');f.value='He walks toward the door.';f.dispatchEvent(new Event('input'));true`);
 await key('Enter','Enter');
 assert.match(await text('recTakes'),/no alt yet/);
 await record();
 assert.match(await text('recStatus'),/Saved alt take 1/);
 assert.deepEqual(await takes(),[{block:0,chosen:true,alt:null},{block:0,chosen:true,alt:'He walks toward the door.'}]);
 assert.match(await text('recCount'),/1 alt$/);
 assert.match(await text('recTakes'),/Alt take 1/);
 await js(`document.querySelector('video').currentTime=5;true`);await sleep(600);
 assert.equal(await text('overlay'),'He walks toward the door.','the video shows the alt’s wording');
 await js(`document.getElementById('toast')?.classList.add('fade');true`);await sleep(400);
 await shoot('alt');
 // Playing with Alt on: the alt is heard in its block, and the page keeps up.
 const play=await js(`(async()=>{const v=document.querySelector('video');v.currentTime=3;await new Promise(r=>setTimeout(r,300));const L=[];const o=new PerformanceObserver(l=>L.push(...l.getEntries().map(e=>e.duration)));o.observe({type:'longtask'});
  let frames=0,run=true;const f=()=>{frames++;if(run)requestAnimationFrame(f)};requestAnimationFrame(f);await v.play();const t0=performance.now();await new Promise(r=>setTimeout(r,4000));run=false;v.pause();o.disconnect();
  return {fps:Math.round(frames/((performance.now()-t0)/1000)),long:L.length,longest:Math.round(Math.max(0,...L))}})()`);
 // Back to the original: its take, and no wording field.
 await key('a','KeyA');
 assert.equal(await js(`document.querySelector('#edAltSw .on').textContent`),'Original');
 assert.equal(await js(`document.getElementById('edText').value`),blocks[0].text);
 // The switch works by click too, and the alt's wording comes back.
 await js(`document.querySelector('#edAltSw [data-side=alt]').click();true`);await sleep(300);
 assert.equal(await js(`document.getElementById('edText').value`),'He walks toward the door.');
 await js(`document.querySelector('#edAltSw [data-side=orig]').click();true`);await sleep(300);
 assert.equal(await js(`document.activeElement.id`)==='edText',false);
 assert.doesNotMatch(await text('recTakes'),/Alt take/);
 assert.equal(await text('overlay'),blocks[0].text);
 // The wording survives a reload of the panel.
 assert.deepEqual(await js(`(async()=>Object.values(JSON.parse(localStorage.getItem('scribecue.rec.alts.'+(await import('./js/recording.js')).takesKey(window.__rec)))))()`),['He walks toward the door.']);

 // Chrome's fake microphone beeps above −6, which stops an export, alts included. The takes
 // are given a level in the pocket, as a narrator's would have.
 await js(`document.getElementById('exportNarration').click();true`);
 await wait(`document.getElementById('recExportDlg').open`);
 assert.match(await text('recReport'),/STOPPED: Block 1 \(alt\) peaks/);
 await js(`document.getElementById('recExportCancel').click();(async()=>{const T=await import('./js/takestore.js'),R=await import('./js/recording.js');
  for(const t of await T.listTakes(R.takesKey(window.__rec)))await T.saveTake({...t,peak:-9},t.chosen);return 1})()`);

 // The export is a package now.
 await js(`document.querySelector('[data-act=exportMenu]')?.click()||document.getElementById('exportBtn')?.click();true`);await sleep(300);
 assert.equal(await js(`document.querySelector('#exportNarration strong').textContent`),'Narration zip');
 await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));true`);
 const long0=(await js(`__long`)).length, t0=Date.now();
 await js(`document.getElementById('exportNarration').click();true`);
 // Block 2 has no take, so the notes come up first.
 await wait(`document.getElementById('recExportDlg').open`);
 assert.match(await text('recReport'),/Block 2 has no take/);
 assert.match(await text('recReport'),/go in the package/);
 await js(`document.getElementById('recExportGo').click();true`);
 await wait(`__saved.length`);
 const packed=Date.now()-t0;
 const pkg=await js(`(async()=>{const Z=await import('./js/zip.js'),B=await import('./js/bwf.js');const blob=await fetch(__saved[0].href).then(r=>r.blob());window.__pkg=blob;const files=await Z.readZip(blob);
  const out={name:__saved[0].name,files:files.map(f=>f.name),notes:await files[2].blob.text()};const main=await B.readNote(files[0].blob),alt=await B.readNote(files[1].blob);
  out.main=main.blocks.map(b=>b.alt??null);out.altOnly=!!alt.altOnly;out.sizes=[files[0].blob.size,files[1].blob.size];return out})()`);
 assert.equal(pkg.name,'door-narration-package.zip');
 assert.deepEqual(pkg.files,['door-narration.wav','door-alts.wav','door-notes.txt']);
 assert.deepEqual(pkg.main,['He walks toward the door.',null]);
 assert.equal(pkg.altOnly,true);
 assert.match(pkg.notes,/Block 1: “He walks toward the door.” \(was “He walks towards the door.”\)/);
 assert.match(pkg.notes,/Block 2 has no take/);

 // The writer opens the script and the package, and uses the alt.
 await js(`document.getElementById('recLeave')?.click()||document.querySelector('.recbadge button:last-child')?.click();true`);await sleep(800);
 await js(`(async()=>{const P=await import('./js/project.js');const p=P.toProject({blocks:${JSON.stringify(blocks.map(b=>({...b,auto:true})))}});const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(p)],'door.scribecue'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
 await wait(`!document.body.classList.contains('mode-record')&&document.querySelectorAll('#list .row').length===2`);
 await js(`document.querySelector('#modeSw [data-mode=write]')?.click();true`);await sleep(400);
 await js(`const dt=new DataTransfer();dt.items.add(new File([__pkg],'door-narration-package.zip'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));true`);
 await wait(`document.getElementById('narrDlg').open`);
 assert.equal(await js(`document.getElementById('narrAlts').hidden`),false);
 assert.match(await text('narrAltList'),/Block 1 “He walks toward the door.” was “He walks towards the door.”/);
 await shoot('check');
 await js(`document.querySelector('#narrAltList button').click();true`);
 await wait(`JSON.parse(localStorage.getItem('scribecue.v1')||'{}').cues?.[0]?.text==='He walks toward the door.'`);
 const c=await js(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[0]`);
 assert.deepEqual([c.start,c.end,!!c.auto],[4,7,false],'the block keeps its timing');
 assert.match(await text('narrAltList'),/Used/);
 const long=(await js(`__long`)).slice(long0);

 // A two-hour package, made of silence: the page stays responsive, and memory stays small.
 await js(`document.getElementById('narrClose').click();window.__long=[];true`);
 const big=await js(`(async()=>{const B=await import('./js/bwf.js'),Z=await import('./js/zip.js');const secs=7200;
  const wav=()=>B.buildBwf({takes:[],secs});const t0=performance.now();let ticks=0;
  const zip=await Z.storeZip([{name:'a.wav',blob:wav()},{name:'b.wav',blob:wav()}],{progress:()=>ticks++});
  return {ms:Math.round(performance.now()-t0),bytes:zip.size,ticks,heap:Math.round(performance.memory.usedJSHeapSize/1048576)}})()`);
 const bigLong=await js(`__long`);
 assert.deepEqual(await js(`__errors`),[]);
 console.log(`Alt smoke passed at 6× slowdown. Package export took ${packed} ms with ${long.length} long tasks${long.length?` (longest ${Math.round(Math.max(...long))} ms)`:''}.`);
 console.log(`Playing with Alt on: ${play.fps} frames a second, ${play.long} long tasks${play.long?` (longest ${play.longest} ms)`:''}.`);
 console.log(`Two-hour package (${(big.bytes/1073741824).toFixed(2)} GB): ${(big.ms/1000).toFixed(1)} s, ${big.ticks} progress updates, heap ${big.heap} MiB, ${bigLong.length} long tasks${bigLong.length?` (longest ${Math.round(Math.max(...bigLong))} ms)`:''}.`);
} finally { ws.close(); }
