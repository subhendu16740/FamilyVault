// ─── gmail-import: bring one found attachment into the vault ───
//
// One attachment per request — the function has seconds, not minutes, and
// reading a PDF is the expensive part — so the app calls this once per
// ticked file and shows progress. For each:
//
//   1. claim the item (its owner only, and not while already importing)
//   2. look the part up in Gmail again: attachment ids change on every
//      fetch, so none was stored
//   3. download it and check the bytes are really a PDF, JPEG or PNG
//   4. skip it if the same bytes were already imported into this family
//   5. store it in the family's folder, record it with
//      insert_family_document() as the person importing, and run the same
//      ingestion an upload runs (_shared/ingest.ts)
//
// The caller must be a member of the family with upload rights — checked
// here, and again by insert_family_document() for the uploader it is given.
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireFamilyMember } from '../_shared/auth.ts';
import { ingestDocument } from '../_shared/ingest.ts';
import { sha256Hex } from '../_shared/gmail-crypto.ts';
import { MAX_IMPORT_BYTES, attachmentParts, sniffType, storageFileName } from '../_shared/gmail-rules.ts';
import { fits, storageFullMessage, type StorageRoom } from '../_shared/plan-text.ts';
import { GmailError, accessTokenFor, getAttachment, getMessage } from '../_shared/gmail.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CONTENT_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' } as const;

