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

// A copy of the video with the script and the timecode burnt in, as ffmpeg/server.py makes
// it, for people with ffmpeg of their own. opts: { subs, timecode, size, height }, height being
// the most lines the picture keeps (480, 720 or 1080), or 0 for the video's own size. rate: the
// frame rate as ffmpeg writes it, such as 30000/1001. srt: a file name of letters, digits,
// spaces, dots, dashes and underscores, which needs no escaping in a filter.
// The script looks as it does over the video (see ffmpeg/server.py): size, bg and pos are
// the "Text over the video" settings.
export const BURN_HEIGHTS = [0, 480, 720, 1080];
export const scaleTo = (h) => `scale=-2:min(${h}\\,trunc(ih/2)*2)`;
export const BURN_SIZES = { s: 16, m: 20, l: 25, xl: 30 };
const BOXES = { none: null, light: '8C', dark: '40', solid: '00' };
export function scriptStyle({ size = 'm', bg = 'none', pos = 'bottom' }) {
  const box = BOXES[bg] ?? null;
  const look = box === null ? ['BorderStyle=1', 'OutlineColour=&H00000000&', 'BackColour=&H80000000&', 'Outline=2', 'Shadow=3']
    : ['BorderStyle=3', `OutlineColour=&H${box}000000&`, 'BackColour=&HFF000000&', 'Outline=2', 'Shadow=0'];
  return [`FontSize=${BURN_SIZES[size] ?? 20}`, 'PrimaryColour=&H00FFFFFF&', ...look, `Alignment=${pos === 'top' ? 8 : 2}`,
    'MarginV=50', 'MarginL=12', 'MarginR=12'];
}
export function burnFilter(opts, rate, srt) {
  const { subs, timecode, height } = opts;
  const parts = [];
  if (BURN_HEIGHTS.includes(height) && height) parts.push(scaleTo(height));
  if (timecode) {
    const drop = rate === '30000/1001' || rate === '60000/1001';
    parts.push(`drawtext=font=monospace:timecode='00\\:00\\:00\\${drop ? ';' : ':'}00':rate=${rate}` +
      ':fontsize=h/24:fontcolor=white:x=h/72:y=h/72:box=1:boxcolor=black@0.67:boxborderw=6');
  }
  if (subs) {
    const style = scriptStyle(opts).join('\\,');
    parts.push(`subtitles=filename='${srt}':force_style='${style}'`);
  }
  parts.push('format=yuv420p');
  return parts.join(',');
}
export function burnCommand({ video, srt, out, opts, rate, track = 0 }) {
  return `ffmpeg -i ${quote(video)} -vf "${burnFilter(opts, rate, srt)}" -map 0:v:0 -map "0:a:${track}?" ` +
    `-c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 192k -movflags +faststart ${quote(out)}`;
}
// A frame rate as ffmpeg writes it: 29.97 as 30000/1001.
export function ffRate(fps) {
  for (const n of [24, 30, 48, 60]) if (Math.abs(fps - n * 1000 / 1001) < 0.005) return `${n * 1000}/1001`;
  return Number.isInteger(fps) ? `${fps}/1` : `${Math.round(fps * 1000)}/1000`;
}
// A file name safe to put in a filter as it is.
export const plainName = (name) => name.replace(/[^\w .-]/g, '_').replace(/^[.\s]+/, '') || 'script';
