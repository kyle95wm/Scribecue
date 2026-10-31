import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { renderMarkdown as md, inline, slug, guideLink, repoPath, GUIDES } from '../app/js/guide.js';

test('headings get GitHub’s anchors, so links between the guides land', () => {
  assert.equal(slug('Speech to text with Whisper'), 'speech-to-text-with-whisper');
  assert.equal(slug('Transcribing again, and empty blocks'), 'transcribing-again-and-empty-blocks');
  assert.equal(slug('Ollama, on your own computer'), 'ollama-on-your-own-computer');
  assert.match(md('## Keys for transcribing'), /<h3 id="keys-for-transcribing">Keys for transcribing<\/h3>/);
});

test('renders lists, nested lists with code, tables and code blocks', () => {
  const h = md('1. Download it:\n\n   ```bash\n   git clone x\n   ```\n\n2. Go in:\n   - nested `a`\n   - two\n');
  assert.match(h, /^<ol><li><p>Download it:<\/p><pre><code>git clone x<\/code><\/pre><\/li><li><p>Go in:<\/p><ul><li>nested <code>a<\/code><\/li><li>two<\/li><\/ul><\/li><\/ol>$/);
  const t = md('| Key | Does |\n| --- | --- |\n| `H` | Mark |\n');
  assert.equal(t, '<table><thead><tr><th>Key</th><th>Does</th></tr></thead><tbody><tr><td><code>H</code></td><td>Mark</td></tr></tbody></table>');
});

test('escapes everything, and only allows safe links', () => {
  assert.equal(inline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.doesNotMatch(inline('[x](javascript:alert(1))'), /href/);
  assert.equal(inline('[guide](AI.md#costs) and <https://x.org>'), '<a href="AI.md#costs">guide</a> and <a href="https://x.org">https://x.org</a>');
  assert.equal(inline('**bold**, *it* and `a <b>`'), '<strong>bold</strong>, <em>it</em> and <code>a &lt;b&gt;</code>');
  assert.match(inline('![A shot](docs/screenshots/main.png)'), /^<img src="docs\/screenshots\/main\.png" alt="A shot"/);
});

test('knows links to the guides, on GitHub or between them', () => {
  assert.deepEqual(guideLink('https://github.com/kyle95wm/Scribecue/blob/main/AI.md#costs'), { file: 'AI.md', hash: 'costs' });
  assert.deepEqual(guideLink('INSTALL.md'), { file: 'INSTALL.md', hash: '' });
  assert.deepEqual(guideLink('GOOGLE-VOICES.md#never-being-billed'), { file: 'GOOGLE-VOICES.md', hash: 'never-being-billed' });
  // Guides live in Guides/, and the README at the top: links between them either way.
  assert.deepEqual(guideLink('https://github.com/kyle95wm/Scribecue/blob/main/Guides/AI.md#costs'), { file: 'AI.md', hash: 'costs' });
  assert.deepEqual(guideLink('Guides/RECORDING.md#punching-in'), { file: 'RECORDING.md', hash: 'punching-in' });
  assert.deepEqual(guideLink('../README.md'), { file: 'README.md', hash: '' });
  assert.equal(guideLink('../docker-compose.yml'), null);
  assert.equal(repoPath('README.md'), 'README.md');
  assert.equal(repoPath('INSTALL.md'), 'Guides/INSTALL.md');
  assert.equal(guideLink('LICENSE'), null);
  assert.equal(guideLink('https://github.com/kyle95wm/Scribecue/releases'), null);
});

test('every guide renders with nothing left as raw Markdown, and its anchors exist', () => {
  const html = {};
  for (const f of Object.keys(GUIDES)) {
    html[f] = md(readFileSync(new URL(`../${repoPath(f)}`, import.meta.url), 'utf8'));
    const text = html[f].replace(/<pre>[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '');
    assert.doesNotMatch(text, /\]\(|\*\*|```|^#|\| ?---/m, `${f} has raw Markdown left`);
  }
  for (const f of Object.keys(GUIDES)) {
    for (const [, href] of html[f].matchAll(/href="([^"]+)"/g)) {
      const g = href.startsWith('#') ? { file: f, hash: href.slice(1) } : guideLink(href);
      if (g?.hash) assert.ok(html[g.file].includes(`id="${g.hash}"`), `${f} links to ${g.file}#${g.hash}, which isn't there`);
    }
    // Links and pictures to other files in the repository, from where the guide is.
    for (const [, ref] of html[f].matchAll(/(?:href|src)="([^"#]+)[^"]*"/g)) {
      if (/^(https?|mailto):/.test(ref)) continue;
      assert.ok(existsSync(new URL(ref, new URL(`../${repoPath(f)}`, import.meta.url))), `${repoPath(f)} links to ${ref}, which isn't there`);
    }
  }
});
