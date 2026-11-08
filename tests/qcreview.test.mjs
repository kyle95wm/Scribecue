import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, fromProject, newIdentity, HISTORY_LIMIT } from '../app/js/project.js';
import { buildReview, readReview, resaveReview, reviewReading, previousReading } from '../app/js/qc.js';
import { retainHistory } from '../app/js/collaboration.js';
import { compareReturnedReview, reviewItems } from '../app/js/qcreview.js';
const project = () => toProject({ projectId: newIdentity(), blocks: [
  { uid: newIdentity(), start: 1, end: 3, text: 'Mara opens a door.' },
  { uid: newIdentity(), start: 5, end: 7, text: 'She steps outside.' },
], settings: { mode: 'qc', ttsVoice: 'test', ttsBase: 1 }, notes: 'Writer notes' });
const make = async (b) => ({ blob: new Blob([new Uint8Array(100).fill(7)]), secs: b.end-b.start, voice: 'test' });
const setup = async (allowEdits = false) => {
  const original = await readReview(await buildReview(project(), make, { handoff: true, allowEdits }));
  return { original, local: toProject(fromProject(original.project)), remote: structuredClone(original.project) };
};
const returned = async (original, remote) => readReview(resaveReview(original, remote));

test('QC export embeds a baseline; normal saves preserve it and returned comments combine with writer work', async () => {
  const {original,local,remote}=await setup();
  assert.ok(original.baselineId); assert.equal(original.project.reviewHistory.checkpoints[0].id,original.baselineId);
  local.blocks[1].text='Writer changed this after sending';
  remote.blocks[0].comments=[{text:'Check the door colour',author:'Sam'}]; remote.comments=[{text:'Scene note',time:4}];
  const review=await returned(original,remote), result=await compareReturnedReview(local,review);
  assert.deepEqual(result.conflicts,[]);
  assert.equal(result.project.blocks[1].text,local.blocks[1].text);
  assert.equal(result.project.blocks[0].comments[0].text,'Check the door colour');
  const combined=await readReview(resaveReview(review,result.project));
  assert.equal(combined.permissions.allowEdits,false); assert.equal(combined.baselineId,original.baselineId);
  assert.deepEqual(new Uint8Array(await combined.file.slice(0,combined.audioEnd).arrayBuffer()),new Uint8Array(await original.file.slice(0,original.audioEnd).arrayBuffer()));
});

test('comments-only returned scripts cannot change timings, text, add or delete blocks, or grant editing permission', async () => {
  const {original,local,remote}=await setup();
  for(const mutate of [p=>p.blocks[0].text='Changed',p=>p.blocks[0].start=0,p=>p.blocks.pop(),p=>p.blocks.push({uid:newIdentity(),start:9,end:10,text:'Added'})]) {
    const p=structuredClone(remote); mutate(p);
    await assert.rejects(compareReturnedReview(local,await returned(original,p)),/comments-only/);
  }
  const forged={...original,permissions:{allowEdits:true}};
  await assert.rejects(compareReturnedReview(local,await returned(forged,remote)),/permission/);
  const editable=await setup(true);
  await assert.rejects(compareReturnedReview(editable.local,editable.original,{localPermission:false}),/permission/);
});

test('same-block corrections need explicit choices; unresolved output cannot be saved', async () => {
  const {original,local,remote}=await setup(true);
  local.blocks[0].text='Local wording';remote.blocks[0].text='Returned wording';
  const r=await returned(original,remote), before=structuredClone(local);
  const result=await compareReturnedReview(local,r);
  assert.equal(result.project,null); assert.equal(result.conflicts.length,1);
  for(const choice of ['local','remote']) {
    const resolved=await compareReturnedReview(local,r,{resolutions:[{...result.conflicts[0],choice}]});
    assert.equal(resolved.project.blocks[0].text,choice==='local'?'Local wording':'Returned wording');
  }
  assert.deepEqual(local,before);
});

