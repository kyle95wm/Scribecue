import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZip } from '../app/js/zip.js';
import { toXlsx, scriptRows, sheetXml, headers, scriptLanguage, XLSX_TYPE } from '../app/js/xlsx.js';

const cues = [
  { start: 1.5, end: 4, text: 'A door opens.\n\nSam walks in.', notes: 'Sign reads <EXIT> & "Way out"' },
  { start: 62.48, end: 65, text: 'Night.' },
];

test('each block is a row: number, SMPTE timecodes, script and notes', () => {
  assert.deepEqual(scriptRows(cues, 25), [
    [1, '00:00:01:12', '00:00:04:00', 'A door opens.\nSam walks in.', 'Sign reads <EXIT> & "Way out"'],
    [2, '00:01:02:12', '00:01:05:00', 'Night.', ''],
  ]);
  assert.equal(scriptRows(cues, 29.97)[1][1], '00:01:02;14', 'drop-frame at 29.97');
});

test('the headers follow the template, with the script’s language', () => {
  assert.deepEqual(headers('fr'), ['Line Number', 'Timecode In', 'Timecode Out', 'Script (fr)', 'On Screen Note (fr)']);
});

test('the language comes from the voice, or its id, or is English', () => {
  assert.equal(scriptLanguage({ lang: 'fr-CA' }, 'polly:Gabrielle'), 'fr');
  assert.equal(scriptLanguage(null, 'google:de-DE-Standard-A'), 'de');
  assert.equal(scriptLanguage(null, 'piper:es_ES-davefx-medium'), 'es');
  assert.equal(scriptLanguage(null, 'kokoro:ff_siwis'), 'fr');
  assert.equal(scriptLanguage(null, 'polly:Joanna'), 'en');
  assert.equal(scriptLanguage(null, ''), 'en');
});

test('text is escaped, and characters XML can’t hold are dropped', () => {
  const sheet = sheetXml([[1, '00:00:00:00', '00:00:01:00', 'Bell\u0007 rings', 'a < b & c']]);
  assert.match(sheet, /Bell rings/);
  assert.match(sheet, /a &lt; b &amp; c/);
  assert.match(sheet, /<c r="A2" s="2"><v>1<\/v><\/c>/, 'the number is a number');
  assert.match(sheet, /<c r="E1" s="1" t="inlineStr"><is><t xml:space="preserve">On Screen Note \(en\)<\/t>/);
  assert.match(sheet, /<dimension ref="A1:E2"\/>/);
});

test('the workbook is a zip with the parts Excel needs', async () => {
  const blob = await toXlsx(cues, { fps: 25, lang: 'en', date: new Date(2026, 10, 17) });
  assert.equal(blob.type, XLSX_TYPE);
  const files = await readZip(blob);
  assert.deepEqual(files.map((f) => f.name).sort(),
    ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  const sheet = await files.find((f) => f.name === 'xl/worksheets/sheet1.xml').blob.text();
  assert.match(sheet, /Sign reads &lt;EXIT&gt; &amp; &quot;Way out&quot;/);
  assert.match(sheet, /<row r="3">/);
});
