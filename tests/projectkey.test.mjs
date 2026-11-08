import { test } from 'node:test';
import assert from 'node:assert/strict';

// The browser parts text to speech touches, before it loads.
let personal = '';
globalThis.localStorage = { getItem: (k) => (k === 'scribecue.googleTts' ? JSON.stringify({ key: personal }) : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => ({ open: false }) };
const { tts, setProjectGoogleKey, usingProjectGoogleKey, reviewGoogleKey, checkGoogleKey, hasGoogleKey } = await import('../app/js/tts.js');

const until = async (ok) => { for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('a shared project’s Google key reads Google voices for those without a key, and is never kept', async () => {
  const calls = [], stored = [], oldFetch = globalThis.fetch;
  globalThis.localStorage.setItem = (k, v) => stored.push([k, v]);
  globalThis.fetch = async (url, init) => {
    const key = init.headers['x-goog-api-key']; calls.push(key);
    if (key === 'wrong-test-key') return { ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid: wrong-test-key' } }) };
    return { ok: true, json: async () => ({ voices: [{ name: 'en-US-Standard-A', languageCodes: ['en-US'], ssmlGender: 'FEMALE' }, { name: 'en-US-Wavenet-A', languageCodes: ['en-US'] }] }) };
  };
  try {
    assert.equal(usingProjectGoogleKey(), false);
    setProjectGoogleKey('project-test-key');
    await until(() => tts.google.length);
    assert.deepEqual(calls.splice(0), ['project-test-key']);
    assert.equal(tts.google.length, 1, 'its Standard voices are offered');
    assert.ok(usingProjectGoogleKey());
    assert.equal(hasGoogleKey(), false, 'it isn’t your own key');
    assert.equal(reviewGoogleKey(), 'project-test-key');
    assert.deepEqual(stored, [], 'nothing is kept in the settings');
    // Your own key goes first.
    personal = 'personal-test-key';
    assert.equal(usingProjectGoogleKey(), false);
    assert.equal(reviewGoogleKey(), 'personal-test-key');
    personal = '';
    // Taken out: no Google voices without a key of your own.
    setProjectGoogleKey('');
    await until(() => !tts.google.length);
    assert.equal(tts.google.length, 0);
    assert.equal(reviewGoogleKey(), '');
    // Checking a key before sharing it says what's wrong, without the key.
    assert.equal(await checkGoogleKey('good-test-key'), '');
    const problem = await checkGoogleKey('wrong-test-key');
    assert.match(problem, /didn’t accept that key/);
    assert.ok(!problem.includes('wrong-test-key'));
  } finally { globalThis.fetch = oldFetch; }
});
