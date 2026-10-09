#!/usr/bin/env node
// ─── AskLocker QA ─────────────────────────────────────────────
//
// Uploads synthetic SPECIMEN documents to the DEV project, asks questions
// about them, and checks the answers — plus the database, access and upload
// checks that guard the failures this project has actually had.
//
//   node run.mjs --plan                 what a run would do; no network
//   node run.mjs --suite smoke          after a deploy (3 questions)
//   node run.mjs --suite nightly        the nightly run (8–9 questions)
//   node run.mjs --suite full           everything but languages (15 questions)
//   node run.mjs --suite languages      eight more Indian languages (12 questions)
//   node run.mjs --suite no-questions   spends no Groq budget at all
//   node run.mjs --only db,access       just those areas
//
// Needs: QA_SUPABASE_ANON_KEY, QA_A_EMAIL, QA_A_PASSWORD, QA_B_EMAIL,
// QA_B_PASSWORD; optionally SUPABASE_ACCESS_TOKEN (database checks),
// QA_SUPABASE_URL (defaults to DEV — PROD is refused), QA_SPACING_SECONDS.
//
// Order is cheapest first: database and access checks spend nothing,
// upload spends one small embedding call and one OCR request, and the
// questions — the only part that spends Groq budget — run last.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, loadConfig, runDate } from './lib/config.mjs';
import { signIn, anonActor } from './lib/supabase.mjs';
import { Results } from './lib/results.mjs';
import { loadQuestions, groupCount, rotationGroup, selectQuestions, estimateFor } from './lib/questions.mjs';
import { ensureVault, syncFixtures, VAULT_A, VAULT_B } from './lib/vault.mjs';
import { runDbChecks } from './lib/checks/db.mjs';
import { runAccessChecks } from './lib/checks/access.mjs';
import { runMemberChecks } from './lib/checks/members.mjs';
import { runUploadChecks, checkIndex } from './lib/checks/upload.mjs';
import { runQuestions } from './lib/checks/ask.mjs';
import { startQaDay } from './lib/dev-day.mjs';
import { writeReport, annotate } from './lib/report.mjs';

const QUESTIONS = fileURLToPath(new URL('./questions.yaml', import.meta.url));
const OUT = fileURLToPath(new URL('./out/', import.meta.url));

const section = (name) => console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);

function describePlan(args, selected, group, groups, today) {
  const rotation = args.suite === 'nightly' ? `rotation group ${group} of ${groups} (${today.toISOString().slice(0, 10)})`
    : args.suite === 'full' ? 'all rotation groups'
    : args.suite === 'languages' ? 'the languages tier only' : 'no rotation';
  const est = estimateFor(selected);
  console.log(`AskLocker QA — suite "${args.suite}", ${rotation}`);
  console.log(`Areas: ${args.only ? args.only.join(', ') : 'db, access, upload, ask'}`);
  if (!selected.length) {
    console.log('Questions: none — this run spends no Groq budget.');
  } else {
    console.log(`Questions: ${selected.length}, asked one at a time with pacing:`);
    selected.forEach((q, i) => console.log(`  ${String(i + 1).padStart(2)}. [${q.tier}${q.group ? ` ${q.group}` : ''}] ${q.ask}`));
    console.log(
      `Groq estimate: ≈${Math.round(est.helper / 1000)}K tokens on gpt-oss-20b (${Math.round(est.helperShare * 100)}% of its free 200K/day), ` +
        `≈${Math.round(est.answer / 1000)}K on gpt-oss-120b (${Math.round(est.answerShare * 100)}%).`,
    );
  }
  return rotation;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = loadQuestions(QUESTIONS);
  const groups = groupCount(all);
  const today = runDate();
  const group = rotationGroup(today, groups);
  const want = (area) => !args.only || args.only.includes(area);
  const selected = want('ask') ? selectQuestions(all, args.suite, group) : [];

  const rotation = describePlan(args, selected, group, groups, today);
  if (args.plan) return 0;

  const cfg = loadConfig();
  const results = new Results();
  const meta = { suite: args.suite, rotation, startedAt: new Date().toISOString(), commit: cfg.commit, runId: cfg.runId, spacingSeconds: cfg.spacingSeconds };
  let budget = null;
  let transcript = [];

  try {
    if (want('db')) {
      section('Database');
      await runDbChecks(cfg, results);
    }

    if (want('access') || want('upload') || want('ask')) {
      section('Setup');
      const a = await signIn(cfg, 'QA account A', cfg.a);
      const b = await signIn(cfg, 'QA account B', cfg.b);
      const anon = anonActor(cfg);
      const vaultA = await ensureVault(a, VAULT_A);
      const vaultB = await ensureVault(b, VAULT_B);
      for (const v of [vaultA, vaultB]) if (v.created) results.note('setup', `created ${v.name} (${v.namespace})`);
      const dayWhy = await startQaDay(cfg, { a, b, vaultA });
      if (dayWhy) results.note('setup', dayWhy);
      const { docs: docsA, notIndexed } = await syncFixtures(cfg, a, vaultA, results);

      if (want('access')) {
        section('Access');
        await runAccessChecks(cfg, { a, b, anon, vaultA, vaultB, docsA }, results);
        // After the stranger probes: this one makes B an insider, then removes it.
        section('Members');
        await runMemberChecks(cfg, { a, b, vaultA }, results);
      }
      if (want('upload')) {
        section('Upload');
        await runUploadChecks(cfg, { a, vaultA }, results, today);
      }
      section('Index');
      await checkIndex(cfg, a, vaultA, results, notIndexed);

      if (selected.length) {
        section(`Questions (${selected.length})`);
        ({ budget, transcript } = await runQuestions(cfg, { a, vaultA, notIndexed }, results, selected));
      }
    }
  } catch (err) {
    results.add('setup', 'fatal', 'The run could not continue', 'fail', { why: err?.message ?? String(err) });
  }

  meta.finishedAt = new Date().toISOString();
  meta.budget = budget;
  // Known issues found by tools/check-fixtures.mjs, when it ran first (CI does).
  try {
    meta.fixtureWarnings = JSON.parse(readFileSync(new URL('./out/fixture-warnings.json', import.meta.url), 'utf8'));
  } catch {
    meta.fixtureWarnings = [];
  }
  const markdown = writeReport(OUT, results, meta, transcript);
  annotate(results);
  section('Summary');
  console.log(markdown);
  return results.failed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // Configuration errors (a missing secret, the PROD guard) are sentences
    // meant for a person; a stack trace would only bury them.
    console.error(`\nQA did not start: ${err?.message ?? err}`);
    process.exit(1);
  },
);
