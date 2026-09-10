// ─── Caller authorization for Edge Functions ────────────────────
//
// These functions run on the SERVICE ROLE key, which bypasses Row-Level
// Security entirely. That is necessary (they write into per-family schemas)
// but it means the database will never say no — so the function must.
//
// The gateway's verify_jwt only checks that the bearer token is signed by
// this project. The public anon key qualifies, and it ships in every web
// bundle. So "verify_jwt is on" does NOT mean the caller is a user, let alone
// a member of the family named in the request body. This helper establishes
// both before anything else runs.
// ────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

export interface Membership {
  userId: string;
  role: string;
  canUpload: boolean;
  canDelete: boolean;
}

export type AuthResult =
  | { ok: true; member: Membership }
  | { ok: false; response: Response };

export interface Requirement {
  /** Caller must hold the admin role in the family. */
  admin?: boolean;
  /** Caller must have can_upload. */
  upload?: boolean;
}

/**
 * Resolve the caller from the Authorization header and confirm they belong
 * to `familyId`. Returns a ready-to-send 401/403 on failure so call sites
 * stay one line.
 */
export async function requireFamilyMember(
  req: Request,
  supabase: SupabaseClient,
  familyId: string,
  need: Requirement = {},
): Promise<AuthResult> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return deny(401, 'Sign in required');

  // Validates the token against the auth server. The anon key is a valid
  // project JWT but not a user session, so it fails here — which is the point.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return deny(401, 'Sign in required');
  const userId = data.user.id;

  const { data: row, error: memErr } = await supabase
    .from('family_members')
    .select('role, can_upload, can_delete')
    .eq('family_id', familyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memErr) {
    console.error('[auth] membership lookup failed:', memErr.message);
    return deny(500, 'Could not verify access');
  }
  if (!row) return deny(403, 'You are not a member of this family');

  const member: Membership = {
    userId,
    role: row.role,
    canUpload: row.can_upload !== false,
    canDelete: row.can_delete === true,
  };

  if (need.admin && member.role !== 'admin') {
    return deny(403, 'Only a family admin can do this');
  }
  if (need.upload && !member.canUpload) {
    return deny(403, 'You do not have upload permission in this family');
  }

  return { ok: true, member };
}

function deny(status: number, message: string): AuthResult {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }),
  };
}
