-- ============================================================================
-- 011: Give rag_retrieve_chunks semantic retrieval
--
-- The ingest pipeline has always embedded chunks into document_chunks.embedding
-- (vector(384), HNSW indexed), but no retrieval path ever compared a query
-- against them: rag_retrieve_chunks took only a tsquery, so every RAG answer
-- was built from keyword matches.
--
-- This adds an OPTIONAL p_query_embedding parameter. It is last and defaults
-- to NULL, so the existing 4-argument call keeps working unchanged — apply
-- this migration before deploying the new rag-search function, in either
-- order, without a broken window.
--
-- The DROP below is load-bearing. CREATE OR REPLACE only replaces a function
-- whose argument list is identical; adding a parameter changes the signature,
-- so without the DROP Postgres keeps the original 4-argument function AND
-- creates a second 5-argument one. A 4-argument call then matches both — the
-- old one exactly, the new one via its default — and fails with
-- "function rag_retrieve_chunks(...) is not unique", breaking the currently
-- deployed rag-search until the new one ships.
--
--   embedding IS NULL  → byte-for-byte the previous behaviour
--   embedding present  → hybrid, weighted 0.7 semantic / 0.3 keyword to match
--                        public.hybrid_search_documents
--
-- NOTE: migration 010 is reserved for the pending pg_dump of the live schema.
-- ============================================================================

-- Remove the previous 4-argument definition so the new one below is the only
-- candidate. Safe: the new signature serves 4-argument callers via its default.
DROP FUNCTION IF EXISTS public.rag_retrieve_chunks(TEXT, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.rag_retrieve_chunks(
  p_schema          TEXT,
  p_tsquery         TEXT,
  p_query_pattern   TEXT,
  p_limit           INTEGER DEFAULT 10,
  p_query_embedding VECTOR  DEFAULT NULL
)
RETURNS TABLE(
  document_id   UUID,
  file_name     CHARACTER VARYING,
  file_type     CHARACTER VARYING,
  category_name CHARACTER VARYING,
  content       TEXT,
  chunk_index   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ─── Keyword only (unchanged from the previous definition) ───────────────
  IF p_query_embedding IS NULL THEN
    RETURN QUERY EXECUTE format(
      'SELECT c.document_id, d.file_name, d.file_type,
              cat.name::VARCHAR AS category_name,
              c.content, c.chunk_index
       FROM %I.document_chunks c
       JOIN %I.documents d ON d.id = c.document_id
       LEFT JOIN public.document_categories cat ON cat.id = d.category_id
       WHERE d.is_deleted = false
         AND (
           (c.search_vector IS NOT NULL AND c.search_vector @@ to_tsquery(''english'', $1))
           OR c.content ILIKE $2
           OR d.ocr_text ILIKE $2
           OR d.file_name ILIKE $2
         )
       ORDER BY
         CASE WHEN c.search_vector IS NOT NULL
                   AND c.search_vector @@ to_tsquery(''english'', $1)
              THEN ts_rank(c.search_vector, to_tsquery(''english'', $1))
              ELSE 0
         END DESC
       LIMIT $3',
      p_schema, p_schema
    ) USING p_tsquery, p_query_pattern, p_limit;
    RETURN;
  END IF;

  -- ─── Hybrid: semantic + keyword ──────────────────────────────────────────
  -- Both sides over-fetch (limit * 3) so the blended ranking has candidates
  -- to choose between rather than re-ranking an already-truncated list.
  RETURN QUERY EXECUTE format(
    'WITH live_docs AS (
       SELECT id FROM %I.documents WHERE is_deleted = false
     ),
     vector_hits AS (
       SELECT c.id, 1 - (c.embedding <=> $4) AS vec_score
       FROM %I.document_chunks c
       WHERE c.embedding IS NOT NULL
         AND c.document_id IN (SELECT id FROM live_docs)
       ORDER BY c.embedding <=> $4
       LIMIT $3 * 3
     ),
     text_hits AS (
       SELECT c.id,
              CASE WHEN c.search_vector IS NOT NULL
                        AND c.search_vector @@ to_tsquery(''english'', $1)
                   THEN ts_rank(c.search_vector, to_tsquery(''english'', $1))
                   ELSE 0
              END AS text_score
       FROM %I.document_chunks c
       JOIN %I.documents d ON d.id = c.document_id
       WHERE d.is_deleted = false
         AND (
           (c.search_vector IS NOT NULL AND c.search_vector @@ to_tsquery(''english'', $1))
           OR c.content ILIKE $2
           OR d.ocr_text ILIKE $2
           OR d.file_name ILIKE $2
         )
       LIMIT $3 * 3
     ),
     combined AS (
       SELECT COALESCE(v.id, t.id) AS chunk_id,
              COALESCE(v.vec_score, 0) * 0.7
            + COALESCE(t.text_score, 0) * 0.3 AS score
       FROM vector_hits v
       FULL OUTER JOIN text_hits t ON v.id = t.id
     )
     SELECT c.document_id, d.file_name, d.file_type,
            cat.name::VARCHAR AS category_name,
            c.content, c.chunk_index
     FROM combined k
     JOIN %I.document_chunks c ON c.id = k.chunk_id
     JOIN %I.documents d ON d.id = c.document_id
     LEFT JOIN public.document_categories cat ON cat.id = d.category_id
     WHERE d.is_deleted = false
     ORDER BY k.score DESC
     LIMIT $3',
    p_schema, p_schema, p_schema, p_schema, p_schema, p_schema
  ) USING p_tsquery, p_query_pattern, p_limit, p_query_embedding;
END;
$function$;
