import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEEDS, DEFAULT_CPS, pickVoices, groupVoices, estimate, spoken, tts, isSpeed, speedLabel } from '../app/js/tts.js';

const v = (name, lang, localService, extra = {}) => ({ name, lang, localService, voiceURI: name, ...extra });
const voices = [
  v('Zed', 'en-US', true), v('Google UK', 'en-GB', false), v('Amélie', 'fr-CA', true),
  v('Alex', 'en-GB', true), v('Anna', 'en-US', true),
];

test('text to speech is off until turned on', () => {
  assert.equal(tts.on, false);
  assert.equal(tts.online, false);
});

test('once turned on, new blocks take their end from the reading unless that is turned off', () => {
  assert.equal(tts.autoEnd, true);
});

test('only voices on this computer are offered unless online voices are allowed', () => {
  assert.deepEqual(pickVoices(voices, { lang: 'en-US' }).map((x) => x.name), ['Anna', 'Zed', 'Alex', 'Amélie']);
  assert.ok(pickVoices(voices, { online: true, lang: 'en-US' }).some((x) => x.name === 'Google UK'));
});

test('voices in the user language come first', () => {
  assert.deepEqual(pickVoices(voices, { lang: 'fr-FR' }).map((x) => x.name)[0], 'Amélie');
  assert.deepEqual(pickVoices(voices, { online: true, lang: 'en-GB' }).map((x) => x.name).slice(0, 2), ['Alex', 'Google UK']);
});

test('the speeds match Frazier, from −30% to +100%', () => {
  assert.deepEqual(SPEEDS.map(([s]) => s), [0.7, 0.85, 1, 1.15, 1.3, 1.5, 2]);
});

test('reading time scales with length and speed', () => {
  const line = 'x'.repeat(30);
  assert.equal(estimate(line), 30 / DEFAULT_CPS);
  assert.equal(estimate(line, 10, 2), 1.5);
  assert.ok(estimate(line, 15, 0.7) > estimate(line, 15, 1));
  assert.equal(estimate('   '), 0);
});

test('tags and line breaks are not read out', () => {
  assert.equal(spoken('<i>Hello</i>\n  {\\an8}there'), 'Hello there');
});

test('the voice menu lists voices on this computer before online ones', () => {
  const groups = groupVoices(pickVoices(voices, { online: true, lang: 'en-US' }));
  assert.deepEqual(groups.map(([label]) => label), ['On this computer', 'Online: the text is sent to the provider']);
  assert.deepEqual(groups[0][1].map((x) => x.name), ['Anna', 'Zed', 'Alex', 'Amélie']);
  assert.deepEqual(groups[1][1].map((x) => x.name), ['Google UK']);
});

test('block speed labels and validation', () => {
  assert.deepEqual(SPEEDS.map(([s]) => speedLabel(s)), ['−30%', '−15%', 'normal', '+15%', '+30%', '+50%', '+100%']);
  assert.equal(isSpeed(1.15), true);
  assert.equal(isSpeed(1.2), false);
  assert.equal(isSpeed(undefined), false);
});
