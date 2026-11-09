// Every tooltip in the app, shown one by one in headless, muted Chrome at 6× CPU slowdown:
// in each mode, in the open panels and dialogs, at several window sizes. Each must be whole,
// inside the window and on top. Also says how many the old tooltips, drawn by CSS beside
// their element, would have cut off, for comparison.
// Usage: node scripts/tooltip-check.mjs <DevTools port> <site url>
import assert from 'node:assert/strict';
const [,, port, site] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500)); return m.result.result.value; };
const wait = async (expression, what = expression) => { for (let i = 0; i < 150; i++) { if (await js(expression).catch(() => false)) return; await sleep(100); } throw Error('Timed out: ' + what); };
await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await size(1440, 900);
await send('Page.navigate', { url: site }); await sleep(800);
await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:'Kyle',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
  localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,projectId:crypto.randomUUID(),cues:Array.from({length:300},(_,i)=>({uid:crypto.randomUUID(),start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.'}))}));Storage.prototype.setItem=()=>{};location.reload();true`);
await wait(`window.scribecueTips && document.querySelectorAll('#list .row').length===300`, 'ready');
await sleep(1500);
await js(`window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);

// Shows each visible tooltip and checks it. Old: where the CSS one would have been.
const sweep = `(async()=>{
  const tips=window.scribecueTips, tip=tips.el, vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
  const top=[...document.querySelectorAll('dialog[open]')].pop();
  const els=[...document.querySelectorAll('[data-tip]')].filter(e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height||r.bottom<0||r.top>vh||r.right<0||r.left>vw)return false;if(top&&!top.contains(e))return false;const s=getComputedStyle(e);return s.visibility!=='hidden';});
  const bad=[], oldBad=[]; let slowest=0;
  const clipOf=(e)=>{let c={l:0,t:0,r:vw,b:vh};for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(/(hidden|auto|scroll|clip)/.test(s.overflow+s.overflowX+s.overflowY)||s.contentVisibility==='auto'){const r=p.getBoundingClientRect();c={l:Math.max(c.l,r.left),t:Math.max(c.t,r.top),r:Math.min(c.r,r.right),b:Math.min(c.b,r.bottom)}}}return c};
  for(const e of els){
    const t0=performance.now(); tips.show(e); slowest=Math.max(slowest,performance.now()-t0);
    const r=tip.getBoundingClientRect(), text=e.getAttribute('data-tip');
    const label=(e.id||e.dataset.act||e.className||e.tagName)+': '+text.slice(0,40);
    if(tip.textContent!==text||r.left<0||r.top<0||r.right>vw||r.bottom>vh||!r.width||(tip.popover&&!tip.matches(':popover-open')))bad.push(label);
    // The old one: centred below (above in the footer), or right-aligned with tip-end, and cut by any scrolling box around it.
    const a=e.getBoundingClientRect(), w=r.width, h=r.height, up=!!e.closest('.status');
    const x=e.classList.contains('tip-end')?a.right-w:(a.left+a.right)/2-w/2, y=up?a.top-8-h:a.bottom+8, c=clipOf(e);
    if(x<c.l-0.5||x+w>c.r+0.5||y<c.t-0.5||y+h>c.b+0.5)oldBad.push(label);
    tips.hide();
  }
  return {count:els.length,bad,oldBad,slowest:Math.round(slowest)};
})()`;
const results = [];
async function check(name) {
  const r = await js(sweep);
  results.push({ name, ...r });
  console.log(`${name}: ${r.count} tooltips, ${r.bad.length} cut off now, ${r.oldBad.length} cut off before, slowest ${r.slowest} ms`);
  if (r.bad.length) console.log('  now:', r.bad.slice(0, 10).join(' | '));
  if (process.env.VERBOSE && r.oldBad.length) console.log('  before:', r.oldBad.slice(0, 12).join(' | '));
}
const act = (a) => js(`document.querySelector('[data-act="${a}"]').click();true`);
const closeDialogs = () => js(`for(const d of document.querySelectorAll('dialog[open]'))d.close();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
for (const [w, h] of [[1440, 900], [1280, 720], [1024, 700]]) {
  await size(w, h); await sleep(600);
  for (const mode of ['write', 'transcribe', 'qc']) {
    await js(`document.querySelector('[data-mode="${mode}"]').click();true`); await sleep(800);
    await js(`[...document.querySelectorAll('#list .row')][2]?.click();true`); await sleep(300);
    await check(`${w}×${h} ${mode}`);
  }
  await js(`document.querySelector('[data-mode="write"]').click();true`); await sleep(500);
  await act('settings'); await wait(`document.getElementById('settingsDlg').open && document.querySelectorAll('#setTabs [role=tab]').length`, 'settings');
  const tabs = await js(`document.querySelectorAll('#setTabs [role=tab]').length`);
  for (let i = 0; i < tabs; i++) {
    await js(`document.querySelectorAll('#setTabs [role=tab]')[${i}].click();true`); await sleep(500);
    await check(`${w}×${h} settings, ${await js(`document.querySelectorAll('#setTabs [role=tab]')[${i}].textContent.trim()`)}`);
  }
  await closeDialogs(); await sleep(300);
  await act('help'); await sleep(800); await check(`${w}×${h} shortcuts`); await closeDialogs(); await sleep(300);
  await act('newProject'); await sleep(600); await check(`${w}×${h} new project`); await closeDialogs(); await sleep(300);
  await act('comments'); await sleep(600); await check(`${w}×${h} comments`); await act('comments'); await sleep(300);
  await act('ai'); await sleep(600); await check(`${w}×${h} AI`); await act('ai'); await closeDialogs(); await sleep(300);
  await act('exportMenu'); await sleep(300); await check(`${w}×${h} export menu`); await closeDialogs(); await sleep(300);
}
const long = await js('__long');
console.log(`${long.length} long tasks while showing ${results.reduce((n, r) => n + r.count, 0)} tooltips${long.length ? ` (longest ${Math.round(Math.max(...long))} ms)` : ''}`);
const now = results.reduce((n, r) => n + r.bad.length, 0);
assert.equal(now, 0, 'every tooltip is whole and inside the window');
console.log('Tooltip check passed');
process.exit(0);
