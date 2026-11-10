// Scribecue's own addresses are set once, in app/js/config.js. A few files can't import
// them: the page's Content-Security-Policy, nginx, the relay's settings and the guides.
// These tests check they agree with config.js, so a fork that changes it learns what else to change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { REPO, WEB_APP, RELAY } from '../app/js/config.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const web = new URL(WEB_APP), relay = new URL(RELAY);
const csp = (text) => text.match(/connect-src ([^;"]+)/)[1].split(/\s+/);

test('the addresses in config.js are well formed', () => {
  assert.match(REPO, /^[\w.-]+\/[\w.-]+$/, 'REPO is owner/name');
  assert.equal(web.protocol, 'https:');
  assert.equal(web.href, WEB_APP, 'WEB_APP ends with a slash');
  assert.equal(relay.protocol, 'wss:');
  assert.equal(relay.pathname, '/', 'RELAY is only a host');
});

test('the Content-Security-Policy lets the page reach the relay', () => {
  for (const f of ['app/index.html', 'nginx.conf']) {
    assert.ok(csp(read(f)).includes(relay.origin.replace(/\/$/, '')), `add ${relay.origin} to connect-src in ${f}`);
  }
});

test('the relay is served at RELAY and accepts the web version', () => {
  const toml = read('relay/wrangler.toml');
  assert.match(toml, new RegExp(`pattern = "${relay.host.replace(/\./g, '\\.')}"`), 'set routes in relay/wrangler.toml to RELAY’s host');
  const origins = toml.match(/^ORIGINS = "([^"]*)"/m)[1].split(',').map((s) => s.trim());
  assert.ok(origins.includes(web.origin), `add ${web.origin} to ORIGINS in relay/wrangler.toml`);
});

test('Ollama is told to accept the web version', () => {
  assert.ok(read('docker-compose.yml').includes(`OLLAMA_ORIGINS:-${web.origin}}`), 'set the OLLAMA_ORIGINS default in docker-compose.yml');
  assert.ok(read('app/index.html').includes(`OLLAMA_ORIGINS=${web.origin}<`), 'set OLLAMA_ORIGINS in app/index.html');
});

test('the page and the guides name the web version and the relay', () => {
  const needs = {
    [web.host]: ['app/index.html', 'README.md', 'Guides/INSTALL.md', 'Guides/SHARING.md', 'Guides/AI.md', 'Guides/GOOGLE-VOICES.md',
      '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/accessibility.yml'],
    [relay.host]: ['Guides/SHARING.md', 'relay/README.md', 'docs/development/collaboration.md'],
  };
  const missing = Object.entries(needs).flatMap(([host, files]) => files.filter((f) => !read(f).includes(host)).map((f) => `${f}: ${host}`));
  assert.deepEqual(missing, [], 'these files should name the address');
});

test('links to Scribecue on GitHub go to REPO', () => {
  // Any repository named like this one: links to other projects, such as Piper, are left alone.
  // Old release notes keep the links they had.
  const name = REPO.split('/')[1];
  const own = new RegExp(`github(?:usercontent)?\\.com/([\\w.-]+/${name.replace(/\./g, '\\.')})(?=[/.)"'\\s>#]|$)`, 'gi');
  const files = execFileSync('git', ['ls-files'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
    .split('\n').filter((f) => /\.(md|html|js|mjs|json|yml|toml|sh)$/.test(f) && !f.startsWith('relay/node_modules') && f !== 'app/changelog.json' && f !== 'relay/package-lock.json');
  const wrong = [];
  for (const f of files) {
    for (const m of read(f).matchAll(own)) if (m[1] !== REPO) wrong.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(wrong, [], `point these at ${REPO}`);
});
