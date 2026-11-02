// QC handoff comparison in muted headless Chrome at 6× CPU slowdown.
// node scripts/qc-review-smoke.mjs <DevTools port> <site URL> [screenshot path]
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
const [,,port,site,screenshot,mediaPath]=process.argv;
const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const js=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let i=0;i<150;i++){if(await js(expression))return;await sleep(100);}throw Error('Timed out: '+expression+'\n'+await js(`document.getElementById('reviewCompareStatus')?.textContent`));};
const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click();true`);
const open=async()=>{await js(`document.querySelector('#ind [data-key=qc]').click();true`);await click('qcCompareReturned');await wait(`document.getElementById('reviewCompareDlg').open`);};
const choose=async()=>js(`(()=>{const dt=new DataTransfer();dt.items.add(new File([__returned],'returned.scribecueqc'));const input=document.getElementById('reviewCompareFile');input.files=dt.files;input.dispatchEvent(new Event('change'));})()`);
try {
  await send('Emulation.setCPUThrottlingRate',{rate:6});await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:site});await sleep(1000);
  await js(`localStorage.clear();localStorage.setItem('scribecue.welcome','1');localStorage.setItem('scribecue.updates','0');localStorage.setItem('scribecue.seenVersion','999.0.0');localStorage.setItem('scribecue.mode','qc');localStorage.setItem('scribecue.loops',JSON.stringify({write:true,transcribe:true,qc:true}));localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:1,end:2,text:'Initial block'}],dirty:false}));location.reload();true`);
  await wait(`document.querySelectorAll('#list .row').length===1`);
  await js(`(async()=>{
    const {toProject,newIdentity}=await import('./js/project.js');const {buildReview,readReview,resaveReview}=await import('./js/qc.js');
    window.__wav=()=>{const a=new Uint8Array(44+48000*2),v=new DataView(a.buffer),put=(at,s)=>{for(let i=0;i<s.length;i++)a[at+i]=s.charCodeAt(i)};put(0,'RIFF');v.setUint32(4,a.length-8,true);put(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,a.length-44,true);return new Blob([a],{type:'audio/wav'})};
    const p=toProject({projectId:newIdentity(),blocks:[{uid:newIdentity(),start:3,end:6,text:'Mara opens the blue door.'},{uid:newIdentity(),start:10,end:12,text:'She steps into the garden.'}],settings:{mode:'qc',ttsVoice:'test',ttsBase:1}});
    window.__original=await readReview(await buildReview(p,async()=>({blob:__wav(),secs:1,voice:'test'}),{allowEdits:true,handoff:true}));
    window.__local=structuredClone(__original.project);window.__remote=structuredClone(__original.project);
    __local.blocks[0].text='Mara pushes open the blue door.';__remote.blocks[0].text='Mara opens a weathered blue door.';__remote.blocks[1].comments=[{text:'Check this entrance.',author:'Sam'}];__remote.blocks[1].start=10.5;__remote.blocks[1].end=12.5;
    window.__returned=resaveReview(__original,__remote);window.__failure='';window.__saved=null;window.__aborted=false;window.confirm=()=>true;
    window.showSaveFilePicker=async()=>{if(__failure==='cancel')throw new DOMException('Cancelled','AbortError');return{name:'combined.scribecueqc',queryPermission:async()=>'granted',requestPermission:async()=>'granted',createWritable:async()=>({write:async data=>{if(__failure==='write')throw Error('Disk full');__saved=data},close:async()=>{},abort:async()=>{__aborted=true}})}};
    const dt=new DataTransfer();dt.items.add(new File([resaveReview(__original,__local)],'writer.scribecueqc'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
  })()`);
  await wait(`document.getElementById('subName').textContent.includes('writer')`);
  assert.equal(await js(`document.querySelector('[data-act=projectCopies]')`),null);
  const pendingShown=`!document.getElementById('listTabs').hidden && document.getElementById('pendingPane').offsetParent && !document.getElementById('reviewCompareDlg').open`;
  await open();await choose();await wait(pendingShown);
  // Exercise the queued-close race without yielding between close and reopen.
  await js(`(async()=>{const {openReviewCompare}=await import('./js/qcreviewdrawer.js');document.getElementById('reviewCompareDlg').close();openReviewCompare();})()`);
  await sleep(100);await choose();await wait(pendingShown);
  const rows=()=>js(`[...document.querySelectorAll('#pendingList .prow')].map(r=>r.querySelector('.d').textContent)`);
  assert.deepEqual(await rows(),['Both changed: wording','Changed: timing']);
  assert.equal(await js(`document.getElementById('pendingAccept').disabled`),true);
  assert.equal(await js(`document.querySelector('#pendingList .prow.sel .ppair').textContent.includes('Mara pushes open the blue door.') && document.querySelector('#pendingList .prow.sel .ppair').textContent.includes('Mara opens a weathered blue door.')`),true);
  assert.equal(await js(`document.querySelector('#cues .cue.ghost .ct').textContent`),'Mara opens a weathered blue door.');
  // Accepting moves on to the next change, whose new timing is outlined on the timeline.
  await js(`document.querySelector('#pendingList .prow .pick.remote').click();true`);
  assert.deepEqual(await rows(),['Both changed: wording · accepted','Changed: timing']);
  assert.equal(await js(`document.querySelector('#pendingList .prow.sel').dataset.i`),'1');
  const ghost=await js(`(()=>{const g=document.querySelector('#cues .cue.ghost'),c=document.querySelector('#cues .cue.changing');return{ghost:!!g,after:g.getBoundingClientRect().left>c.getBoundingClientRect().left}})()`);
  assert.deepEqual(ghost,{ghost:true,after:true});
  const layout=await js(`(()=>{const p=document.getElementById('pendingPane'),r=p.getBoundingClientRect();return{fits:r.bottom<=innerHeight&&p.scrollWidth<=p.clientWidth,height:r.height}})()`);assert.equal(layout.fits,true);
  if(screenshot){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(screenshot,Buffer.from(shot.result.data,'base64'));}
  await js(`document.querySelector('#pendingList .prow.sel .pick.local').click();true`);
  await js(`(()=>{const l=document.getElementById('pendingList');l.focus();l.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));})()`);
  assert.equal(await js(`document.querySelector('#pendingList .prow.sel').dataset.i`),'0','↑ selects the previous change');
  assert.equal(await js(`document.getElementById('pendingAccept').disabled`),false);
  await js(`__failure='write';true`);await click('pendingAccept');
  await wait(`document.getElementById('reviewCompareStatus').textContent==='Disk full'`);
  assert.ok(await js(`__aborted && document.getElementById('list').textContent.includes('Mara pushes open the blue door.')`));
  await click('reviewCompareClose');
  await js(`__failure='cancel';true`);await click('pendingAccept');await wait(`document.getElementById('reviewCompareStatus').textContent.startsWith('Stopped')`);
  await click('reviewCompareClose');
  await js(`__failure='';true`);await click('pendingAccept');
  await wait(`!document.getElementById('reviewCompareDlg').open && document.getElementById('subName').textContent.includes('combined')`);
  assert.equal(await js(`document.getElementById('listTabs').hidden && !document.querySelector('#cues .cue.ghost')`),true);
  const saved=await js(`(async()=>{const {readReview,reviewReading,previousReading}=await import('./js/qc.js');const r=await readReview(__saved);return{editable:r.permissions.allowEdits,text:r.project.blocks[0].text,start:r.project.blocks[1].start,comments:r.project.blocks[1].comments.length,stale:!reviewReading(r,r.project.blocks[0],r.project.settings),previous:!!previousReading(r,r.project.blocks[0]),baseline:r.baselineId===__original.baselineId,audio:await r.file.slice(0,r.audioEnd).text()===await __original.file.slice(0,__original.audioEnd).text()}})()`);
  assert.deepEqual(saved,{editable:true,text:'Mara opens a weathered blue door.',start:10,comments:1,stale:true,previous:true,baseline:true,audio:true});
  await js(`document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyZ',key:'z',ctrlKey:true,bubbles:true,cancelable:true}));true`);
  assert.ok(await js(`document.getElementById('list').textContent.includes('Mara pushes open the blue door.')`));
  // A corrupted original clip is refused, without offering a save.
  await js(`(async()=>{const bytes=new Uint8Array(await __returned.arrayBuffer());bytes[50]^=1;__returned=new Blob([bytes]);})()`);
  await open();await choose();await wait(`document.getElementById('reviewCompareStatus').textContent.includes('original audio differs')`);
  assert.equal(await js(`document.getElementById('reviewCompareSave').hidden`),true);await click('reviewCompareClose');
  // A new comments-only handoff keeps its permission through returned-comment comparison.
  await js(`(async()=>{const {buildReview,readReview,resaveReview}=await import('./js/qc.js');__comments=await readReview(await buildReview({...__original.project,reviewHistory:null},async()=>({blob:__wav(),secs:1,voice:'test'}),{handoff:true}));const p=structuredClone(__comments.project);p.blocks[0].comments=[{text:'Please check the door.',author:'Sam'}];__returned=resaveReview(__comments,p);const dt=new DataTransfer();dt.items.add(new File([__comments.file],'comments-only.scribecueqc'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);
  await wait(`document.getElementById('subName').textContent.includes('comments-only')`);
  await open();await choose();await wait(`!document.getElementById('reviewCompareSave').hidden && !document.getElementById('reviewCompareSave').disabled`);
  await click('reviewCompareSave');await wait(`!document.getElementById('reviewCompareDlg').open`);
  assert.equal(await js(`document.querySelector('#modeSw [data-mode=write]').disabled`),true);
  assert.equal(await js(`(async()=>!(await(await import('./js/qc.js')).readReview(__saved)).permissions.allowEdits)()`),true);
  if (mediaPath) {
    const encoded=readFileSync(mediaPath).toString('base64');
    await js(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],'playback.mp4',{type:'video/mp4'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);
    await wait(`document.getElementById('video').readyState>=2`);await js(`document.getElementById('video').play();true`);
  }
  const performanceResult=await js(`(async()=>{
    const {buildReview,readReview,resaveReview,reviewSink,storedReview,reviewAudioKey}=await import('./js/qc.js');
    const {toProject,newIdentity}=await import('./js/project.js');const {collaborationJob}=await import('./js/collaboration.js');
    const p=toProject({projectId:newIdentity(),blocks:Array.from({length:720},(_,i)=>({uid:newIdentity(),start:i*10,end:i*10+2,text:'Block '+i})),settings:{mode:'qc',ttsVoice:'test',ttsBase:1}});
    const frames=[],longTasks=[],steps=[];let raf,last=performance.now();const tick=t=>{frames.push(t-last);last=t;raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);
    const observer=new PerformanceObserver(l=>longTasks.push(...l.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
    const v=document.getElementById('video');let startVideo=0,startWall=0,quality;
    const sink=await reviewSink(),clip=__wav();let cacheKey=null;
    try {
      const file=await buildReview(p,async()=>({blob:clip,secs:1,voice:'test'}),{sink,handoff:true});
      const original=await readReview(file),reviewed=structuredClone(original.project);reviewed.blocks[1].comments=[{text:'Review note',author:'Sam'}];
      document.querySelector('#list .row').click();document.getElementById('edComment').click();const input=document.getElementById('commentText');input.value='Typing during review comparison';input.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,100));startVideo=v.currentTime;startWall=performance.now();quality=v.getVideoPlaybackQuality();
      const started=performance.now();const result=await collaborationJob({task:'returnedReview',local:original.project,file:resaveReview(original,reviewed),localPermission:null,authoring:true},{progress:(done,total,stage)=>steps.push({done,total,stage})});
      const elapsed=performance.now()-started;
      const accepted=JSON.parse(await result.authorFile.text());cacheKey=reviewAudioKey(accepted.projectId,accepted.reviewAudio.baselineId);
      const keepStart=performance.now();const kept=await storedReview({id:accepted.reviewAudio.baselineId,file:result.file},cacheKey);const keepMs=performance.now()-keepStart;
      if(!kept)throw Error('Original readings could not be kept in the test browser');
      const cached=await storedReview(undefined,cacheKey),restoreStart=performance.now();
      const attached=await collaborationJob({task:'reviewAudio',project:accepted,file:cached.file});const restoreMs=performance.now()-restoreStart;

      const aborter=new AbortController();let aborted=false;
      try {await collaborationJob({task:'returnedReview',local:original.project,file:resaveReview(original,reviewed),localPermission:false},{signal:aborter.signal,progress:(done,total,stage)=>{if(stage==='readings'&&done>=1)aborter.abort()}})}catch(error){aborted=error.name==='AbortError'}
      await new Promise(r=>setTimeout(r,200));cancelAnimationFrame(raf);observer.disconnect();
      return {ms:elapsed,keepMs,restoreMs,attachedReadings:attached.review.readings.length,authorProject:accepted.scribecue,aborted,bytes:file.size,frames:frames.length,maxFrameGapMs:Math.max(...frames),longTasks,progress:steps.length,readingsChecked:steps.filter(s=>s.stage==='readings').at(-1),comments:result.project.blocks[1].comments.length,typing:input.value,heapMiB:Math.round(performance.memory.usedJSHeapSize/1048576),playback:{videoSeconds:v.currentTime-startVideo,wallSeconds:(performance.now()-startWall)/1000,droppedFrames:v.getVideoPlaybackQuality().droppedVideoFrames-quality.droppedVideoFrames}};
    } finally {cancelAnimationFrame(raf);observer.disconnect();if(cacheKey)await storedReview(null,cacheKey);await sink?.clean();}
  })()`);
  assert.equal(performanceResult.aborted,true);assert.equal(performanceResult.attachedReadings,720);assert.equal(performanceResult.authorProject,1);
  assert.equal(performanceResult.comments,1);assert.equal(performanceResult.readingsChecked.done,720);
  assert.equal(performanceResult.typing,'Typing during review comparison');
  if(mediaPath){const rate=performanceResult.playback.videoSeconds/performanceResult.playback.wallSeconds;assert.ok(rate>0.9&&rate<1.1,'playback follows real time during comparison');}
  console.log('QC 6× disk-backed two-hour returned-review comparison:',JSON.stringify(performanceResult));
  console.log('QC comparison: conflicts, original audio, stale readings, permissions, failed/cancelled saves, undo and layout passed:',JSON.stringify(layout));
} finally {ws.close();}
