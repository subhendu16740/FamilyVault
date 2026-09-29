// Dates as ingest stores them: exactly as found on the page.
//
// `extractMetadata()` (supabase/functions/_shared/metadata.ts) keeps the
// matched text, not a normalised date, so an expiry arrives in one of three
// shapes: day-month-year with any of / - . or a space between ("19/10/2026",
// "19-10-26"), year-month-day ("2026-10-19"), or a written month ("19 October
// 2026", "19 Oct 2026"). Day-month order is the Indian convention, and the one
// the extraction patterns look for.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function make(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // 31/02 rolls over into March; that is not a date.
  return date.getMonth() === month - 1 ? date : null;
}

export function parseDocumentDate(value: string): Date | null {
  const v = value.trim();

  let m = v.match(/^(\d{4})[\s/.-]+(\d{1,2})[\s/.-]+(\d{1,2})$/);
  if (m) return make(+m[1], +m[2], +m[3]);

  m = v.match(/^(\d{1,2})[\s/.-]+(\d{1,2})[\s/.-]+(\d{2}|\d{4})$/);
  if (m) return make(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);

  m = v.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return make(+m[3], month + 1, +m[1]);
  }
  return null;
}

/** "19 October 2026" — how dates are written to the person. */
export function longDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "Runs out in 20 days", "Runs out today", "Ran out 3 days ago". */
export function expiryPhrase(daysLeft: number): string {
  if (daysLeft === 0) return 'Runs out today';
  if (daysLeft === 1) return 'Runs out tomorrow';
  if (daysLeft > 1) return daysLeft <= 60 ? `Runs out in ${daysLeft} days` : `Runs out in about ${Math.round(daysLeft / 30)} months`;
  return daysLeft === -1 ? 'Ran out yesterday' : `Ran out ${-daysLeft} days ago`;
}
