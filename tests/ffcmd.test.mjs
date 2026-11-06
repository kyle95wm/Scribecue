// The ffmpeg commands shown after a full mix export, for putting it in the video with
// ffmpeg of one's own. They should match what ffmpeg/server.py does in Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegCommands, quote, CMD_VIDEOS, holdFilter, extendedCommand } from '../app/js/ffcmd.js';

const names = { mix: 'Film - full mix.wav', out: 'Film - with audio description.mp4' };

test('an extra track goes after the video’s own, and is marked as audio description', () => {
  const { add } = ffmpegCommands({ video: 'Film.mp4', ...names, tracks: 1 });
  assert.equal(add, 'ffmpeg -i "Film.mp4" -i "Film - full mix.wav" -map 0:v -map 0:a? -map 1:a -map 0:s? -c copy ' +
    '-c:a:1 aac -b:a:1 256k -metadata:s:a:1 title="Audio description" -disposition:a:1 visual_impaired+descriptions ' +
    '"Film - with audio description.mp4"');
  assert.match(ffmpegCommands({ video: 'Film.mp4', ...names, tracks: 3 }).add, /-c:a:3 aac .* -disposition:a:3 /);
  assert.match(ffmpegCommands({ video: 'Film.mp4', ...names, tracks: 0 }).add, /-c:a:0 aac .* -disposition:a:0 /);
});

test('in place of the sound, the mix is the only audio track', () => {
  const { replace } = ffmpegCommands({ video: 'Film.MOV', ...names, tracks: 2 });
  assert.match(replace, /-map 0:v -map 1:a -map 0:s\? -c copy -c:a:0 aac -b:a:0 256k -disposition:a:0 default /);
  assert.doesNotMatch(replace, /0:a/);
});

test('WebM gets Opus, MKV keeps its attachments, and other files get no commands', () => {
  assert.match(ffmpegCommands({ video: 'a.webm', ...names }).add, /-c:a:1 libopus -b:a:1 192k/);
  assert.match(ffmpegCommands({ video: 'a.mkv', ...names }).replace, /-map 0:s\? -map 0:t\?/);
  assert.equal(ffmpegCommands({ video: 'a.avi', ...names }), null);
  assert.equal(ffmpegCommands({ video: 'a.mp3', ...names }), null);
  assert.deepEqual(CMD_VIDEOS, ['mp4', 'm4v', 'mov', 'mkv', 'webm']);
});

test('names are quoted so the shell takes them as they are', () => {
  assert.equal(quote('My "big" $film`.mp4'), '"My \\"big\\" \\$film\\`.mp4"');
  assert.equal(quote('Plain name.mp4'), '"Plain name.mp4"');
});

test('the filter that holds the picture adds up the pauses it has passed', () => {
  const f = holdFilter([{ at: 5, secs: 2.5 }, { at: 9.25, secs: 1 }]);
  assert.ok(f.startsWith('[0:v:0]setpts=PTS-STARTPTS+(gte(T\\,5.000000)*2.500000+gte(T\\,9.250000)*1.000000)/TB,'), f);
  assert.ok(f.endsWith('tpad=stop=-1:stop_mode=clone,format=yuv420p[v]\n'), f);
});

test('the extended video command uses the filter file and suits the container', () => {
  const c = extendedCommand({ video: 'a b.mp4', mix: 'mix.wav', filter: 'p.txt', out: 'out.mp4' });
  assert.ok(c.startsWith('ffmpeg -i "a b.mp4" -i "mix.wav" -filter_complex_script "p.txt" -map "[v]" -map 1:a -c:v libx264'), c);
  assert.match(extendedCommand({ video: 'a.webm', mix: 'm.wav', filter: 'p.txt', out: 'o.webm' }), /libvpx-vp9.*libopus/);
});
