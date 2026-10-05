// ─── Tickets: the words they use, and what their codes mean ──────
//
// An Indian Railways ticket never says "seat". The berth is under Booking
// Status and Current Status, written as a code — "CNF/B4/17 UB" — so a
// question about a seat found the one passage that did say "seat" (an
// instruction about ordering meals) and never the berth, and nothing told the
// model what the code meant. Pure, so rag-search and the QA self-test share it:
//
//   ticketSearchTerms(question)  more words to search with, when a question
//                                asks about a seat, berth, coach or PNR
//   ticketCodeNotes(texts)       what each status code in some passages means,
//                                in words, for the judge and the answer
//
// Only what the code itself says is spelled out — status, coach, berth and its
// type. What a coach letter means differs between trains, so it is left to the
// ticket's own Class line.
// ────────────────────────────────────────────────────────────────

const SEAT_QUESTION = /\b(seats?|berths?|coach(es)?|bogies?|compartments?)\b/i;
const PNR_QUESTION = /\b(pnr|ticket\s+(no|number))\b/i;

/** Words a ticket uses for what the question asks about; none for other questions. */
export function ticketSearchTerms(question: string): string[] {
  const terms: string[] = [];
  if (SEAT_QUESTION.test(question)) terms.push('seat', 'berth', 'coach', 'status');
  if (PNR_QUESTION.test(question)) terms.push('pnr');
  return terms;
}

const BERTH_TYPES: Record<string, string> = {
  LB: 'lower berth', MB: 'middle berth', UB: 'upper berth',
  SL: 'side lower berth', SM: 'side middle berth', SU: 'side upper berth',
  LOWER: 'lower berth', MIDDLE: 'middle berth', UPPER: 'upper berth',
  'SIDE LOWER': 'side lower berth', 'SIDE MIDDLE': 'side middle berth', 'SIDE UPPER': 'side upper berth',
  WS: 'window seat', WINDOW: 'window seat', 'WINDOW SIDE': 'window seat',
  MS: 'middle seat', AS: 'aisle seat', AISLE: 'aisle seat',
};

// "CNF/B4/17 UB", "CNF/B3/45/LOWER", "RAC/S4/45": a status, a coach, a berth
// number, and sometimes the berth's type.
const WITH_BERTH = new RegExp(
  String.raw`\b(CNF|RAC)\s*/\s*([A-Z]{1,2}\d{1,2})\s*/\s*(\d{1,3})` +
  String.raw`(?:\s*/?\s*(SIDE\s+(?:LOWER|MIDDLE|UPPER)|WINDOW(?:\s+SIDE)?|LOWER|MIDDLE|UPPER|AISLE|LB|MB|UB|SL|SM|SU|WS|MS|AS)\b)?`,
  'gi',
);
// "GNWL/25", "WL 12", "RLWL/7", "RAC 14": a place in a queue, no berth yet.
const WAITING = /\b((?:GN|RL|PQ|TQ|RS|RQ|CK)?WL|RAC)\s*\/?\s*(\d{1,3})\b(?!\s*\/)/gi;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** What the status codes in these passages mean, once each, at most `max`. */
export function ticketCodeNotes(texts: string[], max = 6): string[] {
  const notes = new Map<string, string>();
  for (const text of texts) {
    for (const m of text.matchAll(WITH_BERTH)) {
      const code = squash(m[0]);
      const type = m[4] ? BERTH_TYPES[squash(m[4])] : undefined;
      const where = `coach ${m[2].toUpperCase()}, berth ${Number(m[3])}${type ? `, ${type}` : ''}`;
      notes.set(code, m[1].toUpperCase() === 'CNF'
        ? `${code} means confirmed: ${where}.`
        : `${code} means RAC, not yet a berth of their own (shared until confirmed): ${where}.`);
    }
    for (const m of text.matchAll(WAITING)) {
      const code = squash(m[0]);
      notes.set(code, m[1].toUpperCase() === 'RAC'
        ? `${code} means RAC number ${Number(m[2])}: a shared berth, not yet confirmed.`
        : `${code} means waitlisted, number ${Number(m[2])}: no berth yet.`);
    }
  }
  return [...notes.values()].slice(0, max);
}
