// Subtitles from OpenSubtitles (opensubtitles.com), for the dialogue lane of a video that has
// none of its own. People use their own free API key, and can sign in to their account for
// more downloads a day. Only the video file's hash, its name's title, season and episode, and
// the language go to OpenSubtitles, and only when they search. The password is sent once, to
// sign in; only the sign-in's token is kept.

export const API = 'https://api.opensubtitles.com/api/v1';
export const KEY_PAGE = 'https://www.opensubtitles.com/en/consumers';
export const SITE = 'https://www.opensubtitles.com/';
const CHUNK = 65536;

// The languages offered, as OpenSubtitles names them.
export const LANGUAGES = [
  ['en', 'English'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['it', 'Italian'],
  ['pt-PT', 'Portuguese'], ['pt-BR', 'Portuguese (Brazil)'], ['nl', 'Dutch'], ['sv', 'Swedish'],
  ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['pl', 'Polish'], ['ja', 'Japanese'],
];

// OpenSubtitles' hash of a video file: its size plus the 64-bit sums of its first and last
// 64 KB. Only those two pieces are read, so a two-hour film is never in memory. null for a
// file too small to have one.
export async function movieHash(file) {
  const size = file.size;
  if (!(size >= CHUNK * 2)) return null;
  const sum = async (blob) => {
    const v = new DataView(await blob.arrayBuffer());
    let s = 0n;
    for (let i = 0; i < CHUNK; i += 8) s += v.getBigUint64(i, true);
    return s;
  };
  const h = (BigInt(size) + await sum(file.slice(0, CHUNK)) + await sum(file.slice(size - CHUNK, size))) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, '0');
}

// A title, and a season and episode or a year, from a video's file name, for searching:
// "Show.Name.S01E02.720p.mkv" or "Film Name (2019) 1080p.mp4".
export function guessFromName(name) {
  let base = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ');
  const out = { query: '', season: '', episode: '', year: '' };
  const ep = base.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) || base.match(/\b(\d{1,2})x(\d{2,3})\b/i);
  if (ep) {
    out.season = String(+ep[1]);
    out.episode = String(+ep[2]);
    base = base.slice(0, ep.index);
  } else {
    const y = base.match(/[([]?\b(19\d\d|20\d\d)\b[)\]]?/);
    if (y && y.index > 0) { out.year = y[1]; base = base.slice(0, y.index); }
  }
  // Everything after the first release word is the release, not the title.
  const cut = base.search(/\b(480p|576p|720p|1080p|2160p|4k|uhd|hdr|web[ -]?dl|webrip|bluray|blu[ -]ray|brrip|bdrip|dvdrip|hdtv|x26[45]|h ?26[45]|hevc|xvid|proper|repack|extended|remux|amzn|nf|dsnp)\b/i);
  if (cut > 0) base = base.slice(0, cut);
  out.query = base.replace(/[-–([\]]+\s*$/, '').replace(/\s+/g, ' ').trim();
  return out;
}

// What goes with every request. X-User-Agent stands in for User-Agent, which a browser
// doesn't let pages set.
export function headers({ key, token, app }) {
  const h = { 'Api-Key': String(key).trim(), 'X-User-Agent': app, Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// OpenSubtitles asks for the address's parameters sorted, and in lower case, so it doesn't
// have to redirect.
export function searchUrl(params, base = API) {
  const url = new URL(`${base}/subtitles`);
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v === '' || v == null) continue;
    url.searchParams.set(k, k === 'query' ? String(v).toLowerCase() : String(v));
  }
  return url.href;
}

// One result as Scribecue shows it.
export function resultOf(r) {
  const a = r.attributes || {}, f = a.feature_details || {}, file = a.files?.[0];
  if (!file?.file_id) return null;
  const title = f.feature_type === 'Episode' && f.parent_title
    ? `${f.parent_title}, season ${f.season_number}, episode ${f.episode_number}${f.title ? `: “${f.title}”` : ''}`
    : `${f.title || f.movie_name || 'Untitled'}${f.year ? ` (${f.year})` : ''}`;
  return {
    fileId: file.file_id,
    release: String(a.release || file.file_name || '').trim(),
    title,
    language: a.language || '',
    matches: !!a.moviehash_match,
    hearing: !!a.hearing_impaired,
    machine: !!(a.machine_translated || a.ai_translated),
    downloads: a.download_count || 0,
    fps: a.fps || 0,
  };
}

