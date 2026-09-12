// ─── Rebuilding a family's chunk vectors ────────────────────────
//
// Shared by the reembed-index function (which a person drives from
// Settings › Search) and by rag-search, which starts a rebuild in the
// background the moment it notices one is needed. That second path is
// the one that matters: a rebuild gated on someone opening the right
// Settings row simply does not happen, and until it does, search has no
// vectors and a question asked in another script finds nothing.
//
// Work is done in batches against a cursor stored in
// public.family_embedding_state, so a run can stop at any point — a
// function's wall-clock budget, a failing embedding service, a closed
// browser tab — and the next one picks up exactly where it left off.
//
// CONCURRENCY. Two callers may notice the same stale index at the same
// moment, and two workers sharing one cursor would leapfrog each other
// and leave gaps. `claimRebuild` is a lease: a worker may only start if
// nobody has touched the row for LEASE_STALE_MS, and every batch it
// writes renews it. Nothing is lost if a worker dies holding one — the
// lease simply expires and the next caller resumes from the cursor.
// ────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { embedPassages, EMBEDDING_MODEL } from './embeddings.ts';

/** One HF call per batch: small enough that a failure costs little. */
export const BATCH_SIZE = 32;
/** A row untouched for this long is assumed abandoned, not in progress. */
const LEASE_STALE_MS = 90_000;

export interface StateRow {
  storage_namespace: string;
  model: string;
  cursor_id: string | null;
  done_count: number;
  total_count: number;
  completed_at: string | null;
  updated_at?: string;
}

export interface ReembedProgress {
  done: boolean;
  processed: number;
  done_count: number;
  total_count: number;
  error?: string;
}

export async function loadState(
  supabase: SupabaseClient,
  schema: string,
): Promise<StateRow | null> {
  const { data, error } = await supabase
    .from('family_embedding_state')
    .select('storage_namespace, model, cursor_id, done_count, total_count, completed_at, updated_at')
    .eq('storage_namespace', schema)
    .maybeSingle();
  if (error) {
    console.warn('[reembed] Could not read state:', error.message);
    return null;
  }
  return (data as StateRow) ?? null;
}

export async function saveState(
  supabase: SupabaseClient,
  schema: string,
  patch: Partial<StateRow>,
): Promise<void> {
  const { error } = await supabase
    .from('family_embedding_state')
    .upsert({
      storage_namespace: schema,
      ...patch,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'storage_namespace' });
  if (error) console.warn('[reembed] Could not save state:', error.message);
}

/** True when this family's vectors match the model queries are embedded with. */
export function isUpToDate(state: StateRow | null): boolean {
  // No row means the family was created after migration 013, so every chunk
  // it has was embedded with the current model.
  if (!state) return true;
  return !!state.completed_at && state.model === EMBEDDING_MODEL;
}

/**
 * Take the lease, or return false because someone else holds it. The update
 * is conditional on `updated_at`, so two callers racing here cannot both win:
 * Postgres applies one, and the other matches no rows.
 */
async function claimRebuild(supabase: SupabaseClient, schema: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - LEASE_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from('family_embedding_state')
    .update({ updated_at: new Date().toISOString() })
    .eq('storage_namespace', schema)
    .lt('updated_at', cutoff)
    .select('storage_namespace');
  if (error) {
    console.warn('[reembed] Could not claim rebuild:', error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Embed as many of this family's chunks as fit in `budgetMs`, then return
 * progress. Safe to call repeatedly and from more than one place: the lease
 * makes a second concurrent caller a no-op rather than a corruption.
 */
export async function runReembed(
  supabase: SupabaseClient,
  schema: string,
  opts: { budgetMs: number; requireLease?: boolean } = { budgetMs: 20_000 },
): Promise<ReembedProgress> {
  const state = await loadState(supabase, schema);
  if (!state) return { done: true, processed: 0, done_count: 0, total_count: 0 };
  if (isUpToDate(state)) {
    return { done: true, processed: 0, done_count: state.done_count, total_count: state.total_count };
  }

  if (opts.requireLease && !(await claimRebuild(supabase, schema))) {
    // Somebody else is already on it. Report their progress, not an error.
    return { done: false, processed: 0, done_count: state.done_count, total_count: state.total_count };
  }

  let cursor = state.cursor_id;
  let doneCount = state.done_count;
  let total = state.total_count;

  // A different model means the previous run's progress counts for nothing.
  if (state.model !== EMBEDDING_MODEL) {
    cursor = null;
    doneCount = 0;
    const { data: freshTotal } = await supabase.rpc('rag_chunk_total', { p_schema: schema });
    total = typeof freshTotal === 'number' ? freshTotal : total;
    await saveState(supabase, schema, {
      model: EMBEDDING_MODEL, cursor_id: null, done_count: 0, total_count: total, completed_at: null,
    });
  }

  const startedAt = Date.now();
  let processed = 0;
  let finished = false;

  while (Date.now() - startedAt < opts.budgetMs) {
    const { data: batch, error: batchErr } = await supabase.rpc('rag_chunks_to_embed', {
      p_schema: schema, p_after: cursor, p_limit: BATCH_SIZE,
    });

    if (batchErr) {
      console.error('[reembed] Could not read chunks:', batchErr.message);
      return {
        done: false, processed, done_count: doneCount, total_count: total,
        error: `Could not read chunks: ${batchErr.message}`,
      };
    }

    const chunks = (batch ?? []) as { id: string; content: string }[];
    if (chunks.length === 0) { finished = true; break; }

    const { vectors, error: embedError } = await embedPassages(chunks.map(c => c.content));

    // Every vector null means the embedding service is down, not that these
    // chunks are unembeddable. Keep the cursor where it is so the next run
    // retries this batch rather than skipping past it.
    if (vectors.every(v => v === null)) {
      await saveState(supabase, schema, {
        model: EMBEDDING_MODEL, cursor_id: cursor, done_count: doneCount,
        total_count: total, completed_at: null,
      });
      return {
        done: false, processed, done_count: doneCount, total_count: total,
        error: embedError ? `Embedding service: ${embedError}` : 'Embedding service unavailable',
      };
    }

    for (let i = 0; i < chunks.length; i++) {
      const vector = vectors[i];
      // A chunk that would not embed has its vector CLEARED, never left as it
      // was: the old value came from a different model, and keeping it would
      // let it be compared against new query vectors once this run is marked
      // complete. Cleared, it sits out vector search and is still found by
      // keyword.
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

    // Also renews the lease.
    await saveState(supabase, schema, {
      model: EMBEDDING_MODEL, cursor_id: cursor, done_count: doneCount,
      total_count: Math.max(total, doneCount), completed_at: null,
    });
  }

  if (finished) {
    total = doneCount; // authoritative: this counted what was actually walked
    await saveState(supabase, schema, {
      model: EMBEDDING_MODEL, cursor_id: cursor, done_count: doneCount,
      total_count: total, completed_at: new Date().toISOString(),
    });
    console.log(`[reembed] ${schema} complete: ${doneCount} chunks on ${EMBEDDING_MODEL}`);
  }

  return { done: finished, processed, done_count: doneCount, total_count: Math.max(total, doneCount) };
}

/** Run work after the response has been sent, where the runtime allows it. */
export function afterResponse(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else void work.catch(() => {});
}
