// QC synthesis is explicit. Playback, seeking and timing edits only look up audio.
import { spoken, soundsLike, atBase, googleRequest, googleFailure, readWav, reviewGoogleKey } from './tts.js';

export function speechSpec(key) {
  try {
    let p = JSON.parse(key);
    if (p.length === 8) p = p.slice(2); // early QC packages
    const [text, say, speed, voice, base, skipNotes] = p;
    if (p.length !== 6 || typeof text !== 'string' || typeof voice !== 'string' || !Array.isArray(say) ||
      !Number.isFinite(speed) || !Number.isFinite(base)) return null;
    return { words: spoken(soundsLike(text, say), skipNotes), rate: atBase(speed, base), voice };
  } catch { return null; }
}
export const speechKey = (s) => JSON.stringify([s.voice, s.rate, s.words]);
export const sameSpeech = (a, b) => !!a && !!b && speechKey(a) === speechKey(b);
export function googleRewrite(original, key) {
  const before = speechSpec(original?.key), after = speechSpec(key);
  if (!before || !after || !/^google:[a-z]{2,3}-[A-Z]{2}-Standard-[A-Z]$/.test(before.voice) ||
    original.voice !== before.voice || after.voice !== before.voice || !after.words || after.rate < .25 || after.rate > 4 || sameSpeech(before, after)) return null;
  return after;
}
// One explicit request at a time per reading. Fallback needs the reviewer's consent.
const pending = new Map();
export async function makeGoogleRewrite(spec, bundledKey = '', { useBundled = false } = {}) {
  const key = useBundled ? bundledKey : reviewGoogleKey(bundledKey);
  if (!key) throw new Error('Add your Google key in Text to speech settings, or ask the writer for a key in the QC package');
  const id = JSON.stringify([key, speechKey(spec)]);
  if (pending.has(id)) return pending.get(id);
  const job = (async () => {
    try {
      const name = spec.voice.slice(7), lang = name.split('-').slice(0, 2).join('-');
      const { url, init } = googleRequest(spec.words, { google: name, lang }, spec.rate, key);
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(await googleFailure(response));
      const b64 = (await response.json()).audioContent || '';
      const buf = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer;
      const wav = readWav(buf);
      if (!(wav.secs > 0)) throw new Error('Google returned an empty reading');
      return { blob: new Blob([buf], { type: 'audio/wav' }), secs: wav.secs, voice: spec.voice };
    } catch (error) {
      const message = error.name === 'TimeoutError' ? 'Google took too long to answer. Try the reading again'
        : error.message === 'Failed to fetch' ? 'Couldn’t reach Google. Connect to the internet to make a new reading' : error.message;
      throw new Error(message.split(key).join('[key]').split(bundledKey || key).join('[key]'));
    }
  })();
  pending.set(id, job);
  try { return await job; } finally { pending.delete(id); }
}
export async function reviewedRewrite(spec, bundledKey, offerFallback) {
  const personalFirst = !!bundledKey && reviewGoogleKey(bundledKey) !== bundledKey;
  try { return await makeGoogleRewrite(spec, bundledKey); }
  catch (error) {
    if (!personalFirst || !await offerFallback(error.message)) throw error;
    return makeGoogleRewrite(spec, bundledKey, { useBundled: true });
  }
}
