import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movieHash, guessFromName, headers, searchUrl, resultOf, ranked, search, download, signIn, API } from '../app/js/opensubtitles.js';

// A stand-in for a File: just size and slice().arrayBuffer().
const fakeFile = (bytes) => ({
  size: bytes.length,
  slice: (a, b) => ({ arrayBuffer: async () => bytes.slice(a, b).buffer }),
});

test('hashes a file the way OpenSubtitles does', async () => {
  const size = 200000, bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  // The same sum, done the slow way.
  let want = BigInt(size);
  const v = new DataView(bytes.buffer);
  for (let i = 0; i < 65536; i += 8) want += v.getBigUint64(i, true) + v.getBigUint64(size - 65536 + i, true);
  want &= 0xffffffffffffffffn;
  assert.equal(await movieHash(fakeFile(bytes)), want.toString(16).padStart(16, '0'));
  assert.equal(await movieHash(fakeFile(new Uint8Array(1000))), null);
});

test('hashes only the two ends, not the whole file', async () => {
  const read = [];
  const file = { size: 4e9, slice: (a, b) => { read.push(b - a); return { arrayBuffer: async () => new ArrayBuffer(b - a) }; } };
  assert.equal(await movieHash(file), (4e9).toString(16).padStart(16, '0'));
  assert.deepEqual(read, [65536, 65536]);
});

test('guesses the title, season and episode from a file name', () => {
  assert.deepEqual(guessFromName('Are.You.Afraid.of.the.Dark.S01E01.720p.WEB-DL.mkv'), { query: 'Are You Afraid of the Dark', season: '1', episode: '1', year: '' });
  assert.deepEqual(guessFromName('Sing 2 (2021) 1080p BluRay.mp4'), { query: 'Sing 2', season: '', episode: '', year: '2021' });
  assert.deepEqual(guessFromName('the_matrix_1999.mkv'), { query: 'the matrix', season: '', episode: '', year: '1999' });
  assert.deepEqual(guessFromName('Show Name 2x05.mp4'), { query: 'Show Name', season: '2', episode: '5', year: '' });
  assert.deepEqual(guessFromName('1917.mp4'), { query: '1917', season: '', episode: '', year: '' });
});

test('sends the key and app name, and the sign-in when there is one', () => {
  assert.deepEqual(headers({ key: ' abc ', app: 'Scribecue v1' }), { 'Api-Key': 'abc', 'X-User-Agent': 'Scribecue v1', Accept: 'application/json' });
  assert.equal(headers({ key: 'abc', app: 'x', token: 'tok' }).Authorization, 'Bearer tok');
});

test('search addresses are sorted and in lower case', () => {
  assert.equal(searchUrl({ query: 'The Matrix', languages: 'en', year: '', moviehash: undefined }),
    `${API}/subtitles?languages=en&query=the+matrix`);
  assert.equal(searchUrl({ type: 'episode', query: 'Buffy', episode_number: '2', season_number: '1', languages: 'en' }),
    `${API}/subtitles?episode_number=2&languages=en&query=buffy&season_number=1&type=episode`);
});

const raw = (id, a = {}) => ({ id: String(id), attributes: {
  language: 'en', download_count: 100, release: `Release ${id}`, fps: 23.976, hearing_impaired: false, moviehash_match: false,
  feature_details: { feature_type: 'Movie', title: 'The Matrix', year: 1999 },
  files: [{ file_id: id, file_name: `${id}.srt` }], ...a,
} });

test('results name the film or the episode', () => {
  assert.equal(resultOf(raw(1)).title, 'The Matrix (1999)');
  const ep = resultOf(raw(2, { feature_details: { feature_type: 'Episode', parent_title: 'Buffy', season_number: 1, episode_number: 2, title: 'The Harvest' } }));
  assert.equal(ep.title, 'Buffy, season 1, episode 2: “The Harvest”');
  assert.equal(resultOf({ attributes: { files: [] } }), null);
});

