// ─── plans: when Family Plus ends (migration 040) ───────────────
//
// A family whose Plus has ended has 30 days to renew or get within the free
// limit; then the newest documents above it go. The database decides all of
// that — who is due (plan_cleanup_due), what goes (plan_take_excess, which
// deletes the documents' rows and hands back their files) and when it is
// done (plan_settle). This function only deletes the files it is handed,
// through the Storage API, which SQL cannot call.
//
//   cleanup  anyone   run_reminders() calls it every hour with the project's
//                     public key when a family's time is up, so anyone can
//                     call it. That is safe by construction, like push's
//                     send: it reads nothing from the request but the action,
//                     removes only what the database says is due — after the
//                     family was told, warned a week and a day before — and
//                     a lease keeps two runs off one family.
//
// Answers 503 { status: 'needs_migration' } where 040 is not applied.
// ────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const FAMILIES_A_RUN = 10;     // the next hour takes the rest
const FILES_A_FAMILY = 500;    // per family per run; a bigger family carries on next hour
const REMOVE_AT_ONCE = 100;    // the Storage API's batch

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isMissing = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST202" || error.code === "PGRST205" || /could not find the (function|table)/i.test(error.message ?? ""));

/** One claimed family: its rows go first, then its files; then the books close. */
async function cleanFamily(supabase: SupabaseClient, familyId: string): Promise<number> {
  const { data, error } = await supabase.rpc("plan_take_excess", { p_family_id: familyId, p_max: FILES_A_FAMILY });
  if (error) throw new Error(error.message);
  const names = ((data ?? []) as Array<{ name: string }>).map((r) => r.name).filter(Boolean);

  for (let i = 0; i < names.length; i += REMOVE_AT_ONCE) {
    const { error: removeError } = await supabase.storage.from("documents").remove(names.slice(i, i + REMOVE_AT_ONCE));
    // The rows are gone already; files left behind are files without a
    // document, and the next run takes those first.
    if (removeError) throw new Error(removeError.message);
  }

  const { error: settleError } = await supabase.rpc("plan_settle", { p_family_id: familyId });
  if (settleError) throw new Error(settleError.message);
  return names.length;
}

async function cleanup(supabase: SupabaseClient): Promise<Response> {
  const { data, error } = await supabase.rpc("plan_cleanup_due", { p_max: FAMILIES_A_RUN });
  if (isMissing(error)) {
    return json(503, {
      status: "needs_migration",
      error: "This needs a database update that has not been applied here yet (migration 040).",
    });
  }
  if (error) throw new Error(error.message);

  let families = 0;
  let files = 0;
  let failed = 0;
  for (const { family_id } of (data ?? []) as Array<{ family_id: string }>) {
    try {
      files += await cleanFamily(supabase, family_id);
      families++;
    } catch (err) {
      // Its lease runs out in ten minutes, and the next hour tries again.
      failed++;
      console.error("[plans] clean-up failed for one family:", (err as Error).message);
    }
  }
  return json(200, { families, files, failed });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action } = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (action === "cleanup") return await cleanup(supabase);
    return json(400, { error: "action must be cleanup" });
  } catch (err) {
    console.error("[plans]", (err as Error).message);
    return json(500, { error: "Could not finish. The next run tries again." });
  }
});
