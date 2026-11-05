import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nspell from '../app/vendor/nspell.js';
import {
  wordsIn, knownWords, spellingIssues, grammarIssues, mergeIssues, groupIssues, issueKey, applyFixes, cased,
  aiBatches, aiCheckPrompt, aiCheckSystem, readAiCheck, aiIssues, defaultLanguage,
} from '../app/js/proofing.js';

import { toProject, fromProject } from '../app/js/project.js';

const dictionary = (lang) => {
  const read = (ext) => readFileSync(new URL(`../app/vendor/dictionaries/${lang}.${ext}`, import.meta.url), 'utf8');
  return nspell(read('aff'), read('dic'));
};
const us = dictionary('en-us');
const block = (text, id = 1) => ({ id, text });
const spelled = (text, known) => spellingIssues([block(text)], us, known).map((i) => i.found);
const grammar = (...texts) => grammarIssues(texts.map((t, i) => block(t, i + 1)));
const rules = (text) => grammar(text).map((i) => i.rule);

test('finds words, and leaves out what isn’t one', () => {
  assert.deepEqual(wordsIn('<i>Mara</i> runs').map((w) => w.word), ['Mara', 'runs']);
  assert.deepEqual(wordsIn('See www.example.com or a@b.ca now').map((w) => w.word), ['See', 'or', 'now']);
  assert.deepEqual(wordsIn('The FBI raid at 3rd Ave.').map((w) => w.word), ['The', 'raid', 'at', 'Ave']);
  const { start, end } = wordsIn('<b>hello</b>')[0];
  assert.equal('<b>hello</b>'.slice(start, end), 'hello');
});

test('finds misspellings, with suggestions in the same case', () => {
  assert.deepEqual(spelled('She definately walks to the kitchn.'), ['definately', 'kitchn']);
  assert.deepEqual(spellingIssues([block('Teh dog')], us)[0].fixes[0], 'The');
  assert.deepEqual(spellingIssues([block('He dont go')], us)[0].fixes[0], 'don’t');
  assert.deepEqual(spelled('Mara’s dog doesn’t bark at the café.'), []);
});

test('the three dictionaries each know their own spelling', () => {
  const gb = dictionary('en-gb'), ca = dictionary('en-ca');
  assert.equal(us.correct('colour'), false);
  assert.equal(gb.correct('colour'), true);
  assert.equal(ca.correct('colour'), true);
  assert.equal(gb.correct('realize'), false);
  assert.equal(ca.correct('realize'), true);
});

test('a project’s own words count as right', () => {
  const known = knownWords({ words: ['Zarnok'], notes: 'Vexley is a boy. xqzzy is not a name', blocks: [{ say: [['Qorin', 'cor in']] }] });
  assert.deepEqual(spelled('Zarnok and Zarnok’s dog meet Vexley and Qorin', known), []);
  assert.deepEqual(spelled('xqzzy', known), ['xqzzy']);
});

test('a word is looked up once', () => {
  let calls = 0;
  const dict = { correct: () => (calls++, false), suggest: () => [] };
  spellingIssues([block('wug wug'), block('wug', 2)], dict);
  assert.equal(calls, 2); // the word, then the word without accents
});

test('finds simple grammar mistakes, each with a fix', () => {
  const fix = (text) => grammar(text).map((i) => i.fixes[0]);
  assert.deepEqual(fix('She should of left.'), ['should have']);
  assert.deepEqual(fix('Their is a door.'), ['There is']);
  assert.deepEqual(fix('It is taller rather then wider.'), ['rather than']);
  assert.deepEqual(fix('The dog dog runs.'), ['dog']);
  assert.deepEqual(fix('She eats a apple.'), ['an apple']);
  assert.deepEqual(fix('He holds an car.'), ['a car']);
  assert.deepEqual(fix('Then i leave.'), ['I']);
  assert.deepEqual(fix('Two  spaces.'), [' ']);
  assert.deepEqual(fix('Wait , now.'), [',']);
  assert.deepEqual(fix('Red,blue.'), [', ']);
  assert.deepEqual(fix('Done..'), ['.']);
  assert.deepEqual(fix('He runs. she stops.'), ['S']);
  assert.deepEqual(fix('He runs.She stops.'), ['. ']);
});

test('leaves correct writing alone', () => {
  for (const ok of [
    'An hour passes. A university, a European, an honest man, a one-way street, an umbrella.',
    'She had had enough. He knows that that is true.',
    'Mr. Smith waits... and waits. Dr. Lee nods, e.g. here.',
    'It costs 1,000 dollars at 3.5 percent.',
    'A unit of an uninvited group.',
    'Its own door. Its colour.',
    'See <i>this</i>  <b>one</b>',
  ]) assert.deepEqual(rules(ok).filter((r) => r !== 'spaces'), [], ok);
});

test('checks capitals and full stops only in a script that nearly always has them', () => {
  const tidy = ['One here.', 'Two here.', 'Three here.', 'Four here.', 'Five here.', 'Six here.', 'Seven here.', 'Eight here.', 'Nine here.'];
  const issues = grammar(...tidy, 'ten here', 'Eleven here.');
  assert.deepEqual(issues.map((i) => i.rule).sort(), ['capital', 'stop']);
  assert.equal(issues.find((i) => i.rule === 'stop').fixes[0], 'here.');
  // Fragments throughout: nothing to say.
  assert.deepEqual(grammar('she runs', 'a door opens', 'rain', 'the car', 'night falls'), []);
  // A sentence carrying on into the next block isn't a mistake.
  assert.deepEqual(grammar(...tidy, 'She walks to the door', 'and opens it.', 'Twelve here.'), []);
});

