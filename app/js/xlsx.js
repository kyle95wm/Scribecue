// The script as an Excel workbook (.xlsx): one row per block, with its number, timecodes,
// text and notes, laid out like a studio's script template. An .xlsx is a zip of XML files;
// stored without compression, which Excel, Numbers, LibreOffice and Google Sheets all read.

import { storeZip } from './zip.js';
import { fmtTC } from './formats.js';

// The language code for the headers, such as 'en' or 'fr', from a voice's language
// ('en-US', 'fr_CA'), or failing that from its id ('google:fr-CA-Standard-A',
// 'piper:de_DE-thorsten-medium', 'kokoro:ef_dora'). English when neither says.
const KOKORO = { a: 'en', b: 'en', e: 'es', f: 'fr', h: 'hi', i: 'it', j: 'ja', p: 'pt', z: 'zh' };
export function scriptLanguage(voice, id = '') {
  const lang = String(voice?.lang || '').toLowerCase().split(/[-_]/)[0];
  if (/^[a-z]{2,3}$/.test(lang)) return lang;
  const [kind, name = ''] = String(id).split(/:(.*)/);
  if (kind === 'kokoro') return KOKORO[name[0]] || 'en';
  const m = (kind === 'google' || kind === 'piper') && name.match(/^([a-z]{2,3})[-_][A-Za-z]{2}\b/);
  return m ? m[1] : 'en';
}

// The header row, with the script's language.
export const headers = (lang = 'en') =>
  ['Line Number', 'Timecode In', 'Timecode Out', `Script (${lang})`, `On Screen Note (${lang})`];

// The rows under the headers: [number, in, out, script, note] for each block, with times as
// SMPTE timecode at fps.
const tidy = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').trim();
export const scriptRows = (cues, fps = 25) =>
  cues.map((c, i) => [i + 1, fmtTC(c.start, fps), fmtTC(c.end, fps), tidy(c.text), tidy(c.notes)]);

// Text for XML: escaped, without the control characters XML can't hold.
const xml = (s) => String(s).replace(/[^\t\n\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const COLS = 'ABCDE';
// Styles: 0 Excel's default, 1 a header, 2 a centred cell, 3 the script, as in the template.
const STYLES = { header: 1, cell: 2, script: 3 };
function cell(ref, v, s) {
  if (typeof v === 'number') return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  if (v === '') return `<c r="${ref}" s="${s}"/>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}
function row(r, values, style) {
  return `<row r="${r}"${r === 1 ? ' ht="27" customHeight="1"' : ''}>` +
    values.map((v, i) => cell(`${COLS[i]}${r}`, v, style(i))).join('') + '</row>';
}

export function sheetXml(rows, lang = 'en') {
  const body = [row(1, headers(lang), () => STYLES.header),
    ...rows.map((values, i) => row(i + 2, values, (col) => (col === 3 ? STYLES.script : STYLES.cell)))];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:E${rows.length + 1}"/>` +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="21"/>' +
    '<cols><col min="1" max="5" width="38.83203125" customWidth="1"/></cols>' +
    `<sheetData>${body.join('')}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0" footer="0"/><pageSetup orientation="landscape"/></worksheet>';
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><sz val="16"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><sz val="16"/><name val="Gujarati Sangam MN"/></font>' +
  '<font><sz val="16"/><name val="Arial"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

const PARTS = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'xl/styles.xml': STYLES_XML,
};

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// The workbook for cues (each { start, end, text, notes? }), as a Blob.
export async function toXlsx(cues, { fps = 25, lang = 'en', date } = {}) {
  const files = { ...PARTS, 'xl/worksheets/sheet1.xml': sheetXml(scriptRows(cues, fps), lang) };
  const zip = await storeZip(Object.entries(files).map(([name, text]) => ({ name, blob: new Blob([text]) })), { date });
  return new Blob([zip], { type: XLSX_TYPE });
}
