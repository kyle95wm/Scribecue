import { missing, COMMON } from './codecs.js';

// Scribecue is built for Chrome and Edge. Other browsers on the same engine, such as Brave,
// Opera, Vivaldi or Arc, usually work just as well, so what decides the notice is what a
// browser can do, not its name: people are told only when something is missing or known
// not to work well.

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

// Whether it runs on Chromium, Chrome's engine, as most browsers outside Firefox and
// Safari do.
export function chromium(ua = '', brands = []) {
  const b = brands.map((x) => x.brand || x);
  return b.includes('Chromium') || b.includes('Google Chrome') || b.includes('Microsoft Edge') ||
    (/\b(Chrome|Chromium|HeadlessChrome)\//.test(ua) && !/Firefox\//.test(ua));
}

// The notice's title. A browser that doesn't give its name, such as plain Chromium, isn't
// called anything.
export const noticeTitle = (name) => (name === 'this browser' ? 'This browser is missing some features' : `You're using ${name}`);

// Whether to show the notice: only with something to say.
export const needsNotice = (items) => items.length > 0;

// Phones and tablets, which Scribecue doesn't work on: it needs a keyboard, to hold keys
// while the narrator speaks and step frame by frame, and a screen big enough for the
// timeline. iPads say they're Macs, so a Mac with a touch screen counts as one.
export function isMobile({ ua = '', mobile = false, touchPoints = 0 } = {}) {
  return mobile === true || /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua) ||
    (/Macintosh/.test(ua) && touchPoints > 1);
}

// What this browser can't do that Scribecue uses, in words for the notice.
export function missingFeatures(w = globalThis) {
  const out = [];
  if (!('AudioDecoder' in w)) out.push('waveforms for most video files');
  if (!w.showSaveFilePicker) out.push('autosave, and saving a project straight back to its file (you get a download each time you save instead)');
  if (!('onbeforeinstallprompt' in w)) out.push('the Install app button');
  if (!('speechSynthesis' in w)) out.push('text to speech with your computer’s voices');
  const video = w.document?.createElement?.('video');
  const gone = video ? missing(COMMON, (t) => video.canPlayType(t)) : [];
  if (gone.length) out.push(`playing most MP4 videos, which use ${gone.join(' and ')}. Use a WebM copy instead`);
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
