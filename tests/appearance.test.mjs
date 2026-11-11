import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHOICES, DEFAULTS, readAppearance, storedAppearance, attributes, loadAppearance, saveAppearance, KEY } from '../app/js/appearance.js';
import { settingNames } from '../app/js/settingsfile.js';

const css = readFileSync(new URL('../app/css/style.css', import.meta.url), 'utf8');

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('nothing stored gives the usual look', () => {
  assert.deepEqual(readAppearance(null), DEFAULTS);
  assert.deepEqual(readAppearance('not json'), DEFAULTS);
  assert.deepEqual(readAppearance('[1,2]'), DEFAULTS);
  assert.equal(DEFAULTS.accent, 'amber');
  assert.equal(DEFAULTS.subSize, 'm');
});

test('choices it does not know fall back to the default, one by one', () => {
  const a = readAppearance(JSON.stringify({ accent: 'teal', subSize: 'huge', subBg: 3, extra: 'x' }));
  assert.deepEqual(a, { ...DEFAULTS, accent: 'teal' });
});

test('only what differs from the default is stored', () => {
  assert.equal(storedAppearance(DEFAULTS), null);
  assert.equal(storedAppearance({ ...DEFAULTS, subPos: 'top' }), '{"subPos":"top"}');
  assert.equal(storedAppearance({ ...DEFAULTS, accent: 'pink' }), null);
});

test('saving and loading go round, and resetting to defaults clears storage', () => {
  const s = memory();
  const a = { ...DEFAULTS, accent: 'violet', textSize: 'xl' };
  saveAppearance(a, s);
  assert.deepEqual(loadAppearance(s), a);
  saveAppearance({ ...DEFAULTS }, s);
  assert.equal(s.getItem(KEY), null);
});

test('blocked storage still gives the usual look', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadAppearance(blocked), DEFAULTS);
  assert.doesNotThrow(() => saveAppearance({ ...DEFAULTS, accent: 'teal' }, blocked));
});

test('each choice is an attribute on the page', () => {
  assert.deepEqual(attributes(DEFAULTS), {
    'data-accent': 'amber', 'data-sub-size': 'm', 'data-sub-bg': 'dark', 'data-sub-pos': 'bottom', 'data-text-size': 'm',
  });
});

test('style.css has a rule for every choice that is not the default', () => {
  for (const [name, [choices, def]] of Object.entries(CHOICES)) {
    const attr = Object.keys(attributes({ ...DEFAULTS }))[Object.keys(CHOICES).indexOf(name)];
    for (const [value] of choices) {
      if (value === def) continue;
      assert.ok(css.includes(`[${attr}="${value}"]`), `${attr}="${value}" has no rule`);
    }
  }
  for (const [value] of CHOICES.accent[0]) {
    assert.match(css, new RegExp(`--hl-${value}:`), `--hl-${value} is missing`);
    assert.ok(css.includes(`.lookdot[data-accent="${value}"]`), `no swatch for ${value}`);
  }
});

test('the settings file keeps the appearance', () => {
  assert.ok(settingNames().includes('appearance'));
});
