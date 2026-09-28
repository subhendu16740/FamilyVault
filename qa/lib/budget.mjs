// ─── Spending the free Groq budget carefully ────────────────────
//
// Every question costs three Groq calls inside rag-search. The expensive one
// is the relevance judge on openai/gpt-oss-20b: up to 15 passages of 1,600
// characters, roughly 6–7K tokens. The free tier allows that model 8K tokens
// a MINUTE and 200K a DAY (console.groq.com/docs/rate-limits), shared with
// anyone else using the same key.
//
// So QA:
//   - asks one question at a time, at least `spacing` apart (90s default),
//     keeping each minute's use under the per-minute limit with room left
//     for a real person searching at the same moment;
//   - backs off when Groq pushes back (rag-search reports a 429 as
//     `degraded` with `retry_after_seconds`), retries that question once,
//     and slows down for the rest of the run;
//   - stops asking entirely if Groq pushes back again. The remaining
//     questions are marked "deferred", not failed — a rate limit says the
//     budget is in use, not that the app is broken.
//
// The answer model (gpt-oss-120b) is the one real users feel. QA spends
// only ~2.5K tokens of its 200K a day per question, and the helper steps
// fall back gracefully in rag-search when they are rate-limited, so even a
// Groq key shared with PROD keeps answering people.
// ────────────────────────────────────────────────────────────────

import { sleep } from './supabase.mjs';

// Estimates for the report, not measurements: rag-search does not return
// token counts. Sized from its prompt budgets (RERANK_CANDIDATES × 1,600
// characters for the judge; MAX_CONTEXT_CHARS 6,000 for the answer).
export const TOKENS = { judge: 6500, condense: 1500, answer: 2500 };
export const FREE_DAILY_TOKENS = 200_000;

export class Budget {
  constructor(spacingSeconds) {
    this.spacingMs = Math.max(0, spacingSeconds) * 1000;
    this.lastAt = 0;
    this.open = false;
    this.reason = '';
    this.asked = 0;
    this.condensed = 0;
  }

  /** Wait until the next question is allowed, then count it. */
  async next({ condenses = false } = {}) {
    const wait = this.lastAt + this.spacingMs - Date.now();
    if (this.lastAt && wait > 0) {
      console.log(`    … pacing: waiting ${Math.round(wait / 1000)}s before the next question (Groq free tier)`);
      await sleep(wait);
    }
    this.lastAt = Date.now();
    this.asked++;
    if (condenses) this.condensed++;
  }

  /**
   * Groq said "slow down": wait as long as it asked before the ONE retry of
   * this question, and space every later question further apart. The retry
   * is counted — the steps before the rate-limited one still spent tokens.
   */
  async backOff(retryAfterSeconds, { condenses = false } = {}) {
    const seconds = Math.min(Math.max(Number(retryAfterSeconds) || 60, 20), 120);
    this.spacingMs = Math.min(Math.max(this.spacingMs, 60_000) * 1.5, 180_000);
    console.log(`    … Groq rate limit: retrying in ${seconds}s, then spacing questions ${Math.round(this.spacingMs / 1000)}s apart`);
    await sleep(seconds * 1000);
    this.lastAt = Date.now();
    this.asked++;
    if (condenses) this.condensed++;
  }

  stop(reason) {
    this.open = true;
    this.reason = reason;
  }

  estimate() {
    const helper = this.asked * TOKENS.judge + this.condensed * TOKENS.condense;
    const answer = this.asked * TOKENS.answer;
    return {
      asked: this.asked,
      helperTokens: helper,
      answerTokens: answer,
      helperShare: helper / FREE_DAILY_TOKENS,
      answerShare: answer / FREE_DAILY_TOKENS,
    };
  }
}
