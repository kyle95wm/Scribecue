import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, newIdentity } from '../app/js/project.js';
import { buildReview, readReview, resaveReview, appendRewrite, playbackReading, rewriteSpec, previousReading } from '../app/js/qc.js';
import { speechSpec, reviewedRewrite, makeGoogleRewrite } from '../app/js/qcspeech.js';
import { compareReturnedReview } from '../app/js/qcreview.js';
import { writeWav, isPersonalGoogleKey, reviewGoogleKey } from '../app/js/tts.js';
const voice = 'google:en-US-Standard-A';
const audio = () => writeWav(new Int16Array(4800), 48000);
const setup = async (allowEdits = true) => {
  const p = toProject({ projectId: newIdentity(), blocks: [{ uid: newIdentity(), start: 2, end: 4, text: 'Mara arrives.' }], settings: { mode: 'qc', ttsVoice: voice, ttsBase: 1, ttsSkipNotes: true } });
  return readReview(await buildReview(p, async () => ({ blob: audio(), secs: .1, voice }), { handoff: true, allowEdits, googleReviewKey: allowEdits ? 'bundled-test-key' : '' }));
};
const made = () => ({ blob: audio(), secs: .1, voice });
const changed = (r) => { const p = structuredClone(r.project); p.blocks[0].text = 'Mara leaves.'; return p; };

test('only spoken wording or effective speed changes qualify for a Google rewrite', async () => {
  const r = await setup(), b = r.project.blocks[0], s = r.project.settings, original = previousReading(r, b);
  for (const change of [{ start: 40, end: 41 }, { end: 2.1 }, { vol: .5, dip: true }, { comments: [{ text: 'Note' }] }, { text: '<i>Mara</i>   arrives. [note]' }]) {
    const next = { ...b, ...change };
    assert.equal(rewriteSpec(r, next, s), null);
    assert.equal(playbackReading(r, next, s), original);
  }
  for (const change of [{ text: 'Mara leaves.' }, { speed: 1.15 }, { start: 40, end: 41, speed: 1.3 }, { say: [['Mara', 'Mah-ra']] }]) {
    assert.ok(rewriteSpec(r, { ...b, ...change }, s));
    assert.equal(playbackReading(r, { ...b, ...change }, s), null);
  }
  assert.ok(rewriteSpec(r, b, { ...s, ttsBase: 1.1 }));
  assert.equal(rewriteSpec(r, { ...b, voice: 'google:en-US-Standard-B', text: 'Different' }, s), null);
  assert.equal(rewriteSpec(await setup(false), { ...b, text: 'Different' }, s), null);
});
test('review keys stay outside project/baseline, survive working saves, and are stripped from return copies', async () => {
  const r = await setup();
  assert.equal(r.reviewAccess.googleKey, 'bundled-test-key');
  assert.ok(!JSON.stringify(r.project).includes('bundled-test-key'));
  assert.equal((await readReview(resaveReview(r, r.project))).reviewAccess, null);
  assert.ok(!(await resaveReview(r, r.project).text()).includes('bundled-test-key'), 'return bytes contain no review key');
  assert.equal((await readReview(resaveReview(r, r.project, { includeReviewKey: true }))).reviewAccess.googleKey, 'bundled-test-key');
  await assert.rejects(buildReview(r.project, made, { googleReviewKey: 'key' }), /editable/);
});
test('rewrites are cached independently, survive return/reopen, and never replace original audio', async () => {
  const r = await setup(), p = changed(r), b = p.blocks[0];
  const next = await appendRewrite(r, p, b, made());
  assert.equal(next.proposals.length, 1);
  assert.equal(next.reviewAccess.googleKey, 'bundled-test-key');
  assert.deepEqual(next.readings, r.readings);
  assert.equal(await next.file.slice(0, r.audioEnd).text(), await r.file.slice(0, r.audioEnd).text());
  assert.equal(playbackReading(next, b, p.settings).offset, r.audioEnd);
  assert.equal(playbackReading(next, { ...b, start: 70, end: 71 }, p.settings).offset, r.audioEnd);
  assert.equal(await appendRewrite(next, p, b, made()), next);
  const returned = await readReview(resaveReview(next, p));
  assert.equal(returned.reviewAccess, null); assert.ok(playbackReading(returned, b, p.settings));
  assert.equal(playbackReading(returned, r.project.blocks[0], p.settings).offset, 8, 'undo uses original');
  const result = await compareReturnedReview(r.project, returned);
  assert.equal(result.project.blocks[0].text, b.text);
  const bytes = new Uint8Array(await returned.file.arrayBuffer()); bytes[returned.proposals[0].offset + 44] ^= 1;
  await assert.rejects(compareReturnedReview(r.project, await readReview(new Blob([bytes]))), /rewrite is damaged/);
  bytes[8 + 44] ^= 1;
  await assert.rejects(compareReturnedReview(r.project, await readReview(new Blob([bytes]))), /original audio/);
});
test('malformed rewrite metadata cannot be saved or played as a matching reading', async () => {
  const r = await setup(), p = changed(r);
  await assert.rejects(appendRewrite(r, p, p.blocks[0], { ...made(), voice: 'other' }), /cannot use/);
  const next = await appendRewrite(r, p, p.blocks[0], made());
  next.proposals[0].originalOffset = 123;
  await assert.rejects(readReview(resaveReview(next, p)), /rewrites are damaged/);
  assert.equal(speechSpec('garbage'), null);
});

