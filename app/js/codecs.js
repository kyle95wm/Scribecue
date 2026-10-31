// Which video and audio formats this browser plays. Some Chromium builds, mostly on
// Linux, leave out the licensed ones (H.264, HEVC, AAC), so a common MP4 won't play;
// these let Scribecue say so, and what to do, before it fails.

// A codec as the file names it (an MP4 sample entry, or a Matroska codec ID) -> its name.
const VIDEO_NAMES = {
  avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', av01: 'AV1', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4 video',
  'V_MPEG4/ISO/AVC': 'H.264', 'V_MPEGH/ISO/HEVC': 'HEVC', V_AV1: 'AV1', V_VP9: 'VP9', V_VP8: 'VP8',
  'V_MPEG4/ISO/ASP': 'MPEG-4 video', 'V_MPEG4/ISO/SP': 'MPEG-4 video',
};
export const videoName = (codec) => VIDEO_NAMES[codec] || '';

// What to ask the browser about each, by name.
export const TESTS = {
  'H.264': 'video/mp4; codecs="avc1.42E01E"',
  HEVC: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  AV1: 'video/mp4; codecs="av01.0.04M.08"',
  VP9: 'video/webm; codecs="vp9"',
  VP8: 'video/webm; codecs="vp8"',
  'MPEG-4 video': 'video/mp4; codecs="mp4v.20.9"',
  AAC: 'audio/mp4; codecs="mp4a.40.2"',
  MP3: 'audio/mpeg',
  Opus: 'audio/webm; codecs="opus"',
  Vorbis: 'audio/webm; codecs="vorbis"',
  FLAC: 'audio/flac',
};
// The two most videos use: missing either, a browser can't play a usual MP4.
export const COMMON = ['H.264', 'AAC'];

// Which of names (video or audio, as above) the browser can't play. canPlay: a
// video element's canPlayType. Names it has no test for are left out: AC-3, DTS and the
// like have their own handling, with the waveform.
export function missing(names, canPlay) {
  return [...new Set(names)].filter((n) => TESTS[n] && !canPlay(TESTS[n]));
}

// What to say when a file uses formats the browser can't play. ffmpeg: whether the
// ffmpeg container is running, to make a copy it can.
// names: what it can't play, or none when the browser only said it couldn't play the file.
export function advice(names, { file = 'this file', ffmpeg = false } = {}) {
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
  return (names.length ? `This browser can’t play ${list}, which ${file} uses. Some Chromium builds leave ${names.length > 1 ? 'them' : 'it'} out. `
    : `This browser can’t play ${file}. `) +
    (ffmpeg ? 'Make a copy that plays here, or use Chrome or Edge.' : 'Use Chrome or Edge, or a WebM copy of the video.');
}

// The copy ffmpeg makes (ffmpeg/server.py): "mp4" keeps the picture, when only the sound
// won't play and an MP4 can hold the picture; otherwise "webm", with the picture as VP9.
export const copyKind = (video, names) =>
  video && !names.includes(video) && ['H.264', 'HEVC', 'AV1', 'VP9'].includes(video) ? 'mp4' : 'webm';
