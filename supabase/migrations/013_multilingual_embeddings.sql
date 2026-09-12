-- ============================================================================
-- 013: Multilingual embeddings — registry and re-embed helpers
--
-- The vault embedded every chunk with all-MiniLM-L6-v2, which is English-only:
-- a Hindi or Bengali passage gets a meaningless vector, so semantic retrieval
-- never worked for Indian languages. We are moving to
-- intfloat/multilingual-e5-small — same 384 dimensions, so the vector column
-- and the HNSW index are untouched, and no chunk table is altered here.
--
-- The hazard is the changeover, not the model. A query vector from one model
-- compared against chunk vectors from another produces meaningless distances:
-- search degrades silently instead of failing, which is worse than being down.
-- So this migration adds a per-family registry that says which model a
-- family's chunks are embedded with, and whether the re-embed has finished.
-- Until it has, rag-search passes no query vector and retrieval falls back to
-- the keyword path it used before migration 011 — correct, just less good.
--
-- Existing families are seeded as "needs re-embedding". A family created
-- AFTER this migration has no row at all, and is treated as ready, because
-- every chunk it will ever have is embedded with the current model.
--
-- The three helpers below let an Edge Function walk a family's chunks in
-- batches and write new vectors back. They are SECURITY DEFINER and take a
-- schema name, exactly like the existing rag_retrieve_chunks, so they are
-- granted to service_role only — the Edge Function resolves the schema from a
-- family the caller was verified to administer.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- NOTE: migration 010 is reserved for the pending pg_dump of the live schema.
-- ============================================================================

-- ─── Registry ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.family_embedding_state (
  storage_namespace VARCHAR(50) PRIMARY KEY,
  model             TEXT        NOT NULL,
  -- Chunks are walked in id order; this is the last id embedded. Chunk ids are
  -- random UUIDs, so a row inserted mid-run may fall either side of the
  -- cursor. Both are fine: a new chunk was already embedded with the current
  -- model by ingest, so skipping it is correct and redoing it is harmless.
  cursor_id         UUID,
  done_count        INTEGER     NOT NULL DEFAULT 0,
  total_count       INTEGER     NOT NULL DEFAULT 0,
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No policies: this is service-role-only bookkeeping. Clients read their
-- family's progress through the reembed-index Edge Function, which checks
-- membership first.
ALTER TABLE public.family_embedding_state ENABLE ROW LEVEL SECURITY;

-- Seed every family that already exists. Anything embedded before today came
-- from the English-only model, so each of these needs a re-embed.
DO $seed$
DECLARE
  v_schema TEXT;
  v_total  INTEGER;
BEGIN
  FOR v_schema IN
    SELECT table_schema
    FROM information_schema.tables
    WHERE table_name = 'document_chunks'
      AND table_schema LIKE 'family\_%'
  LOOP
    EXECUTE format('SELECT count(*)::INTEGER FROM %I.document_chunks', v_schema)
      INTO v_total;

    INSERT INTO public.family_embedding_state
      (storage_namespace, model, total_count)
    VALUES
      (v_schema, 'sentence-transformers/all-MiniLM-L6-v2', v_total)
    ON CONFLICT (storage_namespace) DO NOTHING;
  END LOOP;
END
$seed$;

-- ─── Re-embed helpers ───────────────────────────────────────────────────────

-- How many chunks a family has, so progress can be shown as "N of M".
CREATE OR REPLACE FUNCTION public.rag_chunk_total(p_schema TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total INTEGER;
BEGIN
  EXECUTE format('SELECT count(*)::INTEGER FROM %I.document_chunks', p_schema)
    INTO v_total;
  RETURN COALESCE(v_total, 0);
END;
$function$;

-- The next batch to embed, in id order, skipping deleted documents.
CREATE OR REPLACE FUNCTION public.rag_chunks_to_embed(
  p_schema TEXT,
  p_after  UUID    DEFAULT NULL,
  p_limit  INTEGER DEFAULT 32
)
RETURNS TABLE(id UUID, content TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT c.id, c.content
     FROM %I.document_chunks c
     JOIN %I.documents d ON d.id = c.document_id
     WHERE d.is_deleted = false
       AND ($1 IS NULL OR c.id > $1)
     ORDER BY c.id
     LIMIT $2',
    p_schema, p_schema
  ) USING p_after, p_limit;
END;
$function$;

-- Write one freshly computed vector back. A NULL p_embedding CLEARS the
-- vector, which is what the caller wants when a chunk could not be embedded:
-- leaving the previous model's vector in place would let it be compared
-- against new-model query vectors, ranking by noise. A cleared chunk simply
-- sits out vector search and is still found by keyword.
CREATE OR REPLACE FUNCTION public.rag_set_chunk_embedding(
  p_schema    TEXT,
  p_chunk_id  UUID,
  p_embedding VECTOR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE format(
    'UPDATE %I.document_chunks SET embedding = $2 WHERE id = $1',
    p_schema
  ) USING p_chunk_id, p_embedding;
END;
$function$;

-- Edge Functions run as service_role. Nothing else needs these.
REVOKE ALL ON FUNCTION public.rag_chunk_total(TEXT)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rag_chunks_to_embed(TEXT, UUID, INTEGER)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rag_set_chunk_embedding(TEXT, UUID, VECTOR) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rag_chunk_total(TEXT)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_chunks_to_embed(TEXT, UUID, INTEGER)    TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_set_chunk_embedding(TEXT, UUID, VECTOR) TO service_role;
