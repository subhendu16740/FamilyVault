// ─── gmail-connect: link a person's own Gmail account ──────────
//
//   status      connected? to which address? how far has the scan got?
//   start       the Google consent link for this browser to open
//   finish      the browser is back from Google with a code: trade it for a
//               refresh token and keep that, encrypted
//   disconnect  revoke the token at Google and forget everything found
//
// Who ends up holding the token is the whole security question here. The
// attack this flow invites is a consent link started by one account and
// approved by someone else, which would hand their mailbox to the first
// account. Three things stop it:
//
//   - only the account that pressed "Connect" can finish, and only once,
//     within ten minutes (the state row is claimed by a conditional update);
//   - Google's answer only ever lands on an allow-listed FamilyVault origin
//     (GMAIL_RETURN_ORIGINS), never on a page someone else controls;
//   - PKCE: the verifier never leaves the database, so a code seen in
//     transit is worth nothing on its own.
//
// The browser returns to /gmail-import through gmail-callback, which only
// relays; the code is traded here, by an authenticated call.
//
// Answers carry a `status` the app switches on: not_configured (secrets
// missing), needs_migration (026 not applied), origin_not_allowed, expired.
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { pkceChallenge, randomToken } from '../_shared/gmail-crypto.ts';
import { allowedReturnOrigin } from '../_shared/gmail-rules.ts';
import {
  GMAIL_SCOPE, GmailError, RETURN_ORIGINS, consentUrl, exchangeCode, missingSecrets,
  openRefreshToken, revokeToken, sealRefreshToken,
} from '../_shared/gmail.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** 026 not applied: the tables do not exist yet. */
const missingTable = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|does not exist/i.test(error.message ?? ''));

const NEEDS_MIGRATION = {
  status: 'needs_migration',
  error: 'Gmail import needs a database update that has not been applied here yet (migration 026).',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = await requireUser(req, supabase);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case 'status': return await status(userId);
      case 'start': return await start(userId, body.return_origin);
      case 'finish': return await finish(userId, body.state, body.code);
      case 'disconnect': return await disconnect(userId);
      default: return json(400, { error: 'action must be status, start, finish or disconnect' });
    }
  } catch (err) {
    if (err instanceof GmailError) return json(err.status, { status: err.code, error: err.message });
    console.error('[gmail-connect]', err);
    return json(500, { error: (err as Error).message });
  }
});

async function status(userId: string): Promise<Response> {
  const missing = missingSecrets();
  const { data: conn, error } = await supabase
    .from('gmail_connections')
    .select('google_email, connected_at, expired_at, scan_started_at, scan_finished_at, messages_scanned')
    .eq('user_id', userId)
    .maybeSingle();
  if (missingTable(error)) return json(503, NEEDS_MIGRATION);
  if (error) throw new Error(error.message);

  const count = async (filter: (q: any) => any) => {
    const { count: n } = await filter(
      supabase.from('gmail_import_items').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    );
    return n ?? 0;
  };

  return json(200, {
    configured: missing.length === 0,
    ...(missing.length ? { missing } : {}),
    connected: !!conn,
    email: conn?.google_email ?? null,
    expired: !!conn?.expired_at,
    scan: conn ? {
      started_at: conn.scan_started_at,
      finished_at: conn.scan_finished_at,
      messages_scanned: conn.messages_scanned,
    } : null,
    found: conn ? await count((q) => q) : 0,
    imported: conn ? await count((q) => q.eq('status', 'imported')) : 0,
  });
}

async function start(userId: string, returnOrigin: unknown): Promise<Response> {
  const missing = missingSecrets();
  if (missing.length) {
    return json(503, { status: 'not_configured', missing, error: `Gmail import is not set up on this server yet (missing ${missing.join(', ')}).` });
  }
  const origin = allowedReturnOrigin(returnOrigin, RETURN_ORIGINS);
  if (!origin) {
    return json(400, {
      status: 'origin_not_allowed',
      origin: typeof returnOrigin === 'string' ? returnOrigin : null,
      error: 'Gmail can only return to a FamilyVault address listed in the GMAIL_RETURN_ORIGINS secret.',
    });
  }

  // Unfinished attempts older than ten minutes are no use to anyone.
  const nowIso = new Date().toISOString();
  const { error: sweepErr } = await supabase.from('gmail_oauth_states').delete().lt('expires_at', nowIso);
  if (missingTable(sweepErr)) return json(503, NEEDS_MIGRATION);

  const state = randomToken(32);
  const verifier = randomToken(48);
  const { error } = await supabase.from('gmail_oauth_states').insert({
    state,
    user_id: userId,
    return_to: `${origin}/gmail-import`,
    code_verifier: verifier,
  });
  if (error) throw new Error(error.message);

  return json(200, { url: consentUrl(state, await pkceChallenge(verifier)) });
}

