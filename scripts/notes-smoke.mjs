// Block notes checks in headless, muted Chrome at 6× CPU slowdown: the Notes box above the
// text keeps notes for the narrator, without changing what's read or the block's timing.
// Usage: node scripts/notes-smoke.mjs <devtools port> <site url> [screenshot.png]
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
const key=async(k,code,shift=false)=>{const p={key:k,code,windowsVirtualKeyCode:{Tab:9,Enter:13}[k],modifiers:shift?8:0};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...p});await send('Input.dispatchKeyEvent',{type:'keyUp',...p});await sleep(150);};
const active=()=>js(`document.activeElement.id`);
const saved=()=>js(`JSON.parse(localStorage.getItem('scribecue.v1')).cues.map(c=>({end:c.end,text:c.text,notes:c.notes||null}))`);
const row=n=>js(`[...document.querySelectorAll('#list .row')][${n}].getAttribute('aria-label')`);
try {
 await send('Emulation.setCPUThrottlingRate',{rate:6});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:site});await sleep(800);
 await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:3,end:6,text:'She opens the door.'},{start:9,end:12,text:'Siobhan waves.'}],dirty:false}));location.reload();true`);
 await sleep(2000);
 await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
 const before=await saved();

 // Opening a block puts the cursor in its text, not its notes.
 await js(`document.querySelectorAll('#list .row')[1].click();true`);await sleep(300);
 assert.equal(await active(),'edText');
 assert.equal(await js(`getComputedStyle(document.getElementById('edNotes')).display`),'block');
 assert.ok(await js(`document.getElementById('edNotes').compareDocumentPosition(document.getElementById('edText'))&Node.DOCUMENT_POSITION_FOLLOWING`),'Notes sits above the text');

 // Shift+Tab from the text goes to the notes; Tab from the notes back to the text.
 await key('Tab','Tab',true);
 assert.equal(await active(),'edNotes');
 const t0=performance.now();
 const note='Siobhan: shi-VAWN. Warm and unhurried, a smile in the voice.';
 for(const ch of note) await send('Input.insertText',{text:ch});
 const typed=performance.now()-t0;
 await wait(`JSON.parse(localStorage.getItem('scribecue.v1')).cues[1].notes`);
 const after=await saved();
 assert.equal(after[1].notes,note);
 assert.equal(after[1].end,before[1].end,'notes leave the timing alone');
 assert.equal(after[1].text,before[1].text,'notes are not part of the text');
 assert.match(await row(1),/has notes/);
 await key('Tab','Tab');
 assert.equal(await active(),'edText');
 // Tab from the end time comes round to the notes.
 await js(`document.getElementById('edEnd').focus();true`);await key('Tab','Tab');
 assert.equal(await active(),'edNotes');
 if(shot){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(shot,Buffer.from(s.result.data,'base64'));}
 // Enter closes the editor, as in the text.
 await key('Enter','Enter');
 assert.equal(await js(`document.getElementById('editor').hidden`),true);

 // Undo takes the notes away in one step.
 await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,metaKey:true,bubbles:true}));true`);
 await wait(`!JSON.parse(localStorage.getItem('scribecue.v1')).cues[1].notes`);

 // Transcribe mode hides the box.
 await js(`document.querySelector('#modeSw [data-mode=transcribe]').click();true`);await sleep(500);
 await js(`document.querySelectorAll('#list .row')[0].click();true`);await sleep(300);
 assert.equal(await js(`getComputedStyle(document.getElementById('edNotes')).display`),'none');

 // Record mode: the narrator sees the notes with the selected block.
 await js(`(async () => {
  window.confirm = () => true;
  const R = await import('./js/recording.js');
  const file = R.toRecordingFile({ blocks: [{ start: 3, end: 6, text: 'She opens the door.' }, { start: 9, end: 12, text: 'Siobhan waves.', notes: 'Siobhan: shi-VAWN.\\nWarm.' }], fps: 25 });
  const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(file)], 'notes.scribecue-rec'));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return 1;
 })()`);
 await wait(`document.body.classList.contains('mode-record')`);await sleep(800);
 await js(`document.querySelectorAll('#list .row')[1].click();true`);await sleep(500);
 assert.match(await row(1),/has notes/);
 assert.equal(await js(`document.querySelector('#recTakes .recnotes')?.textContent`),'NotesSiobhan: shi-VAWN.\nWarm.');
 if(shot){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(shot.replace(/\.png$/,'-record.png'),Buffer.from(s.result.data,'base64'));}

 const long=await js(`__long`);
 assert.deepEqual(await js(`__errors`),[]);
 console.log(`Notes smoke passed at 6× slowdown: ${note.length} characters typed in ${Math.round(typed)} ms, `
  +`${long.length} long tasks${long.length?` (longest ${Math.round(Math.max(...long))} ms)`:''}`);
} finally { ws.close(); }
