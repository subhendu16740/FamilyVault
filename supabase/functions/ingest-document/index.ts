// ─── AskLocker Document Ingestion Edge Function ───────────────
//
// The HTTP entry point for ingesting an uploaded document. All it does is
// check who is calling and hand off: the pipeline itself lives in
// _shared/ingest.ts, because the rebuild has to run the same steps when it
// finds a document that was never indexed.
//
// Accepts pre-extracted OCR text from the client (Tesseract on web, ML Kit
// on native) and falls back to server-side extraction when there is none.
//
// It reads with the service role, which no Storage policy stops, so it reads
// only the file of the document named, from that document's own row, inside
// the vault's own folder (050). Before, it read whatever address it was sent:
// someone who had once seen another family's file address — a member who
// left, anyone sent a share link — could have that file read into their own
// vault. Each document is read once (start_document_read()): one already
// read, or found unreadable, is not read again, and each person's reads a
// day are counted, so nobody can spend the OCR service's day on a loop.
//
//   400 bad_path      the address is not this document's, or not in the vault's folder
//   404 no_document   no such document in the vault; no_file: its file is not there
//   409 already_read  read already, or found unreadable
//   429 read_limit    this person's reads for the day are used up
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireFamilyMember } from '../_shared/auth.ts';
import { ingestDocument } from '../_shared/ingest.ts';
import { inVaultFolder, providedTextLimit, MAX_DOCUMENT_TEXT } from '../_shared/limits.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const REFUSALS: Record<string, [number, string]> = {
  no_document: [404, 'There is no such document in this vault.'],
  no_file: [404, "This document's file is not in the vault."],
  bad_path: [400, "That is not this document's file."],
  already_read: [409, 'This document has been read already.'],
  read_limit: [429, 'You have added as many documents as you can today. They will be read when you add them again tomorrow.'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { family_id, document_id, storage_path, ocr_text } = await req.json();

    if (!family_id || !document_id) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // Writes into the family's private schema on the service role: the caller
    // must be a member with upload rights, or anyone with the anon key could
    // ingest into any family whose id they know.
    const auth = await requireFamilyMember(req, supabase, family_id, { upload: true });
    if (!auth.ok) return auth.response;

    const { data: family } = await supabase
      .from('families').select('storage_namespace').eq('id', family_id).single();
    const namespace = family?.storage_namespace as string | undefined;
    if (!namespace) return jsonResponse({ status: 'no_document', error: REFUSALS.no_document[1] }, 404);

    // The document's own row says which file to read (050).
    let path: string;
    let fileBytes: number | null = null;
    const { data: start, error: startErr } = await supabase.rpc('start_document_read', {
      p_family_id: family_id, p_document_id: document_id, p_user_id: auth.member.userId,
    });
    if (startErr) {
      // Before 050 there is no such function: read the address sent, but only
      // inside this vault's folder — which alone closes the hole.
      if (!/find the function|schema cache|does not exist/i.test(startErr.message)) throw new Error(startErr.message);
      if (!inVaultFolder(storage_path, namespace)) return refuse('bad_path');
      path = storage_path;
    } else {
      const s = start as { ok: boolean; reason?: string; storage_path?: string; file_bytes?: number | null };
      if (!s.ok) return refuse(s.reason ?? 'no_document');
      path = String(s.storage_path);
      fileBytes = typeof s.file_bytes === 'number' ? s.file_bytes : null;
      if (storage_path && storage_path !== path) return refuse('bad_path');
      if (!inVaultFolder(path, namespace)) return refuse('bad_path');
    }

    // Text the app read itself, no more than a file of this size could hold.
    const limit = fileBytes == null ? MAX_DOCUMENT_TEXT : providedTextLimit(fileBytes);
    const providedText = typeof ocr_text === 'string' ? ocr_text.slice(0, limit) : undefined;

    const result = await ingestDocument(supabase, {
      familyId: family_id,
      namespace,
      documentId: document_id,
      storagePath: path,
      providedText,
    });

    if (result.empty) {
      // Unreadable, and not because OCR could not run: marked, so it is not
      // read again (and the app names it). An OCR outage leaves it pending.
      if (!result.retryable) {
        await supabase.rpc('rag_mark_ingestion_failed', { p_schema: namespace, p_document_id: document_id });
      }
      // Nothing readable came out of the file. Report it rather than claiming
      // success: the document is in the vault but will never answer anything.
      return jsonResponse({
        success: false,
        empty: true,
        // The reason matters: "this is a scan and OCR is not configured" is
        // fixed by setting a secret, "OCR is down" by waiting, and "nothing
        // readable in this file" by replacing it. Saying only the last sends
        // people after the wrong problem; `retryable` marks the first two.
        error: result.reason ?? 'No text could be read from this file',
        ...(result.retryable ? { retryable: true } : {}),
      }, 422);
    }

    return jsonResponse({
      success: true,
      chunks: result.chunks,
      metadata: result.metadata,
      ...(result.embedError ? { embed_error: result.embedError } : {}),
    });

  } catch (err) {
    console.error('[ingest] Error:', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

function refuse(reason: string) {
  const [status, error] = REFUSALS[reason] ?? REFUSALS.no_document;
  return jsonResponse({ status: reason, error }, status);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