test('merging keeps script order and the clearest reason', () => {
  const blocks = [block('Bad alot text', 1), block('x', 2)];
  const spell = { kind: 'spelling', block: 1, start: 4, end: 8, found: 'alot' };
  const rule = { kind: 'grammar', block: 1, start: 4, end: 8, found: 'alot' };
  const later = { kind: 'grammar', block: 2, start: 0, end: 1, found: 'x' };
  assert.deepEqual(mergeIssues(blocks, [later, rule], [spell]), [rule, later]);
});

test('groups a misspelling used often into one row', () => {
  const issues = spellingIssues([block('wugz and wugz', 1), block('Wugz', 2), block('zzqq', 3)], { correct: () => false, suggest: () => [] })
    .filter((i) => i.found.toLowerCase() !== 'and');
  const rows = groupIssues(issues);
  assert.deepEqual(rows.map((r) => r.items.length), [3, 1]);
  assert.equal(issueKey(issues[0]), issueKey(issues[2]));
  const two = groupIssues(grammar('Red,blue,green.'));
  assert.equal(two.length, 2);
});

test('applies fixes from the end, and won’t touch changed text', () => {
  const text = 'teh cat and Teh dog';
  const issues = spellingIssues([block(text)], { correct: (w) => !/^teh$/i.test(w), suggest: () => ['the'] });
  assert.equal(applyFixes(text, issues, 'the'), 'the cat and The dog');
  assert.equal(applyFixes('something else', issues, 'the'), null);
  assert.equal(cased('Abc', 'def'), 'Def');
});

test('splits a script into pieces for AI help, without empty blocks', () => {
  const blocks = Array.from({ length: 65 }, (_, i) => block(i === 3 ? '  ' : 'Text', i + 10));
  const batches = aiBatches(blocks);
  assert.deepEqual(batches.map((b) => b.length), [30, 30, 4]);
  assert.equal(batches[0][3].n, 5);
  assert.deepEqual(aiBatches([block('x'.repeat(5000), 1), block('y'.repeat(5000), 2)]).map((b) => b.length), [1, 1]);
  assert.deepEqual(JSON.parse(aiCheckPrompt(batches[2].slice(0, 1))), [{ block: 62, text: 'Text' }]);
  assert.match(aiCheckSystem('Mara is a nurse'), /Mara is a nurse/);
});

test('reads AI help’s suggestions, and drops any it can’t back up', () => {
  const batch = [{ n: 4, id: 40, text: 'He go to the shop.' }];
  const fenced = '```json\n[{"block":4,"find":"He go","fix":"He goes","why":"Agreement"}]\n```';
  assert.deepEqual(readAiCheck(fenced, batch), [{ block: 40, find: 'He go', fix: 'He goes', why: 'Agreement' }]);
  assert.deepEqual(readAiCheck('[]', batch), []);
  assert.deepEqual(readAiCheck(JSON.stringify([
    { block: 9, find: 'He go', fix: 'x' }, { block: 4, find: 'not there', fix: 'x' }, { block: 4, find: 'He', fix: 'He' }, 'nonsense', null,
  ]), batch), []);
  assert.throws(() => readAiCheck('Sorry, I can’t', batch));
  assert.throws(() => readAiCheck('[oops]', batch));
});

test('AI suggestions follow the block, and go when its words change', () => {
  const s = [{ block: 1, find: 'He go', fix: 'He goes', why: 'Agreement' }];
  assert.deepEqual(aiIssues(s, [block('Now He go.')])[0].start, 4);
  assert.deepEqual(aiIssues(s, [block('He goes.')]), []);
  assert.deepEqual(aiIssues(s, []), []);
});

test('a project keeps its words', () => {
  const blocks = [{ start: 0, end: 1, text: 'x' }];
  assert.deepEqual(toProject({ blocks, words: ['Mara', 'Mara', ' ', 3] }).words, ['Mara']);
  assert.equal('words' in toProject({ blocks }), false);
  assert.deepEqual(fromProject(toProject({ blocks, words: ['Mara'] })).words, ['Mara']);
  assert.deepEqual(fromProject({ scribecue: 1, blocks }).words, []);
});

test('the dictionaries and checker work offline', () => {
  const sw = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
  for (const file of ['js/proofing.js', 'js/proofing-worker.js', 'js/proofdialog.js', 'vendor/nspell.js',
    ...['en-us', 'en-gb', 'en-ca'].flatMap((l) => [`vendor/dictionaries/${l}.aff`, `vendor/dictionaries/${l}.dic`])]) {
    assert.ok(sw.includes(`'${file}'`), file);
  }
});

test('picks the dictionary from the browser’s language', () => {
  assert.equal(defaultLanguage('en-CA'), 'en-ca');
  assert.equal(defaultLanguage('en-GB'), 'en-gb');
  assert.equal(defaultLanguage('en-US'), 'en-us');
  assert.equal(defaultLanguage('fr-FR'), 'en-us');
});
