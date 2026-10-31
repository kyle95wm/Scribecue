import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { GUIDES, repoPath } from '../app/js/guide.js';

const read = (p) => readFileSync(new URL(`../app/${p}`, import.meta.url), 'utf8');

test('the offline copy is named after the same version as the app', () => {
  const app = read('js/update.js').match(/export const VERSION = '([^']+)'/)[1];
  const sw = read('sw.js').match(/const VERSION = '([^']+)'/)[1];
  assert.equal(sw, app, 'update VERSION in app/sw.js to match app/js/update.js');
});

test('a new version’s offline copy is fetched fresh, not from the browser’s cache', async () => {
  // GitHub Pages lets browsers keep files for 10 minutes, so a release soon after a visit
  // once kept the old files under the new version's name.
  const { runInNewContext } = await import('node:vm');
  const added = [], on = {};
  const cache = { addAll: async (rs) => { added.push(...rs); }, add: async (r) => { added.push(r); } };
  runInNewContext(read('sw.js'), {
    self: { addEventListener: (type, f) => { on[type] = f; } }, URL, location: { origin: 'https://example.com' },
    Request: class { constructor(url, init = {}) { this.url = url; this.cache = init.cache; } },
    caches: { open: async () => cache },
  });
  let done;
  on.install({ waitUntil: (p) => { done = p; } });
  await done;
  assert.ok(added.length > 30);
  for (const r of added) assert.equal(typeof r === 'object' && r.cache, 'reload', `${r.url || r} may come from the browser’s cache`);
});

test('every file the offline copy keeps exists', () => {
  const list = read('sw.js').match(/const FILES = (\[[\s\S]*?\]);/)[1];
  const files = JSON.parse(list.replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of files) if (f !== './') assert.ok(existsSync(new URL(`../app/${f}`, import.meta.url)), `${f} is missing`);
  // and every script the app loads is in it, so it works offline
  for (const js of ['app', 'browser', 'config', 'formats', 'project', 'tts', 'update', 'welcome', 'wave-worker', 'piper-engine', 'piper-worker', 'ai', 'aidrawer', 'nav', 'tour', 'keymap', 'keys', 'whatsnew', 'stt', 'whisper-worker', 'spelling', 'reminder', 'autosave', 'guide', 'offline', 'old', 'tmdb', 'findreplace', 'mp3', 'mp3-worker', 'mix-worker', 'audio', 'track-worker', 'ffcmd', 'codecs']) {
    assert.ok(files.includes(`js/${js}.js`), `js/${js}.js isn't kept offline`);
  }
});

test('the app installs: its manifest names it and has the icons browsers need', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Scribecue');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  for (const i of m.icons) assert.ok(existsSync(new URL(`../app/${i.src}`, import.meta.url)));
});

test('the copy in the repository is the Docker one; the web build switches it', () => {
  assert.match(read('js/config.js'), /export const HOSTED = false;/);
});

test('hidden buttons stay hidden, such as Install app until the browser offers it', () => {
  // Buttons are inline-flex, which beats the hidden attribute unless CSS says otherwise.
  assert.match(read('css/style.css'), /^button\[hidden\] \{ display: none; \}/m);
  assert.match(read('index.html'), /<button id="installBtn"[^>]* hidden/);
});

test('the guides and every screenshot they show are built in and kept offline', () => {
  const sw = read('sw.js');
  const shots = readdirSync(new URL('../docs/screenshots', import.meta.url)).filter((f) => f.endsWith('.png'));
  // Every guide the viewer has tabs for.
  const guides = Object.keys(GUIDES);
  for (const f of [...guides, ...shots.map((s) => `docs/screenshots/${s}`)]) {
    assert.ok(sw.includes(`'guides/${f}'`), `guides/${f} isn't kept offline (add it to GUIDES in app/sw.js)`);
  }
  const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  // The README at the top and the rest in Guides/, all copied into one guides/ folder.
  for (const f of guides) {
    assert.ok(existsSync(new URL(`../${repoPath(f)}`, import.meta.url)), `${repoPath(f)} is missing`);
  }
  assert.match(pages, /cp README\.md Guides\/\*\.md _site\/guides\//, 'pages.yml copies the README and Guides/ into the guides');
  assert.match(docker, /COPY README\.md Guides\/\*\.md \/usr\/share\/nginx\/html\/guides\//, 'the Dockerfile copies the README and Guides/ into the guides');
});
