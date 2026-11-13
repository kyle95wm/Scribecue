import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, newIdentity } from '../app/js/project.js';
import { buildReview, readReview, resaveReview, appendRewrite, playbackReading, rewriteSpec, readingVoiceChanged, previousReading } from '../app/js/qc.js';
import { speechSpec, reviewedRewrite, makeGoogleRewrite, makePollyRewrite, rereads, keyName, bundledFor, canReread } from '../app/js/qcspeech.js';
import { compareReturnedReview } from '../app/js/qcreview.js';
import { writeWav, isPersonalGoogleKey, reviewGoogleKey, isPersonalPollyKey, reviewPollyCreds } from '../app/js/tts.js';
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
test('a new block voice is flagged, never offered as a rewrite, and the bundled key is not used for it', async () => {
  const r = await setup(), b = r.project.blocks[0], s = r.project.settings;
  for (const next of [{ ...b, voice: 'google:en-US-Standard-B' }, { ...b, voice: 'piper:en_US-lessac-medium', text: 'Mara leaves.' }]) {
    assert.equal(readingVoiceChanged(r, next, s), true);
    assert.equal(rewriteSpec(r, next, s), null);
    assert.equal(playbackReading(r, next, s), null);
  }
  for (const next of [b, { ...b, voice }, { ...b, text: 'Mara leaves.' }, { ...b, speed: 1.15 }]) assert.equal(readingVoiceChanged(r, next, s), false);
  assert.equal(readingVoiceChanged(r, { ...b, uid: newIdentity(), qcReading: undefined }, s), false, 'a block without an original reading');
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

test('QC’s Google re-reads keep line breaks; other voices read one line', () => {
  const key = (voice) => JSON.stringify(['Cast\nDominic: Peter Dobson', [], 1, voice, 1, false]);
  assert.equal(speechSpec(key('google:en-US-Standard-H')).words, 'Cast\nDominic: Peter Dobson');
  assert.equal(speechSpec(key('piper:en_US-lessac-medium')).words, 'Cast Dominic: Peter Dobson');
  const quoted = JSON.stringify(['A sign reads "Sing".', [], 1, 'google:en-US-Standard-H', 1, false]);
  assert.equal(speechSpec(quoted).words, 'A sign reads Sing.');
});

test('a block added in review can be read in one of the package’s Google voices', async () => {
  const r = await setup(), s = r.project.settings;
  const added = { uid: newIdentity(), start: 6, end: 8, text: 'A door slams.' };
  const p = structuredClone(r.project); p.blocks.push(added);
  assert.ok(rewriteSpec(r, added, s));
  assert.equal(playbackReading(r, added, s), null);
  for (const no of [{ ...added, text: '' }, { ...added, voice: 'google:en-US-Standard-B' }, { ...added, voice: 'piper:en_US-lessac-medium' }, { ...added, uid: undefined }]) assert.equal(rewriteSpec(r, no, s), null);
  assert.equal(rewriteSpec(await setup(false), added, s), null, 'comments-only packages');
  const next = await appendRewrite(r, p, added, made());
  assert.equal(next.proposals[0].blockUid, added.uid);
  assert.equal(next.proposals[0].originalOffset, undefined);
  assert.equal(playbackReading(next, added, s).offset, r.audioEnd);
  assert.equal(playbackReading(next, { ...added, start: 30, end: 31 }, s).offset, r.audioEnd, 'moving reuses it');
  assert.equal(playbackReading(next, { ...added, text: 'A door creaks.' }, s), null);
  assert.equal(playbackReading(next, r.project.blocks[0], s).offset, 8, 'originals are untouched');
  const returned = await readReview(resaveReview(next, p));
  assert.equal(JSON.parse(await returned.file.slice(returned.audioEnd, -12).text()).review, 4);
  assert.equal(playbackReading(returned, added, s).offset, r.audioEnd);
  assert.ok((await compareReturnedReview(r.project, returned)).project.blocks.some((b) => b.uid === added.uid));
});
test('readings for added blocks cannot claim an original block, another voice, or an old version', async () => {
  const r = await setup(), s = r.project.settings, added = { uid: newIdentity(), start: 6, end: 8, text: 'A door slams.' };
  const p = structuredClone(r.project); p.blocks.push(added);
  const next = await appendRewrite(r, p, added, made());
  const tamper = async (change, version) => {
    const file = resaveReview(next, p), text = await file.slice(next.audioEnd, file.size - 12).text(), m = JSON.parse(text);
    change(m); if (version) m.review = version;
    const json = new TextEncoder().encode(JSON.stringify(m)), footer = new Uint8Array(12);
    new DataView(footer.buffer).setUint32(0, json.length, true); footer.set(new TextEncoder().encode('SCQC0001'), 4);
    return readReview(new Blob([next.file.slice(0, next.audioEnd), json, footer]));
  };
  assert.ok(await tamper(() => {}));
  await assert.rejects(tamper((m) => { m.proposals[0].blockUid = r.project.blocks[0].uid; }), /rewrites are damaged/);
  await assert.rejects(tamper((m) => { m.proposals[0].key = m.proposals[0].key.replace('Standard-A', 'Standard-B'); m.proposals[0].voice = 'google:en-US-Standard-B'; }), /rewrites are damaged/);
  await assert.rejects(tamper(() => {}, 3), /rewrites are damaged/);
  await assert.rejects(tamper((m) => { m.review = 7; }), /newer Scribecue/);
});

test('a QC re-read with Google reads a block’s lines one at a time', async () => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage, texts = [];
  globalThis.localStorage = { getItem: () => JSON.stringify({ key: 'personal-test-key' }) };
  const b64 = Buffer.from(await writeWav(Int16Array.from({ length: 24000 }, (_, i) => Math.round(8000 * Math.sin(i / 10))), 24000).arrayBuffer()).toString('base64');
  globalThis.fetch = async (url, init) => { texts.push(JSON.parse(init.body).input.text); return { ok: true, json: async () => ({ audioContent: b64 }) }; };
  try {
    const made = await makeGoogleRewrite({ words: 'Cast\nDominic: Peter Dobson', voice, rate: 1 }, '');
    assert.deepEqual(texts.sort(), ['Cast', 'Dominic: Peter Dobson']);
    assert.ok(Math.abs(made.secs - 2.5) < 0.011, `${made.secs}`); // 1 s, half a second, 1 s
  } finally { globalThis.fetch = oldFetch; globalThis.localStorage = oldStorage; }
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

// ---- Amazon Polly

const polly = 'polly:neural:en-US:Matthew';
const reviewKey = { key: 'AKIAREVIEW', secret: 'review/secret+1', region: 'ca-central-1' };
const pollySetup = async (extra = { pollyReviewKey: reviewKey }, allowEdits = true) => {
  const p = toProject({ projectId: newIdentity(), blocks: [{ uid: newIdentity(), start: 2, end: 4, text: 'Mara arrives.' }], settings: { mode: 'qc', ttsVoice: polly, ttsBase: 1, ttsSkipNotes: true } });
  return readReview(await buildReview(p, async () => ({ blob: audio(), secs: .1, voice: polly }), { handoff: true, allowEdits, ...extra }));
};
// Reads a package's manifest, changes it, and puts it back together.
const rewrap = async (r, change) => {
  const blob = resaveReview(r, r.project, { includeReviewKey: true }), footer = await blob.slice(-12).arrayBuffer();
  const length = new DataView(footer).getUint32(0, true), end = blob.size - 12;
  const m = JSON.parse(await blob.slice(end - length, end).text()); change(m);
  const json = new TextEncoder().encode(JSON.stringify(m)), tail = new Uint8Array(footer); new DataView(tail.buffer).setUint32(0, json.byteLength, true);
  return readReview(new Blob([blob.slice(0, end - length), json, tail]));
};

test('Polly voices can be read again in review, at speeds Polly takes', async () => {
  assert.equal(rereads(polly), true);
  assert.equal(rereads('polly:standard:en-GB-WLS:Geraint'), true);
  assert.equal(rereads('polly:generative:en-US:Matthew'), false);
  assert.equal(rereads('piper:en_US-lessac-medium'), false);
  assert.equal(keyName(polly), 'AWS');
  assert.equal(keyName(voice), 'Google');
  const r = await pollySetup(), s = r.project.settings, b = r.project.blocks[0];
  assert.equal(rewriteSpec(r, b, s), null, 'unchanged');
  const spec = rewriteSpec(r, { ...b, text: 'Mara leaves.' }, s);
  assert.equal(spec.voice, polly);
  assert.ok(rewriteSpec(r, { ...b, speed: 1.5 }, s));
  assert.equal(rewriteSpec(r, { ...b, speed: 1.5 }, { ...s, ttsBase: 1.5 }), null, 'twice normal speed is Polly’s limit; 2.25 would be wrong');
  assert.equal(rewriteSpec(await pollySetup({}, false), { ...b, text: 'Mara leaves.' }, s), null, 'comments-only packages');
});

test('a Polly review key stays with a saved editable package', async () => {
  const r = await pollySetup();
  assert.deepEqual(r.reviewAccess, { polly: reviewKey });
  assert.equal((await readReview(resaveReview(r, r.project))).reviewAccess, null, 'left out unless asked for');
  assert.deepEqual((await readReview(resaveReview(r, r.project, { includeReviewKey: true }))).reviewAccess, { polly: reviewKey });
  assert.equal((await pollySetup({})).reviewAccess, null);
  await assert.rejects(pollySetup({ pollyReviewKey: reviewKey }, false), /editable/);
  await assert.rejects(pollySetup({ pollyReviewKey: { ...reviewKey, region: 'mars-1' } }), /valid key/);
  await assert.rejects(pollySetup({ pollyReviewKey: { ...reviewKey, secret: 'has space' } }), /valid key/);
});

test('both kinds of key can share a package', async () => {
  const r = await pollySetup({ pollyReviewKey: reviewKey, googleReviewKey: 'bundled-test-key' });
  assert.deepEqual(r.reviewAccess, { googleKey: 'bundled-test-key', polly: reviewKey });
  assert.equal(bundledFor(r.reviewAccess, polly), reviewKey.key && r.reviewAccess.polly);
  assert.equal(bundledFor(r.reviewAccess, voice), 'bundled-test-key');
  assert.equal(bundledFor(null, polly), null);
  assert.equal(bundledFor(null, voice), '');
});

test('Polly keys and readings need the version that understands them', async () => {
  const withKey = await pollySetup();
  await assert.rejects(rewrap(withKey, (m) => { m.review = 7; }), /newer Scribecue/);
  await assert.rejects(rewrap(withKey, (m) => { m.review = 5; }), /review key is damaged/);
  await assert.rejects(rewrap(withKey, (m) => { m.reviewAccess.polly.region = 'mars-1'; }), /review key is damaged/);
  await assert.rejects(rewrap(withKey, (m) => { m.reviewAccess = {}; }), /review key is damaged/);
  // A reviewer's own key makes a new reading: the package moves up a version, so older
  // versions say to update rather than that it's damaged.
  const plain = await pollySetup({}), block = { ...plain.project.blocks[0], text: 'Mara leaves.' };
  const next = await appendRewrite(plain, plain.project, block, { blob: audio(), secs: .1, voice: polly });
  assert.equal(next.proposals.length, 1);
  assert.ok(playbackReading(next, block, plain.project.settings));
  const seen = []; await rewrap(next, (m) => seen.push(m.review));
  assert.deepEqual(seen, [6]);
});

test('a reviewer’s own AWS key goes first; the package’s needs their agreement after a failure', async () => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage, oldContext = globalThis.OfflineAudioContext;
  let personal = null, calls = [], offers = 0, fail = false, accept = false;
  globalThis.localStorage = { getItem: () => JSON.stringify(personal || {}) };
  globalThis.OfflineAudioContext = class { decodeAudioData() { return { getChannelData: () => new Float32Array(2400).fill(.5) }; } };
  globalThis.fetch = async (url, init) => {
    const key = /Credential=(\w+)\//.exec(init.headers.authorization)[1]; calls.push(key);
    assert.match(url, /^https:\/\/polly\./);
    if (fail && key === 'AKIAMINE') {
      return { ok: false, status: 403, headers: new Headers({ 'x-amzn-ErrorType': 'AccessDeniedException' }), json: async () => ({ message: 'User AKIAMINE with secret-mine is not authorized' }) };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const spec = { words: 'A rewrite.', voice: polly, rate: 1.15 };
  const offer = async () => { offers++; return accept; };
  try {
    await assert.rejects(makePollyRewrite(spec), /Add your AWS key/);
    assert.equal(canReread(polly, null), false);
    assert.equal(canReread(polly, { polly: reviewKey }), true);
    const made = await reviewedRewrite(spec, reviewKey, offer);
    assert.equal(made.voice, polly);
    assert.ok(made.secs > 0);
    assert.deepEqual(calls, ['AKIAREVIEW']);
    assert.equal(offers, 0, 'no key of their own, so nothing to ask');
    personal = { key: 'AKIAMINE', secret: 'secret-mine', region: 'us-east-1' }; calls = [];
    assert.equal(canReread(polly, null), true);
    assert.equal(isPersonalPollyKey('AKIAMINE'), true);
    assert.equal(isPersonalPollyKey('AKIAREVIEW'), false);
    assert.equal(reviewPollyCreds(reviewKey).key, 'AKIAMINE');
    await reviewedRewrite(spec, reviewKey, offer);
    assert.deepEqual(calls, ['AKIAMINE']);
    fail = true; calls = [];
    await assert.rejects(reviewedRewrite(spec, reviewKey, offer), (e) => { assert.ok(!/AKIAMINE|secret-mine/.test(e.message), e.message); return /\[key\]/.test(e.message); });
    assert.equal(offers, 1);
    assert.deepEqual(calls, ['AKIAMINE'], 'refused: the package’s key isn’t used');
    accept = true; calls = [];
    await reviewedRewrite(spec, reviewKey, offer);
    assert.deepEqual(calls, ['AKIAMINE', 'AKIAREVIEW']);
  } finally { globalThis.fetch = oldFetch; globalThis.localStorage = oldStorage; globalThis.OfflineAudioContext = oldContext; }
});
