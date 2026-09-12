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
import { chunkText } from './chunking.ts';
import { ingestDocument, reextractDocument, EXTRACTOR_VERSION } from './ingest.ts';

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
  /** Document cursor for the re-chunk phase (migration 016). */
  rechunk_cursor?: string | null;
  /** Set once every document has been split with the current splitter. */
  rechunked_at?: string | null;
  /** Which text extractor produced this family's stored text (migration 018). */
  extractor_version?: string | null;
  reextract_cursor?: string | null;
}

export interface ReembedProgress {
  done: boolean;
  processed: number;
  done_count: number;
  total_count: number;
  error?: string;
  /** True while documents are still being re-split, before embedding starts. */
  rechunking?: boolean;
  /** True while PDFs are being read again, the slowest phase. */
  reextracting?: boolean;
}

export async function loadState(
  supabase: SupabaseClient,
  schema: string,
): Promise<StateRow | null> {
  const BASE = 'storage_namespace, model, cursor_id, done_count, total_count, completed_at, updated_at';
  const NEWEST = `${BASE}, rechunk_cursor, rechunked_at, extractor_version, reextract_cursor`;
  // Ask for the newest shape, then fall back. A column a migration has not
  // added yet fails the WHOLE select, and a rebuild that cannot read its own
  // state never starts — which is exactly how migration 016 being unapplied
  // stopped every rebuild instead of just the re-chunk phase.
  let { data, error } = await supabase
    .from('family_embedding_state')
    .select(NEWEST)
    .eq('storage_namespace', schema)
    .maybeSingle();
  if (error) {
    ({ data, error } = await supabase
      .from('family_embedding_state')
      .select(BASE)
      .eq('storage_namespace', schema)
      .maybeSingle());
    // Without 016 and 018 there are no re-chunk or re-extract phases to run,
    // so claim both are done and let the embedding phase proceed rather than
    // blocking on a missing column.
    if (data) {
      (data as StateRow).rechunked_at = new Date(0).toISOString();
      (data as StateRow).extractor_version = EXTRACTOR_VERSION;
    }
  }
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
  const row = { storage_namespace: schema, ...patch, updated_at: new Date().toISOString() };
  let { error } = await supabase
    .from('family_embedding_state')
    .upsert(row, { onConflict: 'storage_namespace' });
  if (error) {
    // Same reasoning as the read: drop the columns migration 016 adds rather
    // than losing the progress this run actually made.
    const {
      rechunk_cursor: _c, rechunked_at: _a,
      extractor_version: _v, reextract_cursor: _r,
      ...older
    } = row as Record<string, unknown>;
    ({ error } = await supabase
      .from('family_embedding_state')
      .upsert(older, { onConflict: 'storage_namespace' }));
  }
  if (error) console.warn('[reembed] Could not save state:', error.message);
}

/** True when this family's vectors match the model queries are embedded with. */
export function isUpToDate(state: StateRow | null): boolean {
  // No row means the family was created after migration 013, so every chunk
  // it has was embedded with the current model, by the current splitter.
  if (!state) return true;
  return !!state.completed_at && state.model === EMBEDDING_MODEL;
}

/**
 * Read every stored PDF again with the current extractor, a few at a time.
 *
 * The slowest phase by far — each document is downloaded and parsed — and the
 * only one that cannot work from documents.ocr_text, because that text is
 * what is wrong. It runs first because it rewrites both the text AND the
 * chunks, so anything the later phases did to the old chunks is discarded.
 */
