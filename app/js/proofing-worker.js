// Spelling and grammar checks, away from the page. The dictionary stays loaded while the
// worker lives, and proofdialog.js ends the worker when it's been idle for a while.
import nspell from '../vendor/nspell.js';
import { spellingIssues, grammarIssues, mergeIssues } from './proofing.js';

let lang = '', dict = null, memo = new Map();
async function load(want) {
  if (want === lang) return;
  const read = async (ext) => {
    const r = await fetch(new URL(`../vendor/dictionaries/${want}.${ext}`, import.meta.url));
    if (!r.ok) throw new Error(`the ${want} dictionary didn’t load`);
    return r.text();
  };
  const [aff, dic] = await Promise.all([read('aff'), read('dic')]);
  dict = nspell(aff, dic);
  lang = want;
  memo = new Map();
}

self.onmessage = async ({ data: { job, language, known, blocks } }) => {
  try {
    await load(language);
    // Known words change more often than the dictionary, and they decide what's in the memo.
    const words = new Set(known);
    if (self.known?.size !== words.size || [...words].some((w) => !self.known.has(w))) memo = new Map();
    self.known = words;
    const list = [];
    for (let i = 0; i < blocks.length; i += 100) {
      list.push(...spellingIssues(blocks.slice(i, i + 100), dict, words, memo));
      self.postMessage({ job, done: Math.min(i + 100, blocks.length), total: blocks.length });
    }
    self.postMessage({ job, issues: mergeIssues(blocks, grammarIssues(blocks), list) });
  } catch (e) {
    self.postMessage({ job, error: e.message || 'The check didn’t finish' });
  }
};
