// ─── gmail-callback: where Google sends the browser back ───────
//
// The one Gmail function deployed WITHOUT JWT verification: Google's
// redirect carries no Supabase session, and cannot. So it does nothing that
// needs one. It looks up the state Google echoes back, and relays the browser
// to the FamilyVault page that started the flow, with the code attached. The
// code is traded for a token by gmail-connect's `finish`, an authenticated
// call that only the account which pressed "Connect" can make.
//
// It is not an open redirect: without a live, unused state row there is
// nowhere to go, and a state's destination was checked against the
// GMAIL_RETURN_ORIGINS allowlist when it was created.
//
// Registered in Google Cloud as the OAuth client's redirect URI:
//   https://<project-ref>.supabase.co/functions/v1/gmail-callback
// Google allows no wildcards there, which is why Vercel previews come back
// through this one fixed address.
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function page(status: number, title: string, message: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#F8F9FC;color:#1F2937;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
main{background:#fff;border-radius:20px;padding:28px;max-width:360px;box-shadow:0 2px 8px rgba(0,0,0,.06)}h1{color:#2A3D66;font-size:20px;margin:0 0 8px}p{color:#6B7280;line-height:1.5;margin:0}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const googleError = url.searchParams.get('error');

  if (!state) {
    return page(400, 'Something went wrong', 'Go back to FamilyVault and press Connect Gmail again.');
  }

  const { data: row, error } = await supabase
    .from('gmail_oauth_states')
    .select('return_to')
    .eq('state', state)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    // 026 not applied: say so plainly (QA reads the 503 as "not set up yet").
    if (error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|does not exist/i.test(error.message)) {
      return page(503, 'Not set up yet', 'Gmail import is not set up on this server yet.');
    }
    console.error('[gmail-callback] state lookup failed:', error.message);
    return page(500, 'Something went wrong', 'Go back to FamilyVault and try again in a moment.');
  }
  if (!row) {
    return page(400, 'This link has expired', 'Connecting Gmail has to be finished within ten minutes. Go back to FamilyVault and press Connect Gmail again.');
  }

  const target = new URL(row.return_to);
  target.searchParams.set('gmail_state', state);
  if (code) target.searchParams.set('gmail_code', code);
  else target.searchParams.set('gmail_error', googleError || 'unknown');

  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
});
