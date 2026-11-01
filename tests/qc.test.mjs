import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReview, readReview, resaveReview, reviewReading, readingKey, voiceReport, hasReviewText, previousReading } from '../app/js/qc.js';
import { toProject, fromProject } from '../app/js/project.js';
const block = { start: 3, end: 6, text: 'Mara arrives.', speed: 1, say: [['Mara', 'Mah-ra']] };
const project = () => toProject({ blocks: [block, { start: 10, end: 12, text: 'Another block.', voice: 'kokoro:af_heart' }], settings: { mode: 'qc', ttsBase: 1, ttsVoice: 'piper:en_US-lessac-medium', ttsSkipNotes: true } });
const wav = () => new Blob([new Uint8Array(100)], { type: 'audio/wav' });
const make = async (b) => ({ blob: wav(), secs: b.end - b.start, voice: b.voice || 'piper:en_US-lessac-medium' });

test('QC settings and comments survive a normal project round trip', () => {
  const p = fromProject(project());
  assert.equal(p.settings.mode, 'qc'); assert.equal(p.settings.ttsSkipNotes, true);
});
test('voice checks cover main and individual block voices without accepting substitutes', () => {
  const p = project();
  const r = voiceReport(p.blocks, p.settings, [{ id: 'piper:en_US-lessac-medium', exportable: true }, { id: 'Samantha', exportable: false }]);
  assert.deepEqual(r.map((v) => [v.id, v.available, v.blocks]), [['piper:en_US-lessac-medium', true, [1]], ['kokoro:af_heart', false, [2]]]);
  assert.equal(voiceReport([{...block, voice:'Samantha'}], p.settings, [{id:'Samantha',exportable:false}])[0].exportable, false);
  assert.equal(hasReviewText({text:'[A note]'}, {ttsSkipNotes:true}), false);
});
test('a package contains the script and independently sliced audio, with no voice installation needed', async () => {
  const p = project(), blob = await buildReview(p, make), r = await readReview(blob);
  assert.deepEqual(r.project, p); assert.equal(r.readings.length, 2);
  const first = reviewReading(r, p.blocks[0], p.settings);
  assert.equal(first.secs, 3); assert.equal(first.offset, 8);
  assert.equal(r.file.slice(first.offset, first.offset + first.bytes).size, 100);
});
test('comments can be saved and reopened without changing or regenerating any audio', async () => {
  const p = project(), r = await readReview(await buildReview(p, make));
  p.blocks[0].comments = [{text:'Check this',author:'Sam',resolved:false}];
  p.comments = [{text:'Scene note', time:20}];
  const next = await readReview(resaveReview(r, p));
  assert.deepEqual(next.project, p);
  assert.deepEqual(new Uint8Array(await next.file.slice(8, next.audioEnd).arrayBuffer()), new Uint8Array(await r.file.slice(8,r.audioEnd).arrayBuffer()));
  assert.ok(reviewReading(next, p.blocks[0], p.settings));
});
test('text, pronunciation, speed, voice and note settings invalidate a supplied reading', async () => {
  const p = project(), r = await readReview(await buildReview(p, make));
  for (const change of [{text:'Changed'}, {say:[]}, {speed:1.15}, {voice:'Samantha'}]) {
    assert.equal(reviewReading(r, {...p.blocks[0], ...change}, p.settings), null, JSON.stringify(change));
  }
  for (const change of [{ttsVoice:'Samantha'},{ttsBase:1.1},{ttsSkipNotes:false}]) assert.equal(reviewReading(r,p.blocks[0],{...p.settings,...change}),null);
  assert.equal(readingKey({...block, comments:[{text:'A note'}]},p.settings),readingKey(block,p.settings));
});
test('stale audio stays stale when a changed review is saved', async () => {
  const p=project(), r=await readReview(await buildReview(p,make));p.blocks[0].text='A correction';
  const next=await readReview(resaveReview(r,p));assert.equal(reviewReading(next,p.blocks[0],p.settings),null);
});
test('package export is sequential, yields progress, and writes one reading at a time to disk', async () => {
  let active=0,max=0,closed=false;const writes=[], progress=[];
  const sink={write:async b=>writes.push(b),close:async()=>{closed=true},abort:async()=>{},file:async()=>new Blob(writes)};
  const blob=await buildReview(project(),async b=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return make(b)}, {sink,progress:(a,b)=>progress.push([a,b])});
  assert.equal(max,1);assert.equal(closed,true);assert.equal((await readReview(blob)).readings.length,2);assert.deepEqual(progress.at(-1),[2,2]);
});
test('cancelling a package aborts the disk writer without producing a partial result', async () => {
  const c=new AbortController();let aborted=false;
  await assert.rejects(buildReview(project(),async b=>{c.abort();return make(b)}, {signal:c.signal,sink:{write:async()=>{},abort:async()=>{aborted=true}}}), /stopped/);
  assert.equal(aborted,true);
});
test('corrupt, truncated and unsupported packages are rejected before playback', async () => {
  const blob=await buildReview(project(),make);
  await assert.rejects(readReview(new Blob(['not a package'])),/isn’t/);
  await assert.rejects(readReview(blob.slice(0,blob.size-1)),/isn’t/);
  const bytes=new Uint8Array(await blob.arrayBuffer());new DataView(bytes.buffer).setUint32(bytes.length-12,0xffffffff,true);
  await assert.rejects(readReview(new Blob([bytes])),/damaged/);
});
test('invalid audio cannot produce a package that appears successful', async () => {
  await assert.rejects(buildReview(project(),async()=>({blob:new Blob(['tiny']),secs:3,voice:'x'})),/could not/);
});


