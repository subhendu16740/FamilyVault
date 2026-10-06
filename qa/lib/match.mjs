// ─── Judging an answer without judging its wording ──────────────
//
// The answer model writes free text, so an exact-match check would fail on
// every rephrasing. These look for the FACT in any common form instead:
// 19/07/2033, 19 July 2033, July 19, 2033 and 19 जुलाई 2033 are one date;
// ₹3,00,000, 300000 and 3 lakh are one amount. No model judges the model —
// that would cost Groq budget and add a second thing that can be wrong.
// ────────────────────────────────────────────────────────────────

// The digits of every Indian script: each block puts 0–9 at offset 0x66, so
// ২,৮৪৫ (Bengali), ૧,૧૦૩ (Gujarati) and ௫,௧௨௦ (Tamil) read as ASCII amounts.
const INDIC_DIGIT = /[\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F]/g;

/** Indian-script digits → ASCII, curly apostrophes → straight. */
export function normalise(text) {
  return String(text ?? '')
    .replace(INDIC_DIGIT, (d) => String((d.codePointAt(0) & 0x7f) - 0x66))
    .replace(/[‘’ʼ]/g, "'");
}

const MONTHS = [
  ['january', 'jan', 'जनवरी'],
  ['february', 'feb', 'फ़रवरी', 'फरवरी'],
  ['march', 'mar', 'मार्च'],
  ['april', 'apr', 'अप्रैल'],
  ['may', 'मई'],
  ['june', 'jun', 'जून'],
  ['july', 'jul', 'जुलाई'],
  ['august', 'aug', 'अगस्त'],
  ['september', 'sept', 'sep', 'सितंबर', 'सितम्बर'],
  ['october', 'oct', 'अक्टूबर', 'अक्तूबर'],
  ['november', 'nov', 'नवंबर', 'नवम्बर'],
  ['december', 'dec', 'दिसंबर', 'दिसम्बर'],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentionsDate(answer, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const text = normalise(answer).toLowerCase();
  const dd = `0?${d}`;
  const mm = `0?${m}`;
  const yy = `(?:${y}|${String(y).slice(2)})`;
  // "30/11/2026", "30.11.2026", "30 11 2026" — and "30 / 11 / 2026", which
  // the answer model copies from PDFs whose text layer spaces the slashes.
  const sep = '(?:\\s*[./-]\\s*|\\s+)';
  const names = MONTHS[m - 1].map(escapeRe).join('|');
  const ord = '(?:st|nd|rd|th)?';
  return [
    `(?<!\\d)${dd}${sep}${mm}${sep}${yy}(?!\\d)`, // 19/07/2033
    `(?<!\\d)${mm}${sep}${dd}${sep}${yy}(?!\\d)`, // 07/19/2033
    `(?<!\\d)${y}${sep}${mm}${sep}${dd}(?!\\d)`, // 2033-07-19
    `(?<!\\d)${dd}${ord}\\s*(?:of\\s+)?(?:${names})\\.?,?\\s*${y}`, // 19 July 2033
    `(?:${names})\\.?\\s*${dd}${ord},?\\s*${y}`, // July 19, 2033
  ].some((p) => new RegExp(p, 'u').test(text));
}

/** Every amount in the text, reading Indian grouping and lakh / crore. */
export function amountsIn(answer) {
  const text = normalise(answer);
  const values = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|लाख|crores?|करोड़)/giu)) {
    values.push(parseFloat(m[1]) * (/crore|करोड़/iu.test(m[2]) ? 1e7 : 1e5));
  }
  for (const m of text.matchAll(/(?<![\d.,])\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|(?<![\d.,])\d+(?:\.\d+)?/g)) {
    values.push(parseFloat(m[0].replace(/,/g, '')));
  }
  return values;
}

export const mentionsAmount = (answer, value) => amountsIn(answer).some((v) => Math.abs(v - value) < 0.5);

/** A phone number, however it is spaced or prefixed. */
export const mentionsPhone = (answer, digits) => normalise(answer).replace(/\D/g, '').includes(digits);

/** An identifier or word, ignoring case, spaces and punctuation. */
export function mentionsText(answer, needle) {
  const compact = (s) => normalise(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return compact(answer).includes(compact(needle));
}

// The model is told to "say so plainly" when the documents do not answer the
// question, and rag-search has two fixed "I couldn't find" replies of its own.
const REFUSAL =
  /\b(couldn't|could not|can't|cannot|unable to|didn't|did not|don't|do not|doesn't|does not)\b[^.]{0,60}?\b(find|locate|see|contain|mention|include|have|say|show|specify|list)\b|\bno (information|mention|record|details?|documents?|data)\b|\bnot (mentioned|available|found|provided|present|included|listed|specified|stated)\b|\bnone of (the|your)\b|\bthere (is|are) no\b/i;

export const refuses = (answer) => REFUSAL.test(normalise(answer));

// The Unicode block of each script the app offers (voice-languages.ts).
// Marathi is written in Devanagari, like Hindi.
export const SCRIPTS = {
  devanagari: [0x0900, 0x097f],
  bengali: [0x0980, 0x09ff],
  gurmukhi: [0x0a00, 0x0a7f],
  gujarati: [0x0a80, 0x0aff],
  tamil: [0x0b80, 0x0bff],
  telugu: [0x0c00, 0x0c7f],
  kannada: [0x0c80, 0x0cff],
  malayalam: [0x0d00, 0x0d7f],
};

/** How much of an answer's writing is in `script` — letters and vowel signs both count. */
export function scriptShare(answer, script) {
  const [from, to] = SCRIPTS[script];
  const letters = String(answer ?? '').match(/[\p{L}\p{M}]/gu) ?? [];
  if (!letters.length) return 0;
  return letters.filter((c) => c.codePointAt(0) >= from && c.codePointAt(0) <= to).length / letters.length;
}

export const devanagariShare = (answer) => scriptShare(answer, 'devanagari');

export const hasMarkdown = (answer) => /(\*\*|__|`|^#{1,6}\s|^\s*[-*]\s)/m.test(String(answer ?? ''));
