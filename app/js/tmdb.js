// Looking up a programme's cast on TMDB (The Movie Database), for the project notes: from
// an IMDb link, which TMDB knows, or a title. People use their own free TMDB key. Only the
// IMDb ID or the title is sent, and only when they click Look up.
//
// This product uses the TMDB API but is not endorsed or certified by TMDB.

export const API = 'https://api.themoviedb.org/3';
export const KEY_PAGE = 'https://www.themoviedb.org/settings/api';
const MAX_CAST = 20, MAX_GUESTS = 15;

// The IMDb ID in a link or on its own, such as tt0118276, or null.
export function imdbId(text) {
  return String(text).match(/\b(tt\d{6,10})\b/)?.[1] || null;
}

// TMDB takes two kinds of key: a long read access token, sent as a header, or a short
// API key, sent in the address.
export function auth(key) {
  const k = String(key).trim();
  return /^eyJ/.test(k) ? { headers: { Authorization: `Bearer ${k}` }, query: {} } : { headers: {}, query: { api_key: k } };
}

const year = (date) => (date ? String(date).slice(0, 4) : '');
const firstSentence = (s) => (String(s || '').match(/^.*?[.!?](?=\s|$)/)?.[0] || String(s || '')).trim();
// "Character (Actor)" for each, in billing order, skipping people playing themselves and
// anyone listed twice.
function castLines(people, max) {
  const seen = new Set(), out = [];
  for (const p of people) {
    const character = String(p.character ?? p.roles?.map((r) => r.character).filter(Boolean).join(' / ') ?? '')
      .replace(/\s*\((voice|uncredited)\)/gi, '').trim();
    if (!character || /^(self|himself|herself|themselves)\b/i.test(character)) continue;
    const line = `- ${character} (${p.name})`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}
const byOrder = (list = []) => [...list].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

// Notes from what TMDB returned: { title, text }.
export function castNotes(found) {
  const genres = (g) => (g?.length ? ` ${g.map((x) => x.name).join(', ')}.` : '');
  if (found.kind === 'movie') {
    const m = found.data;
    const title = `${m.title}${m.release_date ? ` (${year(m.release_date)})` : ''}`;
    return { title, text: [`${title}.${genres(m.genres)}`, firstSentence(m.overview), 'Characters:', ...castLines(byOrder(m.credits?.cast), MAX_CAST)].filter(Boolean).join('\n') };
  }
  if (found.kind === 'tv') {
    const t = found.data;
    const span = [year(t.first_air_date), t.in_production ? '' : year(t.last_air_date)].filter(Boolean);
    const title = `${t.name}${span.length ? ` (${[...new Set(span)].join('–')})` : ''}`;
    return { title, text: [`${title}, TV series.${genres(t.genres)}`, firstSentence(t.overview), 'Characters:', ...castLines(byOrder(t.aggregate_credits?.cast), MAX_CAST)].filter(Boolean).join('\n') };
  }
  const { show, ep } = found;
  const title = `${show.name}, season ${ep.season_number}, episode ${ep.episode_number}: “${ep.name}”`;
  const guests = castLines(byOrder(ep.credits?.guest_stars || ep.guest_stars), MAX_GUESTS);
  return {
    title,
    text: [`${title}${ep.air_date ? ` (${year(ep.air_date)})` : ''}.${genres(show.genres)}`, firstSentence(ep.overview || show.overview),
      'Characters:', ...castLines(byOrder(ep.credits?.cast), MAX_CAST), ...(guests.length ? ['Guest characters:', ...guests] : [])].filter(Boolean).join('\n'),
  };
}

// Looks a programme up from an IMDb link or a title, and returns its notes.
export async function lookup(query, key, fetchFn = fetch) {
  const get = async (path, params = {}) => {
    const { headers, query: q } = auth(key);
    const url = new URL(API + path);
    for (const [k, v] of Object.entries({ ...params, ...q })) url.searchParams.set(k, v);
    const r = await fetchFn(url.href, { headers });
    if (r.status === 401) throw new Error('TMDB didn’t accept the key');
    if (!r.ok) throw new Error(`TMDB answered ${r.status}`);
    return r.json();
  };
  const tt = imdbId(query);
  if (tt) {
    const f = await get(`/find/${tt}`, { external_source: 'imdb_id' });
    const e = f.tv_episode_results?.[0];
    if (e) {
      const [show, ep] = await Promise.all([get(`/tv/${e.show_id}`), get(`/tv/${e.show_id}/season/${e.season_number}/episode/${e.episode_number}`, { append_to_response: 'credits' })]);
      return castNotes({ kind: 'episode', show, ep });
    }
    if (f.movie_results?.[0]) return castNotes({ kind: 'movie', data: await get(`/movie/${f.movie_results[0].id}`, { append_to_response: 'credits' }) });
    if (f.tv_results?.[0]) return castNotes({ kind: 'tv', data: await get(`/tv/${f.tv_results[0].id}`, { append_to_response: 'aggregate_credits' }) });
    throw new Error('TMDB doesn’t have that IMDb title');
  }
  const s = await get('/search/multi', { query: String(query).trim(), include_adult: 'false' });
  const hit = (s.results || []).find((x) => x.media_type === 'movie' || x.media_type === 'tv');
  if (!hit) throw new Error(`Nothing on TMDB called “${String(query).trim()}”`);
  return hit.media_type === 'movie'
    ? castNotes({ kind: 'movie', data: await get(`/movie/${hit.id}`, { append_to_response: 'credits' }) })
    : castNotes({ kind: 'tv', data: await get(`/tv/${hit.id}`, { append_to_response: 'aggregate_credits' }) });
}
