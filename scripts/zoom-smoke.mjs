// Timeline zoom checks in headless, muted Chrome at 6× CPU slowdown, with Chrome's fake
// microphone: the zoom controls in the ruler's corner, Zoom to take (Z) in Record mode, and
// the close-up waveforms of the programme and the take when zoomed right in.
// Usage: node scripts/zoom-smoke.mjs <devtools port> <site url> <video path on the site> [screenshot.png]
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
const key=async(k,code)=>{const p={key:k,code,windowsVirtualKeyCode:k.toUpperCase().charCodeAt(0)};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...p});await send('Input.dispatchKeyEvent',{type:'keyUp',...p});await sleep(200);};
const span=()=>js(`document.getElementById('tlZoomSpan').textContent`);
const btn=z=>`document.querySelector('#tlZoom [data-zoom=${z}]')`;
const shoot=async name=>{if(!shot)return;const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(shot.replace(/\.png$/,`-${name}.png`),Buffer.from(s.result.data,'base64'));};
// How wide the waveform's steps are, in pixels, where it has sound: the median run of
// columns of the same height. Stretched out, the built waveform's steps are several pixels
// wide (1500 pixels a second over 200 bins); a close-up's are one or two.
const columns=canvas=>js(`(()=>{const c=document.getElementById('${canvas}'),g=c.getContext('2d'),d=g.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height,hs=[];
 for(let x=0;x<W;x++){let n=0;for(let y=0;y<H;y++){const k=(y*W+x)*4;if(d[k+3]>200&&(d[k]+d[k+1]+d[k+2])>200)n++;}hs.push(n);}
 const runs=[];let run=1;for(let x=1;x<hs.length;x++){if(hs[x]===hs[x-1])run++;else{if(hs[x-1]>12)runs.push(run);run=1;}}
 runs.sort((a,z)=>a-z);return runs.length?runs[runs.length>>1]:0;})()`);
const blocks=[{start:4,end:7,text:'He walks towards the door.'},{start:12,end:14,text:'Rain.'}];
try {
 await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:site});await sleep(800);
 await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);indexedDB.deleteDatabase('scribecue-takes');navigator.storage.getDirectory().then(r=>r.removeEntry('sessions',{recursive:true})).catch(()=>{}).then(()=>location.reload());true`);
 await sleep(2000);
 await js(`window.showDirectoryPicker=undefined;window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.confirm=()=>true;true`);

 await js(`(async()=>{const R=await import('./js/recording.js');const file=JSON.parse(JSON.stringify(R.toRecordingFile({blocks:${JSON.stringify(blocks)},fps:25})));
  const v=await fetch(${JSON.stringify(videoPath)}).then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(file)],'door.scribecuerec'));dt.items.add(new File([v],'door.mkv',{type:'video/x-matroska'}));
  window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
 await wait(`document.body.classList.contains('mode-record')`);
 await wait(`document.querySelector('video').readyState>=2`);
 await sleep(4000); // the waveform builds
 await js(`document.querySelectorAll('#list .row')[0].click();true`);await sleep(400);
 await key('r','KeyR');await wait(`document.getElementById('recGo').classList.contains('on')`);
 await wait(`document.querySelector('video').currentTime>6.5`,400);await key('r','KeyR');
 await wait(`/Saved/.test(document.getElementById('recStatus').textContent)`);
 await js(`document.querySelector('video').pause();true`);

 // The controls: Fit shows the whole programme; − is off there; + zooms in.
 assert.equal(await js(`getComputedStyle(${btn('take')}).display!=='none'`),true,'Take shows in Record mode');
 await js(`${btn('fit')}.click();true`);await sleep(300);
 const whole=await span();
 assert.equal(await js(`${btn('out')}.disabled`),true,'can’t zoom out past the whole programme');
 await js(`${btn('in')}.click();true`);await sleep(300);
 assert.notEqual(await span(),whole);
 assert.equal(await js(`${btn('out')}.disabled`),false);

 // Z fits block 1's slot and take; Z again goes back.
 const before=await span();
 await key('z','KeyZ');await sleep(300);
 const fitted=await span();
 assert.match(fitted,/^\d\.\d\d s$/,`Zoom to take shows a few seconds, not ${fitted}`);
 assert.equal(await js(`${btn('take')}.getAttribute('aria-pressed')`),'true');
 await shoot('take');
 await key('z','KeyZ');await sleep(300);
 assert.equal(await span(),before,'Z again restores the zoom');
 assert.equal(await js(`${btn('take')}.getAttribute('aria-pressed')`),'false');

 // Right in, at the most: + is off, and both waveforms are read close up, in small steps.
 await key('z','KeyZ');await sleep(300);

 const t0=Date.now();
 for(let k=0;k<12;k++){await js(`${btn('in')}.click();true`);await sleep(80);}
 assert.equal(await js(`${btn('in')}.disabled`),true,'can’t zoom in past the most');
 await js(`document.querySelector('video').currentTime=5.2;true`);await sleep(200);
 await wait(`(()=>{const c=document.getElementById('wave');return c.width>0})()`);
 await sleep(2500); // the close-ups are read once zooming stops
 const closeMs=Date.now()-t0;
 const fineWave=await columns('wave'), fineTake=await columns('takeWave');
 await shoot('close');
 console.log(`waveform step widths, in pixels: programme ${fineWave}, take ${fineTake} (the built waveform’s would be 7 or 8)`);
 assert.ok(fineWave>0&&fineWave<=2,`the programme waveform is drawn close up (steps ${fineWave} px wide)`);
 assert.ok(fineTake>0&&fineTake<=2,`the take is drawn close up (steps ${fineTake} px wide)`);

 // Scrolling while zoomed in stays smooth: frames and long tasks while the view moves.
 const scroll=await js(`(async()=>{const L=[];const o=new PerformanceObserver(l=>L.push(...l.getEntries().map(e=>e.duration)));o.observe({type:'longtask'});
  const tl=document.getElementById('tl'),r=tl.getBoundingClientRect();let frames=0,run=true;const tick=()=>{frames++;if(run)requestAnimationFrame(tick)};requestAnimationFrame(tick);
  const t0=performance.now();for(let k=0;k<60;k++){tl.dispatchEvent(new WheelEvent('wheel',{deltaX:40,clientX:r.left+400,clientY:r.top+40,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,33));}
  run=false;const secs=(performance.now()-t0)/1000;o.disconnect();return {fps:Math.round(frames/secs),long:L.length,longest:Math.round(Math.max(0,...L))};})()`);
 await sleep(1500);

 const long=await js(`__long`);
 assert.deepEqual(await js(`__errors`),[]);
 console.log(`Zoom smoke passed at 6× slowdown: close-ups drawn within ${closeMs} ms of zooming in; scrolling zoomed in at ${scroll.fps} frames a second, `
  +`${scroll.long} long tasks${scroll.long?` (longest ${scroll.longest} ms)`:''}; ${long.length} long tasks in all${long.length?` (longest ${Math.round(Math.max(...long))} ms)`:''}`);
} finally { ws.close(); }