test('ranks hash matches first, machine translations last, then by downloads, each file once', () => {
  const list = ranked([
    [resultOf(raw(1, { moviehash_match: true, download_count: 5 }))],
    [resultOf(raw(1)), resultOf(raw(2, { download_count: 900, machine_translated: true })), resultOf(raw(3, { download_count: 50 })), resultOf(raw(4, { download_count: 500 }))],
  ]);
  assert.deepEqual(list.map((r) => [r.fileId, r.matches]), [[1, true], [4, false], [3, false], [2, false]]);
});

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => body });

test('searches by hash and by title together', async () => {
  const calls = [];
  const got = await search({ key: 'k', app: 'a', hash: 'abc', query: 'Buffy', season: '1', episode: '2', language: 'en' }, async (url, init) => {
    calls.push(url);
    assert.equal(init.headers['Api-Key'], 'k');
    return reply(200, { data: url.includes('moviehash') ? [raw(7, { moviehash_match: true, download_count: 1 })] : [raw(8, { download_count: 9 })] });
  });
  assert.deepEqual(calls, [
    `${API}/subtitles?languages=en&moviehash=abc`,
    `${API}/subtitles?episode_number=2&languages=en&query=buffy&season_number=1&type=episode`,
  ]);
  assert.deepEqual(got.map((r) => r.fileId), [7, 8]);
});

test('a refused key and a run-out sign-in are told apart', async () => {
  await assert.rejects(search({ key: 'bad', app: 'a', query: 'x' }, async () => reply(401, { message: 'You cannot consume this service' })), (e) => e.auth === 'key');
  await assert.rejects(download(1, { key: 'k', app: 'a', token: 't' }, async () => reply(401, { message: 'invalid token' })), (e) => e.auth === 'token');
});

test('downloads as SRT, and says how many downloads are left', async () => {
  const calls = [];
  const got = await download(42, { key: 'k', app: 'a' }, async (url, init) => {
    calls.push([url, init?.method, init?.body]);
    return url.endsWith('/download') ? reply(200, { link: 'https://www.opensubtitles.com/download/x.srt', remaining: 4 }) : reply(200, '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
  });
  assert.deepEqual(calls[0], [`${API}/download`, 'POST', JSON.stringify({ file_id: 42, sub_format: 'srt' })]);
  assert.equal(calls[1][0], 'https://www.opensubtitles.com/download/x.srt');
  assert.deepEqual(got, { text: '1\n00:00:01,000 --> 00:00:02,000\nHi\n', remaining: 4 });
});

test('out of downloads for today says so', async () => {
  await assert.rejects(download(1, { key: 'k', app: 'a' }, async () => reply(406, { message: 'You have downloaded your allowed 5 subtitles for 24h' })),
    (e) => e.quota && /allowed 5/.test(e.message));
});

test('signing in keeps the token and the address to use, never the password', async () => {
  const got = await signIn('kyle', 'secret', { key: 'k', app: 'a' }, async (url, init) => {
    assert.equal(url, `${API}/login`);
    assert.deepEqual(JSON.parse(init.body), { username: 'kyle', password: 'secret' });
    return reply(200, { token: 'tok', base_url: 'vip-api.opensubtitles.com', user: { username: 'kyle', allowed_downloads: 20 } });
  });
  assert.deepEqual(got, { token: 'tok', user: 'kyle', allowed: 20, base: 'https://vip-api.opensubtitles.com/api/v1' });
  assert.ok(!JSON.stringify(got).includes('secret'));
  const odd = await signIn('k', 'p', { key: 'k', app: 'a' }, async () => reply(200, { token: 't', base_url: 'evil.example.com' }));
  assert.equal(odd.base, API);
  await assert.rejects(signIn('k', 'wrong', { key: 'k', app: 'a' }, async () => reply(401, {})), /username and password/);
});
