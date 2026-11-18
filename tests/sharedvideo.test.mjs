import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEALED, PLAIN, TAG, PER_UPLOAD, pieceCount, sealedSize, piece, uploadCount, uploadPieces, nonce, seal, open,
  newKey, importKey, videoInfo, readVideoInfo, cleanName, isShared, sameVideo, resumeFrom, roomFor, SPARE, sizeText, driveRoom, fullText, videoStep,
} from '../app/js/sharedvideo.js';
import { videoText } from '../app/js/sharedialog.js';
import { SharedProject } from '../app/js/shared.js';

const MB = 1024 * 1024;

test('a sealed piece is exactly 4 MiB, so uploads fall on 256 KiB edges', () => {
  assert.equal(SEALED, 4 * MB);
  assert.equal(PLAIN + TAG, SEALED);
  assert.equal((SEALED * PER_UPLOAD) % (256 * 1024), 0);
});

test('pieces cover the whole video, and only the last is short', () => {
  for (const size of [1, PLAIN - 1, PLAIN, PLAIN + 1, 3 * PLAIN, 10 * PLAIN + 12345]) {
    const n = pieceCount(size);
    let plain = 0, sealed = 0;
    for (let i = 0; i < n; i++) {
      const p = piece(i, size);
      assert.equal(p.start, plain);
      assert.equal(p.at, sealed);
      assert.equal(p.last, i === n - 1);
      if (!p.last) assert.equal(p.sealed, SEALED);
      plain += p.plain; sealed += p.sealed;
    }
    assert.equal(plain, size);
    assert.equal(sealed, sealedSize(size));
  }
});

test('upload requests carry whole pieces, and all but the last are whole 256 KiB multiples', () => {
  const size = 9 * PLAIN + 777;
  const n = uploadCount(size);
  assert.equal(n, Math.ceil(10 / PER_UPLOAD));
  let at = 0;
  for (let i = 0; i < n; i++) {
    const u = uploadPieces(i, size);
    assert.equal(u.at, at);
    if (i < n - 1) assert.equal((u.end - u.at) % (256 * 1024), 0);
    at = u.end;
  }
  assert.equal(at, sealedSize(size));
});

test('each piece has its own nonce', () => {
  const seen = new Set();
  for (const i of [0, 1, 2, 255, 256, 2 ** 32, 2 ** 32 + 1]) seen.add(nonce(i).join(','));
  assert.equal(seen.size, 7);
});

test('a piece opens only as the piece it was sealed as', async () => {
  const key = await importKey(newKey());
  const bytes = new TextEncoder().encode('a frame of video');
  const sealed = await seal(key, 3, false, bytes);
  assert.equal(sealed.length, bytes.length + TAG);
  assert.deepEqual(await open(key, 3, false, sealed), bytes);
  await assert.rejects(open(key, 4, false, sealed), 'moved');
  await assert.rejects(open(key, 3, true, sealed), 'taken for the last, as if the rest were cut off');
  await assert.rejects(open(await importKey(newKey()), 3, false, sealed), 'another key');
  const bad = sealed.slice(); bad[0] ^= 1;
  await assert.rejects(open(key, 3, false, bad), 'changed');
});

test('what the project says about its video is checked as it’s read', () => {
  const info = videoInfo({ id: '1AbCdEfGhIjKlMnOp', key: newKey(), name: 'Film/cut:1.mp4', size: 123456, type: 'video/mp4', duration: 61.5 }, 5);
  assert.equal(info.name, 'Film-cut-1.mp4');
  assert.deepEqual(readVideoInfo(JSON.stringify(info)), info);
  assert.equal(readVideoInfo(''), null);
  assert.equal(readVideoInfo('{nope'), null);
  assert.equal(readVideoInfo({ ...info, v: 2 }), null);
  assert.equal(readVideoInfo({ ...info, id: '../x' }), null);
  assert.equal(readVideoInfo({ ...info, key: 'short' }), null);
  assert.equal(readVideoInfo({ ...info, size: -1 }), null);
  assert.equal(readVideoInfo({ ...info, size: 1.5 }), null);
  assert.equal(readVideoInfo({ ...info, name: '' }), null);
  assert.equal(readVideoInfo({ ...info, duration: 'long' }).duration, null);
  assert.equal(readVideoInfo({ ...info, name: '../../etc' }).name, '-..-etc');
});

test('file names are safe in Drive and the browser’s storage', () => {
  assert.equal(cleanName('.done'), 'done');
  assert.equal(cleanName(''), 'video');
  assert.equal(cleanName('a\u0000b?.mp4'), 'a-b-.mp4');
  assert.equal(cleanName('x'.repeat(300)).length, 200);
});

test('the open video is the shared one by its name and size', () => {
  const info = readVideoInfo(videoInfo({ id: '1AbCdEfGhIjKlMnOp', key: newKey(), name: 'Pilot: final.mp4', size: 10 }));
  assert.equal(isShared(info, { name: 'Pilot: final.mp4', size: 10 }), true);
  assert.equal(isShared(info, { name: 'Pilot- final.mp4', size: 10 }), true);
  assert.equal(isShared(info, { name: 'Pilot: final.mp4', size: 11 }), false);
  assert.equal(isShared(null, { name: 'x', size: 1 }), false);
  assert.equal(sameVideo(info, { ...info }), true);
  assert.equal(sameVideo(info, { ...info, key: newKey() }), false);
});

