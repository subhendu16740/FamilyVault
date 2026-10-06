// ─── gmail-scan: find the documents in a person's mailbox ──────
//
//   scan   one batch: the next 25 matching emails, their attachments sorted
//          into suggested / maybe / probably not (gmail-rules.ts). Call again
//          until `done`. `restart: true` starts over from the newest email,
//          to pick up mail that arrived since.
//   list   everything found so far, for the review screen.
//
// Built like the index rebuild: short batches, a saved position (Gmail's
// page token) and a lease, so the app drives it, it can stop anywhere and
// resume, and two tabs cannot scan the same mailbox at once. Only metadata
// is kept — sender, subject, file name, size — never an email's text, and no
// attachment until the person imports it.
//
// What is found is visible only to the person whose mailbox it is.
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { SCAN_QUERY, attachmentParts, classifyAttachment, header } from '../_shared/gmail-rules.ts';
import { GmailError, accessTokenFor, getMessage, listMessages, type GmailMessage } from '../_shared/gmail.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const BATCH = 25;          // emails per call: well inside Gmail's per-user quota and the function's time
const PARALLEL = 5;        // messages read at once
const LEASE_MS = 90_000;   // a batch that dies holds the mailbox no longer than this

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = await requireUser(req, supabase);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => ({}));

    if (body.action === 'list') return await list(auth.userId);
    if (body.action === 'scan') return await scan(auth.userId, body.restart === true);
    return json(400, { error: 'action must be scan or list' });
  } catch (err) {
    if (err instanceof GmailError) {
      return json(err.status, { status: err.code, error: err.message, ...(err.retryAfter ? { retry_after: err.retryAfter } : {}) });
    }
    console.error('[gmail-scan]', err);
    return json(500, { error: (err as Error).message });
  }
});

async function list(userId: string): Promise<Response> {
  const { data, error } = await supabase
    .from('gmail_import_items')
    .select('id, file_name, mime_type, size_bytes, sender, subject, sent_at, suggestion, reason, category_guess, status, error, document_id, family_id')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return json(200, { items: data ?? [] });
}

