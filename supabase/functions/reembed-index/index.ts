// ─── FamilyVault: rebuild a family's search index ───────────────
//
// Re-embeds every chunk with the current model (see _shared/embeddings.ts).
// Needed once, after the move from the English-only model to the
// multilingual one, so Hindi and other Indian-language documents become
// searchable by meaning rather than only by exact words.
//
// Runs in batches, not in one pass: an Edge Function has a wall-clock
// budget and a family can hold thousands of chunks. Each call does as
// much as it safely can, records how far it got in
// public.family_embedding_state, and returns progress. The client calls
// again until `done` is true — and may stop and resume days later,
// because the cursor lives in the database, not in the request.
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
import { embedPassages, EMBEDDING_MODEL } from '../_shared/embeddings.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// One HF call per batch. Small enough that a failure costs little, large
// enough that a few hundred chunks finish in a handful of calls.
const BATCH_SIZE = 32;
// Stop well inside the function's budget and let the client call again.
const TIME_BUDGET_MS = 20_000;

interface StateRow {
  storage_namespace: string;
  model: string;
  cursor_id: string | null;
  done_count: number;
  total_count: number;
  completed_at: string | null;
}

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
    const state = await loadState(schema);

    // A family with no row was created after migration 013, so everything it
    // holds was embedded with the current model. Nothing to do, ever.
    if (!state) {
      return json({ ...idleProgress(), done: true, up_to_date: true, can_rebuild: isAdmin });
    }

    const alreadyDone = !!state.completed_at && state.model === EMBEDDING_MODEL;
    if (status_only || alreadyDone) {
      return json({
        done: alreadyDone,
        up_to_date: alreadyDone,
        processed: 0,
        done_count: state.done_count,
        total_count: state.total_count,
        model: EMBEDDING_MODEL,
        can_rebuild: isAdmin,
      });
    }

    // Starting a fresh run (or restarting after a model change): reset the
    // cursor and recount, so progress is honest rather than carried over
    // from a previous model's run.
    let cursor = state.cursor_id;
    let doneCount = state.done_count;
    let total = state.total_count;

    if (state.model !== EMBEDDING_MODEL) {
      cursor = null;
      doneCount = 0;
      const { data: freshTotal } = await supabase.rpc('rag_chunk_total', { p_schema: schema });
      total = typeof freshTotal === 'number' ? freshTotal : total;
      await saveState(schema, {
        model: EMBEDDING_MODEL,
        cursor_id: null,
        done_count: 0,
        total_count: total,
        completed_at: null,
      });
    }

    const startedAt = Date.now();
    let processed = 0;
    let finished = false;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data: batch, error: batchErr } = await supabase.rpc('rag_chunks_to_embed', {
        p_schema: schema,
        p_after: cursor,
        p_limit: BATCH_SIZE,
      });

      if (batchErr) {
        console.error('[reembed] Could not read chunks:', batchErr.message);
        return json({ error: `Could not read chunks: ${batchErr.message}` }, 500);
      }

      const chunks = (batch ?? []) as { id: string; content: string }[];
      if (chunks.length === 0) {
        finished = true;
        break;
      }

      const { vectors, error: embedError } = await embedPassages(chunks.map(c => c.content));

      // Every vector null means the embedding service is down, not that these
      // chunks are unembeddable. Stop and keep the cursor where it is, so the
      // next call retries the same batch instead of skipping past it.
      if (vectors.every(v => v === null)) {
        await saveState(schema, {
          model: EMBEDDING_MODEL,
          cursor_id: cursor,
          done_count: doneCount,
          total_count: total,
          completed_at: null,
        });
        return json({
          error: embedError
            ? `Embedding service: ${embedError}`
            : 'Embedding service unavailable — nothing was skipped, try again shortly',
          done: false,
          processed,
          done_count: doneCount,
          total_count: total,
          model: EMBEDDING_MODEL,
        }, 503);
      }

      for (let i = 0; i < chunks.length; i++) {
        const vector = vectors[i];
        // A chunk that would not embed has its vector CLEARED, never left as
        // it was: the old value came from a different model, and keeping it
        // would let it be compared against new query vectors once this run is
        // marked complete. Cleared, it sits out vector search and is still
        // found by keyword.
        const { error: setErr } = await supabase.rpc('rag_set_chunk_embedding', {
          p_schema: schema,
          p_chunk_id: chunks[i].id,
          p_embedding: vector ? `[${vector.join(',')}]` : null,
        });
        if (setErr) console.warn(`[reembed] Chunk ${chunks[i].id} not written: ${setErr.message}`);
      }

      cursor = chunks[chunks.length - 1].id;
      processed += chunks.length;
      doneCount += chunks.length;

      await saveState(schema, {
        model: EMBEDDING_MODEL,
        cursor_id: cursor,
        done_count: doneCount,
        total_count: Math.max(total, doneCount),
        completed_at: null,
      });
    }

    if (finished) {
      // done_count is authoritative now: it counted what was actually walked.
      total = doneCount;
      await saveState(schema, {
        model: EMBEDDING_MODEL,
        cursor_id: cursor,
        done_count: doneCount,
        total_count: total,
        completed_at: new Date().toISOString(),
      });
      console.log(`[reembed] ${schema} complete: ${doneCount} chunks on ${EMBEDDING_MODEL}`);
    }

    return json({
      done: finished,
      up_to_date: finished,
      processed,
      done_count: doneCount,
      total_count: Math.max(total, doneCount),
      model: EMBEDDING_MODEL,
      can_rebuild: isAdmin,
    });

  } catch (err) {
    console.error('[reembed] Error:', err);
    return json({ error: String(err) }, 500);
  }
});

async function loadState(schema: string): Promise<StateRow | null> {
  const { data, error } = await supabase
    .from('family_embedding_state')
    .select('storage_namespace, model, cursor_id, done_count, total_count, completed_at')
    .eq('storage_namespace', schema)
    .maybeSingle();
  if (error) {
    console.warn('[reembed] Could not read state:', error.message);
    return null;
  }
  return (data as StateRow) ?? null;
}

async function saveState(schema: string, patch: Partial<StateRow>): Promise<void> {
  const { error } = await supabase
    .from('family_embedding_state')
    .upsert({
      storage_namespace: schema,
      ...patch,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'storage_namespace' });
  if (error) console.warn('[reembed] Could not save state:', error.message);
}

function idleProgress() {
  return {
    processed: 0,
    done_count: 0,
    total_count: 0,
    model: EMBEDDING_MODEL,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
