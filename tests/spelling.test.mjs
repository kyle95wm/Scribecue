import { test } from 'node:test';
import assert from 'node:assert/strict';
import { britishSpelling as uk, defaultSpelling } from '../app/js/spelling.js';

test('swaps American spellings for British and Canadian ones', () => {
  assert.equal(uk('Margaret squints at the gray sky over the harbor.'), 'Margaret squints at the grey sky over the harbour.');
  assert.equal(uk('Colorful flags line the theater. Her favorite neighbor waves.'), 'Colourful flags line the theatre. Her favourite neighbour waves.');
  assert.equal(uk('They traveled to the center and canceled the meeting.'), 'They travelled to the centre and cancelled the meeting.');
  assert.equal(uk('A centered title; mold on the fiber; the catalog.'), 'A centred title; mould on the fibre; the catalogue.');
  assert.equal(uk('His mustache, her pajamas and the jewelry.'), 'His moustache, her pyjamas and the jewellery.');
  assert.equal(uk('Armored cars defend the neighborhood.'), 'Armoured cars defend the neighbourhood.');
});

test('keeps the case of the word it changes', () => {
  assert.equal(uk('Gray clouds. GRAY. Honor.'), 'Grey clouds. GREY. Honour.');
});

test('leaves words whose British spelling is the same, or depends on the meaning', () => {
  for (const s of [
    'A humorous, vigorous and laborious honorary doctor.', // -or stays before -ous and -ary
    'The actor and the doctor check the meter.', // not -our; meter can be a gauge
    'She realizes the tire is flat.', // -ize stays; tire can mean get tired
    'Grayson walks in.', // a name that starts like "gray"
  ]) assert.equal(uk(s), s);
});

test('picks the spelling from the browser’s language', () => {
  assert.equal(defaultSpelling('en-US'), 'us');
  assert.equal(defaultSpelling('en-GB'), 'uk');
  assert.equal(defaultSpelling('en-CA'), 'uk');
  assert.equal(defaultSpelling('en-AU'), 'uk');
  assert.equal(defaultSpelling('fr-CA'), 'us');
  assert.equal(defaultSpelling('en'), 'us');
});
