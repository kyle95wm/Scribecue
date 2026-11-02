// node scripts/author-review-smoke.mjs <DevTools port> <site URL> [screenshot path]
// Use fresh headless Chrome with --mute-audio. All file writes are stubbed.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [,,port,site,screenshot]=process.argv;
const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const js=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let i=0;i<180;i++){if(await js(expression))return;await sleep(100);}throw Error('Timed out: '+expression+'\n'+await js(`document.getElementById('reviewCompareStatus')?.textContent`));};
const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click();true`);
const key=(code,key,options={})=>js(`document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({code,key,ctrlKey:true,bubbles:true,cancelable:true,...options})}));true`);
const openQC=async()=>{await js(`document.querySelector('#modeSw [data-mode=qc]').click();if(!document.getElementById('qcPlaybackDlg').open)document.querySelector('#ind [data-key=qc]').click();true`);};
const compare=async()=>{await openQC();await click('qcCompareReturned');await wait(`document.getElementById('reviewCompareDlg').open`);await js(`(()=>{const d=new DataTransfer();d.items.add(new File([__returned],'returned.scribecueqc'));const i=document.getElementById('reviewCompareFile');i.files=d.files;i.dispatchEvent(new Event('change'));})()`);await wait(`!document.getElementById('reviewCompareSave').hidden&&!document.getElementById('reviewCompareSave').disabled`);};
try {
  await send('Emulation.setCPUThrottlingRate',{rate:6});await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:site});await sleep(1000);
  await js(`localStorage.clear();localStorage.setItem('scribecue.welcome','1');localStorage.setItem('scribecue.updates','0');localStorage.setItem('scribecue.seenVersion','999.0.0');localStorage.setItem('scribecue.mode','qc');localStorage.setItem('scribecue.loops',JSON.stringify({write:true,transcribe:true,qc:true}));localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:1,end:2,text:'Initial'}],dirty:false}));location.reload();true`);
  await wait(`document.querySelectorAll('#list .row').length===1`);
  await js(`(async()=>{
    const {toProject,newIdentity}=await import('./js/project.js');const {buildReview,readReview,resaveReview}=await import('./js/qc.js');
    const a=new Uint8Array(44+9600),v=new DataView(a.buffer),put=(at,s)=>{for(let i=0;i<s.length;i++)a[at+i]=s.charCodeAt(i)};put(0,'RIFF');v.setUint32(4,a.length-8,true);put(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,a.length-44,true);
    const p=toProject({projectId:newIdentity(),blocks:[{uid:newIdentity(),start:3,end:6,text:'Mara opens the blue door.'},{uid:newIdentity(),start:10,end:12,text:'She steps into the garden.'}],settings:{mode:'qc',ttsVoice:'test',ttsBase:1}});
    window.__original=await readReview(await buildReview(p,async()=>({blob:new Blob([a]),secs:.1,voice:'test'}),{handoff:true}));
    window.__author=structuredClone(__original.project);const reviewed=structuredClone(__original.project);reviewed.blocks[0].comments=[{text:'Check whether the door is blue.',author:'Sam'}];window.__returned=resaveReview(__original,reviewed);
    window.__failure='';window.__pickerCalls=0;window.__saved=null;window.__aborted=false;window.__saveName='movie.scribecue';window.confirm=()=>true;
    window.showSaveFilePicker=async()=>{__pickerCalls++;if(__failure==='cancel')throw new DOMException('Cancelled','AbortError');return{name:__saveName,queryPermission:async()=>'granted',requestPermission:async()=>'granted',createWritable:async()=>({write:async data=>{if(__failure==='write')throw Error('Disk full');__saved=data},close:async()=>{},abort:async()=>{__aborted=true}})}};
    const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(__author)],'writer.scribecue'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
  })()`);
  await wait(`document.getElementById('subName').textContent.includes('writer')`);
  await compare();assert.equal(await js(`document.getElementById('reviewCompareSave').textContent`),'Accept review');
  if(screenshot){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(screenshot,Buffer.from(shot.result.data,'base64'));}
  await js(`__failure='write';true`);await click('reviewCompareSave');await wait(`document.getElementById('reviewCompareStatus').textContent==='Disk full'`);
  assert.equal(await js(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[0].comments?.length||0`),0);
  await js(`__failure='cancel';true`);await click('reviewCompareSave');await wait(`document.getElementById('reviewCompareStatus').textContent.startsWith('Stopped')`);
  await js(`__failure='';true`);await click('reviewCompareSave');
  await wait(`!document.getElementById('reviewCompareDlg').open&&document.getElementById('subName').textContent.includes('movie.scribecue')`);
  assert.equal(await js(`document.querySelector('#modeSw [data-mode=write]').disabled`),false);
  assert.equal(await js(`document.getElementById('qcPermission').textContent`),'Authoring project');
  // The writer's own project keeps the script formats and has no return package.
  await js(`document.getElementById('exportBtn').click();true`);
  assert.deepEqual(await js(`(()=>{const shown=a=>!!document.querySelector('#exportMenu [data-act='+a+']').offsetParent;return{ret:shown('exportReturn'),srt:shown('exportSrt'),vtt:shown('exportVtt'),qc:shown('exportQc')}})()`),{ret:false,srt:true,vtt:true,qc:true});
  await js(`document.getElementById('exportBtn').click();true`);
  const accepted=await js(`(async()=>JSON.parse(typeof __saved==='string'?__saved:await __saved.text()))()`);
  assert.equal(accepted.scribecue,1);assert.equal(accepted.blocks[0].comments.length,1);assert.ok(accepted.reviewAudio.baselineId);
  assert.ok(!('permissions'in accepted));
  assert.equal(await js(`(async()=>!(await(await import('./js/qc.js')).readReview(__returned)).permissions.allowEdits)()`),true);
  const pickerCalls=await js('__pickerCalls');
  await compare();await click('reviewCompareSave');await wait(`!document.getElementById('reviewCompareDlg').open`);
  assert.equal(await js('__pickerCalls'),pickerCalls,'acceptance writes back to the authoring file when permission is already granted');
  if(screenshot){
    await js(`document.querySelector('#list .row').click();document.getElementById('edComment').click();document.activeElement?.blur();true`);
    await sleep(400);
    await js(`document.getElementById('toast').classList.add('fade');true`);
    const bounds=await js(`(()=>{const r=document.getElementById('commentsDrawer').getBoundingClientRect();return{left:r.left,right:r.right,width:r.width}})()`);
    assert.ok(bounds.left>=0&&bounds.right<=1440&&bounds.width>=400,'the comments drawer is fully visible');
    const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dirname(screenshot),'qc-authoring.png'),Buffer.from(shot.result.data,'base64'));
  }
  // The author can apply feedback directly in QC and save normal JSON again.
  await js(`document.querySelector('#list .row').click();const i=document.getElementById('edText');i.focus();i.value='Mara opens the green door.';i.dispatchEvent(new Event('input',{bubbles:true}));true`);
  await key('KeyS','s');await sleep(300);
  assert.equal(await js(`JSON.parse(__saved).blocks[0].text`),'Mara opens the green door.');
  assert.ok(await js(`JSON.parse(__saved).reviewAudio.baselineId`));
  // Save As keeps authoring context and the original-audio reference.
  await js(`__saveName='movie-copy.scribecue';true`);await key('KeyS','s',{shiftKey:true});await sleep(300);
  assert.equal(await js(`document.getElementById('subName').textContent.includes('movie-copy')`),true);
  const returnedBytes=await js(`(async()=>Array.from(new Uint8Array(await __returned.arrayBuffer())))()`);
  await sleep(500);await send('Page.reload');await wait(`document.querySelectorAll('#list .row').length===2`);
  await wait(`document.querySelector('#ind [data-key=qc]')?.textContent.includes('ORIGINAL READINGS')`);
  assert.equal(await js(`document.querySelector('#modeSw [data-mode=write]').disabled`),false);
  await openQC();assert.ok(await js(`document.getElementById('qcPackageInfo').textContent.startsWith('1 of 2')`));await click('qcPlaybackClose');
  // Simulate opening on another computer: remove cached audio, retain the project.
  await js(`(async()=>{const p=JSON.parse(localStorage.getItem('scribecue.v1')),q=await import('./js/qc.js');await q.storedReview(null,q.reviewAudioKey(p.projectId,p.reviewAudio.baselineId));})()`);
  await send('Page.reload');await wait(`document.querySelectorAll('#list .row').length===2`);await sleep(300);
  await js(`window.__returned=new Blob([new Uint8Array(${JSON.stringify(returnedBytes)})]);window.confirm=()=>true;true`);
  await openQC();assert.equal(await js(`document.getElementById('qcAttachReadings').hidden`),false);
  await js(`(()=>{const d=new DataTransfer();d.items.add(new File([__returned],'original.scribecueqc'));const i=document.getElementById('qcReadingsFile');i.files=d.files;i.dispatchEvent(new Event('change'));})()`);
  await wait(`document.getElementById('qcPackageInfo').textContent.startsWith('1 of 2')`);
  assert.ok(await js(`document.getElementById('list').textContent.includes('Mara opens the green door.')`));await click('qcPlaybackClose');
  // Reopening the actual returned package still restricts the reviewer.
  await js(`(async()=>{
    const {readReview}=await import('./js/qc.js');const r=await readReview(__returned),footer=new Uint8Array(await __returned.slice(-12).arrayBuffer());
    const manifest=JSON.parse(await __returned.slice(r.audioEnd,-12).text());manifest.project.reviewAudio={baselineId:r.baselineId,owner:true,allowEdits:true};
    const json=new TextEncoder().encode(JSON.stringify(manifest));new DataView(footer.buffer).setUint32(0,json.length,true);
    const forged=new Blob([__returned.slice(0,r.audioEnd),json,footer]),d=new DataTransfer();d.items.add(new File([forged],'reviewer.scribecueqc'));
    document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));
  })()`);
  await wait(`document.getElementById('subName').textContent.includes('reviewer')`);
  assert.equal(await js(`document.querySelector('#modeSw [data-mode=write]').disabled`),true);
  await openQC();await click('qcCompareReturned');
  assert.equal(await js(`document.getElementById('reviewCompareIntro').textContent.includes('You keep editing access')`),false);
  console.log('Author acceptance at 6×: comments-only handoff, failed/cancelled saves, author edits, JSON save/Save As, recovery, locating original readings and reviewer restrictions passed');
} finally {ws.close();}
