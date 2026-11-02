// Mode setup checks in headless, muted Chrome at 6× CPU slowdown: switching to a mode
// for the first time runs its part of the setup, once.
// Usage: node scripts/mode-setup-smoke.mjs <devtools port> <site url> [screenshot.png]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, shot] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0; const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const js=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let i=0;i<160;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};
const mode=m=>js(`document.querySelector('#modeSw [data-mode=${m}]').click(); true`);
const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click(); true`);
const open=()=>js(`document.getElementById('welcome').open`);
const modes=()=>js(`JSON.parse(localStorage.getItem('scribecue.setupModes'))`);
const current=()=>js(`document.querySelector('#modeSw .on')?.dataset.mode`);
try {
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:site});await sleep(800);
 // Someone who set up Transcribe before modes were kept, and has never used Write or QC.
 await js(`localStorage.clear();localStorage.setItem('scribecue.welcome','1');localStorage.setItem('scribecue.seenVersion','999.0.0');localStorage.setItem('scribecue.updates','0');localStorage.setItem('scribecue.mode','transcribe');localStorage.setItem('scribecue.loops',JSON.stringify({transcribe:true}));localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:3,end:6,text:'First block'}],dirty:false}));location.reload();true`);
 await sleep(1600);
 await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
 assert.equal(await open(),false);

 // Write, for the first time: its setup, with text to speech ticked.
 const t0=Date.now();
 await mode('write');
 await wait(`document.getElementById('welcome').open`);
 const opened=Date.now()-t0;
 assert.equal(await current(),'write');
 assert.equal(await js(`document.getElementById('wzStep').textContent`),'Setting up Write mode · Step 1 of 2');
 assert.equal(await js(`document.querySelector('#welcome [data-step=write]').hidden`),false);
 assert.equal(await js(`document.getElementById('wzBack').hidden`),true);
 assert.equal(await js(`document.getElementById('wzNext').textContent`),'Next');
 assert.equal(await js(`document.getElementById('wzTts').checked`),true);
 assert.deepEqual(await modes(),{transcribe:true,write:true});
 if(shot){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(shot,Buffer.from(s.result.data,'base64'));}
 await click('wzNext');
 assert.equal(await js(`document.querySelector('#welcome [data-step=done]').hidden`),false);
 assert.doesNotMatch(await js(`document.getElementById('wzSummary').textContent`),/update/i);
 assert.match(await js(`document.getElementById('wzSummary').textContent`),/Text to speech on/);
 await click('wzNext');
 assert.equal(await open(),false);
 assert.equal(await js(`localStorage.getItem('scribecue.updates')`),'0');
 assert.equal(await js(`JSON.parse(localStorage.getItem('scribecue.tts')||'{}').on`),true);
 // Then Write's loop card, once.
 await wait(`!document.getElementById('tour').hidden`);
 await click('tourNext');
 await wait(`document.getElementById('tour').hidden`);

 // Back to Transcribe, and to Write again: nothing more to set up.
 await mode('transcribe');await sleep(400);
 assert.equal(await open(),false);
 assert.equal(await js(`document.getElementById('tour').hidden`),true);
 await mode('write');await sleep(400);
 assert.equal(await open(),false);

 // QC, skipped: it isn't offered again, and nothing it sets changes.
 await mode('qc');
 await wait(`document.getElementById('welcome').open`);
 assert.equal(await js(`document.querySelector('#welcome [data-step=qc]').hidden`),false);
 await js(`document.getElementById('wzName').value='Someone';true`);
 await click('wzSkip');
 assert.equal(await open(),false);
 assert.equal(await current(),'qc');
 assert.equal(await js(`localStorage.getItem('scribecue.reviewer')`),null);
 assert.equal((await modes()).qc,true);
 await sleep(1500);
 await js(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());if(!document.getElementById('tour').hidden)document.getElementById('tourNext').click();true`);
 await mode('write');await sleep(300);await mode('qc');await sleep(400);
 assert.equal(await open(),false);

 // The whole setup from Settings is unchanged: it still starts at the welcome.
 await js(`(async()=>{(await import('./js/welcome.js')).openWelcome();return true})()`);
 assert.equal(await js(`document.getElementById('wzStep').textContent`),'Step 1 of 5');
 await click('wzSkip');


 // Opening a QC package, never having used QC: QC's setup opens once the package is in.
 await js(`localStorage.setItem('scribecue.setupModes',JSON.stringify({transcribe:true,write:true}));localStorage.setItem('scribecue.mode','write');localStorage.removeItem('scribecue.v1');location.reload();true`);
 await sleep(1600);
 await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
 assert.equal(await current(),'write');
 await js(`(async()=>{
  const {toProject,newIdentity}=await import('./js/project.js');const {buildReview}=await import('./js/qc.js');
  const wav=()=>{const a=new Uint8Array(44+48000*2),v=new DataView(a.buffer),put=(at,s)=>{for(let i=0;i<s.length;i++)a[at+i]=s.charCodeAt(i)};put(0,'RIFF');v.setUint32(4,a.length-8,true);put(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,a.length-44,true);return new Blob([a],{type:'audio/wav'})};
  const p=toProject({projectId:newIdentity(),blocks:[{uid:newIdentity(),start:3,end:6,text:'Mara opens the blue door.'}],settings:{mode:'write',ttsVoice:'test',ttsBase:1}});
  const pkg=await buildReview(p,async()=>({blob:wav(),secs:1,voice:'test'}),{});
  const dt=new DataTransfer();dt.items.add(new File([pkg],'review.scribecueqc'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return true})()`);
 await wait(`document.body.classList.contains('qc-package')`);
 await wait(`document.getElementById('welcome').open`);
 assert.equal(await current(),'qc');
 assert.equal(await js(`document.getElementById('wzStep').textContent`),'Setting up QC mode · Step 1 of 2');
 await click('wzNext');await click('wzNext');
 assert.equal(await open(),false);
 assert.equal((await modes()).qc,true);


 // Opening a recording file, never having recorded: Record's setup, with the controls
 // from under the video lent to it. Chrome runs with a fake microphone.
 await send('Browser.grantPermissions',{origin:new URL(site).origin,permissions:['audioCapture']});
 await js(`localStorage.setItem('scribecue.setupModes',JSON.stringify({transcribe:true,write:true,qc:true}));localStorage.setItem('scribecue.mode','write');location.reload();true`);
 await sleep(1600);
 await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.confirm=()=>true;true`);
 await js(`(async()=>{const R=await import('./js/recording.js');const file=R.toRecordingFile({blocks:[{start:3,end:6,text:'Mara opens the blue door.'}],fps:25});
  const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(file)],'lights.scribecuerec'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return true})()`);
 await wait(`document.body.classList.contains('mode-record')`);
 await js(`document.querySelectorAll('dialog[open]').forEach(d=>{if(d.id!=='welcome')d.close()});true`);
 await wait(`document.getElementById('welcome').open`);
 assert.equal(await js(`document.getElementById('wzStep').textContent`),'Setting up Record mode · Step 1 of 3');
 assert.equal(await js(`document.querySelector('#welcome [data-step=record-mic]').hidden`),false);
 assert.equal(await js(`!!document.querySelector('#wzRecMic #recDev')`),true);
 await js(`window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
 await click('wzRecTest');
 await wait(`document.getElementById('wzRecTest').textContent==='Stop the test'`);
 // the loudest peak shows as the fake microphone beeps, against the pocket
 await wait(`/Loudest: −?[0-9.]+ dBFS, /.test(document.getElementById('wzRecLoudest').textContent)`);
 assert.match(await js(`document.getElementById('wzRecLoudest').className`),/loudest lvl (good|note|quiet|loud)/);
 assert.ok(await js(`document.getElementById('wzRecMeter').width>=document.getElementById('wzRecMeter').clientWidth`));
 const micLong=await js('__long');
 await click('wzNext');
 assert.equal(await js(`document.getElementById('wzRecTest').textContent`),'Test');
 assert.equal(await js(`!!document.querySelector('#wzRecLead #recLead') && !!document.querySelector('#wzRecSync #recTest')`),true);
 await js(`const l=document.getElementById('recLead');l.value='5';l.dispatchEvent(new Event('change'));true`);
 assert.equal(await js(`localStorage.getItem('scribecue.rec.lead')`),'5');
 await click('wzNext');
 assert.match(await js(`document.getElementById('wzSummary').textContent`),/Lead-in: 5 s/);
 assert.equal(await js(`document.getElementById('wzSaveKey').hidden`),true);
 await click('wzNext');
 assert.equal(await open(),false);
 await wait(`!!document.querySelector('.recopts #recDev') && !!document.querySelector('.recopts #recLead') && !!document.querySelector('.recopts #recTest')`);
 assert.equal((await modes()).record,true);
 await sleep(1500);
 assert.equal(await js(`document.getElementById('tour').hidden`),true);
 // Mic check, in its own window: the meter standing up, and the microphone let go when it closes.
 await js(`window.__long=[];true`);
 await click('recMic');
 await wait(`document.getElementById('micDlg').open`);
 await wait(`/Loudest: −?[0-9.]+ dBFS/.test(document.getElementById('micLoudest').textContent)`);
 assert.ok(await js(`(()=>{const c=document.getElementById('micMeter');return c.height>c.width*2})()`));
 assert.match(await js(`document.getElementById('micNote').textContent`),/^Microphone: /);
 const checkLong=await js('__long');
 await click('micClose');
 await wait(`!document.getElementById('micDlg').open`);
 await sleep(400);
 const after=await js(`document.getElementById('micLoudest').textContent`);await sleep(600);
 assert.equal(await js(`document.getElementById('micLoudest').textContent`),after); // nothing listening now
 console.log(`Mic check at 6×: longest task ${Math.round(Math.max(0,...checkLong))} ms (${checkLong.length} over 50 ms)`);
 console.log(`Microphone test at 6×: longest task ${Math.round(Math.max(0,...micLong))} ms (${micLong.length} over 50 ms)`);

 assert.deepEqual(await js('__errors'),[]);
 const long=await js('__long');
 console.log(`Setup opened ${opened} ms after the click; longest task through Record’s setup, ${Math.round(Math.max(0,...long))} ms (${long.length} over 50 ms)`);
 console.log('Mode setup smoke passed');
} finally { ws.close(); }
