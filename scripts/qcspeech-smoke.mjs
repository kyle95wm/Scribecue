// node scripts/qcspeech-smoke.mjs <DevTools port> <site URL> [screenshot path]
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
let preload;
const openQC=async()=>{await js(`document.querySelector('#modeSw [data-mode=qc]').click();if(!document.getElementById('qcPlaybackDlg').open)document.querySelector('#ind [data-key=qc]').click();true`);};
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setCPUThrottlingRate',{rate:6});
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  preload = await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__calls=[];window.__fail=false;window.__offline=false;window.__offers=0;window.__accept=false;
    window.confirm=()=>{__offers++;return __accept};
    const nativeFetch=window.fetch;
    window.fetch=async(url,init)=>{
      if(!String(url).startsWith('https://texttospeech.googleapis.com/'))return nativeFetch(url,init);
      if(String(url).endsWith('/voices'))return {ok:true,json:async()=>({voices:[{name:'en-US-Standard-A',languageCodes:['en-US'],ssmlGender:'FEMALE'}]})};
      const key=init.headers['x-goog-api-key'];__calls.push(key);
      await new Promise(r=>setTimeout(r,300));
      if(__offline)throw Error('Failed to fetch');
      if(__fail&&key==='personal-test-key')return {ok:false,status:403,json:async()=>({error:{message:'Test key refused'}})};
      return {ok:true,json:async()=>({audioContent:String(init.body).includes('short')?__b64short:__b64})};
    };
    window.__saved=null;window.showSaveFilePicker=async()=>({name:'working.scribecueqc',queryPermission:async()=>'granted',createWritable:async()=>({write:async x=>{__saved=x},close:async()=>{}})});
    const nativeClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloadName=this.download;window.__download=nativeFetch(this.href).then(r=>r.blob());}else nativeClick.call(this)};
  `});
  await send('Page.navigate',{url:site});await sleep(700);
  await js(`localStorage.clear();localStorage.setItem('scribecue.welcome','1');localStorage.setItem('scribecue.updates','0');localStorage.setItem('scribecue.seenVersion','999.0.0');localStorage.setItem('scribecue.googleTts',JSON.stringify({key:'personal-test-key',voices:[{name:'en-US-Standard-A',languageCodes:['en-US'],ssmlGender:'FEMALE'}]}));location.reload();true`);
  await wait(`!!document.getElementById('qcExportStart')`);await sleep(800);
  await js(`(async()=>{
    const {toProject,newIdentity}=await import('./js/project.js');const {buildReview,readReview}=await import('./js/qc.js');const {writeWav}=await import('./js/tts.js');
    const buf=writeWav(new Int16Array(48000),48000),a=new Uint8Array(await buf.arrayBuffer());window.__b64=btoa(Array.from(a,x=>String.fromCharCode(x)).join(''));
    const half=new Uint8Array(await writeWav(new Int16Array(24000),48000).arrayBuffer());window.__b64short=btoa(Array.from(half,x=>String.fromCharCode(x)).join(''));
    const p=toProject({projectId:newIdentity(),blocks:[{uid:newIdentity(),start:3,end:6,text:'Mara opens the blue door.'}],settings:{mode:'qc',ttsVoice:'google:en-US-Standard-A',ttsBase:1}});
    window.__original=await buildReview(p,async()=>({blob:new Blob([buf]),secs:1,voice:p.settings.ttsVoice}),{handoff:true,allowEdits:true,googleReviewKey:'bundled-test-key'});
    const d=new DataTransfer();d.items.add(new File([__original],'review.scribecueqc'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));
  })()`);
  await wait(`document.getElementById('subName').textContent.includes('review')&&document.querySelectorAll('#list .row').length===1`);
  await js(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#list .row').click();true`);
  assert.equal(await js('__calls.length'),0,'opening does not synthesize');
  assert.equal(await js(`document.getElementById('edVoiceWrap').hidden`),true,'a Google block keeps its voice with a key in the package');
  assert.equal(await js(`document.getElementById('edSpeedWrap').hidden`),false);
  await js(`(()=>{const f=document.getElementById('edEnd');f.focus();f.value='00:00:05.500';f.dispatchEvent(new Event('change',{bubbles:true}));f.blur()})()`);
  assert.equal(await js('__calls.length'),0,'placement/slot changes do not synthesize');
  const edit=async text=>js(`(()=>{const f=document.getElementById('edText');f.focus();f.value=${JSON.stringify(text)};f.dispatchEvent(new Event('input',{bubbles:true}));f.blur()})()`);
  await js(`window.__longTasks=[];window.__frames=[];window.__lastFrame=performance.now();window.__observer=new PerformanceObserver(l=>__longTasks.push(...l.getEntries().map(e=>e.duration)));__observer.observe({type:'longtask'});window.__tick=t=>{__frames.push(t-__lastFrame);__lastFrame=t;window.__raf=requestAnimationFrame(__tick)};__raf=requestAnimationFrame(__tick);true`);
  // A changed block is read when the edit ends, and its end follows the reading.
  const settled=n=>wait(`__calls.length===${n}&&!document.getElementById('qcBlockInfo').textContent.startsWith('Making')`);
  const length=()=>js(`document.getElementById('edDur').textContent`);
  const hear=()=>key('KeyV','v',{ctrlKey:false});
  assert.equal(await js(`!!document.getElementById('qcRewrite')`),false,'no Hear rewrite button');
  await js(`(()=>{const f=document.getElementById('edText');f.focus();f.value='Mara opens the green';f.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await sleep(1200);assert.equal(await js('__calls.length'),0,'typing alone does not synthesize');
  await edit('Mara opens the green door.');
  await settled(1);
  assert.deepEqual(await js('__calls'),['personal-test-key']);
  await wait(`document.getElementById('edDur').textContent==='1.000 s'`);
  await hear();await sleep(300);await hear();assert.equal(await js('__calls.length'),1,'replaying is offline');
  await js(`(()=>{const f=document.getElementById('edEnd');f.focus();f.value='00:00:05.500';f.dispatchEvent(new Event('change',{bubbles:true}));f.blur()})()`);
  await sleep(1200);assert.equal(await length(),'2.500 s','an end set by hand stays');assert.equal(await js('__calls.length'),1);
  // Back to the original words: the end follows the original reading again, with no request.
  await edit('Mara opens the short door.');await settled(2);
  await wait(`document.getElementById('edDur').textContent==='0.500 s'`);
  await edit('Mara opens the blue door.');await sleep(1200);
  assert.equal(await js('__calls.length'),2,'the original reading needs no request');
  await wait(`document.getElementById('edDur').textContent==='1.000 s'`);
  // The reviewer's key fails: the writer's key reads it, without asking.
  await js(`__fail=true;true`);await edit('Mara opens the red door.');
  await settled(4);
  assert.equal(await js('__offers'),0,'no question');assert.deepEqual((await js('__calls')).slice(-2),['personal-test-key','bundled-test-key']);
  await wait(`document.getElementById('toast').textContent.includes('the writer’s key read block #1')`);
  await wait(`document.getElementById('edDur').textContent==='1.000 s'`);
  await js(`document.getElementById('edSpeed').value='1.15';document.getElementById('edSpeed').dispatchEvent(new Event('change'));true`);
  await settled(6);
  assert.deepEqual((await js('__calls')).slice(-2),['personal-test-key','bundled-test-key'],'each new reading starts with the personal key');
  // A block added in review reads in the package's Google voice, as soon as it's written.
  await js(`__fail=false;document.activeElement?.blur();true`);
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:720,y:676,button:'left',clickCount:1});
  await key('Enter','Enter',{ctrlKey:false});
  await wait(`document.querySelectorAll('#list .row').length===2&&document.activeElement===document.getElementById('edText')`);
  assert.equal(await js(`document.getElementById('edVoiceWrap').hidden`),true,'an added block keeps the package voice');
  assert.equal(await js(`document.getElementById('qcBlockInfo').textContent`),'New block · no reading');
  await edit('A door slams.');
  await settled(7);
  assert.equal(await js('__calls.at(-1)'),'personal-test-key');
  await wait(`document.getElementById('edDur').textContent==='1.000 s'&&document.getElementById('qcBlockInfo').textContent.startsWith('New reading')`);
  await js(`document.querySelector('#list .row').click();true`);
  await js(`__offline=true;true`);await hear();await click('qcPrevious');
  const calls=await js('__calls.length');
  await key('KeyS','s');await wait(`!!__saved`);
  const persisted=await js(`(async()=>{const r=await(await import('./js/qc.js')).readReview(__saved);return{key:r.reviewAccess.googleKey,proposals:r.proposals.length}})()`);
  assert.equal(persisted.key,'bundled-test-key');assert.equal(persisted.proposals,5);
  const responsiveness=await js(`(()=>{cancelAnimationFrame(__raf);__observer.disconnect();return{longTasks:__longTasks,maxFrameGapMs:Math.max(...__frames),frames:__frames.length,heapMiB:Math.round(performance.memory.usedJSHeapSize/1048576)}})()`);
  if(screenshot){
    await js(`document.activeElement?.blur();document.getElementById('toast').classList.add('fade');true`);await sleep(400);
    const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(screenshot,Buffer.from(shot.result.data,'base64'));
  }
  await openQC();assert.ok((await js(`document.getElementById('qcKeyInfo').textContent`)).startsWith('Your Google key'));
  await click('qcReturn');
  const returned=await js(`(async()=>{const r=await(await import('./js/qc.js')).readReview(await __download);return{key:r.reviewAccess,proposals:r.proposals.length}})()`);
  assert.equal(returned.key,null);assert.equal(returned.proposals,5);
  assert.equal(await js('__calls.length'),calls);
  // Restore the working package, then replay with no network and no lost key setting.
  await send('Page.reload');await wait(`document.querySelectorAll('#list .row').length===2`);await sleep(700);
  await js(`__offline=true;document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#list .row').click();true`);await hear();
  assert.equal(await js('__calls.length'),0,'browser recovery replays cached rewrite without Google');
  assert.equal(await js(`JSON.parse(localStorage.getItem('scribecue.googleTts')).key`),'personal-test-key');
  // Check the writer's explicit opt-in and prevent bundling their main key.
  await js(`(async()=>{document.getElementById('qcExportDlg').showModal();(await import('./js/qcdrawer.js')).refreshQc();return true})()`);
  await click('qcExportAllowEdits');await click('qcExportGoogle');
  await js(`document.getElementById('qcGoogleKey').value='personal-test-key';true`);await click('qcExportStart');
  assert.equal(await js(`document.getElementById('qcExportStatus').textContent`),'Use a separate review key. This is your main Google key');
  await js(`document.getElementById('qcGoogleKey').value='bundled-test-key';document.getElementById('qcExportStatus').textContent='';document.activeElement?.blur();true`);
  await js(`document.querySelectorAll('dialog[open]').forEach(d=>{if(d.id!=='qcExportDlg')d.close()});document.getElementById('toast').classList.add('fade');true`);
  if(screenshot){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dirname(screenshot),'qc-google-package.png'),Buffer.from(shot.result.data,'base64'));}
  await click('qcExportAllowEdits');assert.equal(await js(`document.getElementById('qcGoogleKey').value`),'');
  // A block saved by an earlier version, running past its new reading, ends where it finishes once opened.
  await js(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());__saved=null;true`);await key('KeyS','s');await wait(`!!__saved`);
  await js(`(async()=>{const {readReview,resaveReview}=await import('./js/qc.js');const r=await readReview(__saved);const p=r.project;
    p.blocks[0].end=p.blocks[0].start+3;p.blocks[0].auto=true;const f=resaveReview(r,p,{includeReviewKey:true});
    const d=new DataTransfer();d.items.add(new File([f],'stale.scribecueqc'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));return true})()`);
  await wait(`document.getElementById('subName').textContent.includes('stale')`);
  await js(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#list .row').click();true`);
  await wait(`document.getElementById('edDur').textContent==='1.000 s'`);
  console.log(JSON.stringify({cpuSlowdown:6,synthesisRequests:calls,recordings:persisted.proposals,personalKeyPriority:true,automaticReadings:true,endFollowsReading:true,endFollowsOriginal:true,staleEndFitted:true,addedBlockReading:true,automaticFallback:true,offlineReplay:true,returnKeyRemoved:true,responsiveness}));
} finally {if(preload?.result?.identifier)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:preload.result.identifier});ws.close();}
