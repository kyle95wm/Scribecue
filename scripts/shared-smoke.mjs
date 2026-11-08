// Shared copy checks in headless, muted Chrome at 6× CPU slowdown, with 1,500 blocks over two
// hours. With the developer setting off, Yjs never loads. With it on, the shared copy matches
// the script after typing, deleting, undoing, commenting and opening another project, and
// typing stays quick.
// Usage: node scripts/shared-smoke.mjs <devtools port> <site url>
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
const wait=async expression=>{for(let i=0;i<60;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};
const key=async(k,code)=>{const p={key:k,code,windowsVirtualKeyCode:{Escape:27,Delete:46}[k]};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...p});await send('Input.dispatchKeyEvent',{type:'keyUp',...p});await sleep(200);};
const open=async n=>{await js(`document.activeElement?.blur();[...document.querySelectorAll('#list .row')][${n}].click();true`);await sleep(300);};
const type=async text=>{const t0=performance.now();for(const ch of text) await send('Input.insertText',{text:ch});return performance.now()-t0;};
// The script as saved, and the shared copy, in the same shape.
const matches=async()=>{await sleep(700);return js(`(()=>{
  const saved=JSON.parse(localStorage.getItem('scribecue.v1'));
  const want=JSON.stringify(saved.cues.map(c=>[c.uid,c.start,c.end,c.text,(c.comments||[]).map(x=>x.id+x.text)]));
  const out=window.scribecueShared.read();
  const got=JSON.stringify(out.blocks.map(c=>[c.uid,c.start,c.end,c.text,(c.comments||[]).map(x=>x.id+x.text)]));
  return want===got && JSON.stringify((saved.comments||[]).map(c=>c.id))===JSON.stringify(out.comments.map(c=>c.id)) ? true : {want:want.slice(0,300),got:got.slice(0,300),n:[saved.cues.length,out.blocks.length]};
})()`);};
const setup=on=>js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:'Kyle',${on?"sharedCopy:'1',":''}setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,projectId:crypto.randomUUID(),cues:Array.from({length:1500},(_,i)=>({uid:crypto.randomUUID(),start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.',...(i%50===0?{comments:[{text:'Check '+i,author:'Sam',created:'2026-11-08T00:00:00Z'}]}:{})}))}));location.reload();true`);
try {
 await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:site});await sleep(800);

 // Off: nothing loads.
 await setup(false);await sleep(3000);
 assert.equal(await js(`performance.getEntriesByType('resource').some(e=>/yjs|shared\\.js/.test(e.name))`),false,'Yjs stays unloaded');
 assert.equal(await js(`'scribecueShared' in window`),false);
 const offMs=await (async()=>{await open(1);const ms=await type(' Off.');await key('Escape','Escape');return ms;})();

 // On: the shared copy follows the script.
 await setup(true);
 await wait(`window.scribecueShared`);
 await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
 const startMs=await js(`performance.getEntriesByType('resource').filter(e=>/yjs|shared\\.js/.test(e.name)).reduce((m,e)=>Math.max(m,e.responseEnd),0)`);
 assert.equal(await matches(),true,'filled from the script');
 await open(1);
 const onMs=await type(' Kyle again.');
 await key('Escape','Escape');
 assert.equal(await matches(),true,'after typing');
 // Delete a block, then undo.
 await open(3);await key('Escape','Escape');
 await js(`document.getElementById('edDel').click();true`);await sleep(400);
 assert.equal(await matches(),true,'after deleting');
 await js(`document.activeElement?.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,metaKey:true,bubbles:true}));true`);await sleep(400);
 assert.equal(await matches(),true,'after undo');
 // A comment on a block.
 await open(2);
 await js(`document.getElementById('edComment').click();document.getElementById('commentText').value='Looks good';document.getElementById('commentPost').click();true`);
 assert.equal(await matches(),true,'after a comment');
 // Another project starts a new shared copy.
 const before=await js(`window.scribecueShared.doc.guid`);
 await js(`(()=>{const dt=new DataTransfer();dt.items.add(new File([JSON.stringify({scribecue:1,projectId:crypto.randomUUID(),blocks:[{uid:crypto.randomUUID(),start:1,end:2,text:'Only one'}]})],'other.scribecue'));window.confirm=()=>true;window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return true})()`);
 await wait(`JSON.parse(localStorage.getItem('scribecue.v1')).cues.length===1`);
 // The new copy starts once it has asked other tabs for theirs.
 await wait(`window.scribecueShared.doc.guid!==${JSON.stringify(before)}`);
 assert.equal(await matches(),true,'after opening another project');

 const long=await js(`__long`);
 assert.deepEqual(await js(`__errors`),[]);
 console.log(`Shared copy smoke passed at 6× slowdown with 1,500 blocks: typing ${(offMs/5).toFixed(1)} ms a character with it off, `
  +`${(onMs/12).toFixed(1)} ms on; Yjs loaded by ${Math.round(startMs)} ms; ${long.length} long tasks${long.length?` (longest ${Math.round(Math.max(...long))} ms)`:''}`);
} finally { ws.close(); }
