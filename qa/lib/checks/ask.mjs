// ─── Questions: the part that spends Groq budget ────────────────
//
// Each question goes to rag-search exactly as the search screen sends it
// (same body, same history shape for follow-ups) and the answer is judged on
// facts, sources and the pipeline's own debug report — never on wording.
//
// Pacing, back-off and the stop rule live in budget.mjs. A rate-limited
// answer is "inconclusive" and a question not asked is "deferred": neither
// fails the run, because neither says the app is broken.
// ────────────────────────────────────────────────────────────────

import { invokeFunction } from '../supabase.mjs';
import { Budget } from '../budget.mjs';
import { condenses } from '../questions.mjs';
import {
  mentionsDate, mentionsAmount, mentionsPhone, mentionsText, refuses, devanagariShare, hasMarkdown,
} from '../match.mjs';

const isRateLimited = (r) => r.status === 429 || (r.data?.degraded === true && r.data?.retry_after_seconds != null);

export function judgeAnswer(q, d) {
  const e = q.expect ?? {};
  const answer = String(d.answer ?? '');
  const sources = (d.sources ?? []).map((s) => s.file_name);
  const reasons = [];

  if (e.date && !mentionsDate(answer, e.date)) reasons.push(`expected the date ${e.date}`);
  if (e.amount != null && !mentionsAmount(answer, e.amount)) reasons.push(`expected the amount ${e.amount}`);
  if (e.not_amount != null && mentionsAmount(answer, e.not_amount)) reasons.push(`gave ${e.not_amount}, which belongs to someone else`);
  if (e.text && !mentionsText(answer, e.text)) reasons.push(`expected "${e.text}"`);
  if (e.phone && !mentionsPhone(answer, e.phone)) reasons.push(`expected the number ${e.phone}`);
  if (e.not_phone && mentionsPhone(answer, e.not_phone)) reasons.push(`gave ${e.not_phone}, which is someone else's number`);
  if (e.refuses && !refuses(answer)) reasons.push('expected it to say the documents do not answer this');
  if (e.not_regex && new RegExp(e.not_regex, 'u').test(answer)) reasons.push(`contains an invented value (matched /${e.not_regex}/)`);
  if (e.source && !sources.includes(e.source)) reasons.push(`expected ${e.source} among the sources (got ${sources.join(', ') || 'none'})`);
  if (e.answer_language && !String(d.answer_language ?? '').startsWith(e.answer_language)) {
    reasons.push(`expected an answer in ${e.answer_language} (answer_language: ${d.answer_language ?? 'missing'})`);
  }
  if (e.script === 'devanagari' && devanagariShare(answer) < 0.3) reasons.push('expected the answer in Devanagari script');
  if (e.no_markdown && hasMarkdown(answer)) reasons.push('voice answers must not contain markdown');

  // The pipeline's own health, on every question. embedded:false is the
  // exact shape of the HuggingFace outage that left every vector NULL.
  const debug = d.debug ?? {};
  if (debug.embedded === false) reasons.push(`the question was NOT embedded (${debug.embed_error ?? 'no reason given'}) — search fell back to keywords`);
  if (debug.index_rebuilding) reasons.push('the search index is still rebuilding');

  return reasons;
}

export async function runQuestions(cfg, { a, vaultA, notIndexed = new Map() }, results, questions) {
  const budget = new Budget(cfg.spacingSeconds);
  const answered = new Map();
  const transcript = [];

  for (const q of questions) {
    const title = `${q.id}: ${q.ask}`;
    if (budget.open) {
      results.add('questions', q.id, title, 'deferred', { why: budget.reason, ask: q.ask });
      continue;
    }
    // A question about a document that is not indexed cannot pass; asking it
    // would only spend budget to repeat what setup already reported.
    const missing = q.expect?.source && notIndexed.get(q.expect.source);
    if (missing) {
      results.add('questions', q.id, title, 'skipped', { why: `${q.expect.source} is not indexed this run (${missing.status}) — see setup`, ask: q.ask });
      continue;
    }
    const parent = q.after ? answered.get(q.after) : null;
    if (q.after && !parent) {
      results.add('questions', q.id, title, 'skipped', { why: `follow-up to ${q.after}, which did not get an answer this run`, ask: q.ask });
      continue;
    }

    // The same shape search.tsx builds: earlier turns, with the sources the
    // server pins into context for a follow-up.
    const history = parent
      ? [
          { role: 'user', content: parent.ask },
          { role: 'assistant', content: parent.answer, sources: parent.sources, source_ids: parent.sources.map((s) => s.id) },
        ]
      : [];
    const body = {
      family_id: vaultA.id,
      query: q.ask,
      history,
      ...(q.language ? { language: q.language } : {}),
      ...(q.voice ? { voice: true } : {}),
    };

    await budget.next({ condenses: condenses(q) });
    let r = await invokeFunction(cfg, a, 'rag-search', body, { timeoutMs: 120_000 });
    if (isRateLimited(r)) {
      await budget.backOff(r.data?.retry_after_seconds, { condenses: condenses(q) });
      r = await invokeFunction(cfg, a, 'rag-search', body, { timeoutMs: 120_000 });
      if (isRateLimited(r)) {
        budget.stop('Groq rate-limited twice in a row; the rest wait for the next run');
        results.add('questions', q.id, title, 'inconclusive', { why: 'rate-limited by Groq (free tier) — not a defect', ask: q.ask });
        continue;
      }
    }

    const d = r.data ?? {};
    const record = { ask: q.ask, answer: String(d.answer ?? ''), sources: d.sources ?? [], answer_language: d.answer_language, debug: d.debug, ms: r.ms };
    transcript.push({ id: q.id, status: r.status, ...record });

    if (r.status !== 200) {
      results.add('questions', q.id, title, 'fail', { why: `rag-search answered HTTP ${r.status}: ${d.error ?? JSON.stringify(d).slice(0, 160)}`, ...record });
      continue;
    }
    if (d.degraded) {
      // Not a rate limit (that was handled above): the answer model itself
      // is unavailable — the shape of the ten-week outage that went unseen.
      results.add('questions', q.id, title, 'fail', { why: `no model answer (degraded): ${record.answer.slice(0, 120)}`, ...record });
      if (results.inArea('questions').filter((c) => c.status === 'fail' && /degraded/.test(c.why ?? '')).length >= 2) {
        budget.stop('the answer model is unavailable; asking more would only repeat the failure');
      }
      continue;
    }

    answered.set(q.id, record);
    const reasons = judgeAnswer(q, d);
    const rerankLimited = /429|rate/i.test(String(d.debug?.rerank_error ?? ''));
    const status = reasons.length === 0 ? 'pass' : rerankLimited ? 'inconclusive' : 'fail';
    results.add('questions', q.id, title, status, {
      why: reasons.length ? reasons.join('; ') + (rerankLimited ? ' (the relevance judge was rate-limited, so this is retried later)' : '') : `${(r.ms / 1000).toFixed(1)}s`,
      ...record,
    });
  }

  return { budget: budget.estimate(), transcript };
}
