// ffmpeg commands that put an exported full mix into the video, for people with ffmpeg on
// their own computer: the same as ffmpeg/server.py does in Docker. The picture, subtitles
// and other tracks are copied; only the mix is encoded.

export const CMD_VIDEOS = ['mp4', 'm4v', 'mov', 'mkv', 'webm'];

// A file name in double quotes, which every shell takes for ordinary names.
export const quote = (name) => `"${name.replace(/(["\\$`])/g, '\\$1')}"`;

// video, mix, out: file names; tracks: the video's audio tracks (0 when there are none).
// Returns { add, replace }, or null for a file ffmpeg can't put the mix in this way.
export function ffmpegCommands({ video, mix, out, tracks = 1 }) {
  const ext = video.split('.').pop().toLowerCase();
  if (!CMD_VIDEOS.includes(ext)) return null;
  const n = Math.max(0, tracks);
  // WebM holds only Opus or Vorbis.
  const codec = (k) => (ext === 'webm' ? `-c:a:${k} libopus -b:a:${k} 192k` : `-c:a:${k} aac -b:a:${k} 256k`);
  const start = `ffmpeg -i ${quote(video)} -i ${quote(mix)}`;
  const subs = ext === 'mkv' ? '-map 0:s? -map 0:t?' : '-map 0:s?';
  return {
    add: `${start} -map 0:v -map 0:a? -map 1:a ${subs} -c copy ${codec(n)} ` +
      `-metadata:s:a:${n} title="Audio description" -disposition:a:${n} visual_impaired+descriptions ${quote(out)}`,
    replace: `${start} -map 0:v -map 1:a ${subs} -c copy ${codec(0)} -disposition:a:0 default ${quote(out)}`,
  };
}
