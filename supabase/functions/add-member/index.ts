// ─── add-member: a family admin invites a person who has an account ─
//
// Nobody joins a family without saying yes (migration 037). An admin names an
// email; if a confirmed AskLocker account signs in with it, that person is
// sent an invitation — a notification, on their devices too — and joins as a
// viewer only when they accept. Until then the family sees them as Pending
// approval. If no account uses the email, the admin is told so and nothing is
// created, and no email is sent on the family's behalf to an address nobody
// has confirmed.
//
// The work is one database call, invite_family_member(), so the account
// lookup, the invitation and the notification commit together or not at all.
// It is callable by the service role only; the caller is verified here first,
// and the database function checks again that they are an admin.
//
// Answers:
//   200 { success, status: 'invited', email, role }
//   404 { status: 'no_account' }       409 { status: 'already_member' | 'already_invited' }
//   400 { status: 'invalid_email' }    403 caller is not an admin
//   409 { status: 'family_full' }      members and waiting invitations are at
//                                      the plan's limit (041), with the reason
//   409 { status: 'personal_vault' }   a personal vault is for its owner alone (046)
//   503 { status: 'needs_migration' }  037 is not applied to this project
// ────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireFamilyMember } from "../_shared/auth.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { family_id, email, role, alias, relationship } = await req.json().catch(() => ({}));
    if (!family_id || !text(email)) {
      return json(400, { error: "family_id and email are required" });
    }
    if (role != null && role !== "viewer" && role !== "admin") {
      return json(400, { error: "role must be viewer or admin" });
    }

    // Service role: looking an account up by email is something no client
    // may do, and invite_family_member() is granted to nobody else.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await requireFamilyMember(req, supabase, family_id, { admin: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await supabase.rpc("invite_family_member", {
      p_family_id: family_id,
      p_invited_by: auth.member.userId,
      p_email: email,
      p_role: role ?? "viewer",
      p_alias: text(alias),
      p_relationship: text(relationship),
    });

    if (error) {
      // The function does not exist yet: this project is missing migration
      // 037. Say exactly that — "non-2xx status code" sends someone to the logs.
      if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
        return json(503, {
          status: "needs_migration",
          error: "Adding members needs a database update that has not been applied here yet (migration 037).",
        });
      }
      if (error.code === "42501") {
        return json(403, { error: "Only a family admin can add members" });
      }
      // The family has no room (041): the database's own words say how full
      // it is and what makes room.
      if (error.hint === "family_full") {
        return json(409, { status: "family_full", error: error.message });
      }
      // A personal vault is for its owner alone (046), in the database's words.
      if (error.hint === "personal_vault") {
        return json(409, { status: "personal_vault", error: error.message });
      }
      console.error("[add-member] invite_family_member failed:", error.code, error.message);
      return json(500, { error: "Could not add this member. Please try again." });
    }

    const result = (data ?? {}) as Record<string, unknown> & { status?: string; display_name?: string };
    switch (result.status) {
      case "invited":
        return json(200, { success: true, ...result });
      case "already_member":
        return json(409, { ...result, error: `${result.display_name ?? "This person"} is already in this family.` });
      case "already_invited":
        return json(409, { ...result, error: "They have been invited already. They join once they accept." });
      case "no_account":
        return json(404, {
          status: "no_account",
          error: "No AskLocker account uses this email yet. Ask them to sign in to AskLocker once with Google, using this email, then add them again.",
        });
      case "invalid_email":
        return json(400, { status: "invalid_email", error: "That doesn't look like an email address." });
      default:
        console.error("[add-member] unexpected result:", JSON.stringify(result));
        return json(500, { error: "Could not add this member. Please try again." });
    }
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
});
