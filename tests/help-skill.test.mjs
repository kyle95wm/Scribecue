import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { GUIDES, repoPath } from '../app/js/guide.js';

const skill = '.claude/skills/scribecue-help/SKILL.md';
const text = readFileSync(skill, 'utf8');

test('the help skill is there for Claude and Codex', () => {
  assert.match(text, /^---\nname: scribecue-help\ndescription: .+\n---\n/);
  assert.equal(realpathSync('.agents/skills/scribecue-help/SKILL.md'), realpathSync(skill));
});

test('the help skill points to every guide', () => {
  const guides = [...Object.keys(GUIDES).map(repoPath), ...readdirSync('Guides').map((f) => `Guides/${f}`)];
  for (const g of new Set(guides.map((g) => g || 'README.md'))) assert.ok(text.includes(`| \`${g}\` |`), `${g} is missing from the skill`);
});

test('every file and folder the help skill names exists', () => {
  const paths = [...text.matchAll(/`((?:app|Guides|docs|tests|relay|piper|kokoro|whisper|ffmpeg)\/[\w./-]*|[\w-]+\.(?:md|yml))`/g)].map((m) => m[1]);
  assert.ok(paths.length >= 40);
  for (const p of new Set(paths)) {
    if (p.includes('*')) continue;
    assert.ok(existsSync(p), `${p} doesn't exist`);
  }
});