test('reviewer-only edits are listed for a choice; declining keeps the writer version and still adds comments', async () => {
  const {original,local,remote}=await setup(true);
  const [first,second]=remote.blocks;
  first.text='Reviewer wording';first.comments=[{text:'Reworded this',author:'Sam'}];
  remote.blocks=[first,{uid:newIdentity(),start:9,end:10,text:'Reviewer added'}];
  const r=await returned(original,remote), result=await compareReturnedReview(local,r);
  assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(new Set(result.changes.map(c=>c.uid)),new Set([first.uid,second.uid,remote.blocks[1].uid]));
  assert.equal(result.project.blocks.length,2,'without choices every change is accepted, as before');
  const declined=await compareReturnedReview(local,r,{resolutions:result.changes.map(c=>({...c,choice:'local'}))});
  assert.deepEqual(declined.project.blocks.map(b=>b.text),['Mara opens a door.','She steps outside.']);
  assert.equal(declined.project.blocks[0].comments[0].text,'Reworded this','comments come in even when the edit is declined');
  const mixed=await compareReturnedReview(local,r,{resolutions:result.changes.map(c=>({...c,choice:c.uid===first.uid?'remote':'local'}))});
  assert.deepEqual(mixed.project.blocks.map(b=>b.text),['Reviewer wording','She steps outside.']);
});

test('pending review items: each block change in script order, with both versions and no comments', async () => {
  const {original,local,remote}=await setup(true);
  local.blocks[0].text='Writer wording';
  remote.blocks[0].text='Reviewer wording';remote.blocks[1].start=6;remote.blocks[1].comments=[{text:'Moved',author:'Sam'}];
  remote.blocks.unshift({uid:newIdentity(),start:0.2,end:0.8,text:'Reviewer added'});
  const result=await compareReturnedReview(local,await returned(original,remote)), items=reviewItems(result,local);
  assert.deepEqual(items.map(i=>[i.kind,i.conflict,i.ours?.text??null,i.theirs?.text??null]),[
    ['block',false,null,'Reviewer added'],['block',true,'Writer wording','Reviewer wording'],['block',false,'She steps outside.','She steps outside.']]);
  assert.equal(items[2].theirs.start,6);assert.ok(!('comments' in items[2].theirs),'comments come in on their own');
});

test('an accepted change can carry your edits to its wording and times', async () => {
  const {original,local,remote}=await setup(true);
  remote.blocks[0].text='Reviewer wording';remote.blocks[0].comments=[{text:'Reworded',author:'Sam'}];
  const added={uid:newIdentity(),start:9,end:10,text:'Reviewer added'};remote.blocks.push(added);
  local.blocks[1].text='Writer wording';remote.blocks[1].text='Reviewer other wording';
  const r=await returned(original,remote), result=await compareReturnedReview(local,r);
  const edits={[remote.blocks[0].uid]:{text:'My wording',start:1.5,end:3},[added.uid]:{text:'Added, tidied',start:9,end:11},[remote.blocks[1].uid]:{text:'Settled wording',start:5,end:7}};
  const resolutions=[...result.changes,...result.conflicts].map(c=>({...c,choice:'remote',edit:edits[c.uid]}));
  const out=await compareReturnedReview(local,r,{resolutions});
  assert.deepEqual(out.project.blocks.map(b=>[b.text,b.start,b.end]),[['My wording',1.5,3],['Settled wording',5,7],['Added, tidied',9,11]]);
  assert.equal(out.project.blocks[0].comments[0].text,'Reworded','comments stay with the edited block');
  const bad=resolutions.map(c=>c.uid===added.uid?{...c,edit:{text:'x',start:5,end:4}}:c);
  await assert.rejects(compareReturnedReview(local,r,{resolutions:bad}),/end after its start/);
});

test('comment-only returns list no block changes', async () => {
  const {original,local,remote}=await setup();
  remote.blocks[0].comments=[{text:'Check this',author:'Sam'}];remote.comments=[{text:'Scene note',time:4}];
  const result=await compareReturnedReview(local,await returned(original,remote));
  assert.deepEqual(result.changes,[]);assert.equal(result.project.comments[0].text,'Scene note');
});

test('moving original readings keeps them usable; wording changes retain stale previous readings without trusting returned offsets', async () => {
  const {original,local,remote}=await setup(true);
  remote.blocks[0].start=10;remote.blocks[0].end=11;remote.blocks[0].qcReading=original.readings[1].offset;
  remote.blocks[1].text='Corrected wording';remote.blocks[1].qcReading=8;
  const result=await compareReturnedReview(local,await returned(original,remote));
  const combined=await readReview(resaveReview(original,result.project));
  const moved=combined.parsed.blocks.find(b=>b.uid===local.blocks[0].uid),changed=combined.parsed.blocks.find(b=>b.uid===local.blocks[1].uid);
  assert.equal(reviewReading(combined,moved,combined.project.settings).offset,original.readings[0].offset);
  assert.equal(reviewReading(combined,changed,combined.project.settings),null);
  assert.equal(previousReading(combined,changed).offset,original.readings[1].offset);
});

