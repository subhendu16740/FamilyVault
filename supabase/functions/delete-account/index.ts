// ─── delete-account: a person deletes their own account, for good ─
//
// Both stores require this inside the app. Nothing is kept afterwards and
// there is no grace period: what goes, goes now.
//
//   { action: 'preview' }                  what deleting would do, per family
//   { action: 'delete', confirm: 'DELETE' } do it
//
// The caller is ALWAYS the person in the session; the body names nobody.
// The database side is migration 029 (service role only):
//   account_deletion_plan()   which families go with the account: those
//                             nobody would be left to manage
//   family_storage_objects()  the files in one family's folder
//   delete_account_data()     every row, in one transaction
//
// The order makes a failure safe to retry. Files first: if removing them
// fails, nothing else has happened yet. Then the rows, all or nothing. Then
// the sign-in; if that fails, calling again finds no data and finishes it.
//
// Answers:
//   200 preview: { families: [...] }
//   200 delete:  { deleted: true, families_deleted, families_left, files_deleted }
//   400 no confirmation     401 not signed in
//   503 { status: 'needs_migration' }  029 is not applied to this project
// ────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { openRefreshToken, revokeToken } from "../_shared/gmail.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface PlanRow {
  family_id: string;
  family_name: string;
  storage_namespace: string;
  role: string;
  other_members: number;
  other_admins: number;
  document_count: number;
  your_documents: number;
  delete_family: boolean;
}

const needsMigration = (error: { code?: string; message?: string }) =>
  error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");

const NEEDS_MIGRATION = {
  status: "needs_migration",
  error: "Deleting your account from the app is not switched on yet.",
};

// Storage's remove() takes a list; keep each call small.
const REMOVE_BATCH = 100;
// A page of names per call (PostgREST caps rows), so ask again until none are
// left. The guard only stops a loop that makes no progress.
const MAX_ROUNDS = 500;

/** Remove every file under these family folders. Returns how many went. */
async function removeFamilyFiles(supabase: SupabaseClient, namespaces: string[]): Promise<number> {
  let removed = 0;
  for (const ns of namespaces) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data, error } = await supabase.rpc("family_storage_objects", { p_storage_namespace: ns });
      if (error) throw new Error(`Could not list the files of ${ns}: ${error.message}`);
      const names = (data ?? []) as string[];
      if (!names.length) break;
      for (let i = 0; i < names.length; i += REMOVE_BATCH) {
        const batch = names.slice(i, i + REMOVE_BATCH);
        const { error: removeErr } = await supabase.storage.from("documents").remove(batch);
        if (removeErr) throw new Error(`Could not delete the files of ${ns}: ${removeErr.message}`);
        removed += batch.length;
      }
    }
  }
  return removed;
}

/** Ask Google to forget this person's Gmail permission. Best effort: the row goes either way. */
async function revokeGmail(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("gmail_connections")
      .select("refresh_token_enc")
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.refresh_token_enc) await revokeToken(await openRefreshToken(data.refresh_token_enc));
  } catch (err) {
    console.warn("[delete-account] Gmail permission not revoked at Google:", (err as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, confirm } = await req.json().catch(() => ({}));
    if (action !== "preview" && action !== "delete") {
      return json(400, { error: "action must be preview or delete" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await requireUser(req, supabase);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const { data: planData, error: planErr } = await supabase.rpc("account_deletion_plan", { p_user_id: userId });
    if (planErr) {
      if (needsMigration(planErr)) return json(503, NEEDS_MIGRATION);
      console.error("[delete-account] plan failed:", planErr.code, planErr.message);
      return json(500, { error: "Could not work out what to delete. Please try again." });
    }
    const plan = (planData ?? []) as PlanRow[];

    if (action === "preview") {
      return json(200, {
        families: plan.map((f) => ({
          family_id: f.family_id,
          name: f.family_name,
          role: f.role,
          other_members: f.other_members,
          document_count: f.document_count,
          your_documents: f.your_documents,
          deleted: f.delete_family,
        })),
      });
    }

    if (confirm !== "DELETE") {
      return json(400, { error: "Type DELETE to confirm." });
    }

    // 1. The files of the families that go with the account.
    const files = await removeFamilyFiles(
      supabase,
      plan.filter((f) => f.delete_family).map((f) => f.storage_namespace),
    );

    // 2. Gmail: tell Google, while the sealed permission still exists.
    await revokeGmail(supabase, userId);

    // 3. Every row, in one transaction.
    const { data: result, error: dataErr } = await supabase.rpc("delete_account_data", { p_user_id: userId });
    if (dataErr) {
      if (needsMigration(dataErr)) return json(503, NEEDS_MIGRATION);
      console.error("[delete-account] delete_account_data failed:", dataErr.code, dataErr.message);
      return json(500, { error: "Your account couldn't be deleted, and nothing more was removed. Please try again." });
    }
    const outcome = (result ?? {}) as { deleted_namespaces?: string[]; families_deleted?: number; families_left?: number };

    // 4. Anything added to those folders meanwhile, and the folders of families
    //    the person had created and nobody was left in (found in step 3).
    let lateFiles = 0;
    try {
      lateFiles = await removeFamilyFiles(supabase, outcome.deleted_namespaces ?? []);
    } catch (err) {
      console.error("[delete-account] files left behind:", (err as Error).message);
    }

    // 5. The sign-in itself. Its Gmail connection, feedback and saved chats
    //    go with it (ON DELETE CASCADE).
    const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error("[delete-account] deleteUser failed:", authErr.message);
      return json(500, {
        error: "Your documents and details are deleted, but your sign-in wasn't. Please try again.",
      });
    }

    return json(200, {
      deleted: true,
      families_deleted: outcome.families_deleted ?? 0,
      families_left: outcome.families_left ?? 0,
      files_deleted: files + lateFiles,
    });
  } catch (err) {
    console.error("[delete-account]", (err as Error).message);
    return json(500, { error: "Your account could not be deleted. Please try again." });
  }
});
