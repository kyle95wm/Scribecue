// Two tabs with the shared copy on, in headless, muted Chrome at 6× CPU slowdown, with 1,500
// blocks over two hours: a second tab takes the first's copy; typing, typing in the same block
// at once, deleting and commenting reach the other tab; the caret stays put; names stay right.
// Usage: node scripts/two-tab-smoke.mjs <devtools port> <site url>
import assert from 'node:assert/strict';
const [,, port, site] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tab(url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expression) => { const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails)); return m.result.result.value; };
  const wait = async (expression, what = expression) => { for (let i = 0; i < 80; i++) { if (await js(expression)) return; await sleep(250); } throw Error('Timed out: ' + what); };
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // Both tabs count as shown, so neither is slowed as a background tab.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const watch = () => js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  const open = async (n) => { await js(`document.activeElement?.blur();[...document.querySelectorAll('#list .row')][${n}].click();true`); await sleep(300); };
  const text = (n) => js(`[...document.querySelectorAll('#list .row')][${n}]?.querySelector('.tx, .text, p')?.textContent ?? [...document.querySelectorAll('#list .row')][${n}]?.textContent`);
  const rows = () => js(`window.scribecueShared.read().blocks.length`);
  return { ws, send, js, wait, watch, open, text, rows, close: () => { ws.close(); fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); } };
}
const typeIn = async (t, s) => { const t0 = performance.now(); for (const ch of s) await t.send('Input.insertText', { text: ch }); return performance.now() - t0; };

const a = await tab('about:blank');
let b;
try {
  await a.send('Page.navigate', { url: site }); await sleep(800);
  await a.js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:'Kyle',editor:'kyle-tab-a-0001',sharedCopy:'1',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
    localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,projectId:crypto.randomUUID(),cues:Array.from({length:1500},(_,i)=>({uid:crypto.randomUUID(),start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.'}))}));location.reload();true`);
  await a.wait(`window.scribecueShared`, 'tab A shared copy');
  await a.watch();

  // A second tab joins: it takes A's copy.
  b = await tab(site);
  await b.wait(`window.scribecueShared`, 'tab B shared copy');
  await b.watch();
  // B is Sam, so names can be told apart. Each tab reads the name as it edits.
  await b.js(`localStorage.setItem('scribecue.reviewer','Sam');true`);
  const same = async () => JSON.stringify(await a.js(`window.scribecueShared.read()`)) === JSON.stringify(await b.js(`window.scribecueShared.read()`));
  assert.ok(await same(), 'B took A’s copy');
  assert.equal(await b.rows(), 1500);

  // A types in block 2: B sees it, credited to Kyle. (Both tabs share this browser's
  // storage, so each reads the name in effect as it edits.)
  await a.js(`localStorage.setItem('scribecue.reviewer','Kyle');localStorage.setItem('scribecue.editor','kyle-tab-a-0001');true`);
  await a.open(1);
  const aMs = await typeIn(a, ' A was here.');
  await b.wait(`[...document.querySelectorAll('#list .row')][1].textContent.includes('A was here.')`, 'B sees A’s typing');

  // Both type in block 2 at once: A at the end, B at the start. Both keep their words, and
  // A's caret stays at the end of what A is typing.
  await b.js(`localStorage.setItem('scribecue.reviewer','Sam');localStorage.setItem('scribecue.editor','sam-tab-b-00001');true`);
  await b.open(1);
  await b.js(`const t=document.getElementById('edText');t.setSelectionRange(0,0);true`);
  for (const [x, y] of [['1', 'B'], ['2', 'b'], ['3', ' ']]) { await a.send('Input.insertText', { text: x }); await b.send('Input.insertText', { text: y }); }
  await sleep(800);
  const [ta, tb] = [await a.js(`document.getElementById('edText').value`), await b.js(`document.getElementById('edText').value`)];
  assert.equal(ta, tb, 'both tabs show the same words');
  assert.match(ta, /^Bb Block number 2 describes the scene\. A was here\.123$/);
  assert.equal(await a.js(`document.getElementById('edText').selectionStart`), ta.length, 'A’s caret stays at its end');
  assert.equal(await b.js(`document.getElementById('edText').selectionStart`), 3, 'B’s caret stays after its letters');
  await a.js(`document.activeElement.blur();true`); await b.js(`document.activeElement.blur();true`);
  assert.ok(await same(), 'copies agree after typing at once');

  // A deletes block 4: it goes from B. B comments on block 1: it reaches A.
  await a.open(3);
  await a.js(`document.getElementById('edDel').click();true`);
  await b.wait(`window.scribecueShared.read().blocks.length===1499 && document.querySelectorAll('#list .row')[3].textContent.includes('Block number 5')`, 'B loses block 4');
  await b.open(0);
  await b.js(`document.getElementById('edComment').click();document.getElementById('commentAuthor').value='Sam';document.getElementById('commentText').value='Looks good';document.getElementById('commentPost').click();true`);
  await a.wait(`window.scribecueShared.read().blocks[0].comments?.[0]?.text==='Looks good'`, 'A gets B’s comment');
  await sleep(600);
  assert.ok(await same(), 'copies agree at the end');
  // Each tab's edits keep their own name; nothing was stamped twice.
  const names = await a.js(`window.scribecueShared.read().blocks.slice(0,2).map(b=>b.edited?.by||'')`);
  assert.deepEqual(names, ['', 'Sam'], 'block 2 was last changed by Sam, block 1 by no one');

  const report = async (t) => { const long = await t.js(`__long`); assert.deepEqual(await t.js(`__errors`), []); return `${long.length} long tasks${long.length ? ` (longest ${Math.round(Math.max(...long))} ms)` : ''}`; };
  console.log(`Two-tab smoke passed at 6× slowdown with 1,500 blocks: A typed ${(aMs / 12).toFixed(1)} ms a character; A ${await report(a)}; B ${await report(b)}`);
} finally { a.close(); b?.close(); }