/** A failure the person can act on, shown on the item. */
class ImportProblem extends Error {}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let claimedId: string | null = null;
  try {
    const { item_id, family_id, category_id, belongs_to_member } = await req.json().catch(() => ({}));
    if (!item_id || !family_id) return json(400, { error: 'item_id and family_id are required' });

    const auth = await requireFamilyMember(req, supabase, family_id, { upload: true });
    if (!auth.ok) return auth.response;
    const userId = auth.member.userId;

    // 1. Claim it: the owner's, found or failed before, not imported already
    //    — or left 'importing' by an attempt that died over five minutes ago.
    const now = new Date();
    const stale = new Date(now.getTime() - 5 * 60_000).toISOString();
    const { data: item } = await supabase
      .from('gmail_import_items')
      .update({ status: 'importing', error: null, claimed_at: now.toISOString() })
      .eq('id', item_id)
      .eq('user_id', userId)
      .or(`status.in.(found,failed),and(status.eq.importing,claimed_at.lt."${stale}")`)
      .select('id, message_id, part_id, file_name')
      .maybeSingle();
    if (!item) {
      return json(409, { status: 'not_available', error: 'This file is already imported or being imported, or is not yours to import.' });
    }
    claimedId = item.id;

    const { data: conn } = await supabase
      .from('gmail_connections')
      .select('refresh_token_enc, expired_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!conn) throw new ImportProblem('Gmail is not connected any more.');
    if (conn.expired_at) throw new GmailError('Gmail access has expired', 401, 'expired');

    // 2–3. Find the part again and download it.
    const token = await accessTokenFor(supabase, userId, conn.refresh_token_enc);
    const message = await getMessage(token, item.message_id);
    const part = attachmentParts(message.payload).find((p) => p.partId === item.part_id);
    if (!part) throw new ImportProblem('This attachment is no longer in Gmail.');
    if (part.size > MAX_IMPORT_BYTES) throw new ImportProblem(`Larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB — too big to import.`);

    const bytes = await getAttachment(token, item.message_id, part.attachmentId);
    const kind = sniffType(bytes);
    if (!kind) throw new ImportProblem('This file is not really a PDF or a photo, whatever its name says.');
    const sha = await sha256Hex(bytes);

    // 4. The same file already imported into this family: point at it.
    const { data: twin } = await supabase
      .from('gmail_import_items')
      .select('document_id')
      .eq('user_id', userId)
      .eq('family_id', family_id)
      .eq('content_sha256', sha)
      .eq('status', 'imported')
      .limit(1)
      .maybeSingle();
    if (twin?.document_id) {
      await supabase.from('gmail_import_items')
        .update({ status: 'duplicate', family_id, document_id: twin.document_id, content_sha256: sha })
        .eq('id', item.id);
      claimedId = null;
      return json(200, { status: 'duplicate', document_id: twin.document_id });
    }

    // 5. Family Plus, and room for it (038, 039). Import from Gmail is part of
    //    Family Plus, and every plan has a storage limit, which the bucket's
    //    policy keeps for uploads from the app; the service role passes no
    //    policy, so both are checked here. Before 038 there is nothing to
    //    ask, and nothing is checked, as before.
    const { data: rooms } = await supabase.rpc('family_storage_status', { p_family_id: family_id });
    const r = (rooms as Array<{ plan: string; limit_bytes: number; used_bytes: number; personal?: boolean }> | null)?.[0];
    if (r) {
      if (r.plan !== 'plus') {
        throw new ImportProblem('Import from Gmail is part of Family Plus. Settings › Family Plus shows what it includes.');
      }
      const room: StorageRoom = {
        plan: 'plus',
        limitBytes: Number(r.limit_bytes),
        usedBytes: Number(r.used_bytes),
        personal: r.personal === true,    // 048; absent before it
      };
      if (!fits(room, bytes.length)) throw new ImportProblem(storageFullMessage(room, bytes.length));
    }

    // 6. Store, record, ingest — the same three steps as an upload.
    const { data: family } = await supabase.from('families').select('storage_namespace').eq('id', family_id).single();
    if (!family?.storage_namespace) throw new ImportProblem('This family has no storage folder.');
    const storagePath = `${family.storage_namespace}/${Date.now()}_${storageFileName(item.file_name, kind)}`;

    const { error: storageErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType: CONTENT_TYPES[kind], upsert: false });
    if (storageErr) throw new ImportProblem(`Could not store the file: ${storageErr.message}`);

    const { data: documentId, error: insertErr } = await supabase.rpc('insert_family_document', {
      p_family_id: family_id,
      p_uploaded_by: userId,
      p_file_name: item.file_name,
      p_file_type: kind,
      p_file_size_bytes: bytes.length,
      p_storage_path: storagePath,
      p_category_id: category_id ?? undefined,
      p_belongs_to_member: belongs_to_member ?? undefined,
    });
    if (insertErr || !documentId) {
      await supabase.storage.from('documents').remove([storagePath]);
      throw new ImportProblem(`Could not add the document: ${insertErr?.message ?? 'no id returned'}`);
    }

    // From here the document is in the vault whatever happens next: an
    // ingestion that fails leaves it pending, and the index rebuild retries
    // documents that never finished (_shared/reembed.ts).
    await supabase.from('gmail_import_items')
      .update({ status: 'imported', family_id, document_id: documentId, content_sha256: sha, imported_at: new Date().toISOString() })
      .eq('id', item.id);
    claimedId = null;

    let chunks = 0;
    let unreadable: string | undefined;
    try {
      const result = await ingestDocument(supabase, { familyId: family_id, documentId, storagePath });
      chunks = result.chunks;
      if (result.empty) unreadable = result.reason ?? 'No text could be read from this file';
    } catch (err) {
      console.error('[gmail-import] ingestion failed:', err);
      unreadable = 'Saved, but reading it failed; it will be retried when the search index is rebuilt.';
    }

    return json(200, { status: 'imported', document_id: documentId, chunks, ...(unreadable ? { unreadable } : {}) });
  } catch (err) {
    const message = err instanceof GmailError || err instanceof ImportProblem ? err.message : 'Something went wrong importing this file.';
    if (claimedId) {
      await supabase.from('gmail_import_items').update({ status: 'failed', error: message }).eq('id', claimedId);
    }
    if (err instanceof GmailError) {
      return json(err.status, { status: err.code, error: err.message, ...(err.retryAfter ? { retry_after: err.retryAfter } : {}) });
    }
    if (err instanceof ImportProblem) return json(422, { status: 'failed', error: message });
    console.error('[gmail-import]', err);
    return json(500, { status: 'failed', error: message });
  }
});
