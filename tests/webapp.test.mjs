import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../app/${p}`, import.meta.url), 'utf8');

test('the offline copy is named after the same version as the app', () => {
  const app = read('js/update.js').match(/export const VERSION = '([^']+)'/)[1];
  const sw = read('sw.js').match(/const VERSION = '([^']+)'/)[1];
  assert.equal(sw, app, 'update VERSION in app/sw.js to match app/js/update.js');
});

test('every file the offline copy keeps exists', () => {
  const list = read('sw.js').match(/const FILES = (\[[\s\S]*?\]);/)[1];
  const files = JSON.parse(list.replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of files) if (f !== './') assert.ok(existsSync(new URL(`../app/${f}`, import.meta.url)), `${f} is missing`);
  // and every script the app loads is in it, so it works offline
  for (const js of ['app', 'browser', 'config', 'formats', 'project', 'tts', 'update', 'welcome', 'wave-worker', 'piper-engine', 'piper-worker', 'ai', 'aidrawer', 'nav', 'tour', 'keymap', 'keys', 'whatsnew', 'stt', 'whisper-worker', 'spelling', 'reminder', 'autosave', 'guide', 'offline', 'old', 'tmdb', 'findreplace']) {
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
  for (const f of ['README.md', 'TRANSCRIBING.md', 'AI.md', 'INSTALL.md', ...shots.map((s) => `docs/screenshots/${s}`)]) {
    assert.ok(sw.includes(`'guides/${f}'`), `guides/${f} isn't kept offline (add it to GUIDES in app/sw.js)`);
  }
  const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(pages, /cp README\.md TRANSCRIBING\.md AI\.md INSTALL\.md _site\/guides\//);
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /COPY README\.md TRANSCRIBING\.md AI\.md INSTALL\.md \/usr\/share\/nginx\/html\/guides\//);
});