async function scan(userId: string, restart: boolean): Promise<Response> {
  const { data: conn, error } = await supabase
    .from('gmail_connections')
    .select('refresh_token_enc, expired_at, scan_finished_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conn) return json(409, { status: 'not_connected', error: 'Connect Gmail first.' });
  if (conn.expired_at) return json(401, { status: 'expired', error: 'Gmail access has expired. Connect again to continue.' });

  // Take the lease — and, for a restart, reset the position in the same step.
  const now = new Date();
  const { data: leased } = await supabase
    .from('gmail_connections')
    .update({
      scan_lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
      updated_at: now.toISOString(),
      ...(restart ? { scan_page_token: null, scan_finished_at: null, scan_started_at: now.toISOString(), messages_scanned: 0 } : {}),
    })
    .eq('user_id', userId)
    .or(`scan_lease_until.is.null,scan_lease_until.lt."${now.toISOString()}"`)
    .select('scan_page_token, scan_started_at, scan_finished_at, messages_scanned')
    .maybeSingle();
  if (!leased) return json(409, { status: 'busy', error: 'A scan of this mailbox is already running.' });

  const release = (patch: Record<string, unknown> = {}) =>
    supabase.from('gmail_connections')
      .update({ scan_lease_until: null, updated_at: new Date().toISOString(), ...patch })
      .eq('user_id', userId);

  try {
    if (leased.scan_finished_at) {
      await release();
      return json(200, { done: true, messages_scanned: leased.messages_scanned, found: await foundCount(userId), added: 0 });
    }

    const token = await accessTokenFor(supabase, userId, conn.refresh_token_enc);
    const page = await listMessages(token, SCAN_QUERY, leased.scan_page_token, BATCH);
    const messages = await inBatches(page.ids, PARALLEL, (id) => getMessage(token, id).catch((err) => {
      // Slowing down or lost access stops the batch (it resumes from the same
      // page). Anything else is this one email's problem — deleted since the
      // list, or one Gmail will not serve — and it is skipped, or a single bad
      // email would hold the scan on this page for good.
      if (err instanceof GmailError && (err.code === 'rate_limited' || err.code === 'expired')) throw err;
      if (!(err instanceof GmailError && err.code === 'not_found')) console.warn(`[gmail-scan] skipped message ${id}:`, (err as Error).message);
      return null;
    }));

    const rows = findings(userId, messages.filter((m): m is GmailMessage => !!m));
    const added = await saveNew(userId, rows);

    const finished = !page.nextPageToken;
    await release({
      scan_page_token: page.nextPageToken ?? null,
      scan_finished_at: finished ? new Date().toISOString() : null,
      scan_started_at: leased.scan_started_at ?? now.toISOString(),
      messages_scanned: leased.messages_scanned + page.ids.length,
    });

    return json(200, {
      done: finished,
      messages_scanned: leased.messages_scanned + page.ids.length,
      found: await foundCount(userId),
      added,
    });
  } catch (err) {
    await release();
    throw err;
  }
}

interface ItemRow {
  user_id: string;
  message_id: string;
  part_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sender: string | null;
  subject: string | null;
  sent_at: string | null;
  suggestion: string;
  reason: string;
  category_guess: string | null;
}

/** Every attachment in these emails that could be a document. */
function findings(userId: string, messages: GmailMessage[]): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const message of messages) {
    const headers = message.payload?.headers;
    const from = header(headers, 'from') ?? '';
    const subject = header(headers, 'subject') ?? '';
    const sentAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
    for (const part of attachmentParts(message.payload)) {
      const verdict = classifyAttachment({
        fileName: part.fileName,
        mimeType: part.mimeType,
        size: part.size,
        inline: part.inline,
        from,
        subject,
        labelIds: message.labelIds,
      });
      if (!verdict) continue;
      rows.push({
        user_id: userId,
        message_id: message.id,
        part_id: part.partId,
        file_name: part.fileName.slice(0, 255),
        mime_type: part.mimeType,
        size_bytes: part.size,
        sender: from.slice(0, 255) || null,
        subject: subject.slice(0, 300) || null,
        sent_at: sentAt,
        suggestion: verdict.suggestion,
        reason: verdict.reason,
        category_guess: verdict.category,
      });
    }
  }
  return rows;
}

/**
 * Store what is new. The same file mailed or forwarded more than once —
 * same name, same size — is listed once: newest first, so the newest copy.
 */
async function saveNew(userId: string, rows: ItemRow[]): Promise<number> {
  if (!rows.length) return 0;
  const key = (name: string, size: number) => `${name.toLowerCase()}|${size}`;
  // A quote or backslash in a file name cannot be sent in PostgREST's `in`
  // list; such a name is deduplicated within the batch only. And a failed
  // lookup must not fail the batch — the scan would stop on this page for
  // good — so it only costs the cross-batch check.
  const names = [...new Set(rows.map((r) => r.file_name))].filter((n) => !/["\\]/.test(n));
  const { data: known, error: lookupErr } = names.length
    ? await supabase.from('gmail_import_items').select('file_name, size_bytes').eq('user_id', userId).in('file_name', names)
    : { data: [], error: null };
  if (lookupErr) console.warn('[gmail-scan] duplicate lookup failed; continuing without it:', lookupErr.message);
  const seen = new Set((known ?? []).map((k) => key(k.file_name, k.size_bytes)));

  const fresh = rows.filter((r) => {
    const k = key(r.file_name, r.size_bytes);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length) return 0;

  const { error } = await supabase
    .from('gmail_import_items')
    .upsert(fresh, { onConflict: 'user_id,message_id,part_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return fresh.length;
}

async function foundCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('gmail_import_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

/** Run `fn` over `items`, `limit` at a time, keeping order. */
async function inBatches<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}