test('personal key first; bundled fallback is offered and requires agreement for each failed reading', async () => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage;
  let personal = '', calls = [], offers = 0, fail = false, accept = false;
  globalThis.localStorage = { getItem: () => JSON.stringify({ key: personal }) };
  const b64 = Buffer.from(await audio().arrayBuffer()).toString('base64');
  globalThis.fetch = async (url, init) => {
    const key = init.headers['x-goog-api-key']; calls.push(key);
    assert.equal(new URL(url).search, '');
    assert.equal(JSON.parse(init.body).voice.name, 'en-US-Standard-A');
    if (fail && key === 'personal-test-key') return { ok: false, status: 403, json: async () => ({ error: { message: 'Denied personal-test-key' } }) };
    return { ok: true, json: async () => ({ audioContent: b64 }) };
  };
  const spec = { words: 'A rewrite.', voice, rate: 1.15 };
  const offer = async (message) => { offers++; assert.ok(!message.includes('personal-test-key')); return accept; };
  try {
    assert.equal(reviewGoogleKey('bundled-test-key'), 'bundled-test-key');
    await reviewedRewrite(spec, 'bundled-test-key', offer);
    assert.deepEqual(calls.splice(0), ['bundled-test-key']); assert.equal(offers, 0);
    personal = 'personal-test-key'; assert.ok(isPersonalGoogleKey(personal));
    await reviewedRewrite(spec, 'bundled-test-key', offer);
    assert.deepEqual(calls.splice(0), ['personal-test-key']); assert.equal(offers, 0);
    fail = true;
    await assert.rejects(reviewedRewrite(spec, 'bundled-test-key', offer), /Denied \[key\]/);
    assert.deepEqual(calls.splice(0), ['personal-test-key']); assert.equal(offers, 1);
    accept = true;
    await reviewedRewrite(spec, 'bundled-test-key', offer);
    assert.deepEqual(calls.splice(0), ['personal-test-key', 'bundled-test-key']); assert.equal(offers, 2);
    await reviewedRewrite(spec, 'bundled-test-key', offer);
    assert.deepEqual(calls.splice(0), ['personal-test-key', 'bundled-test-key']); assert.equal(offers, 3);
    await assert.rejects(reviewedRewrite(spec, '', offer), /Denied/); assert.equal(offers, 3);
    calls.splice(0); fail = false;
    await Promise.all([makeGoogleRewrite(spec, 'bundled-test-key'), makeGoogleRewrite(spec, 'bundled-test-key')]);
    assert.deepEqual(calls, ['personal-test-key'], 'double-click requests are deduplicated');
    assert.equal(personal, 'personal-test-key');
  } finally { globalThis.fetch = oldFetch; globalThis.localStorage = oldStorage; }
});
