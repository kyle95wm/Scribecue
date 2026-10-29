import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

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
  for (const js of ['app', 'browser', 'config', 'formats', 'project', 'tts', 'update', 'welcome', 'wave-worker', 'piper-engine', 'piper-worker', 'ai', 'aidrawer', 'nav', 'tour', 'keymap', 'keys', 'whatsnew']) {
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
