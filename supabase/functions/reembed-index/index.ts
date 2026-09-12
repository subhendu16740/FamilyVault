// ─── FamilyVault: rebuild a family's search index ───────────────
//
// Re-embeds every chunk with the current model (see _shared/embeddings.ts).
// Needed once, after the move from the English-only model to the
// multilingual one, so Hindi and other Indian-language documents become
// searchable by meaning rather than only by exact words.
//
// The work itself lives in _shared/reembed.ts, because rag-search starts
// the same rebuild in the background whenever it notices one is due. This
// function is the deliberate route: Settings › Search, where a person can
// watch it and read the error in full if it fails.
//
// Runs in batches against a cursor in public.family_embedding_state, so a
// call may stop at any point and the next resumes exactly where it left
// off — days later if need be. The client calls again until `done`.
//
// While a family is mid-rebuild, rag-search sends no query vector for it
// and retrieval falls back to keyword matching. Search stays correct
// throughout; it just loses semantic matching until the run finishes.
//
// POST { family_id, status_only? } — any member may read status;
// only an admin may rebuild.
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireFamilyMember } from '../_shared/auth.ts';
import { EMBEDDING_MODEL } from '../_shared/embeddings.ts';
import { loadState, isUpToDate, runReembed } from '../_shared/reembed.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Stop well inside the function's budget and let the client call again.
const TIME_BUDGET_MS = 20_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { family_id, status_only } = await req.json();
    if (!family_id) return json({ error: 'Missing family_id' }, 400);

    // Any member may ask how the index is doing; only an admin may rebuild
    // it, because that rewrites every vector in the family's schema.
    const auth = await requireFamilyMember(req, supabase, family_id);
    if (!auth.ok) return auth.response;
    const isAdmin = auth.member.role === 'admin';
    if (!status_only && !isAdmin) {
      return json({ error: 'Only a family admin can rebuild the search index' }, 403);
    }

    const { data: family, error: famErr } = await supabase
      .from('families')
      .select('storage_namespace')
      .eq('id', family_id)
      .single();
    if (famErr || !family) return json({ error: 'Family not found' }, 404);

    const schema = family.storage_namespace as string;
    const state = await loadState(supabase, schema);
    const upToDate = isUpToDate(state);

    if (status_only || upToDate) {
      return json({
        done: upToDate,
        up_to_date: upToDate,
        processed: 0,
        done_count: state?.done_count ?? 0,
        total_count: state?.total_count ?? 0,
        model: EMBEDDING_MODEL,
        can_rebuild: isAdmin,
        unindexed: await unindexedDocuments(schema),
      });
    }

    // No lease here: a person pressing Update is asking for this to happen
    // now, and should not be told "someone else has it" by a background
    // worker that may be idle. Batches are idempotent — the worst a rare
    // overlap costs is embedding the same chunk twice.
    const progress = await runReembed(supabase, schema, { budgetMs: TIME_BUDGET_MS });

    return json({
      ...progress,
      up_to_date: progress.done,
      model: EMBEDDING_MODEL,
      can_rebuild: isAdmin,
      // Only worth naming once the rebuild is done: until then a document may
      // simply be waiting its turn rather than genuinely unreadable.
      ...(progress.done ? { unindexed: await unindexedDocuments(schema) } : {}),
    }, progress.error ? 503 : 200);

  } catch (err) {
    console.error('[reembed] Error:', err);
    return json({ error: String(err) }, 500);
  }
});

/**
 * Documents with no chunks at all: nothing for search to match, so they can
 * never appear in an answer. Usually an ingestion that failed or never ran —
 * this vault had a PDF sitting at status 'pending' for a month with nobody
 * told. Naming them beats letting them look like documents with no answer.
 */
async function unindexedDocuments(schema: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('rag_unindexed_documents', { p_schema: schema });
  if (error) {
    console.warn('[reembed] Could not list unindexed documents:', error.message);
    return [];
  }
  return ((data ?? []) as { file_name: string }[]).map(d => d.file_name);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
