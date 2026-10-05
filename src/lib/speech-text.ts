// Turn an answer into something a voice can read well.
//
// The server already writes voice-mode answers in plain sentences, but a
// model slips sometimes, and identifiers are a problem no prompt fixes: a
// voice reads "ABCDE1234F" as a word and "123456789012" as a number in the
// hundreds of billions. Spelling them out character by character is how a
// person would read a PAN or Aadhaar number to someone over the phone.
//
// The answer on the screen keeps its digits ("Train number 16782"); only
// what is spoken changes ("one six seven eight two"), and it is done here,
// from the digits themselves, never by the model — which, asked to write a
// train number for the ear, once swapped two of its digits.

/** Alphanumeric ID: 6+ chars, at least one letter and one digit, e.g. PAN, passport, policy numbers. */
const ALNUM_ID = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b/g;
/** Long digit runs (8+): Aadhaar, phone, account numbers. Not years or amounts. */
const LONG_DIGITS = /\b\d{8,}\b/g;
/**
 * A shorter number named as one — "train number 16782", "Train No. 16782",
 * "PNR: 4512", "PIN 751001", "flight 101", "नंबर 16782" — read digit by
 * digit, as a person reads a train or room number. Seat and berth numbers
 * (one or two digits), amounts and years are left to the voice.
 */
const NAMED_NUMBER =
  /(^|[^\p{L}\p{M}\p{N}])((?:numbers?|nos?\.|no:|num\.|pnr|pin\s?code|pincode|pin|train|flight|room|flat|code|id|otp|नंबर|संख्या|क्रमांक)(?:\s*[:#-]|\s+(?:is|was|will be))?\s*)(\d{3,7})(?![\p{L}\p{M}\p{N}])/giu;

export function toSpeech(text: string): string {
  let t = text;

  // Markdown that would be read literally.
  t = t.replace(/\*\*|__|`+/g, '');
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s*[-*•]\s+/gm, '');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Identifiers, spelled out. Long ones in groups of four, with a short pause between.
  t = t.replace(ALNUM_ID, id => spellOut(id));
  t = t.replace(LONG_DIGITS, n => spellOut(n));
  t = t.replace(NAMED_NUMBER, (_, before: string, label: string, n: string) => `${before}${label}${spellOut(n)}`);

  return t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

function spellOut(s: string): string {
  const chars = s.split('');
  if (chars.length <= 7) return chars.join(' ');
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(' '));
  return groups.join(', ');
}