test('stopping after the last reading does not publish a completed package', async () => {
  const controller = new AbortController();
  const p = project(); p.blocks = [p.blocks[0]];
  await assert.rejects(buildReview(p, async b => {
    setTimeout(() => controller.abort(), 0);
    return make(b);
  }, {signal:controller.signal}), /stopped/);
});
test('a spoken block without audio fails instead of silently omitting its reading', async () => {
  await assert.rejects(buildReview(project(), async()=>null), /could not/);
});


test('moving and resizing a block reuses the original audio at its saved length', async () => {
  const p = project(), r = await readReview(await buildReview(p, make));
  const original = reviewReading(r, p.blocks[0], p.settings);
  for (const change of [{start:4}, {end:4}, {start:30,end:31}]) {
    assert.equal(reviewReading(r,{...p.blocks[0],...change},p.settings),original);
    assert.equal(original.secs,3);
  }
});
test('an edited block keeps a reference to its previous reading through saves', async () => {
  const p=project(), r=await readReview(await buildReview(p,make));
  p.blocks[0].qcReading=r.readings[0].offset;p.blocks[0].text='Corrected description';
  const next=await readReview(resaveReview(r,p));
  assert.equal(reviewReading(next,next.parsed.blocks[0],p.settings),null);
  assert.equal(previousReading(next,next.parsed.blocks[0]).offset,r.readings[0].offset);
  assert.equal(fromProject(toProject({blocks:next.parsed.blocks})).blocks[0].qcReading,8);
});
test('fresh exports discard references to the previous package audio', async () => {
  const p=project();p.blocks[1].qcReading=8;
  const r=await readReview(await buildReview(p,make));
  assert.equal(r.project.blocks[1].qcReading,undefined);
  assert.equal(reviewReading(r,r.project.blocks[1],p.settings).voice,'kokoro:af_heart');
});
test('early packages with timing keys can move their readings too', async () => {
  const p=project(), r=await readReview(await buildReview(p,make));
  r.readings[0].key=JSON.stringify([p.blocks[0].start,p.blocks[0].end,...JSON.parse(r.readings[0].key)]);
  const legacy=await readReview(resaveReview(r,p));
  assert.equal(reviewReading(legacy,{...p.blocks[0],start:15,end:16},p.settings).secs,3);
});
