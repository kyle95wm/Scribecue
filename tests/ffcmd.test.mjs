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

import { burnFilter, burnCommand, ffRate, plainName } from '../app/js/ffcmd.js';

test('burn in: smaller first, then the timecode, then the script, as the server does', () => {
  const vf = burnFilter({ subs: true, timecode: true, size: 'l', bg: 'none', pos: 'top', height: 720 }, '25/1', 'Film.srt');
  const order = ['scale=', 'drawtext=', 'subtitles=', 'format=yuv420p'].map((k) => vf.indexOf(k));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!order.includes(-1));
  assert.match(vf, /timecode='00\\:00\\:00\\:00':rate=25\/1/);
  assert.match(vf, /filename='Film.srt'/);
  assert.match(vf, /FontSize=25/);
  assert.match(vf, /BorderStyle=1/);
  assert.match(vf, /Alignment=8/);
});

test('burn in: only what was asked for, and drop-frame timecode at 29.97 and 59.94', () => {
  assert.ok(!burnFilter({ timecode: true }, '25/1', 'x.srt').includes('subtitles='));
  assert.ok(!burnFilter({ subs: true }, '25/1', 'x.srt').includes('drawtext='));
  assert.ok(!burnFilter({ subs: true }, '25/1', 'x.srt').includes('scale='));
  assert.ok(!burnFilter({ subs: true, height: 0 }, '25/1', 'x.srt').includes('scale='));
  assert.ok(!burnFilter({ subs: true, height: 333 }, '25/1', 'x.srt').includes('scale='));
  assert.match(burnFilter({ timecode: true }, '30000/1001', 'x.srt'), /00\\;00/);
  assert.match(burnFilter({ timecode: true }, '60000/1001', 'x.srt'), /00\\;00/);
  assert.match(burnFilter({ timecode: true }, '24000/1001', 'x.srt'), /00\\:00'/);
});

test('burn in: the command quotes the names and the optional track, for zsh too', () => {
  const cmd = burnCommand({ video: 'My "film".mp4', srt: 'My _film_.srt', out: 'My film - subtitles.mp4', opts: { subs: true }, rate: '25/1', track: 1 });
  assert.match(cmd, /^ffmpeg -i "My \\"film\\".mp4" -vf "/);
  assert.match(cmd, /-map "0:a:1\?"/);
  assert.match(cmd, /"My film - subtitles.mp4"$/);
});

test('frame rates and names for a command', () => {
  assert.equal(ffRate(30000 / 1001), '30000/1001');
  assert.equal(ffRate(24000 / 1001), '24000/1001');
  assert.equal(ffRate(60000 / 1001), '60000/1001');
  assert.equal(ffRate(25), '25/1');
  assert.equal(ffRate(12.5), '12500/1000');
  assert.equal(plainName("Bob's film: part 1, [cut].srt"), 'Bob_s film_ part 1_ _cut_.srt');
  assert.equal(plainName('.hidden'), 'hidden');
});

import { readFileSync } from 'node:fs';
import { BURN_SIZES } from '../app/js/ffcmd.js';

test('the text over the video and the burnt-in script have the same proportions', () => {
  const css = readFileSync(new URL('../app/css/style.css', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../ffmpeg/server.py', import.meta.url), 'utf8');
  assert.match(css, /--u: calc\(100cqh \/ 288\)/);
  assert.match(css, /bottom: calc\(50 \* var\(--u\)\)/);
  assert.match(css, /font: calc\(20 \* var\(--u\) \* var\(--sub-scale\)\)/);
  assert.match(css, /left: 3\.125%/); // 12 of 384
  for (const [k, scale] of [['s', 0.8], ['l', 1.25], ['xl', 1.5]]) {
    assert.match(css, new RegExp(`data-sub-size="${k}"\\] \\{ --sub-scale: ${scale}; \\}`));
    assert.equal(BURN_SIZES[k], 20 * scale);
    assert.match(server, new RegExp(`"${k}": ${20 * scale}`));
  }
  // How opaque each background is: CSS alpha, and the ASS alpha (00 opaque, FF clear).
  for (const [k, alpha, hex] of [['light', 0.45, '8C'], ['dark', 0.75, '40']]) {
    assert.ok(css.includes(`[data-sub-bg="${k}"] { --sub-bg: rgba(0, 0, 0, ${alpha}); }`), k);
    assert.equal(Math.round((1 - alpha) * 255).toString(16).toUpperCase(), hex);
    assert.match(server, new RegExp(`"${k}": "${hex}"`));
  }
});

test('burn in: each resolution is a most, so a smaller video is never made bigger', () => {
  for (const h of [480, 720, 1080]) {
    assert.ok(burnFilter({ subs: true, height: h }, '25/1', 'x.srt').startsWith(`scale=-2:min(${h}\\,trunc(ih/2)*2),`), h);
  }
});
