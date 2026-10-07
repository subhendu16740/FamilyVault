// ─── Which passages an answer used ─────────────────────────────
//
// The answer model is shown numbered passages and ends its reply with one
// line, "USED: 2, 3", or "USED: none" when nothing in them answers the
// question. The source chips under an answer come from that line. A document
// that was only retrieved therefore never shows as a source: before this, a
// bank statement sent alongside the hotel booking that held the answer
// appeared beside it. The line is taken off before the answer is shown or
// read aloud. Pure, so the QA self-test runs it.
// ────────────────────────────────────────────────────────────────

/** What the answer model is told to add. English and plain digits, whatever language it answers in. */
export const USED_PASSAGES_RULE =
  'After your answer, add one last line: "USED:" and the numbers of the passages your answer relies on, for example "USED: 2, 3", or "USED: none" if none of them answers the question. Write that line in English with plain digits, whatever language you answer in.';

// "USED:" — perhaps in bold or code, perhaps "Used passages:" — then the list:
// "none", or numbers in any script with commas, "and", "और" or "&" between
// them — at least one number, or "none". Nothing else may follow on the
// line, so an answer that merely says "used:" somewhere is left alone.
const LABEL = String.raw`[*_\x60]*used(?:[ \t]+passages?)?[*_\x60]*[ \t]*[:：]`;
const SEP = String.raw`[ \t*_\x60.,;&\-]|and|और`;
const LIST = String.raw`((?:${SEP})*(?:\p{Nd}+|none)(?:${SEP}|\p{Nd}|none)*)`;
// On a line of its own, anywhere — a model sometimes adds a note after it.
const OWN_LINE = new RegExp(String.raw`^[ \t]*${LABEL}${LIST}$`, 'gimu');
// At the end of the answer's last line, after a space.
const LINE_END = new RegExp(String.raw`(\s)${LABEL}${LIST}\s*$`, 'iu');

/** A digit in Devanagari, Bengali, Tamil… or Arabic-Indic, as 0–9; other characters unchanged. */
function plainDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0)!;
    if (cp >= 0x30 && cp <= 0x39) return d;
    if (cp >= 0x0900 && cp <= 0x0dff && (cp & 0x7f) >= 0x66 && (cp & 0x7f) <= 0x6f) return String((cp & 0x7f) - 0x66);
    if (cp >= 0x0660 && cp <= 0x0669) return String(cp - 0x0660);
    if (cp >= 0x06f0 && cp <= 0x06f9) return String(cp - 0x06f0);
    if (cp >= 0xff10 && cp <= 0xff19) return String(cp - 0xff10);
    return d;
  });
}

/** The numbers in a "USED:" list; [] for "none"; null when it names nothing. */
function numbers(list: string): number[] | null {
  const found = [...new Set((plainDigits(list).match(/[0-9]+/g) ?? []).map(Number))];
  if (found.length) return found;
  return /none/i.test(list) ? [] : null;
}

/**
 * The model's reply, split into the answer and the passages it says it used.
 * `used` is null when the reply has no such line, or one naming nothing (a
 * model that ignored the instruction): the caller then lists every passage
 * it sent, as before. An empty list means "none". Every "USED:" line is
 * taken out of the answer; the last one counts.
 */
export function splitUsedPassages(reply: string): { answer: string; used: number[] | null } {
  const lines = [...reply.matchAll(OWN_LINE)];
  if (lines.length) {
    return {
      answer: reply.replace(OWN_LINE, '').replace(/\n{3,}/g, '\n\n').trim(),
      used: numbers(lines[lines.length - 1][1]),
    };
  }
  const end = LINE_END.exec(reply);
  if (end) return { answer: reply.slice(0, end.index + end[1].length).trim(), used: numbers(end[2]) };
  return { answer: reply.trim(), used: null };
}

/**
 * The passages an answer used, from the 1-based numbers it gave. Numbers
 * that point at nothing are dropped; if none points anywhere, every passage
 * is kept, since a list of wrong numbers says nothing about what was read.
 */
export function passagesUsed<T>(passages: T[], used: number[] | null): T[] {
  if (used === null) return passages;
  if (used.length === 0) return [];
  const picked = used.filter((n) => Number.isInteger(n) && n >= 1 && n <= passages.length).map((n) => passages[n - 1]);
  return picked.length ? picked : passages;
}
