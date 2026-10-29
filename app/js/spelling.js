// British and Canadian spelling for text Whisper writes, which is always American. Only
// spellings the two share, and only where the word can't mean something else: -or to
// -our, -er to -re, grey, doubled l, and a few more. -ize stays, since Canada keeps it
// (and so do many British publishers), and so do words that depend on their meaning, such
// as meter (a gauge, or a metre), tire or check.

// Stems that take -our, followed by the endings they keep. "humorous", "laborious" and
// "vaporize" keep -or, so -ous and -ize aren't among the endings.
const OUR = /\b(colo|hono|favo|neighbo|harbo|labo|flavo|humo|behavio|rumo|armo|endeavo|parlo|savo|vigo|rigo|splendo|cando|clamo|fervo|tumo|odo|vapo|valo|ardo|savio)r(s|ed|ing|ful|fully|less|ite|ites|able|ably|y|hood|ship)?\b/gi;
// -er to -re, with the endings each can take.
const RE = /\b(cent|theat|fib|somb|calib|sab|lust|spect|meag|lit|centimet|millimet|kilomet|scept|sepulch)er(s|ed)?\b/gi;
// Verbs whose last l doubles before -ed, -ing and -er.
const LL = /\b(travel|cancel|label|model|signal|level|fuel|quarrel|marvel|tunnel|total|channel|counsel|dial|duel|equal|funnel|grovel|jewel|libel|panel|pedal|pencil|rival|shovel|snorkel|swivel|tassel|towel|unravel|yodel)(ed|ing|er|ers)\b/gi;
const WORDS = {
  gray: 'grey', grays: 'greys', grayed: 'greyed', graying: 'greying', grayish: 'greyish', grayer: 'greyer', grayest: 'greyest',
  catalog: 'catalogue', catalogs: 'catalogues', cataloged: 'catalogued', dialog: 'dialogue', dialogs: 'dialogues',
  mold: 'mould', molds: 'moulds', moldy: 'mouldy', molded: 'moulded', molding: 'moulding',
  plow: 'plough', plows: 'ploughs', plowed: 'ploughed', plowing: 'ploughing',
  smolder: 'smoulder', smolders: 'smoulders', smoldered: 'smouldered', smoldering: 'smouldering',
  mustache: 'moustache', mustaches: 'moustaches', pajamas: 'pyjamas', jewelry: 'jewellery',
  defense: 'defence', defenses: 'defences', offense: 'offence', offenses: 'offences',
  woolen: 'woollen', woolens: 'woollens', fulfill: 'fulfil', fulfills: 'fulfils', enroll: 'enrol', enrolls: 'enrols',
};
const WORD = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi');

// The replacement in the case of the word it replaces: "Gray" → "Grey", "GRAY" → "GREY".
function cased(from, to) {
  if (from === from.toUpperCase() && from.length > 1) return to.toUpperCase();
  if (from[0] === from[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
  return to;
}

export function britishSpelling(text) {
  return text
    .replace(OUR, (w, stem, end = '') => cased(w, `${stem}ur${end}`.toLowerCase()))
    .replace(RE, (w, stem, end = '') => cased(w, `${stem}re${end === 'ed' ? 'd' : end}`.toLowerCase()))
    .replace(LL, (w, stem, end) => cased(w, `${stem}l${end}`.toLowerCase()))
    .replace(WORD, (w) => cased(w, WORDS[w.toLowerCase()]));
}

// Which spelling suits someone, from their browser's language: British and Canadian
// spelling for English outside the US and its neighbours that follow it.
export function defaultSpelling(lang = 'en-US') {
  return /^en-(GB|IE|AU|NZ|ZA|CA|IN|SG|HK|MT)\b/i.test(lang) ? 'uk' : 'us';
}
