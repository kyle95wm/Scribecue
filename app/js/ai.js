// AI help for writing audio description: a chat about the scene and a draft of the
// selected block, from the person's own AI provider. Nothing is sent anywhere until they
// connect a provider and send a message or ask for a draft.
//
// Providers are called straight from the browser with the person's own key, or through
// OpenRouter's sign-in, or Ollama on their own computer. This file builds the requests and
// reads the replies; the drawer that uses it is in app.js.

export const PROVIDERS = {
  anthropic: {
    name: 'Claude (Anthropic)', keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…', defaultModel: 'claude-opus-5-5',
  },
  openai: { name: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  gemini: { name: 'Gemini (Google)', keyUrl: 'https://aistudio.google.com/app/apikey', keyHint: 'AIza…' },
  openrouter: { name: 'OpenRouter', keyUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-…', signIn: true },
  ollama: { name: 'Ollama (on this computer)', local: true, base: 'http://localhost:11434' },
};

const ANTHROPIC_VERSION = '2026-10-21';
// Claude's current models, best first. Anthropic's model list can't be read from a web
// page, so this is the list offered.
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
// Models that can hand a declined request on to another Claude model by themselves.
const CLAUDE_FALLBACKS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

// The instructions every provider gets.
export const SYSTEM = `You help a writer create audio description: short narration of what's on screen for blind and partially sighted viewers, read in the gaps between dialogue.

Write in the present tense, plainly and concretely. Describe what can be seen: who is there, where they are, what they do, expressions and body language, and text on screen that matters. Don't interpret beyond what's visible, explain the plot, or say "we see". Mention the camera only when the shot itself matters.

Keep the names and style the script already uses, and don't name someone the script hasn't named yet. Fit the time available: a description that runs past its gap gets in the way of the dialogue.

Video frames you're given are stills from the programme, each labelled with its timecode.`;

// The instructions with the writer's notes about this programme, which can say what the
// frames can't: who the characters are, where it's set, how the team writes.
export function systemWith(notes = '') {
  const n = notes.trim();
  return n ? `${SYSTEM}\n\nThe writer's notes about this programme. Follow them, and use the names they give:\n${n}` : SYSTEM;
}

// How much fits in a block: the voice's characters per second times the block's length,
// at the block's reading speed. About six characters make a word, with its space.
export function fitBudget(secs, cps = 15, speed = 1) {
  const chars = Math.max(0, Math.floor(secs * cps * speed));
  return { chars, words: Math.max(1, Math.round(chars / 6)) };
}

const clock = (t) => {
  const ms = Math.round(Math.max(0, t) * 1000), s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

// The blocks around block i, so replies match the script and don't repeat it.
export function nearbyScript(cues, i, before = 4, after = 2) {
  const lines = [];
  for (let k = Math.max(0, i - before); k <= Math.min(cues.length - 1, i + after); k++) {
    const c = cues[k];
    lines.push(`${k === i ? '>' : ' '} #${k + 1} ${clock(c.start)}–${clock(c.end)}: ${c.text.trim() || '(empty)'}`);
  }
  return lines.join('\n');
}

// What to ask for when drafting block i. budget from fitBudget.
export function draftPrompt(cues, i, budget, frameTimes = []) {
  const c = cues[i], secs = c.end - c.start;
  return [
    `Here is the script around block #${i + 1} (marked >):`,
    nearbyScript(cues, i),
    '',
    `Write the description for block #${i + 1}, from ${clock(c.start)} to ${clock(c.end)} (${secs.toFixed(1)} s). ` +
      `About ${budget.words} words (${budget.chars} characters) fit when it's read aloud; use fewer if that says it well.`,
    c.text.trim() ? `It currently says: "${c.text.trim()}". Improve it, or write a better one.` : '',
    frameTimes.length ? `The frames are from ${frameTimes.map(clock).join(', ')}.` : 'There are no frames, so work from the script and say if you need to see the scene.',
    'Reply with only the description, without quotes or notes.',
  ].filter(Boolean).join('\n');
}

// Context for a chat message: where the writer is.
export function chatContext(cues, i, playhead) {
  const at = `The playhead is at ${clock(playhead)}.`;
  if (i < 0) return at;
  return `${at} The selected block is #${i + 1}. The script around it:\n${nearbyScript(cues, i)}`;
}

// ---- requests

// Earlier messages keep their words but not their frames, beyond the last few: frames
// are most of what's sent, and older ones are rarely needed again.
export function recentFrames(messages, keep = 2) {
  let seen = 0;
  return messages.slice().reverse().map((m) => {
    if (m.role !== 'user' || !m.images?.length) return m;
    return ++seen <= keep ? m : { ...m, images: [] };
  }).reverse();
}

// messages: [{ role: 'user' | 'assistant', text, images: [{ data (base64 JPEG), at }], raw }]
// raw is Claude's own content for an assistant turn, sent back unchanged.
export function buildRequest(provider, { key, model, base, system = SYSTEM, messages }) {
  const json = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') {
    const body = {
      model, max_tokens: 16000, stream: true, system,
      output_config: { effort: 'medium' },
      messages: messages.map((m) => ({
        role: m.role,
        content: m.role === 'assistant' ? (m.raw || [{ type: 'text', text: m.text }]) : [
          ...(m.images || []).map((im) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.data } })),
          { type: 'text', text: m.text },
        ],
      })),
    };
    const headers = {
      ...json, 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (CLAUDE_FALLBACKS.has(model)) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
    return { url: 'https://api.anthropic.com/v1/messages', headers, body };
  }
  if (provider === 'openai' || provider === 'openrouter') {
    const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = { ...json, Authorization: `Bearer ${key}` };
    if (provider === 'openrouter') headers['X-Title'] = 'Scribecue';
    return {
      url, headers,
      body: {
        model, stream: true,
        messages: [{ role: 'system', content: system }, ...messages.map((m) => ({
          role: m.role,
          content: m.role === 'assistant' || !m.images?.length ? m.text : [
            { type: 'text', text: m.text },
            ...m.images.map((im) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im.data}` } })),
          ],
        }))],
      },
    };
  }
  if (provider === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: { ...json, 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [...(m.images || []).map((im) => ({ inline_data: { mime_type: 'image/jpeg', data: im.data } })), { text: m.text }],
        })),
      },
    };
  }
  if (provider === 'ollama') {
    return {
      url: `${(base || PROVIDERS.ollama.base).replace(/\/+$/, '')}/api/chat`,
      headers: json,
      body: {
        model, stream: true,
        messages: [{ role: 'system', content: system }, ...messages.map((m) => ({
          role: m.role, content: m.text, ...(m.images?.length ? { images: m.images.map((im) => im.data) } : {}),
        }))],
      },
    };
  }
  throw new Error(`unknown provider ${provider}`);
}

// ---- replies

// The lines of a streamed body, as they arrive.
async function* lines(body) {
  const reader = body.getReader(), dec = new TextDecoder();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    rest += dec.decode(value || new Uint8Array(), { stream: !done });
    const parts = rest.split(/\r?\n/);
    rest = parts.pop();
    for (const p of parts) yield p;
    if (done) break;
  }
  if (rest) yield rest;
}
// Server-sent events: the JSON of each data: line.
async function* events(body) {
  for await (const l of lines(body)) {
    if (!l.startsWith('data:')) continue;
    const d = l.slice(5).trim();
    if (!d || d === '[DONE]') continue;
    try { yield JSON.parse(d); } catch { /* a keep-alive or a partial line */ }
  }
}

// Reads a streamed reply, calling onText with each piece of text. Returns
// { text, raw, stop } where raw is Claude's content to send back next turn.
export async function readReply(provider, response, onText = () => {}) {
  let text = '', stop = '';
  const add = (t) => { if (t) { text += t; onText(t, text); } };
  if (provider === 'anthropic') {
    const blocks = [];
    for await (const e of events(response.body)) {
      if (e.type === 'content_block_start') blocks[e.index] = { ...e.content_block };
      else if (e.type === 'content_block_delta') {
        const b = blocks[e.index], d = e.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; add(d.text); }
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
      } else if (e.type === 'message_delta') stop = e.delta?.stop_reason || stop;
      else if (e.type === 'error') throw new Error(e.error?.message || 'Claude stopped with an error');
    }
    return { text, raw: blocks.filter(Boolean), stop };
  }
  if (provider === 'openai' || provider === 'openrouter') {
    for await (const e of events(response.body)) {
      if (e.error) throw new Error(e.error.message || 'the provider stopped with an error');
      const ch = e.choices?.[0];
      add(ch?.delta?.content);
      if (ch?.finish_reason) stop = ch.finish_reason;
    }
    return { text, stop };
  }
  if (provider === 'gemini') {
    for await (const e of events(response.body)) {
      if (e.error) throw new Error(e.error.message || 'Gemini stopped with an error');
      const cand = e.candidates?.[0];
      for (const p of cand?.content?.parts || []) if (!p.thought) add(p.text);
      if (cand?.finishReason) stop = cand.finishReason;
      if (e.promptFeedback?.blockReason) stop = 'refusal';
    }
    return { text, stop };
  }
  // Ollama: one JSON object per line
  for await (const l of lines(response.body)) {
    if (!l.trim()) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (e.error) throw new Error(e.error);
    add(e.message?.content);
    if (e.done) stop = e.done_reason || 'stop';
  }
  return { text, stop };
}

// Why a request failed, in words for the writer.
export async function failure(provider, response) {
  let msg = '';
  try {
    const j = await response.json();
    msg = (typeof j.error === 'string' ? j.error : j.error?.message || j.message || '').trim().replace(/\.+$/, '');
  } catch { /* not JSON */ }
  const who = PROVIDERS[provider]?.name || provider;
  if (response.status === 401 || response.status === 403 || (response.status === 400 && /api.?key/i.test(msg))) return `${who} didn't accept the key${msg ? `: ${msg}` : ''}. Check it in AI settings.`;
  if (response.status === 404) return `${who} doesn't know that model${msg ? `: ${msg}` : ''}. Pick another in AI settings.`;
  if (response.status === 429) return `${who} says too many requests or no credit left${msg ? `: ${msg}` : ''}.`;
  return `${who} answered ${response.status}${msg ? `: ${msg}` : ''}.`;
}

// ---- models

// The models this provider offers, best first where we know, otherwise by name.
// Asking also checks the key, where the provider needs one.
export async function listModels(provider, { key, base }, fetcher = fetch) {
  const get = async (url, headers = {}, opts = {}) => {
    const r = await fetcher(url, { headers, ...opts });
    if (!r.ok) throw new Error(await failure(provider, r));
    return r.json();
  };
  if (provider === 'anthropic') {
    // Counting tokens is free, and says whether the key works.
    await get('https://api.anthropic.com/v1/messages/count_tokens', {
      'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    }, { method: 'POST', body: JSON.stringify({ model: CLAUDE_MODELS[0], messages: [{ role: 'user', content: 'Hi' }] }) });
    return [...CLAUDE_MODELS];
  }
  if (provider === 'openai') {
    const j = await get('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
    // Leave out models that can't chat: speech, images, embeddings and the like.
    return (j.data || []).map((m) => m.id)
      .filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|transcribe|tts|image|search|embedding/.test(id)).sort();
  }
  if (provider === 'gemini') {
    const j = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key });
    return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name))
      .map((m) => m.name.replace(/^models\//, '')).sort().reverse();
  }
  if (provider === 'openrouter') {
    if (key) await get('https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` }); // the list itself is public
    const j = await get('https://openrouter.ai/api/v1/models');
    // Only models that can look at the frames.
    return (j.data || []).filter((m) => (m.architecture?.input_modalities || []).includes('image')).map((m) => m.id).sort();
  }
  const j = await get(`${(base || PROVIDERS.ollama.base).replace(/\/+$/, '')}/api/tags`);
  return (j.models || []).map((m) => m.name).sort();
}

// ---- OpenRouter sign-in (OAuth with PKCE: no secret is needed in the page)

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}
export const openRouterAuthUrl = (callback, challenge) =>
  `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
export async function openRouterKey(code, verifier, fetcher = fetch) {
  const r = await fetcher('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!r.ok) throw new Error(await failure('openrouter', r));
  const j = await r.json();
  if (!j.key) throw new Error('OpenRouter didn’t send a key');
  return j.key;
}
