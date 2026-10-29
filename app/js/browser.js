// Scribecue is built for Chrome and Edge. In other browsers it still opens, but some
// features depend on things only Chromium browsers have, so people are told which.

// The browser's name, from its brands (Chromium browsers) or its user agent string.
export function browserName(ua = '', brands = []) {
  const b = brands.map((x) => x.brand || x);
  if (b.includes('Microsoft Edge') || /\bEdg\//.test(ua)) return 'Edge';
  if (b.includes('Google Chrome') || /HeadlessChrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/OPR\//.test(ua) || b.includes('Opera')) return 'Opera';
  if (b.includes('Brave')) return 'Brave';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS/.test(ua)) return 'Safari';
  const other = b.find((x) => !/Not.?A.?Brand|Chromium/i.test(x));
  if (other) return other;
  if (/Chrome\//.test(ua) && !b.includes('Chromium')) return 'Chrome'; // older Chrome, no brands
  return 'this browser';
}

export const supported = (name) => name === 'Chrome' || name === 'Edge';

// What this browser can't do that Scribecue uses, in words for the notice.
export function missingFeatures(w = globalThis) {
  const out = [];
  if (!('AudioDecoder' in w)) out.push('waveforms for most video files');
  if (!w.showSaveFilePicker) out.push('saving a project straight back to its file (you get a download instead)');
  if (!('onbeforeinstallprompt' in w)) out.push('the Install app button');
  if (!('speechSynthesis' in w)) out.push('text to speech with your computer’s voices');
  return out;
}

// What a browser has but doesn't do well enough, found by using it, in words for the
// notice. Feature checks can't see these.
const ISSUES = {
  Firefox: [
    'smooth sound for a file’s description track, when the file has several audio tracks (it can stutter or cut out)',
    'speech to text, which can interrupt the video’s sound while blocks are transcribed',
  ],
};
export const knownIssues = (name) => ISSUES[name] || [];

// What the notice lists: what's missing, then what doesn't work well.
export const noticeItems = (name, w = globalThis) => [...missingFeatures(w), ...knownIssues(name)];
