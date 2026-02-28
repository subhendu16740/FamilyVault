import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { family_id, invitee_email, role, invited_by } = await req.json();

    if (!family_id || !invitee_email || !invited_by) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase admin client (service role bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Create invitation record
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: invErr } = await supabaseAdmin.from("invitations").insert({
      family_id,
      invited_by,
      invitee_email: invitee_email.toLowerCase(),
      role: role || "viewer",
      token,
      expires_at: expiresAt,
    });

    if (invErr) {
      return new Response(
        JSON.stringify({ error: invErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Get family name for the email
    const { data: family } = await supabaseAdmin
      .from("families")
      .select("name")
      .eq("id", family_id)
      .single();

    // 3. Get inviter name
    const { data: inviter } = await supabaseAdmin
      .from("users")
      .select("display_name")
      .eq("id", invited_by)
      .single();

    // 4. Send invitation via Supabase Auth
    // This sends an email using Supabase's built-in SMTP
    const { error: authErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      invitee_email.toLowerCase(),
      {
        data: {
          invitation_token: token,
          family_id,
          family_name: family?.name || "a family",
          invited_by_name: inviter?.display_name || "Someone",
          role: role || "viewer",
        },
        redirectTo: `${Deno.env.get("SUPABASE_URL")?.replace(".supabase.co", ".supabase.co")}/auth/v1/callback`,
      }
    );

    // If user already exists in auth, the invite might "fail" — that's OK
    // The invitation record is still in the DB
    if (authErr && !authErr.message.includes("already been registered")) {
      console.error("Auth invite error:", authErr);
    }

    return new Response(
      JSON.stringify({ success: true, message: `Invitation sent to ${invitee_email}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