async function reextractPhase(
  supabase: SupabaseClient,
  schema: string,
  state: StateRow,
  deadline: number,
): Promise<{ done: boolean; documents: number; cursor: string | null; error?: string }> {
  let cursor = state.reextract_cursor ?? null;
  let documents = 0;

  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc('rag_documents_to_reextract', {
      p_schema: schema, p_after: cursor, p_limit: 2,
    });
    if (error) {
      // Migration 018 not applied: skip the phase rather than block the rest.
      if (/find the function|schema cache|does not exist/i.test(error.message)) {
        return { done: true, documents, cursor };
      }
      return { done: false, documents, cursor, error: `Could not list PDFs: ${error.message}` };
    }

    const docs = (data ?? []) as { id: string; storage_path: string; file_name: string }[];
    if (docs.length === 0) return { done: true, documents, cursor };

    for (const doc of docs) {
      try {
        const result = await reextractDocument(supabase, schema, doc.id, doc.storage_path);
        if (result.empty) {
          console.warn(`[reembed] Re-extract produced nothing for ${doc.file_name} — keeping existing text`);
        } else {
          console.log(`[reembed] Re-extracted ${doc.file_name}: ${result.chars} chars, ${result.chunks} chunks`);
          documents++;
        }
      } catch (err) {
        // One unreadable file must not stall the whole family. Its existing
        // text and chunks are untouched, so it stays as searchable as it was.
        console.warn(`[reembed] Re-extract failed for ${doc.file_name}:`, err);
      }
      cursor = doc.id;
      if (Date.now() >= deadline) break;
    }
  }

  return { done: false, documents, cursor };
}

/**
 * Re-split every document with the current splitter, a few at a time.
 *
 * Pure text work against documents.ocr_text — no OCR, no network — so it is
 * far cheaper than embedding and runs first, as its own phase with its own
 * cursor. It has to run first because it decides what the chunks ARE;
 * embedding chunks that are about to be replaced would be wasted.
 *
 * Chunks are written without vectors here. They stay findable by keyword
 * throughout, and the embedding phase fills the vectors in.
 */
async function rechunkPhase(
  supabase: SupabaseClient,
  schema: string,
  state: StateRow,
  deadline: number,
): Promise<{ done: boolean; documents: number; cursor: string | null; error?: string }> {
  let cursor = state.rechunk_cursor ?? null;
  let documents = 0;

  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc('rag_documents_to_rechunk', {
      p_schema: schema, p_after: cursor, p_limit: 3,
    });
    if (error) {
      console.error('[reembed] Could not list documents to re-chunk:', error.message);
      return { done: false, documents, cursor, error: `Could not read documents: ${error.message}` };
    }

    const docs = (data ?? []) as { id: string; ocr_text: string }[];
    if (docs.length === 0) return { done: true, documents, cursor };

    for (const doc of docs) {
      const chunks = chunkText(doc.ocr_text);
      if (chunks.length === 0) { cursor = doc.id; continue; }

      const { error: replaceErr } = await supabase.rpc('rag_replace_document_chunks', {
        p_schema: schema,
        p_document_id: doc.id,
        p_chunks: chunks.map(c => ({
          chunk_index: c.chunk_index,
          content: c.content,
          token_count: c.token_count,
          embedding: null,
        })),
      });
      if (replaceErr) {
        // Leave the cursor before this document so the next run retries it,
        // rather than marching past a document that lost its chunks.
        console.error(`[reembed] Could not replace chunks for ${doc.id}: ${replaceErr.message}`);
        return { done: false, documents, cursor, error: `Could not rewrite chunks: ${replaceErr.message}` };
      }
      cursor = doc.id;
      documents++;
    }
  }

  return { done: false, documents, cursor };
}

/**
 * Give one attempt to each document that has no chunks at all.
 *
 * Such a document is invisible to search however good retrieval gets, and it
 * got that way by an ingestion that failed or never ran — a file uploaded,
 * stored, and then never read. Everything a retry needs is already here, so
 * the rebuild retries rather than asking anyone to delete and re-upload.
 *
 * Bounded by construction: a document that yields text leaves this list by
 * gaining chunks, and one that yields none is marked 'failed' and never tried
 * again. Either way it is gone from the list after a single attempt, so this
 * cannot become work repeated on every search.
 */
