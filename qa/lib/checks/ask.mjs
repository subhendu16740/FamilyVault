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
import { DEV_REF } from '../config.mjs';
import { Budget } from '../budget.mjs';
import { condenses } from '../questions.mjs';
import {
  mentionsDate, mentionsAmount, mentionsPhone, mentionsText, refuses, scriptShare, hasMarkdown,
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
  if (e.script && scriptShare(answer, e.script) < 0.3) reasons.push(`expected the answer in ${e.script[0].toUpperCase()}${e.script.slice(1)} script`);
  if (e.no_markdown && hasMarkdown(answer)) reasons.push('voice answers must not contain markdown');

  // The pipeline's own health, on every question. embedded:false is the
  // exact shape of the HuggingFace outage that left every vector NULL.
  const debug = d.debug ?? {};
  if (debug.embedded === false) reasons.push(`the question was NOT embedded (${debug.embed_error ?? 'no reason given'}) — search fell back to keywords`);
  if (debug.index_rebuilding) reasons.push('the search index is still rebuilding');
  // A relation in the question must have become a name BEFORE search: the
  // right answer alone does not show it, when only one document could match.
  if (e.relative && !(debug.relatives ?? []).some((r) => r.name === e.relative)) {
    reasons.push(`expected the question to name ${e.relative} through the family tree (relatives: ${JSON.stringify(debug.relatives ?? [])})`);
  }

  return reasons;
}

// The people a question needs in QA Vault A's tree (migration 031), added
// once and kept, like the permanent documents: "my mother" means someone only
// when account A has a mother in the tree. Returns why the question cannot be
// asked, or null.
async function ensureFamily(a, vaultA, family) {
  const read = () => a.client.from('family_people').select('id, display_name, user_id').eq('family_id', vaultA.id);
  const { data: people, error } = await read();
  if (error) {
    return /PGRST205|42P01|could not find the table|does not exist/i.test(`${error.code} ${error.message}`)
      ? 'migration 031 is not applied to DEV yet'
      : `could not read the family tree: ${error.message}`;
  }
  const me = (people ?? []).find((p) => p.user_id === a.user.id);
  if (!me) return 'account A has no person of its own in the family tree';
  for (const f of family) {
    const found = (people ?? []).find((p) => p.display_name.toLowerCase() === f.name.toLowerCase());
    const { error: err } = found
      ? await a.client.rpc('link_family_people', { p_family_id: vaultA.id, p_person: found.id, p_relation: f.relation, p_relative: me.id })
      : await a.client.rpc('add_family_person', { p_family_id: vaultA.id, p_display_name: f.name, p_gender: f.gender ?? null, p_relation: f.relation, p_relative: me.id });
    if (err) return `could not put ${f.name} in the tree as account A's ${f.relation}: ${err.message}`;
  }
  return null;
}

// Each person asks 20 questions a month on Free (migration 049), and a QA run
// asks up to about 16 as account A. So before asking, QA starts account A's
// count for the month again — on DEV only, through the Management API, and
// only account A's row. Without SUPABASE_ACCESS_TOKEN it cannot, and once the
// month's questions are used up the rest are deferred, not failed.
async function startQuestionCount(cfg, a) {
  if (!cfg.managementToken) return 'no SUPABASE_ACCESS_TOKEN, so account A\'s monthly count was not started again';
  const id = String(a.user?.id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return 'account A has no user id';
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${DEV_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.managementToken}`, 'Content-Type': 'application/json' },
      // Before 049 there is no such table: nothing to start again.
      body: JSON.stringify({ query: `do $$ begin if to_regclass('public.question_usage') is not null then delete from public.question_usage where user_id = '${id}'; end if; end $$;` }),
    });
    return res.ok ? null : `the Management API answered ${res.status}`;
  } catch (err) {
    return String(err?.message ?? err);
  }
}

export async function runQuestions(cfg, { a, vaultA, notIndexed = new Map() }, results, questions) {
  const budget = new Budget(cfg.spacingSeconds);
  const answered = new Map();
  const transcript = [];
  let lastCount = null;
  let asked = 0;
  let countStarted = false;
  if (questions.length) {
    const why = await startQuestionCount(cfg, a);
    countStarted = !why;
    if (why) console.log(`    … ${why}`);
  }

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
    if (q.family?.length) {
      const why = await ensureFamily(a, vaultA, q.family);
      if (why) {
        results.add('questions', q.id, title, 'skipped', { why, ask: q.ask });
        continue;
      }
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
    asked++;
    if (d.questions && typeof d.questions === 'object') lastCount = d.questions;

    // This month's questions (049), or today's tries (050), are used up: a
    // limit kept, not a defect.
    if (r.status === 200 && d.question_limit) {
      budget.stop(d.questions?.reason === 'tries'
        ? "account A has tried as many questions as it can today (migration 050); the rest wait for tomorrow"
        : "account A's questions for this month are used up (migration 049); the rest wait for its count to start again");
      results.add('questions', q.id, title, 'deferred', { why: budget.reason, ...record });
      continue;
    }

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

  // Each question counted once on the server, never more than were asked,
  // and what the last answer said is what question_status() says now.
  if (lastCount) {
    const { data: now, error } = await a.client.rpc('question_status');
    const used = Number(now?.used);
    // Started again before asking, the count cannot pass the number asked.
    const ok = !error && Number.isFinite(used) && used === Number(lastCount.used) && (!countStarted || used <= asked);
    results.add('questions', 'question-count', 'Each question is counted once on the server, and an unanswered one given back (049)', ok ? 'pass' : 'fail',
      { why: error ? String(error.message).slice(0, 120) : `${used} counted${countStarted ? ` for ${asked} asked` : ''}; the last answer said ${lastCount.used}` });
  }

  return { budget: budget.estimate(), transcript };
}