test('returned listening settings and notes never replace the writer’s project settings', async () => {
  const {original,local,remote}=await setup(true);
  remote.settings.ttsVoice='foreign';remote.notes='Foreign notes';remote.media={name:'wrong.mp4'};
  const result=await compareReturnedReview(local,await returned(original,remote));
  assert.equal(result.project.settings.ttsVoice,local.settings.ttsVoice);
  assert.equal(result.project.notes,local.notes);assert.equal(result.project.media,null);
});

test('changed audio or changed reading metadata is rejected before a combined package is produced', async () => {
  const {original,local,remote}=await setup(true);
  const file=resaveReview(original,remote), raw=new Uint8Array(await file.arrayBuffer());raw[10]^=1;
  await assert.rejects(compareReturnedReview(local,await readReview(new Blob([raw]))),/original audio differs/);
  const altered={...original,readings:original.readings.map((r,i)=>i? r:{...r,voice:'forged'})};
  await assert.rejects(compareReturnedReview(local,await returned(altered,remote)),/original readings differ/);
});

test('old, unrelated or damaged review baselines are refused without losing normal QC compatibility', async () => {
  const {original,local,remote}=await setup(true);
  const old=await readReview(await buildReview(project(),make));
  assert.equal(old.baselineId,null);
  await assert.rejects(compareReturnedReview(local,old),/starting point/);
  const wrong=structuredClone(remote);wrong.projectId=newIdentity();
  await assert.rejects(compareReturnedReview(local,await returned(original,wrong)),/different project/);
  local.reviewHistory.checkpoints[0].snapshot=local.reviewHistory.checkpoints[0].snapshot.replace('Mara','Forged');
  await assert.rejects(compareReturnedReview(local,original),/saved revision/);
});

test('QC history stays bounded and checkpoints contain no recursive archives or local preferences', async () => {
  let p=project(), review;
  for(let i=0;i<HISTORY_LIMIT+2;i++) {p.blocks[0].text='Round '+i;review=await readReview(await buildReview(p,make,{handoff:true}));const history=retainHistory([...(p.reviewHistory?.checkpoints||[]),...review.project.reviewHistory.checkpoints]);p={...review.project,reviewHistory:history};}
  assert.equal(p.reviewHistory.checkpoints.length,HISTORY_LIMIT);
  assert.equal(review.project.reviewHistory.checkpoints.length,1,'outgoing QC packages contain only their own round');
  const snapshot=JSON.parse(p.reviewHistory.checkpoints.at(-1).snapshot);
  assert.ok(!('reviewHistory' in snapshot.project)); assert.ok(!('view' in snapshot.project));
  assert.ok(!('mode' in snapshot.project.settings));
  assert.ok(snapshot.readings.every(r=>r.sha.length===64));
});

test('accepting a comments-only review produces an authoring project with comments and a reference to its original readings', async () => {
  const { acceptedReviewProject, verifyReviewAttachment } = await import('../app/js/qcreview.js');
  const {original,local,remote}=await setup(false);
  local.settings.mode='write';local.view={playhead:25,selected:1};
  remote.blocks[0].comments=[{text:'Check the colour',author:'Sam'}];
  const r=await returned(original,remote), merged=await compareReturnedReview(local,r);
  const accepted=acceptedReviewProject(local,merged.project,r.baselineId);
  assert.equal(accepted.scribecue,1);assert.equal(accepted.settings.mode,'write');
  assert.deepEqual(accepted.view,local.view);assert.equal(accepted.blocks[0].comments[0].text,'Check the colour');
  assert.deepEqual(accepted.reviewAudio,{baselineId:original.baselineId});
  assert.ok(!('permissions' in accepted));assert.equal(r.permissions.allowEdits,false);
  const reopened=toProject(fromProject(JSON.parse(JSON.stringify(accepted))));
  assert.deepEqual(reopened.reviewAudio,accepted.reviewAudio);
  const audio=await verifyReviewAttachment(reopened,await readReview(resaveReview(r,merged.project)));
  assert.equal(audio.permissions.allowEdits,false,'acceptance never changes the package permission');
});

test('an author can retrieve old original readings after their round has left the bounded review history', async () => {
  const { acceptedReviewProject, verifyReviewAttachment }=await import('../app/js/qcreview.js');
  const {original,local}=await setup(false), merged=await compareReturnedReview(local,original);
  const accepted=acceptedReviewProject(local,merged.project,original.baselineId);
  accepted.reviewHistory=null;accepted.blocks[0].text='A later author correction';
  assert.equal((await verifyReviewAttachment(accepted,original)).baselineId,original.baselineId);
  const bad=structuredClone(original.project.reviewHistory.checkpoints[0]);bad.snapshot=bad.snapshot.replace('Mara','Forged');
  const altered={...original,parsed:{...original.parsed,reviewHistory:{version:1,checkpoints:[bad]}}};
  await assert.rejects(verifyReviewAttachment(accepted,altered),/saved revision/);
});

