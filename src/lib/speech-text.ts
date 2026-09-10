// Turn an answer into something a voice can read well.
//
// The server already writes voice-mode answers in plain sentences, but a
// model slips sometimes, and identifiers are a problem no prompt fixes: a
// voice reads "ABCDE1234F" as a word and "123456789012" as a number in the
// hundreds of billions. Spelling them out character by character is how a
// person would read a PAN or Aadhaar number to someone over the phone.

/** Alphanumeric ID: 6+ chars, at least one letter and one digit, e.g. PAN, passport, policy numbers. */
const ALNUM_ID = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b/g;
/** Long digit runs (8+): Aadhaar, phone, account numbers. Not years or amounts. */
const LONG_DIGITS = /\b\d{8,}\b/g;

export function toSpeech(text: string): string {
  let t = text;

  // Markdown that would be read literally.
  t = t.replace(/\*\*|__|`+/g, '');
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s*[-*•]\s+/gm, '');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Identifiers, spelled out. Groups of four with a short pause between.
  t = t.replace(ALNUM_ID, id => spellOut(id));
  t = t.replace(LONG_DIGITS, n => spellOut(n));

  return t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

function spellOut(s: string): string {
  const chars = s.split('');
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(' '));
  return groups.join(', ');
}
