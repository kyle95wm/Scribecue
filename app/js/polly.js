// Amazon Polly's voices, with the user's own AWS access key. The page talks to Polly
// directly, so every request is signed here with AWS Signature Version 4. Nothing in this
// file touches the page, so it can be tested without a browser.

// The regions on offer. The page may only contact addresses named in its security rules,
// which can't say "any region", so each one is listed there too (nginx.conf and the meta
// tag in index.html). New AWS accounts on the Free plan can only use Polly in their home
// region, which AWS picks by country, so Ohio, Stockholm and Sydney have to be here.
export const POLLY_REGIONS = [
  ['us-east-1', 'US East (N. Virginia)'],
  ['us-east-2', 'US East (Ohio)'],
  ['us-west-2', 'US West (Oregon)'],
  ['ca-central-1', 'Canada (Central)'],
  ['eu-west-1', 'Europe (Ireland)'],
  ['eu-west-2', 'Europe (London)'],
  ['eu-central-1', 'Europe (Frankfurt)'],
  ['eu-north-1', 'Europe (Stockholm)'],
  ['ap-northeast-1', 'Asia Pacific (Tokyo)'],
  ['ap-southeast-2', 'Asia Pacific (Sydney)'],
];
export const POLLY_REGION = POLLY_REGIONS[0][0];
// Amazon has no Neural voices in these, though its voice list still names them.
const STANDARD_ONLY = new Set(['us-east-2', 'eu-north-1']);
export const pollyRegionLabel = ([id, name]) => `${name}, ${id}${STANDARD_ONLY.has(id) ? ' (Standard voices only)' : ''}`;
export const POLLY_KEY_PAGE = 'https://console.aws.amazon.com/iam/home#/users';
// A key as a QC package may hold it.
export const validPollyKey = (k) => !!k && /^[A-Za-z0-9]{1,128}$/.test(k.key) && /^\S{1,256}$/.test(k.secret) && POLLY_REGIONS.some(([id]) => id === k.region);
export const pollyHost = (region) => `polly.${region}.amazonaws.com`;
const SERVICE = 'polly';

// Neural first, since they sound better. Long-Form and Generative voices are left out:
// the first costs too much for lines that get read again, and the second only takes a
// speed around full sentences, which blocks often aren't.
const ENGINES = ['neural', 'standard'];
const ENGINE_NAMES = { neural: 'Neural', standard: 'Standard' };

// The sample rate of readings: Polly's rate for Neural voices. It also offers this for Standard ones.
export const POLLY_RATE = 24000;

const utf8 = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', utf8.encode(text)));
async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, utf8.encode(text));
}
// Query strings are signed with this stricter encoding, and sorted.
const awsEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const awsQuery = (query) => Object.entries(query).map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`).sort().join('&');

// The Authorization header for a request. headers: every header to sign, with lowercase
// names, including host and x-amz-date. amzDate: as in 20150830T123600Z.
export async function awsSignature({ method, path, query = {}, headers, body = '', region, service = SERVICE, key, secret, amzDate }) {
  const names = Object.keys(headers).sort();
  const canonical = [
    method, path, awsQuery(query),
    ...names.map((n) => `${n}:${String(headers[n]).trim()}`), '',
    names.join(';'), await sha256(body),
  ].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let k = await hmac(utf8.encode(`AWS4${secret}`), day);
  for (const part of [region, service, 'aws4_request']) k = await hmac(k, part);
  return `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hex(await hmac(k, toSign))}`;
}

const amzDateOf = (now) => now.toISOString().replace(/[-:]|\.\d{3}/g, '');
// How every request to Amazon goes: no cookies, and no address of ours.
const POLLY_FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };

async function signed(method, path, { query = {}, body, type } = {}, { key, secret, region }, now) {
  const amzDate = amzDateOf(now), host = pollyHost(region);
  const signedHeaders = { host, 'x-amz-date': amzDate, ...(type ? { 'content-type': type } : {}) };
  const authorization = await awsSignature({ method, path, query, headers: signedHeaders, body: body || '', region, key, secret, amzDate });
  const { host: _, ...headers } = signedHeaders; // the browser sends the host itself
  const search = awsQuery(query);
  return {
    url: `https://${host}${path}${search ? `?${search}` : ''}`,
    init: { ...POLLY_FETCH, method, headers: { ...headers, authorization }, ...(body ? { body } : {}) },
  };
}

// SSML can't hold these, or the words would be taken for markup.
export const ssmlText = (text) => String(text)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
// Polly takes speeds from 20% to 200%, in whole percents.
export const pollyRate = (speed) => Math.min(200, Math.max(20, Math.round((Number(speed) || 1) * 100)));

