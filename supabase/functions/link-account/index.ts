// ─── link-account: link someone in the family tree to their account ─
//
// The tree holds people with and without accounts (031). When someone added
// by name later signs up, adding them by email (add-member) would give them a
// second entry beside the one with their links, documents and emergency card.
// An admin links the existing entry to the account instead (migration 033):
//
//   • not yet a member: they are invited (migration 037), and when they
//     accept they join as a viewer under that person's id, so everything
//     already theirs stays theirs. Until then the family sees Pending
//     approval on the person's page;
//   • already a member: their two entries become one, at once — they are in
//     the family already, and nothing new opens up to them.
//
// A function of its own, not an option on add-member, on purpose: an app
// that asked an older add-member to link would have it ADD the person again,
// the very duplicate this prevents. A missing link-account answers the
// gateway's 404 instead, which the app reads as "not switched on yet".
//
// invite_family_person_account() does either in one transaction. It takes
// the admin's user id, so it is callable by the service role only; the caller
// is verified here first, and the database function checks again.
//
// Answers:
//   200 { success, status: 'invited', email, display_name }
//   200 { success, status: 'merged', display_name, member_id }
//   404 { status: 'no_account' }       400 { status: 'invalid_email' }
//   404 { status: 'no_person' }        409 { status: 'already_linked' | 'already_member' | 'already_invited' }
//   409 { status: 'tree_rule' }        the join would break a rule of the tree
//                                      (two parents at most, nobody their own ancestor)
//   409 { status: 'family_full' }      no room for another member (041), with the reason
//   403 caller is not an admin         503 { status: 'needs_migration' } 037 is not applied
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { family_id, person_id, email } = await req.json().catch(() => ({}));
    if (!text(family_id) || !text(person_id) || !text(email)) {
      return json(400, { error: "family_id, person_id and email are required" });
    }
    if (!UUID.test(person_id)) {
      return json(404, { status: "no_person", error: "That person is no longer in the family tree." });
    }

    // Service role: looking an account up by email is something no client
    // may do, and invite_family_person_account() is granted to nobody else.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await requireFamilyMember(req, supabase, family_id, { admin: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await supabase.rpc("invite_family_person_account", {
      p_family_id: family_id,
      p_invited_by: auth.member.userId,
      p_person_id: person_id,
      p_email: email,
    });

    if (error) {
      if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
        return json(503, {
          status: "needs_migration",
          error: "Linking someone to their account needs a database update that has not been applied here yet (migration 037).",
        });
      }
      if (error.code === "42501") {
        return json(403, { error: "Only a family admin can link someone to their account" });
      }
      // The family has no room for them (041), in the database's own words.
      if (error.hint === "family_full") {
        return json(409, { status: "family_full", error: error.message });
      }
      // The tree's own rules, in the words the database uses for them:
      // "Someone can have at most two parents in the tree." and the like.
      if (error.code === "23505" || error.code === "23514" || error.code === "22023") {
        return json(409, { status: "tree_rule", error: error.message });
      }
      console.error("[link-account] invite_family_person_account failed:", error.code, error.message);
      return json(500, { error: "Could not link this person. Please try again." });
    }

    const result = (data ?? {}) as Record<string, unknown> & { status?: string; display_name?: string };
    switch (result.status) {
      case "invited":
      case "merged":
        return json(200, { success: true, ...result });
      case "already_invited":
        return json(409, { ...result, error: `${result.email ?? "Someone"} has been invited to be this person already. Withdraw that invitation first.` });
      case "already_linked":
        return json(409, { ...result, error: `${result.display_name ?? "This person"} is already linked to an account.` });
      case "already_member":
        return json(409, { ...result, error: "That account is already in this family." });
      case "no_person":
        return json(404, { status: "no_person", error: "That person is no longer in the family tree." });
      case "no_account":
        return json(404, {
          status: "no_account",
          error: "No AskLocker account uses this email yet. Ask them to sign up with it, then link them again.",
        });
      case "invalid_email":
        return json(400, { status: "invalid_email", error: "That doesn't look like an email address." });
      default:
        console.error("[link-account] unexpected result:", JSON.stringify(result));
        return json(500, { error: "Could not link this person. Please try again." });
    }
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
});