async function retryStuckDocuments(
  supabase: SupabaseClient,
  schema: string,
  familyId: string,
  deadline: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('rag_documents_to_ingest', {
    p_schema: schema, p_limit: 2,
  });
  if (error) {
    // Migration 017 not applied yet; the rest of the rebuild still runs.
    if (!/find the function|schema cache|does not exist/i.test(error.message)) {
      console.warn('[reembed] Could not list stuck documents:', error.message);
    }
    return 0;
  }

  const docs = (data ?? []) as { id: string; storage_path: string; file_name: string }[];
  let recovered = 0;

  for (const doc of docs) {
    if (Date.now() >= deadline) break;
    try {
      const result = await ingestDocument(supabase, {
        familyId, documentId: doc.id, storagePath: doc.storage_path,
      });
      if (result.empty) {
        console.warn(`[reembed] Nothing readable in ${doc.file_name} — marking failed`);
        await supabase.rpc('rag_mark_ingestion_failed', { p_schema: schema, p_document_id: doc.id });
      } else {
        console.log(`[reembed] Recovered ${doc.file_name}: ${result.chunks} chunks`);
        recovered++;
      }
    } catch (err) {
      // One bad file must not stop the rebuild. Mark it and move on: the app
      // names it, and the person can replace it.
      console.warn(`[reembed] Retry failed for ${doc.file_name}:`, err);
      await supabase.rpc('rag_mark_ingestion_failed', { p_schema: schema, p_document_id: doc.id });
    }
  }

  return recovered;
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
  opts: { budgetMs: number; requireLease?: boolean; familyId?: string } = { budgetMs: 20_000 },
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

  const startedAt = Date.now();
  const deadline = startedAt + opts.budgetMs;

  let cursor = state.cursor_id;
  let doneCount = state.done_count;
  let total = state.total_count;

  // ── Phase A: read stored PDFs again when extraction itself has changed.
  // Ahead of everything else because it rewrites text and chunks together,
  // which would discard any work the later phases had done.
  if (state.extractor_version !== EXTRACTOR_VERSION) {
    const reextract = await reextractPhase(supabase, schema, state, deadline);
    await saveState(supabase, schema, {
      model: EMBEDDING_MODEL,
      reextract_cursor: reextract.cursor,
      ...(reextract.done
        ? { extractor_version: EXTRACTOR_VERSION, rechunked_at: new Date().toISOString(), cursor_id: null, done_count: 0 }
        : {}),
      completed_at: null,
    });
    if (reextract.error || !reextract.done) {
      return {
        done: false, processed: 0, done_count: doneCount, total_count: total,
        ...(reextract.error ? { error: reextract.error } : {}), reextracting: true,
      };
    }
    console.log(`[reembed] ${schema}: re-extracted ${reextract.documents} PDF(s)`);
    // Chunks were rewritten by extraction, so embedding starts over and the
    // separate re-chunk phase has nothing left to do.
    state.rechunked_at = new Date().toISOString();
    cursor = null;
    doneCount = 0;
  }

  // ── Phase 0: give one attempt to documents that were never indexed, so a
  // failed upload is repaired rather than sitting in the vault unsearchable.
  if (opts.familyId) {
    const recovered = await retryStuckDocuments(supabase, schema, opts.familyId, deadline);
    if (recovered > 0) console.log(`[reembed] ${schema}: recovered ${recovered} document(s)`);
  }

  // ── Phase 1: re-split documents, if this family has not been through the
  // current splitter yet. Cheap, and it must finish before anything is
  // embedded, because it decides what the chunks are.
  if (!state.rechunked_at) {
    const rechunk = await rechunkPhase(supabase, schema, state, deadline);
    await saveState(supabase, schema, {
      model: EMBEDDING_MODEL,
      rechunk_cursor: rechunk.cursor,
      ...(rechunk.done ? { rechunked_at: new Date().toISOString(), cursor_id: null, done_count: 0 } : {}),
      completed_at: null,
    });
    if (rechunk.error) {
      return { done: false, processed: 0, done_count: doneCount, total_count: total, error: rechunk.error, rechunking: true };
    }
    if (!rechunk.done) {
      // Out of budget mid-split. Come back and carry on; nothing is embedded
      // until every document has been re-split.
      return { done: false, processed: 0, done_count: doneCount, total_count: total, rechunking: true };
    }
    console.log(`[reembed] ${schema}: re-split ${rechunk.documents} document(s)`);
    // Chunk ids and counts all changed, so the embedding phase starts over.
    cursor = null;
    doneCount = 0;
  }

  // A different model means the previous run's progress counts for nothing.
  if (state.model !== EMBEDDING_MODEL) {
    cursor = null;
    doneCount = 0;
  }

  {
    const { data: freshTotal } = await supabase.rpc('rag_chunk_total', { p_schema: schema });
    if (typeof freshTotal === 'number') total = freshTotal;
  }

  let processed = 0;
  let finished = false;

  // ── Phase 2: embed.
  while (Date.now() < deadline) {
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