// The request for one reading, which comes back as MP3. Polly's uncompressed audio stops at
// 16 kHz, so MP3 is what gives the voices their full sound.
export function pollyRequest(text, voice, speed, creds, now = new Date()) {
  const body = JSON.stringify({
    Engine: voice.polly.engine,
    OutputFormat: 'mp3',
    SampleRate: String(POLLY_RATE),
    Text: `<speak><prosody rate="${pollyRate(speed)}%">${ssmlText(text)}</prosody></speak>`,
    TextType: 'ssml',
    VoiceId: voice.polly.id,
  });
  return signed('POST', '/v1/speech', { body, type: 'application/json' }, creds, now);
}
// What a reading needs to know of a voice, from its id alone. Null if it isn't a Polly voice.
const POLLY_URI = /^polly:(neural|standard):[A-Za-z-]+:([A-Za-z0-9]+)$/;
export const isPollyVoice = (uri) => POLLY_URI.test(String(uri));
export function pollyVoiceOf(uri) {
  const m = POLLY_URI.exec(String(uri));
  return m && { polly: { engine: m[1], id: m[2] } };
}
// One page of the voice list. nextToken: from the page before.
export const pollyVoicesRequest = (creds, nextToken = '', now = new Date()) =>
  signed('GET', '/v1/voices', { query: nextToken ? { NextToken: nextToken } : {} }, creds, now);

// Polly's voice list, as Scribecue's voice objects: one for each engine a voice has, in
// the user's languages if it has any of those, with Neural voices first. Matthew's Neural
// voice is "Polly Neural Matthew, male".
export function pollyVoiceList(json, langs = ['en'], region = POLLY_REGION) {
  const all = [];
  for (const engine of ENGINES) {
    if (engine === 'neural' && STANDARD_ONLY.has(region)) continue;
    for (const v of json?.Voices || []) {
      if (!v.Id || !v.LanguageCode || !v.SupportedEngines?.includes(engine)) continue;
      const gender = { Female: ', female', Male: ', male' }[v.Gender] || '';
      all.push({ voiceURI: `polly:${engine}:${v.LanguageCode}:${v.Id}`, polly: { id: v.Id, engine },
        name: `Polly ${ENGINE_NAMES[engine]} ${v.Name || v.Id}${gender}`, lang: v.LanguageCode, localService: false });
    }
  }
  const bases = new Set(langs.map((l) => l.toLowerCase().split('-')[0]));
  const mine = all.filter((v) => bases.has(v.lang.toLowerCase().split('-')[0]));
  return mine.length ? mine : all;
}
// What's worth keeping of each voice, so opening Scribecue doesn't contact Amazon.
export const pollyVoiceRecord = ({ Id, Name, Gender, LanguageCode, SupportedEngines }) => ({ Id, Name, Gender, LanguageCode, SupportedEngines });

// A voice's name from its id alone: "polly:neural:en-US:Matthew" is "Polly Neural Matthew (en-US)".
export function pollyLabel(uri) {
  const m = /^polly:(\w+):([^:]+):(.+)$/.exec(String(uri));
  return m && `Polly ${ENGINE_NAMES[m[1]] || m[1]} ${m[3]} (${m[2]})`;
}

const errorType = (r) => (r.headers?.get?.('x-amzn-ErrorType') || '').split(':')[0];
// Too many readings too quickly, which is worth trying again: Polly answers Neural voices
// about eight times a second.
export const pollyThrottled = (r) => r.status === 429 || errorType(r) === 'ThrottlingException';

// What went wrong, from Amazon's answer, in words someone can act on.
export async function pollyFailure(r) {
  let msg = '';
  try { const j = await r.json(); msg = j.message || j.Message || ''; } catch { /* no details */ }
  const type = errorType(r);
  if (['UnrecognizedClientException', 'InvalidClientTokenId'].includes(type)) return 'Amazon didn’t accept the access key. Check it in Settings, under Text to speech';
  if (['InvalidSignatureException', 'SignatureDoesNotMatch'].includes(type)) {
    return /expired|future|time/i.test(msg) ? 'Amazon refused the request: check this computer’s clock is right' : 'Amazon didn’t accept the secret key. Check it in Settings, under Text to speech';
  }
  if (/service control policy/i.test(msg)) return 'Amazon blocked Polly in this region for your account. New AWS accounts can only use it in their home region: AWS Settings shows it, under Projects and Additional info';
  if (type === 'AccessDeniedException' || r.status === 403) return `Amazon refused: ${msg || 'the access key may not be allowed to use Polly'}. If your budget has run out, this is the budget stopping the voices`;
  if (type === 'EngineNotSupportedException') return 'That voice isn’t offered in this AWS region. Choose another voice or region in Settings';
  if (pollyThrottled(r)) return 'Amazon says too many readings were asked for at once. Try again in a moment';
  return `Amazon answered ${r.status}${msg ? `: ${msg}` : ''}`;
}
