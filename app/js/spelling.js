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

// One setting chooses the English: Settings, Editing, Spelling ('en-us', 'en-gb' or
// 'en-ca'). The spelling check uses it as its dictionary, speech to text for its spelling,
// and AI help for how it writes.

// Speech to text changes Whisper's American spelling for British and Canadian.
export const britishFor = (language) => language === 'en-gb' || language === 'en-ca';

// What AI help is told, so it doesn't drift into another English.
const ENGLISH = {
  'en-us': 'Use American English: American spelling and words, such as color, gray, sidewalk and apartment.',
  'en-gb': 'Use British English: British spelling and words, such as colour, grey, pavement and flat.',
  'en-ca': 'Use Canadian English: Canadian spelling, such as colour, grey, centre and realize, and North American words, such as sidewalk and apartment.',
};
export const englishFor = (language) => ENGLISH[language] || ENGLISH['en-us'];
