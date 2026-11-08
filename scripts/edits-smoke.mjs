// "Edited by" checks in headless, muted Chrome at 6× CPU slowdown, with 1,500 blocks over two
// hours: a project of your own shows no names; once someone else changes a block, an open
// block says who changed it last; undo brings back the name it had; typing stays quick.
// Usage: node scripts/edits-smoke.mjs <devtools port> <site url> [screenshot.png]
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
const wait=async expression=>{for(let i=0;i<40;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};
const key=async(k,code)=>{const p={key:k,code,windowsVirtualKeyCode:{Escape:27}[k]};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...p});await send('Input.dispatchKeyEvent',{type:'keyUp',...p});await sleep(150);};
const line=()=>js(`(e=>e.hidden?'':e.textContent)(document.getElementById('edEdited'))`);
// A real click takes the focus from the text first; a scripted one doesn't, so blur it here.
const open=async n=>{await js(`document.activeElement?.blur();[...document.querySelectorAll('#list .row')][${n}].click();true`);await sleep(300);};
const savedBy=n=>js(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[${n}].edited?.by||''`);
const as=(name,who)=>js(`localStorage.setItem('scribecue.reviewer',${JSON.stringify(name)});localStorage.setItem('scribecue.editor',${JSON.stringify(who)});true`);
const type=async text=>{const t0=performance.now();for(const ch of text) await send('Input.insertText',{text:ch});return performance.now()-t0;};
try {
 await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:site});await sleep(800);
 await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:'Kyle',editor:'kyle-browser-1',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  const edited={by:'Kyle',at:'2026-11-07T14:00:00.000Z',who:'kyle-browser-1'};
  localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,cues:Array.from({length:1500},(_,i)=>({uid:'b'+String(i).padStart(7,'0')+'-0000-4000-8000-000000000000',start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.',edited}))}));location.reload();true`);
 await sleep(3000);
 await js(`window.showDirectoryPicker=undefined;window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
 assert.equal(await js(`document.querySelectorAll('#list .row').length>0`),true);

 // Your own project: nothing shows, before or after your edits.
 await open(1);
 assert.equal(await line(),'','no names on a project of your own');
 const kyleMs=await type(' Kyle again.');
 await key('Escape','Escape');
 await wait(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[1].text.endsWith('Kyle again.')`);
 await open(1);
 assert.equal(await line(),'');

 // Someone else changes a block: now open blocks say who changed them last.
 await as('Sam','sam-browser-1');
 await open(5);
 const samMs=await type(' Sam tightened it.');
 await key('Escape','Escape');
 await wait(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[5].edited?.by==='Sam'`);
 await open(5);
 assert.match(await line(),/^Edited by Sam · /);
 if(shot){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(shot,Buffer.from(s.result.data,'base64'));}
 await open(1);
 assert.match(await line(),/^Edited by Kyle · /,'blocks Kyle changed now show his name');
 assert.equal(await savedBy(0),'Kyle','untouched blocks keep their name');

 // Undo takes Sam's change away, and his name with it.
 await js(`document.activeElement?.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,metaKey:true,bubbles:true}));true`);
 await wait(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[5].edited?.by==='Kyle'`);
 await open(5);
 assert.equal(await line(),'','back to one person, so nothing shows');

 const long=await js(`__long`);
 assert.deepEqual(await js(`__errors`),[]);
 const per=(ms,text)=>(ms/text.length).toFixed(1);
 console.log(`Edits smoke passed at 6× slowdown with 1,500 blocks: typing ${per(kyleMs,' Kyle again.')} ms and ${per(samMs,' Sam tightened it.')} ms a character, `
  +`${long.length} long tasks${long.length?` (longest ${Math.round(Math.max(...long))} ms)`:''}`);
} finally { ws.close(); }
