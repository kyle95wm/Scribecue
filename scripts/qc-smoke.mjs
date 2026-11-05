// QC regression checks in headless, muted Chrome at 6× CPU slowdown.
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
const wait=async expression=>{for(let i=0;i<160;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};
const mode=m=>js(`document.querySelector('#modeSw [data-mode=${m}]').click(); true`);
const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click(); true`);
try {
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Page.navigate',{url:site});await sleep(800);
 await js(`localStorage.clear();localStorage.setItem('scribecue.proof','{"warn":false}');localStorage.setItem('scribecue.welcome','1');localStorage.setItem('scribecue.setupModes',JSON.stringify({write:true,transcribe:true,qc:true,record:true}));localStorage.setItem('scribecue.seenVersion','999.0.0');localStorage.setItem('scribecue.updates','0');localStorage.setItem('scribecue.mode','qc');localStorage.setItem('scribecue.loops',JSON.stringify({write:true,transcribe:true,qc:true}));localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:3,end:6,text:'First QC block'},{start:10,end:14,text:'Second QC block'}],dirty:false}));location.reload();true`);
 await sleep(1600);
 await js(`window.confirm=()=>true;window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.showSaveFilePicker=async()=>({name:'review.scribecue',queryPermission:async()=>'granted',createWritable:async()=>({write:async t=>{window.__saved=t},close:async()=>{}})});document.querySelector('#list .row').click();true`);
 assert.equal(await js(`document.getElementById('edText').readOnly && document.getElementById('edStart').readOnly && document.getElementById('edEnd').readOnly`),true);
 const save=async()=>{await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'s',metaKey:true,bubbles:true,cancelable:true}));true`);await sleep(300);return js(`JSON.parse(__saved)`);};
 const before=await save();
 await js(`document.getElementById('edText').value='Unwanted edit';document.getElementById('edText').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('edVoice').value='unwanted';document.getElementById('edVoice').dispatchEvent(new Event('change'));document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',code:'Delete',bubbles:true,cancelable:true}));true`);
 assert.deepEqual((await save()).blocks,before.blocks);
 await mode('write');
 assert.notEqual(await js(`getComputedStyle(document.getElementById('commentsBtn')).display`),'none');
 assert.notEqual(await js(`getComputedStyle(document.getElementById('edComment')).display`),'none');
 {
  await mode('transcribe');
  assert.equal(await js(`getComputedStyle(document.getElementById('commentsBtn')).display`),'none');
  await click('commentsBtn');
  assert.equal(await js(`document.getElementById('commentsDrawer').hidden`),true);
  assert.equal(await js(`getComputedStyle(document.getElementById('edComment')).display`),'none');
 }
 await mode('qc');await click('edComment');assert.equal(await js(`document.getElementById('commentsDrawer').hidden`),false);await mode('write');assert.equal(await js(`document.getElementById('commentsDrawer').hidden`),false);await mode('transcribe');assert.equal(await js(`document.getElementById('commentsDrawer').hidden`),true);
 assert.equal(await js(`document.getElementById('qcAllowEdits')`),null);
 // Export actual Piper readings through the UI, then open them with no provider calls.
 await mode('write');
 await wait(`(async()=>{const t=await import('./js/tts.js');return t.reviewVoices().some(v=>v.exportable&&v.id.startsWith('piper:'));})()`);
 await js(`(async()=>{const t=await import('./js/tts.js');const v=t.reviewVoices().find(v=>v.exportable&&v.id.startsWith('piper:'));t.setTtsOption('voice',v.id);window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.scribecueqc'))window.__download=this.href;else __anchorClick.call(this);};document.querySelector('[data-act=exportQc]').click();return true;})()`);
 await click('qcExportStart');await wait(`!!window.__download`);
 const real=await js(`(async()=>{const q=await import('./js/qc.js');window.__realFile=await fetch(__download).then(r=>r.blob());const r=await q.openReview(__realFile);return {readings:r.readings.length,live:r.live,allowEdits:q.reviewAllowsEdits(r),baseline:r.baselineId};})()`);
 assert.equal(real.allowEdits,false);
 assert.equal(real.readings,0);assert.equal(real.live,true);
 console.log('Piper package exported:',JSON.stringify(real));
 await click('qcExportClose');
 assert.ok((await save()).reviewHistory.checkpoints.some(c=>c.id===real.baseline),'writer project keeps the QC starting point');
 await js(`window.__download=null;document.querySelector('[data-act=exportQc]').click();true`);
 assert.equal(await js(`document.getElementById('qcExportAllowEdits').getAttribute('aria-pressed')`),'false');
 await click('qcExportAllowEdits');await click('qcExportStart');await wait(`!!window.__download`);
 assert.equal(await js(`(async()=>{const q=await import('./js/qc.js');const r=await q.openReview(await fetch(__download).then(r=>r.blob()));return q.reviewAllowsEdits(r);})()`),true);
 await click('qcExportClose');
 // Only the creator's export dialog controls permissions; a default package is read-only.
 await js(`window.__drop=async file=>{const d=new DataTransfer();d.items.add(file);document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));};__drop(new File([__realFile],'comments-only.scribecueqc'));true`);
 await wait(`document.getElementById('subName').textContent.includes('comments-only')`);
 assert.equal(await js(`document.getElementById('edText').readOnly`),true);
 assert.equal(await js(`document.querySelector('#modeSw [data-mode=write]').disabled`),true);
 await mode('write');assert.equal(await js(`document.body.classList.contains('mode-qc')`),true);
 await js(`document.querySelector('[data-act=exportQc]').click();true`);
 assert.equal(await js(`document.getElementById('qcExportDlg').open`),false);
 await click('edComment');await js(`document.getElementById('commentText').value='Read-only note';document.getElementById('commentPost').click();document.getElementById('commentsClose').click();true`);
 await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'s',metaKey:true,bubbles:true,cancelable:true}));true`);await sleep(350);
 assert.equal(await js(`(async()=>{const q=await import('./js/qc.js');return q.reviewAllowsEdits(await q.openReview(__saved));})()`),false);
 // Importing a project with unavailable default and block voices must preserve timings.
 await js(`window.__drop=async file=>{const d=new DataTransfer();d.items.add(file);document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));};window.__missing={scribecue:1,format:1,blocks:[{start:3,end:3.5,text:'This reading is deliberately much longer than half a second.',auto:true},{start:10,end:11,text:'Override voice',voice:'missing:block'}],settings:{mode:'write',ttsVoice:'missing:main',ttsBase:1}};__drop(new File([JSON.stringify(__missing)],'missing.scribecue'));true`);
 await wait(`document.body.classList.contains('mode-qc') && document.getElementById('qcPlaybackDlg').open`);
 assert.match(await js(`document.getElementById('qcVoiceList').textContent`),/not available here/);
 await click('qcPlaybackClose');
 assert.deepEqual((await save()).blocks.map(b=>[b.start,b.end]),[[3,3.5],[10,11]]);
 // Exercise the real disk-backed package writer and worker reader with synthetic audio.
 const perf=await js(`(async()=>{
 const q=await import('./js/qc.js');const {writeWav}=await import('./js/audio.js');
 const samples=new Int16Array(16000*2);for(let i=0;i<samples.length;i++)samples[i]=Math.sin(i/20)*650;
 const wav=new Blob([writeWav(samples,16000)]);const p={...__missing,settings:{mode:'qc',ttsVoice:'portable:voice',ttsBase:1,ttsSkipNotes:false},blocks:Array.from({length:720},(_,i)=>({start:i*10,end:i*10+2,text:'Review '+i,...(i===0?{auto:true}:{})}))};
 const sink=await q.reviewSink();let ticks=0,maxGap=0,last=performance.now(),progress=0;const timer=setInterval(()=>{const n=performance.now();maxGap=Math.max(maxGap,n-last);last=n;ticks++;},16);const start=performance.now();
 const file=await q.buildReview(p,async()=>({blob:wav,secs:2,voice:'portable:voice'}),{sink,allowEdits:true,progress:()=>progress++});
 window.__reviewFile=file;window.__review=await q.openReview(file);window.__reviewSink=sink;clearInterval(timer);
 const edited=structuredClone(p);edited.comments=[{id:'qc-note',time:5,text:'Check this',author:'Reviewer',created:1}];const again=await q.openReview(q.resaveReview(__review,edited));
 return {ms:Math.round(performance.now()-start),bytes:file.size,ticks,maxGap:Math.round(maxGap),progress,readings:again.readings.length,comments:again.parsed.comments.length};
 })()`);
 assert.equal(perf.readings,720);assert.equal(perf.comments,1);assert.ok(perf.ticks>10);assert.equal(perf.progress,721);
 console.log('QC 6× disk-backed two-hour package:',JSON.stringify(perf));
 await js(`__drop(new File([__reviewFile],'portable.scribecueqc'));true`);
 await wait(`document.querySelectorAll('#list .row').length===720`);
 await click('qcPlaybackClose'); // no-op when already closed
 await js(`document.querySelector('#list .row').click();true`);
 assert.match(await js(`document.getElementById('qcBlockInfo').textContent`),/Original 2.0 s/);
 // Read packaged audio against the generated video, without synthesising any text.
 await js(`(async()=>{window.__synthCalls=0;const f=window.fetch;window.fetch=(u,o)=>{if(String(u).includes('/tts/')&&o?.method==='POST'){__synthCalls++;return Promise.reject(Error('Provider unavailable'));}return f(u,o);};window.__audioStarts=[];const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.tagName==='AUDIO'&&this.src.startsWith('blob:'))__audioStarts.push({timeline:document.getElementById('video').currentTime,offset:this.currentTime});return play.call(this);};const b=await fetch('/demo.mkv').then(r=>r.blob());await __drop(new File([b],'demo.mkv'));return true;})()`);
 await wait(`document.getElementById('video').readyState>=2`);
 await js(`document.querySelector('#list .row').click();document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyV',key:'v',bubbles:true,cancelable:true}));true`);
 await wait(`__audioStarts.length>0`);await sleep(2500);
 assert.equal(await js(`__synthCalls`),0);
 const timing=await js(`__audioStarts`);assert.ok(timing.every(x=>Math.abs(x.offset-x.timeline)<0.1),'reading starts within 100 ms of the programme');console.log('QC original reading startup at 6×:',JSON.stringify(timing));
 await js(`document.getElementById('video').pause();true`);
 // V in programme-sound mode plays only the selected block.
 await js(`document.querySelector('#ind [data-key=qc]').click();true`);await click('qcSourceVideo');await click('qcPlaybackClose');
 await js(`document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyV',key:'v',bubbles:true,cancelable:true}));true`);await sleep(2400);
 assert.equal(await js(`document.getElementById('video').paused`),true);
 await js(`document.querySelector('#ind [data-key=qc]').click();true`);await click('qcSourcePackage');await click('qcPlaybackClose');
 // Save comments back to the package without synthesis or losing original payloads.
 await click('edComment');await js(`document.getElementById('commentText').value='Portable comment';document.getElementById('commentPost').click();document.getElementById('commentsClose').click();true`);
 await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'s',metaKey:true,bubbles:true,cancelable:true}));true`);await sleep(400);
 const packageSaved=await js(`(async()=>{const q=await import('./js/qc.js');const r=await q.openReview(__saved);return {readings:r.readings.length,comments:r.parsed.blocks[0].comments.length};})()`);
 assert.deepEqual(packageSaved,{readings:720,comments:1});
 const memory=await send('Runtime.getHeapUsage');console.log('QC heap after 720-reading import/save (MiB):',Math.round(memory.result.usedSize/1048576));
 assert.deepEqual(await js(`__errors`),[]);
 await js(`__reviewSink.clean();location.reload();true`);await sleep(1800);
 await wait(`document.querySelectorAll('#list .row').length===720`);
 await js(`document.querySelector('#list .row').click();true`);
 await wait(`document.getElementById('qcBlockInfo').textContent.includes('Original 2.0 s')`);
 await click('edComment');assert.match(await js(`document.getElementById('commentsLog').textContent`),/Portable comment/);await click('commentsClose');
 // Creator-authorized editing survives recovery and has no reviewer toggle.
 assert.equal(await js(`document.getElementById('qcAllowEdits')`),null);
 assert.equal(await js(`document.getElementById('qcPermission').textContent`),'Edits allowed');
 assert.equal(await js(`document.getElementById('edText').readOnly || document.getElementById('edEnd').readOnly`),false);
 assert.equal(await js(`document.getElementById('edSpeedWrap').hidden || document.getElementById('edVoiceWrap').hidden`),false);
 await js(`document.getElementById('edStart').value='1';document.getElementById('edStart').dispatchEvent(new FocusEvent('blur'));document.getElementById('edEnd').value='1.5';document.getElementById('edEnd').dispatchEvent(new FocusEvent('blur'));true`);
 assert.match(await js(`document.getElementById('qcBlockInfo').textContent`),/Original 2.0 s · runs past block/);
 const qcTimes=await js(`[document.getElementById('edStart').value,document.getElementById('edEnd').value]`);
await js(`document.querySelector('#list .row').click();true`);
 const point=await js(`(()=>{const r=document.getElementById('edText').getBoundingClientRect();const x=r.x+20,y=r.y+20;return {x,y,target:document.elementFromPoint(x,y)?.outerHTML.slice(0,150)};})()`);
 assert.match(point.target,/id="edText"/);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
 assert.equal(await js(`document.activeElement.id`),'edText');
 await js(`window.__editStart=performance.now();document.getElementById('edText').value='Revised description';document.getElementById('edText').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('edText').blur();window.__editMs=performance.now()-__editStart;true`);
 console.log('QC text edit at 6× with 720 blocks (ms):',await js(`__editMs`));
 assert.ok(await js(`__editMs<200`),'QC text edit stays responsive');
 assert.deepEqual(await js(`[document.getElementById('edStart').value,document.getElementById('edEnd').value]`),qcTimes);
 assert.match(await js(`document.getElementById('qcBlockInfo').textContent`),/out of date/);
 assert.equal(await js(`document.getElementById('qcPrevious').hidden`),false);
 const staleShot=await send('Page.captureScreenshot',{format:'png'});(await import('node:fs')).writeFileSync('/tmp/qc-edits-stale.png',Buffer.from(staleShot.result.data,'base64'));
 await click('qcPrevious');assert.equal(await js(`document.getElementById('video').paused`),true);
 assert.equal(await js(`document.getElementById('qcPrevious').getAttribute('aria-pressed')`),'true');
 await click('qcPrevious');assert.equal(await js(`document.getElementById('qcPrevious').getAttribute('aria-pressed')`),'false');
 await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyZ',key:'z',metaKey:true,bubbles:true,cancelable:true}));true`);
 assert.equal(await js(`document.getElementById('edText').value`),'Review 0');
 assert.match(await js(`document.getElementById('qcBlockInfo').textContent`),/Original 2.0 s/);
 await js(`document.getElementById('edSpeed').value='1.15';document.getElementById('edSpeed').dispatchEvent(new Event('change'));true`);
 assert.deepEqual(await js(`[document.getElementById('edStart').value,document.getElementById('edEnd').value]`),qcTimes);
 assert.match(await js(`document.getElementById('qcBlockInfo').textContent`),/out of date/);
 await js(`document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyP',key:'p',altKey:true,shiftKey:true,bubbles:true,cancelable:true}));true`);
 assert.equal(await js(`document.getElementById('sayDlg').open`),true);await click('sayTry');
 assert.match(await js(`document.getElementById('toast').textContent`),/Choose Approximate TTS preview/);await click('sayDone');
 await mode('write');await mode('qc');
 assert.equal(await js(`document.getElementById('qcPermission').textContent`),'Edits allowed');
 assert.equal(await js(`document.getElementById('edText').readOnly`),false);

 // Save/reload retains previous audio and preserves creator-approved editing.
 await js(`window.showSaveFilePicker=async()=>({name:'edited.scribecueqc',queryPermission:async()=>'granted',createWritable:async()=>({write:async b=>{window.__edited=b},close:async()=>{}})});document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'s',metaKey:true,bubbles:true,cancelable:true}));true`);await wait(`!!window.__edited`);
 const edited=await js(`(async()=>{const q=await import('./js/qc.js');const r=await q.openReview(__edited),b=r.parsed.blocks[0];return {valid:!!q.reviewReading(r,b,r.parsed.settings),oldSecs:q.previousReading(r,b)?.secs,comments:b.comments.length,allowEdits:q.reviewAllowsEdits(r)};})()`);
 assert.deepEqual(edited,{valid:false,oldSecs:2,comments:1,allowEdits:true});
 await js(`location.reload();true`);await sleep(1600);await wait(`document.querySelectorAll('#list .row').length===720`);await js(`document.querySelector('#list .row').click();true`);
 await wait(`document.getElementById('qcPrevious').hidden===false`);
 assert.equal(await js(`document.getElementById('qcPermission').textContent`),'Edits allowed');
 // New reviewers can choose QC directly in first-run setup.
 await js(`(async()=>{const w=await import('./js/welcome.js');w.openWelcome();return true;})()`);
 await click('wzNext');await js(`document.querySelector('input[name=wzMode][value=qc]').click();true`);await click('wzNext');
 assert.equal(await js(`document.querySelector('#welcome [data-step=qc]').hidden`),false);
 const setupShot=await send('Page.captureScreenshot',{format:'png'});(await import('node:fs')).writeFileSync('/tmp/scribecue-qc-setup.png',Buffer.from(setupShot.result.data,'base64'));
 for(let i=0;i<5 && await js(`document.getElementById('welcome').open`);i++)await click('wzNext');
 assert.equal(await js(`document.body.classList.contains('mode-qc')`),true);
 // New is available for both kinds of package, with cancellation and save protection.
 for (const allowEdits of [false,true]) {
  await js(`(async()=>{const q=await import('./js/qc.js');const {writeWav}=await import('./js/audio.js');const p={scribecue:1,blocks:[{start:1,end:2,text:'Keep this review'}],settings:{mode:'qc'}};const file=await q.buildReview(p,async()=>({blob:new Blob([writeWav(new Int16Array(16000),16000)]),secs:1,voice:'portable:voice'}),{allowEdits:${allowEdits}});const d=new DataTransfer();d.items.add(new File([file],'new-project-test.scribecueqc'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));return true;})()`);
  await wait(`document.getElementById('subName').textContent.includes('new-project-test')`);
  await click('qcPlaybackClose');
  assert.notEqual(await js(`getComputedStyle(document.querySelector('[data-act=newProject]')).display`),'none');
  await js(`document.querySelector('[data-act=newProject]').click();true`);
  assert.equal(await js(`document.querySelector('#newDlg [data-choice=blocks]').hidden`),true);
  await click('newCancel');assert.equal(await js(`document.body.classList.contains('mode-qc')`),true);
  await js(`document.querySelector('#list .row').click();document.getElementById('edComment').click();document.getElementById('commentText').value='Unsaved review note';document.getElementById('commentPost').click();true`);
  await js(`document.querySelector('[data-act=newProject]').click();window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError')};true`);
  assert.equal(await js(`document.getElementById('newUnsaved').hidden`),false);
  if (!allowEdits) { const shot=await send('Page.captureScreenshot',{format:'png'});(await import('node:fs')).writeFileSync('/tmp/scribecue-qc-new-project.png',Buffer.from(shot.result.data,'base64')); }
  await click('newSave');await sleep(300);
  assert.equal(await js(`document.getElementById('newDlg').open && document.body.classList.contains('mode-qc')`),true);
  await js(`window.showSaveFilePicker=async()=>({name:'returned-review.scribecueqc',queryPermission:async()=>'granted',createWritable:async()=>({write:async b=>{window.__newSaved=b},close:async()=>{}})});true`);
  if (allowEdits) await js(`document.querySelector('#newDlg [data-choice=project]').click();true`);
  else {
   await click('newSave');await wait(`document.body.classList.contains('mode-write')`);
   assert.equal(await js(`(async()=>{const q=await import('./js/qc.js');const r=await q.openReview(__newSaved);return r.parsed.blocks[0].comments[0].text;})()`),'Unsaved review note');
  }
  assert.equal(await js(`document.querySelectorAll('#list .row').length`),0);
  assert.equal(await js(`document.querySelector('#modeSw [data-mode=transcribe]').disabled`),false);
  assert.equal(await js(`document.getElementById('commentsDrawer').hidden`),true);
  await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true,cancelable:true}));true`);
  assert.equal(await js(`document.querySelectorAll('#list .row').length`),0);
  await mode('transcribe');await mode('write');
  await js(`location.reload();true`);await sleep(1400);
  assert.equal(await js(`document.body.classList.contains('mode-write') && !document.querySelector('#modeSw [data-mode=transcribe]').disabled`),true);
 }
 console.log('QC New project: save, cancelled save, discard, package cleanup, mode switching and recovery passed');
 console.log('QC mode: creator permissions, comments-only restrictions, authorized edits, fixed timings, audio reuse and recovery passed');
} finally {await send('Emulation.setCPUThrottlingRate',{rate:1});ws.close();}