async function finish(userId: string, state: unknown, code: unknown): Promise<Response> {
  if (typeof state !== 'string' || typeof code !== 'string' || !state || !code) {
    return json(400, { error: 'state and code are required' });
  }

  // Claimed by the account that started it, once, in time — or not at all.
  const nowIso = new Date().toISOString();
  const { data: claimed, error } = await supabase
    .from('gmail_oauth_states')
    .update({ used_at: nowIso })
    .eq('state', state)
    .eq('user_id', userId)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('code_verifier')
    .maybeSingle();
  if (missingTable(error)) return json(503, NEEDS_MIGRATION);
  if (error) throw new Error(error.message);
  if (!claimed) {
    return json(400, {
      status: 'expired',
      error: 'This connection attempt has expired, or was started from another account. Press Connect Gmail again.',
    });
  }

  const grant = await exchangeCode(code, claimed.code_verifier);

  // Google's consent screen lets a person untick the Gmail permission.
  if (!grant.scopes.split(/\s+/).includes(GMAIL_SCOPE)) {
    await revokeToken(grant.refreshToken ?? grant.accessToken);
    return json(400, {
      status: 'scope_denied',
      error: 'FamilyVault needs permission to read your email to find documents. Connect again and leave that box ticked.',
    });
  }
  if (!grant.refreshToken || !grant.email) {
    return json(502, { error: 'Google did not return a lasting permission. Press Connect Gmail again.' });
  }

  const { data: previous } = await supabase
    .from('gmail_connections')
    .select('google_email, refresh_token_enc')
    .eq('user_id', userId)
    .maybeSingle();
  const sameAccount = previous?.google_email?.toLowerCase() === grant.email.toLowerCase();

  if (previous && !sameAccount) {
    // A different mailbox: the old one's token and findings go.
    try { await revokeToken(await openRefreshToken(previous.refresh_token_enc)); } catch { /* already unusable */ }
    await supabase.from('gmail_import_items').delete().eq('user_id', userId);
  }

  const { error: saveErr } = await supabase.from('gmail_connections').upsert({
    user_id: userId,
    google_email: grant.email,
    refresh_token_enc: await sealRefreshToken(grant.refreshToken),
    scopes: grant.scopes,
    connected_at: nowIso,
    expired_at: null,
    updated_at: nowIso,
    // Reconnecting the same mailbox (after Google's 7-day test limit, say)
    // resumes the scan where it stopped; a new mailbox starts over.
    ...(sameAccount ? {} : {
      scan_page_token: null, scan_started_at: null, scan_finished_at: null, scan_lease_until: null, messages_scanned: 0,
    }),
  });
  if (saveErr) throw new Error(saveErr.message);

  return json(200, { connected: true, email: grant.email });
}

async function disconnect(userId: string): Promise<Response> {
  const { data: conn, error } = await supabase
    .from('gmail_connections')
    .select('refresh_token_enc')
    .eq('user_id', userId)
    .maybeSingle();
  if (missingTable(error)) return json(503, NEEDS_MIGRATION);

  if (conn) {
    try {
      await revokeToken(await openRefreshToken(conn.refresh_token_enc));
    } catch (err) {
      console.warn('[gmail-connect] revoke failed; deleting the local copy anyway:', (err as Error).message);
    }
  }
  // Imported documents stay in the vault; what the scan found does not.
  await supabase.from('gmail_import_items').delete().eq('user_id', userId);
  await supabase.from('gmail_connections').delete().eq('user_id', userId);
  return json(200, { connected: false });
}
