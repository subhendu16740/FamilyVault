// ─── Numbers stay in digits ──────────────────────────────────────
//
// A voice answer is read out by the device, and the model, told to write for
// the ear, took that as licence to write a train number in words — and,
// writing it out, swapped two of its digits. The screen showed words,
// the voice read the wrong number, and nothing on the screen said otherwise.
//
// The answer prompt now says to copy every number exactly as the document
// writes it, in digits. This is the safety net behind it, in two steps:
//
//   restoreCodes()     a code spelled out ("one six seven eight two A B",
//                      "A B C D E 1 2 3 4 F") goes back to the code as the
//                      document writes it ("16782AB", "ABCDE1234F") — but
//                      only when, joined up, it IS a code in the document.
//                      It never makes one up.
//   digitsFromWords()  what is left: a run of three or more digits written
//                      as words (English or Hindi), or four or more single
//                      digits spaced apart, goes back to plain digits.
//
// How a number is read aloud is the app's job (toSpeech in
// src/lib/speech-text.ts), done in code from the digits themselves, so the
// order can never change on the way.
//
// Pure, so the QA self-test runs it.
// ────────────────────────────────────────────────────────────────

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  'शून्य': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4',
  'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
};

const WORD = Object.keys(DIGIT_WORDS).sort((a, b) => b.length - a.length).join('|');
// Whole words only, in any script: "one" is not in "someone", "सात" not in "सातवां".
const START = '(?<![\\p{L}\\p{M}\\p{N}])';
const END = '(?![\\p{L}\\p{M}\\p{N}])';
const SEP = '[\\s,\\-–]+';

/** "one six seven eight two", "nine-eight-seven", "एक छह सात": three or more digit words in a row. */
const SPELLED_RUN = new RegExp(`${START}(?:${WORD})${END}(?:${SEP}(?:${WORD})${END}){2,}`, 'giu');
/** "1 6 7 8 2": four or more single digits with a space between each. */
const SPACED_RUN = new RegExp(`${START}\\d(?: \\d){3,}${END}`, 'gu');

/** Digits written as words, or spaced out one by one, back to plain digits: "One six seven" → "167". */
export function digitsFromWords(text: string): string {
  return text
    .replace(SPELLED_RUN, (run) => run.split(new RegExp(SEP, 'u')).map((w) => DIGIT_WORDS[w.toLowerCase()] ?? '').join(''))
    .replace(SPACED_RUN, (run) => run.replace(/ /g, ''));
}

// ─── Codes, exactly as the document writes them ─────────────────

/** A code in a document: letters and digits, maybe joined by - or /, at least one digit. */
const SOURCE_CODE = /[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*/g;
/** One piece of a code spelled out: a letter, a digit or digits, or a digit word. */
const UNIT = `(?:[A-Za-z]|\\d+|${WORD})`;
const UNIT_RUN = new RegExp(`${START}${UNIT}${END}(?:${SEP}${UNIT}${END})+`, 'giu');

const asChars = (unit: string) => DIGIT_WORDS[unit.toLowerCase()] ?? unit.toUpperCase();
/** A piece that only spelling out produces: a single letter, a single digit, a digit word. */
const spelled = (unit: string) => unit.length === 1 || DIGIT_WORDS[unit.toLowerCase()] !== undefined;

/** Every code in the text, by its letters and digits alone: "MH12AB1234" → "MH-12-AB-1234". */
function codesIn(text: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const [code] of text.matchAll(SOURCE_CODE)) {
    const key = code.replace(/[-/]/g, '').toUpperCase();
    if (key.length >= 4 && /\d/.test(key) && !codes.has(key)) codes.set(key, code);
  }
  return codes;
}

/**
 * A code the answer spelled out, put back as the documents write it:
 * "one six seven eight two A B" → "16782AB", "A B C D E 1 2 3 4 F" →
 * "ABCDE1234F", "M H 1 2 A B 1 2 3 4" → "MH-12-AB-1234". Only when the pieces,
 * joined, are exactly a code in `source` — so nothing is ever invented, and a
 * number spelled with its digits out of order is not "corrected" into another.
 */
export function restoreCodes(answer: string, source: string): string {
  const codes = codesIn(source);
  if (!codes.size) return answer;
  return answer.replace(UNIT_RUN, (run) => {
    const units = run.split(new RegExp(SEP, 'u')).filter(Boolean);
    // The whole run, then without a stray word-letter at either end ("a", "I").
    for (const [from, to] of [[0, units.length], [1, units.length], [0, units.length - 1], [1, units.length - 1]]) {
      const part = units.slice(from, to);
      if (part.length < 2 || part.filter(spelled).length < 2) continue;
      const code = codes.get(part.map(asChars).join(''));
      if (code) return [...units.slice(0, from), code, ...units.slice(to)].join(' ');
    }
    return run;
  });
}
