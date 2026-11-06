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

// The filter that holds the picture at each pause, as ffmpeg/server.py makes it, for a file
// of its own: a film's pauses make it too long for a command. pauses: [{ at, secs }].
const sums = (t) => (t.length < 2 ? t[0] ?? '0' : `(${sums(t.slice(0, t.length >> 1))}+${sums(t.slice(t.length >> 1))})`);
export function holdFilter(pauses) {
  const moved = sums(pauses.map(({ at, secs }) => `gte(T\\,${at.toFixed(6)})*${secs.toFixed(6)}`));
  return `[0:v:0]setpts=PTS-STARTPTS+${moved}/TB,fps=fps=source_fps:start_time=0,tpad=stop=-1:stop_mode=clone,format=yuv420p[v]\n`;
}

// Makes an extended video from the video, the mix and that file. The picture has to be
// encoded again, and it stops with the sound.
export function extendedCommand({ video, mix, filter, out }) {
  const coded = out.toLowerCase().endsWith('.webm')
    ? '-c:v libvpx-vp9 -deadline realtime -cpu-used 6 -row-mt 1 -b:v 0 -crf 30 -c:a libopus -b:a 192k'
    : '-c:v libx264 -preset veryfast -crf 18 -c:a aac -b:a 256k';
  return `ffmpeg -i ${quote(video)} -i ${quote(mix)} -filter_complex_script ${quote(filter)} -map "[v]" -map 1:a ${coded} -shortest ${quote(out)}`;
}
