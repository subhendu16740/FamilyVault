// ─── Numbers stay in digits ──────────────────────────────────────
//
// A voice answer is read out by the device, and the model, told to write for
// the ear, took that as licence to write a train number in words — and,
// writing it out, swapped two of its digits. The screen showed words,
// the voice read the wrong number, and nothing on the screen said otherwise.
//
// The answer prompt now says to copy every number exactly as the document
// writes it, in digits. This is the safety net behind it: a run of three or
// more digits written as words (English or Hindi), or four or more single
// digits spaced apart, goes back to plain digits. How a number is read aloud
// is the app's job (toSpeech in src/lib/speech-text.ts), done in code from
// the digits themselves, so the order can never change on the way.
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
