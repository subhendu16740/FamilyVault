// ─── Questions each month: the allowance, and the words for it (049) ─
//
// A question is the most expensive thing AskLocker does, so each person has
// a monthly allowance: 20 on Free (plan_limits.questions_per_month), and on
// Family Plus no monthly limit, up to a fair-use ceiling of 500
// (questions_fair_use). A month is a calendar month in India time.
//
// rag-search counts one through claim_question() before it answers, and
// gives it back when no answer came; Ask shows what question_status() says.
// Since 050 each try is counted for the day too (10 a day on Free, 100 on
// Plus), answered or not, and a try is never given back.
// Shared by both, so the app and the answer say the same thing. Pure
// TypeScript: no Deno, no React, so the QA self-test pins it in Node.
// ────────────────────────────────────────────────────────────────

/** What claim_question() / question_status() report for the person asking. */
export interface QuestionAllowance {
  /** Questions asked this month. */
  used: number;
  /** The plan's monthly number; null on a plan without one (Family Plus). */
  limit: number | null;
  /** The most that can be asked this month: the monthly number, or fair use. Null: no ceiling at all. */
  ceiling: number | null;
  /** Left of the ceiling. Null: no ceiling at all. */
  left: number | null;
  /** In a vault on Family Plus. */
  plus: boolean;
  /** The day the count starts again, YYYY-MM-DD. */
  resetsOn: string | null;
  /** Why a question was refused (050): the month's answers, or the day's tries. */
  reason?: 'month' | 'tries' | null;
  /** Questions tried today, and the most a day (050). */
  tries?: number | null;
  triesLimit?: number | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** The database's answer, or null when it is not one (before 049, an error). */
export function parseAllowance(raw: unknown): QuestionAllowance | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!('ceiling' in r) && !('limit' in r)) return null;
  const used = num(r.used) ?? 0;
  const ceiling = num(r.ceiling);
  const left = 'left' in r ? num(r.left) : ceiling == null ? null : Math.max(ceiling - used, 0);
  return {
    used,
    limit: num(r.limit),
    ceiling,
    left,
    plus: r.plus === true,
    resetsOn: typeof r.resets_on === 'string' ? r.resets_on.slice(0, 10) : null,
    // 050's, only when the database said them.
    ...(r.reason === 'tries' || r.reason === 'month' ? { reason: r.reason } : {}),
    ...(num(r.tries) != null ? { tries: num(r.tries) } : {}),
    ...(num(r.tries_limit) != null ? { triesLimit: num(r.tries_limit) } : {}),
  };
}

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
} as const;

/** "2026-11-01" → "1 November" (or "1 नवंबर"); null when it cannot be read. */
export function resetDay(resetsOn: string | null, language: 'en' | 'hi' = 'en'): string | null {
  const m = resetsOn?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return `${Number(m[3])} ${MONTHS[language][month]}`;
}

const isHindi = (language?: string) => (language ?? 'en').split('-')[0].toLowerCase() === 'hi';

/**
 * What the person reads, and hears, when this month's questions are used up:
 * on Free, that they start again on the 1st and that Family Plus has no
 * monthly limit; on Plus, that they asked the most one person can.
 */
export function questionLimitMessage(a: QuestionAllowance, language?: string): string {
  const hi = isHindi(language);
  if (a.reason === 'tries') {
    // The day's tries (050): answered or not, so asking again and again
    // cannot spend the AI service's day for everyone.
    const t = a.triesLimit ?? a.tries ?? 0;
    if (hi) {
      return a.plus
        ? `आपने आज ${t} सवाल पूछ लिए हैं, जो एक व्यक्ति के लिए एक दिन में सबसे ज़्यादा हैं। कल फिर से पूछ सकते हैं।`
        : `आपने आज ${t} सवाल पूछ लिए हैं, जो Free में एक दिन में सबसे ज़्यादा हैं। हर सवाल गिना जाता है, जवाब मिले या नहीं। कल फिर से पूछ सकते हैं।`;
    }
    return a.plus
      ? `You have asked ${t} questions today, the most one person can ask in a day. You can ask again tomorrow.`
      : `You have asked ${t} questions today, the most on Free in a day. Every question counts here, answered or not. You can ask again tomorrow.`;
  }
  const day = resetDay(a.resetsOn, hi ? 'hi' : 'en');
  const n = a.ceiling ?? a.used;
  if (hi) {
    const again = day ? ` ये ${day} को फिर से मिलेंगे।` : ' ये अगले महीने फिर से मिलेंगे।';
    return a.plus
      ? `आपने इस महीने ${n} सवाल पूछ लिए हैं, जो एक व्यक्ति के लिए सबसे ज़्यादा हैं।${again}`
      : `आपने इस महीने के अपने ${n} मुफ़्त सवाल पूछ लिए हैं।${again} Family Plus में हर महीने सवालों की कोई सीमा नहीं है।`;
  }
  const again = day ? ` They start again on ${day}.` : ' They start again next month.';
  return a.plus
    ? `You have asked ${n} questions this month, the most one person can ask.${again}`
    : `You have asked your ${n} free questions for this month.${again} With Family Plus there is no monthly limit.`;
}

/**
 * The line Ask shows: "12 of 20 free questions left this month", or null when
 * there is nothing worth saying (Family Plus, below the fair-use ceiling).
 */
export function questionsLeftText(a: QuestionAllowance): string | null {
  if (a.limit == null) {
    // Plus: say nothing until fair use is close.
    if (a.ceiling == null || a.left == null || a.left > 50) return null;
    return a.left === 0
      ? `You have asked the most questions one person can this month`
      : `${a.left} of ${a.ceiling} questions left this month`;
  }
  const left = a.left ?? Math.max(a.limit - a.used, 0);
  if (left === 0) return `You have used your ${a.limit} free questions this month`;
  return `${left} of ${a.limit} free question${a.limit === 1 ? '' : 's'} left this month`;
}

/** The allowance after one question was given back (no answer came of it). */
export function givenBack(a: QuestionAllowance): QuestionAllowance {
  const used = Math.max(a.used - 1, 0);
  return { ...a, used, left: a.ceiling == null ? null : Math.max(a.ceiling - used, 0) };
}

/** As the database writes it, for a response the app reads with parseAllowance(). */
export function allowanceJson(a: QuestionAllowance): Record<string, unknown> {
  return {
    used: a.used, limit: a.limit, ceiling: a.ceiling, left: a.left, plus: a.plus, resets_on: a.resetsOn,
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.tries != null ? { tries: a.tries } : {}),
    ...(a.triesLimit != null ? { tries_limit: a.triesLimit } : {}),
  };
}