test('locating original readings rejects another project, another round, changed clips and changed permissions', async () => {
  const { acceptedReviewProject, verifyReviewAttachment }=await import('../app/js/qcreview.js');
  const {original,local}=await setup(false), merged=await compareReturnedReview(local,original);
  const accepted=acceptedReviewProject(local,merged.project,original.baselineId);
  const other=await setup(false);
  await assert.rejects(verifyReviewAttachment(accepted,other.original),/matching/);
  await assert.rejects(verifyReviewAttachment(accepted,{...original,permissions:{allowEdits:true}}),/permission/);
  const raw=new Uint8Array(await original.file.arrayBuffer());raw[10]^=1;
  await assert.rejects(verifyReviewAttachment(accepted,await readReview(new Blob([raw]))),/original audio/);
});

test('QC packages omit author audio references and keep their own editing permission', async () => {
  const { acceptedReviewProject }=await import('../app/js/qcreview.js');
  const {original,local}=await setup(false), merged=await compareReturnedReview(local,original);
  const accepted=acceptedReviewProject(local,merged.project,original.baselineId);
  const packaged=await readReview(resaveReview(original,accepted));
  assert.ok(!('reviewAudio' in packaged.project));assert.equal(packaged.permissions.allowEdits,false);
});

test('returned block comments combine with author corrections made after sending, without reverting text or timings', async () => {
  const {original,local,remote}=await setup(false);
  local.blocks[0].text='The author already fixed the wording';local.blocks[0].start=.5;
  remote.blocks[0].comments=[{text:'Please check the door colour',author:'Sam'}];
  const result=await compareReturnedReview(local,await returned(original,remote));
  assert.deepEqual(result.conflicts,[]);
  assert.equal(result.project.blocks[0].text,local.blocks[0].text);
  assert.equal(result.project.blocks[0].start,.5);
  assert.equal(result.project.blocks[0].comments[0].text,remote.blocks[0].comments[0].text);
});

test('conflicting block comments are resolved separately from the author’s script changes', async () => {
  const p=project(); p.blocks[0].comments=[{text:'First note',author:'Sam'}];
  const original=await readReview(await buildReview(p,make,{handoff:true}));
  const local=toProject(fromProject(original.project)),remote=structuredClone(original.project);
  local.blocks[0].text='Author correction';local.blocks[0].comments[0].text='Local note';remote.blocks[0].comments[0].text='Returned note';
  const review=await returned(original,remote),result=await compareReturnedReview(local,review);
  assert.deepEqual(result.conflicts,[{kind:'block-comments',uid:local.blocks[0].uid}]);
  const resolved=await compareReturnedReview(local,review,{resolutions:[{...result.conflicts[0],choice:'remote'}]});
  assert.equal(resolved.project.blocks[0].text,'Author correction');
  assert.equal(resolved.project.blocks[0].comments[0].text,'Returned note');
});

test('comments added on both sides of a review are all kept, with no choice to make', async () => {
  const {original,local,remote}=await setup(false);
  local.blocks[0].comments=[{text:'Local note'}];remote.blocks[0].comments=[{text:'Returned note'}];
  const result=await compareReturnedReview(local,await returned(original,remote));
  assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(result.project.blocks[0].comments.map((c)=>c.text),['Local note','Returned note']);
});

test('a comments-only review saved by an older Scribecue, without who changed each block, is still accepted', async () => {
  const p = project(); p.blocks.forEach((b) => { b.edited = { by: 'Kyle', at: '2026-11-07T14:00:00.000Z', who: 'kyle-browser-1' }; });
  const original = await readReview(await buildReview(p, make, { handoff: true }));
  const local = toProject(fromProject(original.project)), remote = structuredClone(original.project);
  remote.blocks.forEach((b) => delete b.edited);
  remote.blocks[0].comments = [{ text: 'Lovely', author: 'Sam' }];
  const result = await compareReturnedReview(local, await returned(original, remote));
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.project.blocks[0].comments[0].text, 'Lovely');
  assert.equal(result.project.blocks[0].edited.by, 'Kyle', 'the writer keeps the names');
});
