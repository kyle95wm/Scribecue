// Signing in to Google Drive, for syncing settings. A page alone gets a Google pass that lasts
// an hour and can't be renewed without a click, so the relay does the part that needs the
// app's client secret: it swaps Google's sign-in code for a pass and a long-lived renewal
// token, and renews the pass when asked.
//
// It keeps nothing. The renewal token goes back to the browser sealed with GOOGLE_SEAL_KEY,
// which only the relay has, so the browser holds it without being able to use it elsewhere,
// and the relay holds no accounts. Each browser's sign-in is its own.
//
// Needs, as Worker secrets: GOOGLE_CLIENT_SECRET, and GOOGLE_SEAL_KEY (32 random bytes, in
// base64). GOOGLE_CLIENT_ID is a plain variable in wrangler.toml.

const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
// The page Google sends people back to, on the app's own address.
export const CALLBACK = 'google.html';
const MAX_BODY = 8192;

const enc = new TextEncoder(), dec = new TextDecoder();
export const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function sealKey(env) {
  const raw = Uint8Array.from(atob(String(env.GOOGLE_SEAL_KEY || '')), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('GOOGLE_SEAL_KEY isn’t 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
// The client id goes in as extra data, so a token sealed for one app can't be opened for another.
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(env.GOOGLE_CLIENT_ID) }, await sealKey(env), enc.encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64u(out);
}
export async function unseal(env, sealed) {
  const all = unb64u(String(sealed));
  if (all.length < 29) throw new Error('bad');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: enc.encode(env.GOOGLE_CLIENT_ID) }, await sealKey(env), all.slice(12)));
}

// The account's address, from the id token Google just handed over directly. It's only shown
// to the person, so it isn't checked further.
export function emailOf(idToken) {
  try { return JSON.parse(dec.decode(unb64u(String(idToken).split('.')[1]))).email || ''; } catch { return ''; }
}

const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': origin, vary: 'Origin', 'cache-control': 'no-store' },
});

// Handles /google/token, /google/refresh and /google/revoke, for a page at `origin`, already
// checked as allowed. Returns a Response. fetch is Google's, passed in for tests.
export async function google(request, env, origin, path, fetchFn = fetch) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin',
    } });
  }
  if (request.method !== 'POST') return json({ error: 'post' }, 405, origin);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_SEAL_KEY) return json({ error: 'not-set-up' }, 503, origin);
  let body;
  try {
    const t = await request.text();
    if (t.length > MAX_BODY) throw new Error('big');
    body = JSON.parse(t);
  } catch { return json({ error: 'bad-request' }, 400, origin); }
  const ask = async (params) => {
    const r = await fetchFn(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  try {
    if (path === 'token') {
      const { code, verifier } = body;
      if (typeof code !== 'string' || typeof verifier !== 'string') return json({ error: 'bad-request' }, 400, origin);
      // Google only accepts the address the sign-in started with, so this can only be the
      // page's own callback.
      const { ok, data } = await ask({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: `${origin}/${CALLBACK}` });
      if (!ok || !data.access_token) return json({ error: data.error || 'refused' }, 400, origin);
      if (!data.refresh_token) return json({ error: 'no-refresh' }, 400, origin);
      return json({ access: data.access_token, expires: data.expires_in, sealed: await seal(env, data.refresh_token), email: emailOf(data.id_token), scope: data.scope || '' }, 200, origin);
    }
    if (path === 'refresh' || path === 'revoke') {
      let token;
      try { token = await unseal(env, body.sealed); } catch { return json({ error: 'signed-out' }, 401, origin); }
      if (path === 'revoke') {
        await fetchFn(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
        return json({ ok: true }, 200, origin);
      }
      const { ok, data } = await ask({ grant_type: 'refresh_token', refresh_token: token });
      if (!ok || !data.access_token) return json({ error: data.error === 'invalid_grant' ? 'signed-out' : (data.error || 'refused') }, data.error === 'invalid_grant' ? 401 : 502, origin);
      return json({ access: data.access_token, expires: data.expires_in }, 200, origin);
    }
  } catch (e) {
    console.error('google sign-in failed:', e?.message || e);
    return json({ error: 'failed' }, 502, origin);
  }
  return json({ error: 'not-found' }, 404, origin);
}
