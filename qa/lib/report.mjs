// ─── The report: a summary a person reads, and a transcript to diff ─
//
// out/summary.md     appended to the GitHub Actions run summary
// out/results.json   every check, and every question with its full answer,
//                    sources and debug block — the record to compare when an
//                    answer that used to pass starts failing
// ────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON } from './results.mjs';

const AREAS = [
  ['database', 'Database'],
  ['setup', 'Setup'],
  ['access', 'Access'],
  ['upload', 'Upload'],
  ['index', 'Index'],
  ['questions', 'Questions'],
];

const pct = (x) => `${Math.round(x * 100)}%`;
const cell = (s, n = 140) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, n);

function areaRow(results, area, label) {
  const checks = results.inArea(area);
  if (!checks.length) return null;
  const count = (s) => checks.filter((c) => c.status === s).length;
  const passed = count('pass');
  const icon = count('skipped') === checks.length ? ICON.skipped : count('fail') ? ICON.fail : count('inconclusive') || count('deferred') ? ICON.inconclusive : count('known') ? ICON.known : ICON.pass;
  const extra = [
    count('fail') && `${count('fail')} failed`,
    count('known') && `${count('known')} known issue${count('known') > 1 ? 's' : ''}`,
    count('inconclusive') && `${count('inconclusive')} inconclusive`,
    count('deferred') && `${count('deferred')} deferred`,
    count('skipped') && `${count('skipped')} skipped`,
  ].filter(Boolean).join(', ');
  return `| ${label} | ${icon} ${passed}/${checks.length} | ${extra} |`;
}

export function renderMarkdown(results, meta) {
  const out = [];
  out.push(`## FamilyVault QA — ${meta.suite}`);
  out.push('');
  out.push(`DEV · ${meta.commit || 'local run'} · ${meta.startedAt.slice(0, 16).replace('T', ' ')} UTC · ${meta.rotation}`);
  out.push('');
  out.push('| Area | Passed | |');
  out.push('|---|---|---|');
  for (const [area, label] of AREAS) {
    const row = areaRow(results, area, label);
    if (row) out.push(row);
  }

  const failures = results.checks.filter((c) => c.status === 'fail');
  if (failures.length) {
    out.push('', '### ❌ Failed', '');
    for (const f of failures) out.push(`- **${f.area}** — ${f.title}${f.why ? `: ${f.why}` : ''}`);
  }

  const known = results.checks.filter((c) => c.status === 'known');
  if (known.length || meta.fixtureWarnings?.length) {
    out.push('', '### 🐞 Known issues (reported every run, not failing it)', '');
    for (const k of known) out.push(`- **${k.area}** — ${k.title}: ${k.why}`);
    for (const w of meta.fixtureWarnings ?? []) out.push(`- **fixtures** — ${w}`);
  }

  const soft = results.checks.filter((c) => c.status === 'inconclusive' || c.status === 'deferred');
  if (soft.length) {
    out.push('', '### ⚠️ Not judged this run', '');
    for (const s of soft) out.push(`- **${s.area}** — ${s.title}: ${s.status}${s.why ? ` (${s.why})` : ''}`);
  }

  const questions = results.inArea('questions');
  if (questions.length) {
    out.push('', '### Questions', '', '| | Question | Answer | Sources |', '|---|---|---|---|');
    for (const q of questions) {
      out.push(`| ${ICON[q.status]} | ${cell(q.ask ?? q.title, 80)} | ${cell(q.answer ?? q.why, 160)} | ${cell((q.sources ?? []).map((s) => s.file_name).join(', '), 90)} |`);
    }
  }

  if (meta.budget) {
    const b = meta.budget;
    out.push('');
    out.push(
      `Groq, estimated: ${b.asked} rag-search call(s) ≈ ${Math.round(b.helperTokens / 1000)}K tokens on the helper model ` +
        `(gpt-oss-20b, ${pct(b.helperShare)} of its free 200K/day) and ≈ ${Math.round(b.answerTokens / 1000)}K on the answer model ` +
        `(gpt-oss-120b, ${pct(b.answerShare)}). Paced ${meta.spacingSeconds}s apart.`,
    );
  }
  for (const n of results.notes) out.push(`\n<sub>${n.area}: ${cell(n.text, 300)}</sub>`);
  return out.join('\n') + '\n';
}

export function writeReport(dir, results, meta, transcript) {
  mkdirSync(dir, { recursive: true });
  const markdown = renderMarkdown(results, meta);
  writeFileSync(join(dir, 'summary.md'), markdown);
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ meta, checks: results.checks, notes: results.notes, transcript }, null, 2));
  return markdown;
}

/** Inline annotations on the Actions run: errors for failures, warnings for the rest. */
export function annotate(results) {
  if (!process.env.GITHUB_ACTIONS) return;
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const c of results.checks) {
    const level = c.status === 'fail' ? 'error' : ['known', 'inconclusive', 'deferred'].includes(c.status) ? 'warning' : null;
    if (level) console.log(`::${level} title=${esc(`QA ${c.area}: ${c.status}`)}::${esc(`${c.title}${c.why ? ` — ${c.why}` : ''}`)}`);
  }
}
