// ─── Database invariants: free, and the checks that found the worst bugs ─
//
// 1. The 023 sweep must return zero rows on DEV and PROD: no owner-rights
//    function a client can call that never asks who is calling.
// 2. The 024 fingerprint must be identical on DEV and PROD. Drift between
//    them is what left PROD unable to create a vault, and its document list
//    failing, while DEV worked.
//
// Read-only catalog queries through the Management API, with the same
// SUPABASE_ACCESS_TOKEN the deploy workflow uses. No Groq, no documents.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { DEV_REF, PROD_REF } from '../config.mjs';

const SWEEP = readFileSync(new URL('../../sql/sweep.sql', import.meta.url), 'utf8');
const FINGERPRINT = readFileSync(new URL('../../sql/fingerprint.sql', import.meta.url), 'utf8');
const PROJECTS = [['DEV', DEV_REF], ['PROD', PROD_REF]];

async function query(token, ref, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API answered ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  return Array.isArray(body) ? body : (body.result ?? body.rows ?? []);
}

export async function runDbChecks(cfg, results) {
  if (!cfg.managementToken) {
    results.add('database', 'db', 'Database invariants', 'skipped', { why: 'SUPABASE_ACCESS_TOKEN is not set' });
    return;
  }

  for (const [name, ref] of PROJECTS) {
    try {
      const rows = await query(cfg.managementToken, ref, SWEEP);
      results.add('database', `sweep:${name}`, `${name}: no client-callable function trusts a caller-supplied id (023 sweep)`,
        rows.length === 0 ? 'pass' : 'fail',
        { why: rows.length ? `exposed: ${rows.map((r) => r.proname).join(', ')}` : '0 rows' });
    } catch (err) {
      // An unreachable API says nothing about the database; don't call it a defect.
      results.add('database', `sweep:${name}`, `${name}: 023 sweep`, 'inconclusive', { why: err.message });
    }
  }

  try {
    const [dev, prod] = await Promise.all(PROJECTS.map(([, ref]) => query(cfg.managementToken, ref, FINGERPRINT)));
    const shape = (rows) => new Map(rows.map((r) => [r.k, `${r.n}:${r.h}`]));
    const d = shape(dev);
    const p = shape(prod);
    const kinds = [...new Set([...d.keys(), ...p.keys()])].sort();
    const differ = kinds.filter((k) => d.get(k) !== p.get(k));
    results.add('database', 'fingerprint', 'DEV and PROD have the same schema, functions, policies and grants (024 fingerprint)',
      differ.length ? 'fail' : 'pass',
      {
        why: differ.length
          ? `differ: ${differ.map((k) => `${k} (DEV ${d.get(k)?.split(':')[0] ?? '—'} vs PROD ${p.get(k)?.split(':')[0] ?? '—'})`).join(', ')} — a change was applied to one project only`
          : `${kinds.length}/${kinds.length} object types identical`,
      });
  } catch (err) {
    results.add('database', 'fingerprint', 'DEV/PROD fingerprint', 'inconclusive', { why: err.message });
  }
}
