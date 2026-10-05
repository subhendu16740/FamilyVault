// ─── Gmail import: talking to Google ────────────────────────────
//
// OAuth (consent link, code exchange, refresh, revoke) and the three Gmail
// API reads the import needs: list messages, read one message's structure,
// download one attachment. Nothing here writes to anyone's mailbox — the
// only scope requested is gmail.readonly — and nothing here stores email.
//
// Secrets, per Supabase project (supabase secrets set …):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET   the OAuth client of the SEPARATE
//                                          Google Cloud project made for Gmail,
//                                          so the app's Google sign-in never
//                                          shares its "unverified" status or
//                                          its 100-user cap
//   GMAIL_TOKEN_KEY                        32 random bytes, base64: seals
//                                          refresh tokens (gmail-crypto.ts)
//   GMAIL_RETURN_ORIGINS                   the web origins Google's answer may
//                                          return to (gmail-rules.ts)
// ────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fromBase64, importTokenKey, openToken, sealToken } from './gmail-crypto.ts';
import type { GmailPart } from './gmail-rules.ts';

const CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY') ?? '';
export const RETURN_ORIGINS = Deno.env.get('GMAIL_RETURN_ORIGINS') ?? '';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Secrets this project still needs before Gmail can work at all. */
export function missingSecrets(): string[] {
  return [
    ['GMAIL_CLIENT_ID', CLIENT_ID],
    ['GMAIL_CLIENT_SECRET', CLIENT_SECRET],
    ['GMAIL_TOKEN_KEY', TOKEN_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);
}

/** Registered in Google Cloud as the OAuth client's redirect URI. */
export const callbackUrl = () => `${SUPABASE_URL}/functions/v1/gmail-callback`;

export class GmailError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  constructor(message: string, status = 502, code = 'gmail_error', retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// ─── OAuth ──────────────────────────────────────────────────────

/**
 * Google's consent page. `prompt=consent` and `access_type=offline` so a
 * refresh token comes back every time; PKCE so a code seen in transit is
 * useless without the verifier, which stays in the database.
 */
export function consentUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: `openid email ${GMAIL_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const error = String(data.error ?? `HTTP ${res.status}`);
    // A refresh token Google no longer honours: revoked by the person, or
    // older than the 7 days Google allows while the app is in "Testing".
    if (error === 'invalid_grant') throw new GmailError('Gmail access has expired', 401, 'expired');
    throw new GmailError(`Google refused the request (${error}${data.error_description ? `: ${data.error_description}` : ''})`, 502, error);
  }
  return data;
}

export interface Grant {
  refreshToken: string | null;
  accessToken: string;
  email: string;
  scopes: string;
}

/** The code Google sent back, traded for tokens — proven with the PKCE verifier. */
export async function exchangeCode(code: string, verifier: string): Promise<Grant> {
  let data: Record<string, unknown>;
  try {
    data = await tokenRequest({
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(),
    });
  } catch (err) {
    // For a code, invalid_grant means it was used, expired, or not ours.
    if (err instanceof GmailError && err.code === 'expired') {
      throw new GmailError('Google did not accept this sign-in (it may have expired). Press Connect Gmail again.', 400, 'expired');
    }
    throw err;
  }
  // The ID token came straight from Google's token endpoint over TLS, so its
  // claims are read, not re-verified.
  let email = '';
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64(String(data.id_token ?? '').split('.')[1] ?? '')));
    email = claims.email_verified === false ? '' : String(claims.email ?? '');
  } catch {
    email = '';
  }
  return {
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    accessToken: String(data.access_token ?? ''),
    email,
    scopes: String(data.scope ?? ''),
  };
}

/** Ask Google to forget a token. Best effort: the local copy is deleted either way. */
export async function revokeToken(token: string): Promise<void> {
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

let tokenKey: Promise<CryptoKey> | null = null;
const key = () => (tokenKey ??= importTokenKey(TOKEN_KEY));

export const sealRefreshToken = async (token: string) => sealToken(await key(), token);
export const openRefreshToken = async (sealed: string) => openToken(await key(), sealed);

/**
 * A fresh access token for this person. One refresh per request: access
 * tokens are never stored. When Google refuses, the connection is marked
 * expired so the app can ask the person to connect again.
 */
export async function accessTokenFor(supabase: SupabaseClient, userId: string, sealed: string): Promise<string> {
  try {
    const data = await tokenRequest({ refresh_token: await openRefreshToken(sealed), grant_type: 'refresh_token' });
    return String(data.access_token ?? '');
  } catch (err) {
    if (err instanceof GmailError && err.code === 'expired') {
      await supabase.from('gmail_connections')
        .update({ expired_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }
    throw err;
  }
}

// ─── Gmail API ──────────────────────────────────────────────────

async function gmailGet<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${GMAIL_API}${path}${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return await res.json() as T;

  const data = await res.json().catch(() => ({})) as { error?: { message?: string; errors?: { reason?: string }[] } };
  const reason = data.error?.errors?.[0]?.reason ?? '';
  if (res.status === 429 || /rateLimitExceeded|userRateLimitExceeded/.test(reason)) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 30;
    throw new GmailError('Gmail is asking us to slow down', 429, 'rate_limited', retryAfter);
  }
  if (res.status === 401) throw new GmailError('Gmail access has expired', 401, 'expired');
  if (res.status === 404) throw new GmailError('That email is no longer in Gmail', 404, 'not_found');
  throw new GmailError(`Gmail answered ${res.status}${data.error?.message ? `: ${data.error.message}` : ''}`, 502);
}

export interface MessagePage {
  ids: string[];
  nextPageToken?: string;
}

/** One page of message ids matching the scan query, newest first. */
export async function listMessages(accessToken: string, q: string, pageToken: string | null, maxResults: number): Promise<MessagePage> {
  const data = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, '/messages', {
    q,
    maxResults: String(maxResults),
    fields: 'messages(id),nextPageToken',
    ...(pageToken ? { pageToken } : {}),
  });
  return { ids: (data.messages ?? []).map((m) => m.id), nextPageToken: data.nextPageToken };
}

export interface GmailMessage {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

// A message's part tree, nested explicitly — Gmail's field selector has no
// recursion. Six levels covers a forwarded email with attachments inside.
const partFields = (depth: number): string =>
  `partId,mimeType,filename,headers(name,value),body(size,attachmentId)${depth > 0 ? `,parts(${partFields(depth - 1)})` : ''}`;
const MESSAGE_FIELDS = `id,internalDate,labelIds,payload(${partFields(5)})`;

/** A message's structure and headers — never its text, never its attachments. */
export function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(accessToken, `/messages/${encodeURIComponent(id)}`, { format: 'full', fields: MESSAGE_FIELDS });
}

/** One attachment's bytes. */
export async function getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const data = await gmailGet<{ data?: string }>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return fromBase64(data.data ?? '');
}
