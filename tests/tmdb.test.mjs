import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imdbId, auth, castNotes, lookup, API } from '../app/js/tmdb.js';

test('finds the IMDb ID in a link or on its own', () => {
  assert.equal(imdbId('https://www.imdb.com/title/tt0118276/?ref_=nv_sr_srsg_0'), 'tt0118276');
  assert.equal(imdbId('m.imdb.com/title/tt12345678/'), 'tt12345678');
  assert.equal(imdbId('tt0118276'), 'tt0118276');
  assert.equal(imdbId('Buffy the Vampire Slayer'), null);
});

test('sends either kind of TMDB key the way TMDB expects', () => {
  assert.deepEqual(auth('eyJhbGciOi.abc.def'), { headers: { Authorization: 'Bearer eyJhbGciOi.abc.def' }, query: {} });
  assert.deepEqual(auth(' 0123456789abcdef0123456789abcdef '), { headers: {}, query: { api_key: '0123456789abcdef0123456789abcdef' } });
});

const series = {
  name: 'Buffy the Vampire Slayer', first_air_date: '1997-03-10', last_air_date: '2003-05-20', in_production: false,
  genres: [{ name: 'Drama' }], overview: 'A young woman fights vampires. She has help.',
  aggregate_credits: { cast: [
    { name: 'Anthony Stewart Head', order: 1, roles: [{ character: 'Rupert Giles' }] },
    { name: 'Sarah Michelle Gellar', order: 0, roles: [{ character: 'Buffy Summers' }] },
    { name: 'Joss Whedon', order: 5, roles: [{ character: 'Himself' }] },
  ] },
};

test('notes list the characters in billing order, without people playing themselves', () => {
  const { title, text } = castNotes({ kind: 'tv', data: series });
  assert.equal(title, 'Buffy the Vampire Slayer (1997–2003)');
  assert.equal(text, [
    'Buffy the Vampire Slayer (1997–2003), TV series. Drama.',
    'A young woman fights vampires.',
    'Characters:',
    '- Buffy Summers (Sarah Michelle Gellar)',
    '- Rupert Giles (Anthony Stewart Head)',
  ].join('\n'));
});

test('an IMDb link for an episode adds its guest cast', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname.replace('/3', '');
    const body = {
      '/find/tt0533447': { tv_episode_results: [{ show_id: 95, season_number: 2, episode_number: 3 }], movie_results: [], tv_results: [] },
      '/tv/95': series,
      '/tv/95/season/2/episode/3': { name: 'School Hard', season_number: 2, episode_number: 3, air_date: '1997-09-29', overview: 'Spike arrives.',
        credits: { cast: [{ name: 'Sarah Michelle Gellar', character: 'Buffy Summers', order: 0 }], guest_stars: [{ name: 'James Marsters', character: 'Spike', order: 0 }] } },
    }[path];
    return { ok: !!body, status: body ? 200 : 404, json: async () => body };
  };
  const { title, text } = await lookup('https://www.imdb.com/title/tt0533447/', 'eyJtoken', fake);
  assert.equal(title, 'Buffy the Vampire Slayer, season 2, episode 3: “School Hard”');
  assert.match(text, /Characters:\n- Buffy Summers \(Sarah Michelle Gellar\)\nGuest characters:\n- Spike \(James Marsters\)/);
  // Only TMDB is contacted, with the IMDb ID, and the key goes as a header.
  assert.ok(calls.every((c) => c.url.startsWith(API)));
  assert.match(calls[0].url, /\/find\/tt0533447\?external_source=imdb_id$/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer eyJtoken');
});

test('says when the key is wrong, or the title isn’t found', async () => {
  const deny = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(lookup('tt0118276', 'bad', deny), /didn’t accept the key/);
  const none = async () => ({ ok: true, status: 200, json: async () => ({ results: [{ media_type: 'person', id: 1 }] }) });
  await assert.rejects(lookup('Nonexistent Show', 'k', none), /Nothing on TMDB called “Nonexistent Show”/);
});