// Hash matches first, then by how often they've been downloaded; each file once.
export function ranked(lists) {
  const seen = new Set(), out = [];
  for (const r of lists.flat()) {
    if (!r || seen.has(r.fileId)) continue;
    seen.add(r.fileId);
    out.push(r);
  }
  return out.sort((a, b) => (b.matches - a.matches) || (a.machine - b.machine) || (b.downloads - a.downloads));
}

async function failure(r, what) {
  let msg = '';
  try { const j = await r.json(); msg = j.message || j.errors?.[0] || ''; } catch { /* not JSON */ }
  if (r.status === 401 || r.status === 403) {
    const e = new Error(/token/i.test(msg) ? 'Your OpenSubtitles sign-in has run out' : 'OpenSubtitles didn’t accept the key');
    e.auth = /token/i.test(msg) ? 'token' : 'key';
    return e;
  }
  if (r.status === 406 || (r.status === 429 && /download/i.test(msg))) {
    const e = new Error(msg || 'That’s all the downloads OpenSubtitles allows today');
    e.quota = true;
    return e;
  }
  if (r.status === 429) return new Error('OpenSubtitles is busy. Try again in a moment');
  return new Error(`${what}: OpenSubtitles answered ${r.status}${msg ? ` (${msg})` : ''}`);
}

// Searches by the file's hash and by title, together, and returns the results ranked.
// opts: { key, token, app, base, hash, query, season, episode, year, language }
export async function search(opts, fetchFn = fetch) {
  const { hash, query, season, episode, year, language = 'en', base = API } = opts;
  const get = async (params) => {
    const r = await fetchFn(searchUrl({ languages: language, ...params }, base), { headers: headers(opts) });
    if (!r.ok) throw await failure(r, 'Couldn’t search');
    const j = await r.json();
    return (j.data || []).map(resultOf);
  };
  const asks = [];
  if (hash) asks.push(get({ moviehash: hash }));
  if (String(query || '').trim()) {
    const q = { query: String(query).trim() };
    if (season) Object.assign(q, { season_number: season, episode_number: episode, type: 'episode' });
    if (year) q.year = year;
    asks.push(get(q));
  }
  if (!asks.length) return [];
  return ranked(await Promise.all(asks));
}

// Fetches one subtitle file as SRT text. Returns { text, remaining } (downloads left today).
export async function download(fileId, opts, fetchFn = fetch) {
  const r = await fetchFn(`${opts.base || API}/download`, {
    method: 'POST',
    headers: { ...headers(opts), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
  });
  if (!r.ok) throw await failure(r, 'Couldn’t download');
  const j = await r.json();
  if (!j.link) throw new Error(j.message || 'OpenSubtitles sent no file');
  const f = await fetchFn(j.link);
  if (!f.ok) throw new Error(`Couldn’t download: the file answered ${f.status}`);
  return { text: await f.text(), remaining: Number.isFinite(j.remaining) ? j.remaining : null };
}

// Signs in to an OpenSubtitles account. Returns { token, user, base, allowed }: base is the
// address to use from now on, which OpenSubtitles may change for some accounts.
export async function signIn(username, password, opts, fetchFn = fetch) {
  const r = await fetchFn(`${API}/login`, {
    method: 'POST',
    headers: { ...headers({ key: opts.key, app: opts.app }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (r.status === 401) throw new Error('OpenSubtitles didn’t accept that username and password');
  if (!r.ok) throw await failure(r, 'Couldn’t sign in');
  const j = await r.json();
  if (!j.token) throw new Error('OpenSubtitles sent no sign-in');
  const host = String(j.base_url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return {
    token: j.token,
    user: j.user?.username || username,
    allowed: j.user?.allowed_downloads ?? null,
    base: /^[a-z0-9-]+\.opensubtitles\.com$/i.test(host) ? `https://${host}/api/v1` : API,
  };
}

export async function signOut(opts, fetchFn = fetch) {
  try { await fetchFn(`${opts.base || API}/logout`, { method: 'DELETE', headers: headers(opts) }); } catch { /* signed out here anyway */ }
}
