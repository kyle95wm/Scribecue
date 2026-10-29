import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS, SYSTEM, systemWith, usefulOpenAI, usefulGemini, buildRequest, recentFrames, readReply, failure, listModels, fitBudget, nearbyScript, draftPrompt,
  pkcePair, openRouterAuthUrl, openRouterKey,
} from '../app/js/ai.js';

const turn = [{ role: 'user', text: 'Describe this.', images: [{ data: 'QUJD', at: 3 }] }];
const streamOf = (text) => new Response(text);

test('each provider gets the frames and words in its own format', () => {
  const a = buildRequest('anthropic', { key: 'k', model: 'claude-opus-5-5', messages: turn });
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(a.headers['x-api-key'], 'k');
  assert.equal(a.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(a.body.stream, true);
  assert.equal(a.body.fallbacks, 'default');
  assert.equal(a.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.deepEqual(a.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  assert.ok(!('temperature' in a.body));
  // Haiku has no fallbacks
  const h = buildRequest('anthropic', { key: 'k', model: 'claude-haiku-5-5', messages: turn });
  assert.equal(h.body.fallbacks, undefined);
  assert.equal(h.headers['anthropic-beta'], undefined);

  const o = buildRequest('openai', { key: 'k', model: 'gpt-x', messages: turn });
  assert.equal(o.headers.Authorization, 'Bearer k');
  assert.equal(o.body.messages[0].role, 'system');
  assert.equal(o.body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');

  const r = buildRequest('openrouter', { key: 'k', model: 'x/y', messages: turn });
  assert.equal(r.url, 'https://openrouter.ai/api/v1/chat/completions');

  const g = buildRequest('gemini', { key: 'k', model: 'gemini-x', messages: [...turn, { role: 'assistant', text: 'Ok' }] });
  assert.match(g.url, /models\/gemini-x:streamGenerateContent\?alt=sse$/);
  assert.equal(g.headers['x-goog-api-key'], 'k');
  assert.deepEqual(g.body.contents[0].parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } });
  assert.equal(g.body.contents[1].role, 'model');

  const l = buildRequest('ollama', { model: 'llava', base: 'http://localhost:11434/', messages: turn });
  assert.equal(l.url, 'http://localhost:11434/api/chat');
  assert.deepEqual(l.body.messages[1].images, ['QUJD']);
  assert.ok(l.body.options.num_ctx >= 8192, 'room for frames and the script');
});

test('Claude’s own reply goes back unchanged on the next turn', () => {
  const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Hi' }];
  const a = buildRequest('anthropic', { key: 'k', model: 'claude-opus-5-5', messages: [...turn, { role: 'assistant', text: 'Hi', raw }] });
  assert.deepEqual(a.body.messages[1].content, raw);
});

test('streamed replies are read for each provider', async () => {
  const seen = [];
  const claude = await readReply('anthropic', streamOf([
    'event: message_start', 'data: {"type":"message_start","message":{}}', '',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc"}}',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"A woman "}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"waves."}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}', '',
  ].join('\n')), (t) => seen.push(t));
  assert.equal(claude.text, 'A woman waves.');
  assert.deepEqual(seen, ['A woman ', 'waves.']);
  assert.equal(claude.stop, 'end_turn');
  assert.deepEqual(claude.raw, [{ type: 'thinking', thinking: '', signature: 'abc' }, { type: 'text', text: 'A woman waves.' }]);

  const openai = await readReply('openai', streamOf('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n'));
  assert.equal(openai.text, 'Hi there');

  const gemini = await readReply('gemini', streamOf('data: {"candidates":[{"content":{"parts":[{"text":"thinking","thought":true},{"text":"Rain falls."}]}}]}\r\n\r\n'));
  assert.equal(gemini.text, 'Rain falls.');

  const ollama = await readReply('ollama', streamOf('{"message":{"content":"A "}}\n{"message":{"content":"dog."},"done":true,"done_reason":"stop"}\n'));
  assert.equal(ollama.text, 'A dog.');
  assert.equal(ollama.stop, 'stop');

  await assert.rejects(readReply('anthropic', streamOf('data: {"type":"error","error":{"message":"Overloaded"}}\n')), /Overloaded/);
});

test('failures say what to do', async () => {
  const r = new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 });
  assert.match(await failure('anthropic', r), /didn't accept the key: invalid x-api-key\. Check it in AI settings/);
  assert.match(await failure('gemini', new Response('{"error":{"message":"API key not valid."}}', { status: 400 })), /didn't accept the key/);
  assert.match(await failure('ollama', new Response('{"error":"model \\"x\\" not found"}', { status: 404 })), /doesn't know that model/);
});

test('model lists keep chat models that can see frames', async () => {
  const fake = (json) => async () => new Response(JSON.stringify(json));
  assert.deepEqual(await listModels('openai', { key: 'k' }, fake({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-3' }, { id: 'gpt-x-audio' }, { id: 'o9' }] })), ['gpt-x', 'o9']);
  // Ollama: only models that say they can see
  const ollama = async (url, o) => {
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'gemma3:12b' }, { name: 'llama3.1:8b' }, { name: 'old:1b' }] }));
    const name = JSON.parse(o.body).model;
    return new Response(JSON.stringify(name === 'old:1b' ? {} : { capabilities: name === 'gemma3:12b' ? ['completion', 'vision'] : ['completion', 'tools'] }));
  };
  assert.deepEqual(await listModels('ollama', {}, ollama), ['gemma3:12b', 'old:1b']); // a model too old to say is kept
  let asked;
  const claude = await listModels('anthropic', { key: 'k' }, async (url, o) => { asked = { url, o }; return new Response('{"input_tokens":8}'); });
  assert.equal(claude[0], 'claude-opus-5-5');
  assert.equal(asked.url, 'https://api.anthropic.com/v1/messages/count_tokens');
  assert.equal(asked.o.method, 'POST');
  assert.equal(asked.o.headers['x-api-key'], 'k');
  assert.deepEqual(await listModels('openrouter', {}, fake({ data: [
    { id: 'a', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    { id: 'b', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
    { id: 'makes-pictures', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] } },
    { id: 'b:batch', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  ] })), ['b']);
  assert.deepEqual(await listModels('gemini', { key: 'k' }, fake({ models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] })), ['gemini-a']);
  assert.deepEqual(await listModels('ollama', {}, fake({ models: [{ name: 'llava' }, { name: 'gemma3' }] })), ['gemma3', 'llava']);
});

test('drafts know how much fits and what is around them', () => {
  assert.deepEqual(fitBudget(3, 15, 1), { chars: 45, words: 8 });
  assert.deepEqual(fitBudget(3, 15, 1.5), { chars: 67, words: 11 });
  const cues = [
    { start: 1, end: 3, text: 'Mara walks in.' },
    { start: 5, end: 8.5, text: '' },
    { start: 10, end: 12, text: 'She sits.' },
  ];
  assert.match(nearbyScript(cues, 1), /^ {2}#1 00:00:01\.000–00:00:03\.000: Mara walks in\.\n> #2 00:00:05\.000–00:00:08\.500: \(empty\)\n {2}#3/);
  const p = draftPrompt(cues, 1, fitBudget(3.5), [5, 6.75]);
  assert.match(p, /block #2, from 00:00:05\.000 to 00:00:08\.500 \(3\.5 s\)/);
  assert.match(p, /About 9 words \(52 characters\)/);
  assert.match(p, /frames are from 00:00:05\.000, 00:00:06\.750/);
  assert.match(p, /Reply with only the description/);
  assert.doesNotMatch(p, /currently says/);
});

test('OpenRouter sign-in uses PKCE and swaps the code for a key', async () => {
  const { verifier, challenge } = await pkcePair();
  assert.match(verifier, /^[\w-]{43}$/);
  assert.match(challenge, /^[\w-]{43}$/);
  assert.equal(openRouterAuthUrl('https://x.test/app/', challenge),
    `https://openrouter.ai/auth?callback_url=https%3A%2F%2Fx.test%2Fapp%2F&code_challenge=${challenge}&code_challenge_method=S256`);
  let sent;
  const key = await openRouterKey('c0de', verifier, async (url, o) => { sent = { url, body: JSON.parse(o.body) }; return new Response('{"key":"sk-or-1"}'); });
  assert.equal(key, 'sk-or-1');
  assert.deepEqual(sent, { url: 'https://openrouter.ai/api/v1/auth/keys', body: { code: 'c0de', code_verifier: verifier, code_challenge_method: 'S256' } });
  assert.ok(PROVIDERS.openrouter.signIn);
});

test('only the latest messages keep their frames', () => {
  const im = [{ data: 'x', at: 1 }];
  const msgs = [
    { role: 'user', text: 'one', images: im }, { role: 'assistant', text: 'a' },
    { role: 'user', text: 'two', images: im }, { role: 'assistant', text: 'b' },
    { role: 'user', text: 'three', images: im },
  ];
  const out = recentFrames(msgs);
  assert.deepEqual(out.map((m) => m.images?.length ?? null), [0, null, 1, null, 1]);
  assert.equal(out[0].text, 'one'); // the words stay
  assert.equal(msgs[0].images.length, 1); // and the conversation itself is unchanged
});

test('project notes go with the instructions, and nothing extra goes without them', () => {
  assert.equal(systemWith(''), SYSTEM);
  assert.equal(systemWith('  \n '), SYSTEM);
  const s = systemWith('Mara: red coat.\nSet in Leeds.');
  assert.ok(s.startsWith(SYSTEM));
  assert.match(s, /notes about this programme.*\nMara: red coat\.\nSet in Leeds\.$/s);
  // and they reach every provider
  for (const p of ['anthropic', 'openai', 'gemini', 'ollama']) {
    const r = JSON.stringify(buildRequest(p, { key: 'k', model: 'm', system: s, messages: [{ role: 'user', text: 'hi' }] }).body);
    assert.match(r, /Mara: red coat/, p);
  }
});

test('models that can’t see the frames or write a description aren’t offered', () => {
  const keep = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini', 'gpt-5.4', 'o1', 'o3', 'o4-mini', 'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'chatgpt-4o-latest'];
  const skip = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-0613', 'gpt-4-0125-preview', 'gpt-4-turbo-preview', 'o1-mini', 'o3-mini', 'gpt-image-1', 'dall-e-3', 'gpt-4o-audio-preview',
    'gpt-4o-realtime-preview', 'gpt-4o-search-preview', 'gpt-4o-transcribe', 'gpt-4o-mini-tts', 'text-embedding-3-large', 'omni-moderation-latest', 'gpt-5-codex', 'codex-mini-latest',
    'computer-use-preview', 'gpt-oss-120b', 'gpt-3.5-turbo-instruct', 'sora-2', 'tts-1', 'whisper-1'];
  for (const id of keep) assert.ok(usefulOpenAI(id), `${id} should be offered`);
  for (const id of skip) assert.ok(!usefulOpenAI(id), `${id} shouldn’t be offered`);
  const g = (name, methods = ['generateContent']) => usefulGemini({ name: `models/${name}`, supportedGenerationMethods: methods });
  for (const n of ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-3.1-flash-lite']) assert.ok(g(n), n);
  for (const n of ['gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'gemini-2.0-flash-live-001', 'gemini-embedding-001', 'gemini-pro', 'gemini-2.5-flash-native-audio-dialog']) assert.ok(!g(n), n);
  assert.ok(!g('gemini-2.5-flash', ['embedContent']));
});
