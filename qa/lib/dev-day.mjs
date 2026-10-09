// ─── A fresh day for QA's own accounts on DEV (050) ─────────────
//
// QA's accounts are on Free, so the limits anyone on Free meets apply to them
// too (050): 10 questions tried a day, 50 documents added a day, and 3
// invitations a day from a family to the same person — and one run invites B
// to QA Vault A three times, while a day can hold several runs. So each run
// starts these counts again, on DEV only, through the Management API: A's
// and B's counts for the day, and the invitations QA Vault A has sent.
// Nobody else's row is touched. (A's questions for the month are started
// again by the ask suite, which counts them: ask.mjs.)
// ────────────────────────────────────────────────────────────────

import { DEV_REF } from './config.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Null when started again; otherwise why not, in words. */
export async function startQaDay(cfg, { a, b, vaultA }) {
  if (!cfg.managementToken) return "no SUPABASE_ACCESS_TOKEN, so QA's daily counts were not started again (a second run in a day may meet 050's limits)";
  const ids = [a?.user?.id, b?.user?.id, vaultA?.id].map((v) => String(v ?? ''));
  if (!ids.every((id) => UUID.test(id))) return 'an account or QA Vault A has no id';
  const [userA, userB, familyA] = ids;
  // Before 050 there is no daily_usage, and no invitation is counted.
  const query = `do $$ begin
    if to_regclass('public.daily_usage') is not null then
      delete from public.daily_usage where user_id in ('${userA}', '${userB}');
    end if;
    delete from public.audit_logs where family_id = '${familyA}' and action = 'invite_sent';
  end $$;`;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${DEV_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.managementToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return res.ok ? null : `the Management API answered ${res.status}`;
  } catch (err) {
    return String(err?.message ?? err);
  }
}
