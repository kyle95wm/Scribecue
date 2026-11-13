// QC synthesis is explicit. Playback, seeking and timing edits only look up audio.
import { spoken, spokenLines, googleWords, soundsLike, atBase, googleRequest, googleFailure, readWav, withoutLeadIn, joinLines, reviewGoogleKey, reviewPollyCreds, pollyRead } from './tts.js';
import { isPollyVoice, pollyVoiceOf } from './polly.js';

export function speechSpec(key) {
  try {
    let p = JSON.parse(key);
    if (p.length === 8) p = p.slice(2); // early QC packages
    const [text, say, speed, voice, base, skipNotes] = p;
    if (p.length !== 6 || typeof text !== 'string' || typeof voice !== 'string' || !Array.isArray(say) ||
      !Number.isFinite(speed) || !Number.isFinite(base)) return null;
    const said = soundsLike(text, say);
    return { words: isGoogleStandard(voice) ? googleWords(spokenLines(said, skipNotes)) : spoken(said, skipNotes), rate: atBase(speed, base), voice };
  } catch { return null; }
}
export const speechKey = (s) => JSON.stringify([s.voice, s.rate, s.words]);
export const sameSpeech = (a, b) => !!a && !!b && speechKey(a) === speechKey(b);
export const isGoogleStandard = (voice) => /^google:[a-z]{2,3}-[A-Z]{2}-Standard-[A-Z]$/.test(voice);
// The voices QC can read again, each with a key of its own: Google's and Polly's.
export const rereads = (voice) => isGoogleStandard(voice) || isPollyVoice(voice);
// The speeds each one takes. Outside them, a reading would quietly be at the wrong speed.
const rateFits = ({ voice, rate }) => rate >= (isPollyVoice(voice) ? .2 : .25) && rate <= (isPollyVoice(voice) ? 2 : 4);
export function rewriteOf(original, key) {
  const before = speechSpec(original?.key), after = speechSpec(key);
  if (!before || !after || !rereads(before.voice) ||
    original.voice !== before.voice || after.voice !== before.voice || !after.words || !rateFits(after) || sameSpeech(before, after)) return null;
  return after;
}
// A block the reviewer added has no original. It can only use a voice the package already
// reads with (voices: a Set of them).
export function additionOf(voices, key) {
  const spec = speechSpec(key);
  return spec && rereads(spec.voice) && voices?.has(spec.voice) && spec.words && rateFits(spec) ? spec : null;
}
// Whose key reads a voice, for messages.
export const keyName = (voice) => (isPollyVoice(voice) ? 'AWS' : 'Google');
// The package's key for a voice: a Google key, or an AWS key with its secret and region.
export const bundledFor = (access, voice) => (isPollyVoice(voice) ? access?.polly || null : access?.googleKey || '');
// Whether a voice can be read here, with the reviewer's own key or the package's.
export const canReread = (voice, access) => (isPollyVoice(voice) ? !!reviewPollyCreds(bundledFor(access, voice)) : !!reviewGoogleKey(bundledFor(access, voice)));
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
      const line = async (words) => {
        const { url, init } = googleRequest(words, { google: name, lang }, spec.rate, key);
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(await googleFailure(response));
        const b64 = (await response.json()).audioContent || '';
        return withoutLeadIn(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer);
      };
      // A line at a time, as the writer's Google readings are.
      const buf = await joinLines(await Promise.all(spec.words.split('\n').map(line)));
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
export async function makePollyRewrite(spec, bundled = null, { useBundled = false } = {}) {
  const creds = useBundled ? bundled : reviewPollyCreds(bundled);
  if (!creds) throw new Error('Add your AWS key in Text to speech settings, or ask the writer for a key in the QC package');
  const id = JSON.stringify([creds.key, speechKey(spec)]);
  if (pending.has(id)) return pending.get(id);
  const job = (async () => {
    try {
      const buf = await pollyRead(spec.words, pollyVoiceOf(spec.voice), spec.rate, true, creds, AbortSignal.timeout(30000));
      const wav = readWav(buf);
      if (!(wav.secs > 0)) throw new Error('Amazon returned an empty reading');
      return { blob: new Blob([buf], { type: 'audio/wav' }), secs: wav.secs, voice: spec.voice };
    } catch (error) {
      const message = error.name === 'TimeoutError' ? 'Amazon took too long to answer. Try the reading again'
        : error.message === 'Failed to fetch' ? 'Couldn’t reach Amazon. Connect to the internet to make a new reading' : error.message;
      throw new Error(message.split(creds.key).join('[key]').split(creds.secret).join('[key]'));
    }
  })();
  pending.set(id, job);
  try { return await job; } finally { pending.delete(id); }
}
// bundled: the package's key for this voice (see bundledFor).
export async function reviewedRewrite(spec, bundled, offerFallback) {
  const polly = isPollyVoice(spec.voice), make = polly ? makePollyRewrite : makeGoogleRewrite;
  const personalFirst = !!bundled && (polly ? reviewPollyCreds(bundled) : reviewGoogleKey(bundled)) !== bundled;
  try { return await make(spec, bundled); }
  catch (error) {
    if (!personalFirst || !await offerFallback(error.message)) throw error;
    return make(spec, bundled, { useBundled: true });
  }
}
