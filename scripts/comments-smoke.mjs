// Browser regression and slower-computer checks. Run against a local test copy of the
// app with demo.mkv available, using headless, muted Chrome's debugging port.
import assert from 'node:assert/strict';
const [,, port, site] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  if (process.env.DEBUG_COMMENTS) console.log(expression.slice(0, 110));
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails));
  return m.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (id) => js(`document.getElementById(${JSON.stringify(id)}).click(); true`);
const key = (code, key, extra = {}) => js(`document.body.dispatchEvent(new KeyboardEvent('keydown', {code:${JSON.stringify(code)},key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(extra)}})); true`);
const count = () => js(`document.querySelectorAll('#commentsLog article').length`);
const post = (text) => js(`document.getElementById('commentText').value=${JSON.stringify(text)}; document.getElementById('commentPost').click(); true`);
const action = (label) => js(`[...document.querySelectorAll('#commentsLog button')].find(b=>b.textContent===${JSON.stringify(label)}).click(); true`);
try {
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Page.navigate', { url: site }); await sleep(700);
  await js(`localStorage.clear(); localStorage.setItem('scribecue.welcome','1'); localStorage.setItem('scribecue.seenVersion','999.0.0'); localStorage.setItem('scribecue.updates','0'); localStorage.setItem('scribecue.mode','transcribe'); localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:3,end:6,text:'First block'},{start:10,end:14,text:'Second block'}],dirty:false})); location.reload(); true`);
  await sleep(1300);
  await js(`window.__errors=[]; addEventListener('error',e=>__errors.push(e.message)); window.__long=[]; new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'}); document.querySelector('#list .row').click(); true`);
  assert.equal(await js(`document.querySelector('#commentBlock, #commentTime')`), null);
  await click('edComment');
  assert.equal(await js(`document.activeElement.id`), 'commentText');
  assert.equal(await js(`document.getElementById('commentTimeLabel').hidden`), true);
  await js(`document.getElementById('commentAuthor').value='QC reviewer'; true`);
  await post('First note <b>plain text</b>'); await post('Second note');
  assert.equal(await count(), 2);
  assert.equal(await js(`document.querySelector('#commentsLog .comment-body b')===null`), true);
  await action('Resolve'); assert.equal(await count(), 1);
  await click('commentsResolved'); assert.equal(await count(), 2);
  await action('Reopen');
  await action('Edit');
  await js(`document.querySelector('#commentsLog textarea').value='Updated QC note'; true`);
  await action('Save');
  // The header targets the playhead even with a block selected.
  await click('commentsClose'); await click('commentsBtn');
  assert.equal(await js(`document.getElementById('commentTimeLabel').hidden`), false);
  assert.equal(await js(`document.getElementById('commentAt').value`), '00:00:03:00');
  await js(`document.querySelectorAll('#list .row')[1].click(); true`);
  await click('edComment');
  assert.equal(await js(`document.getElementById('commentsDrawer').hidden`), false);
  assert.equal(await js(`document.getElementById('commentTimeLabel').hidden`), true);
  assert.match(await js(`document.getElementById('commentTarget').textContent`), /block #2/);
  assert.equal(await js(`document.activeElement.id`), 'commentText');
  await post('Note for the second block');
  assert.equal(await count(), 3);
  assert.match(await js(`document.querySelectorAll('#commentsLog .comment-location')[2].textContent`), /Block #2/);
  await js(`[...document.querySelectorAll('#commentsLog article')].find(a=>a.textContent.includes('Note for the second block')).querySelector('.acts button:last-child').click(); true`);
  assert.equal(await count(), 2);
  await click('commentsClose');
  // Reopening from a different block must target that block, too.
  await js(`document.querySelector('#list .row').click(); true`);
  await click('edComment');
  assert.match(await js(`document.getElementById('commentTarget').textContent`), /block #1/);
  await click('commentsClose'); await click('commentsBtn');
  assert.equal(await js(`document.getElementById('commentTimeLabel').hidden`), false);
  await js(`document.getElementById('commentAt').value='nonsense'; true`);
  await post('Invalid time'); assert.equal(await count(), 2);
  await js(`document.getElementById('commentAt').value='00:00:20:00'; true`);
  await post('Timeline note'); assert.equal(await count(), 3);
  await js(`[...document.querySelectorAll('#commentsLog .comment-location')].at(-1).click(); true`);
  await sleep(100);
  assert.equal(await js(`document.getElementById('clock').textContent`), '00:00:20:00');
  await action('Delete'); assert.equal(await count(), 2);
  await click('commentsClose');
  await key('KeyZ', 'z', { metaKey: true });
  await click('commentsBtn'); assert.equal(await count(), 3);
  // Both drawers share the same space, and timeline right-click starts a timed comment.
  await click('aiBtn');
  assert.equal(await js(`document.getElementById('commentsDrawer').hidden`), true);
  await js(`const r=document.getElementById('ruler').getBoundingClientRect(); document.getElementById('ruler').dispatchEvent(new MouseEvent('contextmenu',{clientX:r.left+50,bubbles:true,cancelable:true})); true`);
  assert.equal(await js(`document.getElementById('aiDrawer').hidden`), true);
  assert.equal(await js(`document.getElementById('commentTimeLabel').hidden`), false);
  // Save through the real project path, then import that JSON through a file drop.
  await js(`window.showSaveFilePicker=async()=>({name:'qc.scribecue',queryPermission:async()=>'granted',createWritable:async()=>({write:async t=>{window.__saved=t},close:async()=>{}})}); document.getElementById('commentText').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'s',metaKey:true,bubbles:true,cancelable:true})); true`);
  await sleep(300);
  const saved = await js(`JSON.parse(window.__saved)`);
  assert.equal(saved.blocks[0].comments.length, 2); assert.equal(saved.comments.length, 1);
  assert.equal(saved.blocks[0].comments[0].author, 'QC reviewer');
  await js(`window.confirm=()=>true; const dt=new DataTransfer(); dt.items.add(new File([__saved],'qc.scribecue')); window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); true`);
  await sleep(300); assert.equal(await count(), 3);
  await js(`location.reload(); true`); await sleep(1200);
  await click('commentsBtn'); assert.equal(await count(), 3);
  await js(`window.confirm=()=>true; window.__errors=[]; addEventListener('error',e=>__errors.push(e.message)); true`);
  // Merging keeps both blocks' comments, and undo restores their attachments.
  await click('commentsClose');
  await js(`document.querySelector('#list .row').click(); true`);
  await key('KeyM', 'm');
  assert.equal(await js(`document.querySelectorAll('#list .row').length`), 1);
  await click('commentsBtn'); assert.equal(await count(), 3);
  await click('commentsClose'); await key('KeyZ', 'z', {metaKey:true});
  assert.equal(await js(`document.querySelectorAll('#list .row').length`), 2);
  await click('commentsBtn');
  // A large QC file must not create thousands of DOM nodes. Its last comment is at two hours.
  const stress = await js(`(async()=>{const p=JSON.parse(localStorage.getItem('scribecue.v1')); p.comments=Array.from({length:5000},(_,i)=>({text:'Review '+i,author:'Sam',time:i*7200/4999,created:'2026-10-31T00:00:00Z'})); const project={scribecue:1,blocks:p.cues,comments:p.comments}; const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(project)],'long-qc.scribecue')); const t=performance.now();window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,400));return {loadMs:performance.now()-t,rendered:document.querySelectorAll('#commentsLog article').length,heap:performance.memory?.usedJSHeapSize}})()`);
  assert.equal(stress.rendered, 50);
  await click('commentsNext'); assert.equal(await count(), 50);
  // Load the generated video, then measure playback and typing at 6× CPU slowdown.
  await js(`(async()=>{const b=await fetch('/demo.mkv').then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([b],'demo.mkv'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);
  await sleep(2500);
  const performanceResult = await js(`(async()=>{const v=document.getElementById('video');v.muted=true;await v.play();const long=[],frames=[];const observer=new PerformanceObserver(l=>long.push(...l.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});let active=true;const tick=t=>{if(active){frames.push(t);requestAnimationFrame(tick)}};requestAnimationFrame(tick);const before=v.getVideoPlaybackQuality();const t=performance.now();const input=document.getElementById('commentText');input.focus();input.value='Typing while the programme plays';input.dispatchEvent(new InputEvent('input',{bubbles:true}));const typingMs=performance.now()-t;await new Promise(r=>setTimeout(r,5000));active=false;observer.disconnect();v.pause();const after=v.getVideoPlaybackQuality();return {typingMs,animationFps:frames.length/5,videoFrames:after.totalVideoFrames-before.totalVideoFrames,droppedFrames:after.droppedVideoFrames-before.droppedVideoFrames,longTasks:long.length,maxLongTaskMs:Math.max(0,...long),heapMB:performance.memory?.usedJSHeapSize/1048576,currentTime:v.currentTime}})()`);
  assert.ok(performanceResult.currentTime >= 4, 'video played under CPU throttling');
  assert.ok(performanceResult.typingMs < 100, 'typing stays responsive');
  assert.ok(performanceResult.maxLongTaskMs < 200, 'no long freeze during playback');
  assert.deepEqual(await js('window.__errors'), []);
  console.log(JSON.stringify({ cpuSlowdown: 6, stress, playback: performanceResult }, null, 2));
  console.log('Comments browser checks passed');
} finally { await send('Emulation.setCPUThrottlingRate', { rate: 1 }); ws.close(); }
