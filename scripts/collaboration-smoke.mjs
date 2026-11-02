// Run against a fresh headless Chrome launched with --mute-audio:
// node scripts/collaboration-smoke.mjs <DevTools port> <site URL>
// Exercises the actual save/load path and worker at 6× CPU slowdown.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const [,, port, site, mediaPath] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails));
  return m.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (expression) => { for (let i = 0; i < 100; i++) { if (await js(expression)) return; await sleep(100); } throw Error(`Timed out: ${expression}`); };
const key = (code, key, modifiers = {}) => js(`document.body.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ code, key, bubbles: true, cancelable: true, ...modifiers })}));true`);
const setupSave = () => js(`window.__saved=null;window.showSaveFilePicker=async()=>({name:'shared.scribecue',queryPermission:async()=>'granted',createWritable:async()=>({write:async data=>{window.__saved=JSON.parse(data)},close:async()=>{}})});true`);
const save = async () => { await js('window.__saved=null;true'); await key('KeyS', 's', { ctrlKey: true }); await wait('!!window.__saved'); return js('__saved'); };
try {
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(1200);
  await js(`localStorage.clear();localStorage.setItem('scribecue.welcome','1');localStorage.setItem('scribecue.setupModes',JSON.stringify({write:true,transcribe:true,qc:true}));localStorage.setItem('scribecue.updates','0');localStorage.setItem('scribecue.seenVersion','999.0.0');localStorage.setItem('scribecue.mode','write');localStorage.setItem('scribecue.loops',JSON.stringify({write:true,transcribe:true,qc:true}));localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:1,end:3,text:'First block'},{start:4,end:6,text:'Second block'}],dirty:false}));location.reload();true`);
  await wait(`document.querySelectorAll('#list .row').length===2`);
  await setupSave();
  const first = await save();
  assert.ok(first.projectId); assert.ok(first.blocks.every((b) => b.uid));
  await js(`document.querySelector('#list .row').click();document.getElementById('edText').focus();document.getElementById('edText').value='Edited first block';document.getElementById('edText').dispatchEvent(new Event('input',{bubbles:true}));true`);
  await sleep(500);
  const edited = await save();
  assert.equal(edited.blocks[0].text, 'Edited first block');
  assert.deepEqual(edited.blocks.map((b) => b.uid), first.blocks.map((b) => b.uid));
  await sleep(600);
  await send('Page.reload');
  await wait(`document.querySelectorAll('#list .row').length===2`); await setupSave();
  const reloaded = await save();
  assert.equal(reloaded.projectId, first.projectId);
  assert.deepEqual(reloaded.blocks.map((b) => b.uid), first.blocks.map((b) => b.uid));
  // Open an actual saved file, not just the autosaved session.
  await js(`{window.confirm=()=>true;window.__file=${JSON.stringify(edited)};const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(__file)],'roundtrip.scribecue'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));true}`);
  await wait(`document.getElementById('subName').textContent.includes('roundtrip')`);
  const opened = await save();
  assert.equal(opened.projectId, first.projectId);
  assert.deepEqual(opened.blocks.map((b) => b.uid), first.blocks.map((b) => b.uid));
  // A different imported script starts a different project, and undo restores identity.
  await js(`{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify('1\n00:00:01,000 --> 00:00:02,000\nImported block\n')}],'import.srt'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));true}`);
  await wait(`document.querySelectorAll('#list .row').length===1`);
  const imported = await save(); assert.notEqual(imported.projectId, first.projectId);
  await key('KeyZ', 'z', { ctrlKey: true });
  const undone = await save();
  assert.equal(undone.projectId, first.projectId);
  assert.deepEqual(undone.blocks.map((b) => b.uid), first.blocks.map((b) => b.uid));
  if (mediaPath) {
    const encoded = readFileSync(mediaPath).toString('base64');
    await js(`{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'playback.mp4',{type:'video/mp4'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));true}`);
    await wait(`document.getElementById('video').readyState>=2`);
    await js(`document.querySelector('#list .row').click();document.activeElement.blur();document.getElementById('video').currentTime=2;true`);
    await sleep(200);
    await key('KeyX', 'x');
    const split = await save();
    assert.equal(split.blocks.length, 3);
    assert.equal(split.blocks[0].uid, first.blocks[0].uid);
    assert.equal(new Set(split.blocks.map(b=>b.uid)).size, 3);
    assert.ok(!first.blocks.some(b=>b.uid===split.blocks[1].uid));
    await js(`document.querySelector('#list .row').click();document.activeElement.blur();true`);
    await key('KeyM', 'm');
    const merged = await save();
    assert.equal(merged.blocks.length, 2);
    assert.deepEqual(merged.blocks.map(b=>b.uid), first.blocks.map(b=>b.uid));
    await key('KeyZ', 'z', { ctrlKey: true });
    assert.deepEqual((await save()).blocks.map(b=>b.uid), split.blocks.map(b=>b.uid));
    await key('KeyZ', 'z', { ctrlKey: true });
    assert.deepEqual((await save()).blocks.map(b=>b.uid), first.blocks.map(b=>b.uid));
    await js(`document.getElementById('video').play();true`);
  }
  // A two-hour script, independent edits, worker progress, cancellation and input.
  const measured = await js(`(async()=>{
    const {toProject,newIdentity}=await import('./js/project.js');
    const {compareProjectCopies,collaborationJob}=await import('./js/collaboration.js');
    const base=toProject({projectId:newIdentity(),blocks:Array.from({length:1500},(_,i)=>({uid:newIdentity(),start:i*4.8,end:i*4.8+2,text:'Block '+i}))});
    const local=structuredClone(base),remote=structuredClone(base);
    local.blocks[0].text='Local edit';remote.blocks[1499].text='Remote edit';
    const progress=[],frames=[],longTasks=[];
    const observer=new PerformanceObserver(l=>longTasks.push(...l.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
    let raf,last=performance.now();const tick=t=>{frames.push(t-last);last=t;raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);
    document.querySelector('#list .row').click();const input=document.getElementById('edText');input.focus();input.value='Typing during comparison';input.dispatchEvent(new Event('input',{bubbles:true}));
    const video=document.getElementById('video'),videoStart=video.currentTime,wallStart=performance.now(),qualityStart=video.getVideoPlaybackQuality();
    const started=performance.now();const result=await compareProjectCopies(base,local,remote,{progress:(done,total)=>progress.push([done,total])});
    const elapsed=performance.now()-started;
    const controller=new AbortController();const cancelled=compareProjectCopies(base,local,remote,{signal:controller.signal});controller.abort();
    let aborted=false;try{await cancelled}catch(e){aborted=e.name==='AbortError'}
    let failed=false;try{await compareProjectCopies({...base,projectId:null},local,remote)}catch(e){failed=/before sharing/.test(e.message)}
    await new Promise(r=>setTimeout(r,1000));cancelAnimationFrame(raf);observer.disconnect();
    return {elapsed,frames:frames.length,maxFrameGapMs:Math.max(...frames),longTasks,progress:progress.length,lastProgress:progress.at(-1),aborted,failed,
      playback:{elapsed:video.currentTime-videoStart,wallSeconds:(performance.now()-wallStart)/1000,droppedFrames:video.getVideoPlaybackQuality().droppedVideoFrames-qualityStart.droppedVideoFrames},typing:input.value,
      text:[result.project.blocks[0].text,result.project.blocks[1499].text],conflicts:result.conflicts,heapBytes:performance.memory?.usedJSHeapSize};
  })()`);
  assert.deepEqual(measured.text, ['Local edit', 'Remote edit']);
  assert.deepEqual(measured.conflicts, []); assert.deepEqual(measured.lastProgress, [1500, 1500]);
  assert.ok(measured.progress > 1 && measured.aborted && measured.failed);
  assert.equal(measured.typing, 'Typing during comparison');
  if (mediaPath) assert.ok(measured.playback.elapsed / measured.playback.wallSeconds > 0.9, 'video keeps pace with real time');
  await js(`document.getElementById('video').pause();document.activeElement?.blur();document.querySelector('[data-act=newProject]').click();document.querySelector('#newDlg [data-choice=project]').click();true`);
  await wait(`document.querySelectorAll('#list .row').length===0`);
  await key('Enter', 'Enter');
  const fresh = await save();
  assert.notEqual(fresh.projectId, first.projectId);
  assert.ok(fresh.blocks.every(b=>!first.blocks.some(old=>old.uid===b.uid)));
  console.log('Identity save/load/import/split/merge/undo/new-project checks passed');
  console.log('6× CPU, 1,500-block two-hour script:', JSON.stringify(measured));
} finally { ws.close(); }
