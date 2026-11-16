import { test } from 'node:test';
import assert from 'node:assert/strict';
import { google, seal, unseal, emailOf, b64u } from '../relay/src/google.js';

const ORIGIN = 'https://scribecue.example';
const env = {
  GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_SEAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
};
const post = (body) => new Request('https://relay.example/google/x', { method: 'POST', body: JSON.stringify(body) });
const idToken = (claims) => `x.${b64u(new TextEncoder().encode(JSON.stringify(claims)))}.y`;
function fakeGoogle(answer) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, params: Object.fromEntries(new URLSearchParams(opts.body.toString())) });
    const [status, body] = answer(url, calls.at(-1).params);
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fn };
}

test('a sealed token opens only with the same key and client', async () => {
  const s = await seal(env, 'refresh-1');
  assert.equal(await unseal(env, s), 'refresh-1');
  await assert.rejects(unseal({ ...env, GOOGLE_CLIENT_ID: 'other' }, s));
  await assert.rejects(unseal({ ...env, GOOGLE_SEAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(8))) }, s));
  assert.equal(emailOf(idToken({ email: 'a@example.com' })), 'a@example.com');
  assert.equal(emailOf('nonsense'), '');
});

test('signing in swaps the code for a pass, and seals the renewal token', async () => {
  const g = fakeGoogle(() => [200, { access_token: 'acc', expires_in: 3599, refresh_token: 'ref', id_token: idToken({ email: 'a@example.com' }), scope: 'drive.appdata' }]);
  const r = await google(post({ code: 'c', verifier: 'v' }), env, ORIGIN, 'token', g.fn);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(body.access, 'acc');
  assert.equal(body.email, 'a@example.com');
  assert.equal(await unseal(env, body.sealed), 'ref');
  assert.ok(!JSON.stringify(body).includes('"ref"'), 'the renewal token never goes back in the clear');
  assert.equal(g.calls[0].params.redirect_uri, `${ORIGIN}/google.html`);
  assert.equal(g.calls[0].params.code_verifier, 'v');
  assert.equal(g.calls[0].params.client_secret, 'secret');
});

test('renewing gives a new pass; a token Google dropped says signed out', async () => {
  const sealed = await seal(env, 'ref');
  const ok = fakeGoogle((url, p) => [200, { access_token: p.refresh_token === 'ref' ? 'acc2' : 'x', expires_in: 3599 }]);
  assert.deepEqual(await (await google(post({ sealed }), env, ORIGIN, 'refresh', ok.fn)).json(), { access: 'acc2', expires: 3599 });
  const dropped = fakeGoogle(() => [400, { error: 'invalid_grant' }]);
  const r = await google(post({ sealed }), env, ORIGIN, 'refresh', dropped.fn);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'signed-out');
  const bad = await google(post({ sealed: 'nonsense' }), env, ORIGIN, 'refresh', ok.fn);
  assert.equal((await bad.json()).error, 'signed-out');
});

test('disconnecting revokes the token at Google', async () => {
  const g = fakeGoogle(() => [200, {}]);
  const r = await google(post({ sealed: await seal(env, 'ref') }), env, ORIGIN, 'revoke', g.fn);
  assert.equal(r.status, 200);
  assert.match(g.calls[0].url, /revoke/);
  assert.equal(g.calls[0].params.token, 'ref');
});

test('without its secrets, the helper says it isn’t set up', async () => {
  const r = await google(post({ code: 'c', verifier: 'v' }), { GOOGLE_CLIENT_ID: 'x' }, ORIGIN, 'token', fakeGoogle(() => [200, {}]).fn);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'not-set-up');
});

test('preflight requests are answered for the page’s origin', async () => {
  const r = await google(new Request('https://relay.example/google/token', { method: 'OPTIONS' }), env, ORIGIN, 'token');
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
});