test('a download carries on from the last whole piece', () => {
  const size = 5 * PLAIN + 10;
  assert.equal(resumeFrom(0, size), 0);
  assert.equal(resumeFrom(PLAIN - 1, size), 0);
  assert.equal(resumeFrom(PLAIN, size), 1);
  assert.equal(resumeFrom(3 * PLAIN + 5, size), 3);
  assert.equal(resumeFrom(size, size), pieceCount(size));
});

test('a download needs room, with some to spare', () => {
  assert.equal(roomFor(1e9, 0, { quota: 2e9, usage: 0 }), true);
  assert.equal(roomFor(1e9, 0, { quota: 1e9 + SPARE - 1, usage: 0 }), false);
  assert.equal(roomFor(1e9, 6e8, { quota: 1e9, usage: 0 }), true, 'counts what’s already in');
  assert.equal(roomFor(1e9, 0, null), true, 'unknown: try');
});

test('sizes read as MB or GB', () => {
  assert.equal(sizeText(2_400_000_000), '2.4 GB');
  assert.equal(sizeText(350_000_000), '350 MB');
  assert.equal(sizeText(10), '1 MB');
});

test('the shared project carries the video, and tells others when it changes', () => {
  const a = new SharedProject(), b = new SharedProject();
  a.onUpdate((doc, u, origin) => { if (origin !== 'remote') b.apply(doc, u); });
  const seen = [];
  b.onVideo((v) => seen.push(v));
  const text = JSON.stringify(videoInfo({ id: '1AbCdEfGhIjKlMnOp', key: newKey(), name: 'Pilot.mp4', size: 99 }));
  a.setVideo(text);
  assert.equal(b.video(), text);
  a.setVideo('');
  assert.equal(b.video(), '');
  assert.deepEqual(seen, [text, '']);
});

test('the Share window says what can be done with the video', () => {
  assert.equal(videoText({ available: false }), null, 'not set up here: nothing shows');
  assert.equal(videoText({ available: true, drive: false }).connect, true);
  assert.match(videoText({ available: true, drive: true, open: null }).info, /Open the video/);
  const send = videoText({ available: true, drive: true, open: { name: 'Pilot.mp4', size: 2_400_000_000 } });
  assert.match(send.info, /Send Pilot\.mp4 \(2\.4 GB\)/);
  assert.equal(send.toggle, true);
  const shared = { name: 'Pilot.mp4', size: 2_400_000_000 };
  assert.equal(videoText({ available: true, drive: true, open: { name: 'Pilot.mp4', size: 2_400_000_000 }, shared }).swap, false);
  const other = videoText({ available: true, drive: true, open: { name: 'Pilot v2.mp4', size: 5 }, shared });
  assert.equal(other.swap, true);
  assert.match(other.info, /You have Pilot v2\.mp4 open/);
  assert.match(videoText({ available: true, drive: true, sending: true, open: { name: 'Pilot.mp4', size: 1 } }).info, /^Sending Pilot\.mp4/);
});

test('a video is only sent when the owner’s Drive has room for it', () => {
  assert.deepEqual(driveRoom(2e9, { limit: 15e9, usage: 12e9 }), { ok: true, free: 3e9 });
  assert.deepEqual(driveRoom(2e9, { limit: 15e9, usage: 14e9 }), { ok: false, free: 1e9 });
  assert.deepEqual(driveRoom(2e9, { limit: 15e9, usage: 16e9 }), { ok: false, free: 0 }, 'over the limit already');
  assert.equal(driveRoom(2e9, { limit: null, usage: 99e9 }).ok, true, 'no limit');
  assert.equal(driveRoom(2e9, null).ok, true, 'Drive didn’t say: try, and Drive refuses if it must');
});

test('a full Drive says how much is needed and what to do', () => {
  assert.equal(fullText(2.4e9, 1.1e9), 'There isn’t room in your Google Drive. The video needs 2.4 GB, and 1.1 GB is free. Free up space in Drive, or send a smaller copy, such as 720p');
  assert.match(fullText(2.4e9, 0), /needs 2\.4 GB, and it’s full\./);
  assert.match(fullText(2.4e9), /needs 2\.4 GB\. Free up space/);
});

test('the video sent is found for the owner too, not only for those it’s shared with', () => {
  const info = readVideoInfo(videoInfo({ id: 'abcdefghijk', key: 'A'.repeat(43), name: 'Pilot.mp4', size: 10 }));
  const same = { name: 'Pilot.mp4', size: 10 }, other = { name: 'Other.mp4', size: 20 };
  assert.equal(videoStep({ info: null, owner: true }), 'clear');
  assert.equal(videoStep({ info, owner: true }), 'find', 'the owner opens the project with no video');
  assert.equal(videoStep({ info, owner: false }), 'find');
  assert.equal(videoStep({ info, owner: true, open: same }), 'have');
  assert.equal(videoStep({ info, owner: false, open: other, changed: true }), 'tell');
  assert.equal(videoStep({ info, owner: true, open: other, changed: true }), 'leave', 'the owner sent it, so isn’t told');
  assert.equal(videoStep({ info, owner: false, open: other }), 'leave');
});
