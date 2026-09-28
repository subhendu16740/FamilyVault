// ─── Which questions a run asks ─────────────────────────────────
//
//   smoke         the `smoke` tier only — after every deploy to DEV
//   nightly       smoke + core + ONE rotating group, chosen by the date, so
//                 the whole set is covered every few nights while no single
//                 night spends more than about a third of the free budget
//   full          every question above, for a deliberate manual run
//   languages     the `languages` tier only: documents and questions in the
//                 Indian languages the app offers, by hand, never on a
//                 schedule — it alone is close to half the free day
//   no-questions  none — database, access and upload checks only, which
//                 spend no Groq budget at all
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { TOKENS, FREE_DAILY_TOKENS } from './budget.mjs';
import { SCRIPTS } from './match.mjs';

const TIERS = ['smoke', 'core', 'rotate', 'languages'];
const ASSERTIONS = ['date', 'amount', 'not_amount', 'text', 'phone', 'not_phone', 'refuses', 'not_regex', 'source', 'answer_language', 'script', 'no_markdown'];

export function loadQuestions(path) {
  const doc = parse(readFileSync(path, 'utf8'));
  const questions = doc?.questions;
  if (!Array.isArray(questions) || questions.length === 0) throw new Error(`${path} has no questions`);
  const seen = new Set();
  for (const q of questions) {
    const where = `question ${q.id ?? '(no id)'}`;
    if (!q.id || !q.ask) throw new Error(`${where}: needs an id and an ask`);
    if (seen.has(q.id)) throw new Error(`${where}: duplicate id`);
    if (!TIERS.includes(q.tier)) throw new Error(`${where}: tier must be one of ${TIERS.join(', ')}`);
    if (q.tier === 'rotate' && !Number.isInteger(q.group)) throw new Error(`${where}: rotating questions need an integer group`);
    if (q.after && !seen.has(q.after)) throw new Error(`${where}: 'after: ${q.after}' must name an EARLIER question`);
    const keys = Object.keys(q.expect ?? {});
    if (!keys.length) throw new Error(`${where}: has no expectations`);
    for (const key of keys) if (!ASSERTIONS.includes(key)) throw new Error(`${where}: unknown expectation '${key}'`);
    if (q.expect.script && !SCRIPTS[q.expect.script]) throw new Error(`${where}: script must be one of ${Object.keys(SCRIPTS).join(', ')}`);
    seen.add(q.id);
  }
  return questions;
}

export const groupCount = (questions) => Math.max(1, ...questions.filter((q) => q.tier === 'rotate').map((q) => q.group));

/** Day number since the epoch, so every run on one UTC day picks the same group. */
export function rotationGroup(date, groups) {
  return (Math.floor(date.getTime() / 86_400_000) % groups) + 1;
}

export function selectQuestions(questions, suite, group) {
  switch (suite) {
    case 'no-questions':
      return [];
    case 'smoke':
      return questions.filter((q) => q.tier === 'smoke');
    case 'nightly':
      return questions.filter((q) => q.tier === 'smoke' || q.tier === 'core' || (q.tier === 'rotate' && q.group === group));
    case 'full':
      return questions.filter((q) => q.tier !== 'languages');
    case 'languages':
      return questions.filter((q) => q.tier === 'languages');
    default:
      throw new Error(`Unknown suite ${suite}`);
  }
}

/** A question in another language or mid-conversation also runs the condense step. */
export const condenses = (q) => Boolean(q.language || q.after);

export function estimateFor(questions) {
  const helper = questions.reduce((sum, q) => sum + TOKENS.judge + (condenses(q) ? TOKENS.condense : 0), 0);
  const answer = questions.length * TOKENS.answer;
  return { helper, answer, helperShare: helper / FREE_DAILY_TOKENS, answerShare: answer / FREE_DAILY_TOKENS };
}
