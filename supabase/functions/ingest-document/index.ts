// ─── FamilyVault Document Ingestion Edge Function ───────────────
//
// The HTTP entry point for ingesting an uploaded document. All it does is
// check who is calling and hand off: the pipeline itself lives in
// _shared/ingest.ts, because the rebuild has to run the same steps when it
// finds a document that was never indexed.
//
// Accepts pre-extracted OCR text from the client (Tesseract on web, ML Kit
// on native) and falls back to server-side extraction when there is none.
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireFamilyMember } from '../_shared/auth.ts';
import { ingestDocument } from '../_shared/ingest.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { family_id, document_id, storage_path, ocr_text } = await req.json();

    if (!family_id || !document_id || !storage_path) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // Writes into the family's private schema on the service role: the caller
    // must be a member with upload rights, or anyone with the anon key could
    // ingest into any family whose id they know.
    const auth = await requireFamilyMember(req, supabase, family_id, { upload: true });
    if (!auth.ok) return auth.response;

    const result = await ingestDocument(supabase, {
      familyId: family_id,
      documentId: document_id,
      storagePath: storage_path,
      providedText: typeof ocr_text === 'string' ? ocr_text : undefined,
    });

    if (result.empty) {
      // Nothing readable came out of the file. Report it rather than claiming
      // success: the document is in the vault but will never answer anything.
      return jsonResponse({
        success: false,
        empty: true,
        error: 'No text could be read from this file',
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
