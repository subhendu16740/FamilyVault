-- ============================================================================
-- 015: Stop one document from filling the whole candidate list
--
-- "What is Arpita's mobile number?" returned nothing, while the answer sat at
-- character 25 of a resume: "ARPITA PATNAIK  Mob: +91 …". Retrieval never
-- offered that chunk. The vault also holds a 111-chunk tax return, and an
-- Indian tax form says "mobile" and "number" on page after page — so a
-- keyword query of "what | arpita | mobile | number" ranks dozens of tax-form
-- chunks above the one resume chunk that matches the rare word, and they take
-- every slot.
--
-- rag-search already caps chunks per document, but it does so on the rows
-- this function returns, which is too late: when all of them come from one
-- document there is nothing left to diversify with. The cap has to be applied
-- while ranking, so each document is represented by its OWN best chunks and
-- the global ordering then chooses between documents.
--
-- p_per_doc is last and defaults to NULL (= no cap), so the existing
-- five-argument call keeps working and this can be applied before or after
-- the function that uses it.
--
-- The DROP is load-bearing, for the same reason it was in migration 011:
-- CREATE OR REPLACE only replaces an identical argument list, so adding a
-- parameter would leave BOTH definitions in place and a five-argument call
-- would fail with "function ... is not unique".
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

DROP FUNCTION IF EXISTS public.rag_retrieve_chunks(TEXT, TEXT, TEXT, INTEGER, VECTOR);

CREATE OR REPLACE FUNCTION public.rag_retrieve_chunks(
  p_schema          TEXT,
  p_tsquery         TEXT,
  p_query_pattern   TEXT,
  p_limit           INTEGER DEFAULT 10,
  p_query_embedding VECTOR  DEFAULT NULL,
  p_per_doc         INTEGER DEFAULT NULL
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
  -- ─── Keyword only (no query vector, or mid re-embed) ─────────────────────
  IF p_query_embedding IS NULL THEN
    RETURN QUERY EXECUTE format(
      'WITH scored AS (
         SELECT c.document_id, d.file_name, d.file_type,
                cat.name::VARCHAR AS category_name,
                c.content, c.chunk_index,
                CASE WHEN c.search_vector IS NOT NULL
                          AND c.search_vector @@ to_tsquery(''english'', $1)
                     THEN ts_rank(c.search_vector, to_tsquery(''english'', $1))
                     ELSE 0
                END AS score
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
       ),
       ranked AS (
         SELECT s.*,
                row_number() OVER (
                  PARTITION BY s.document_id
                  ORDER BY s.score DESC, s.chunk_index
                ) AS rn
         FROM scored s
       )
       SELECT r.document_id, r.file_name, r.file_type, r.category_name,
              r.content, r.chunk_index
       FROM ranked r
       WHERE $4 IS NULL OR r.rn <= $4
       ORDER BY r.score DESC, r.rn
       LIMIT $3',
      p_schema, p_schema
    ) USING p_tsquery, p_query_pattern, p_limit, p_per_doc;
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
       SELECT c.id, 1 - (c.embedding <=> $5) AS vec_score
       FROM %I.document_chunks c
       WHERE c.embedding IS NOT NULL
         AND c.document_id IN (SELECT id FROM live_docs)
       ORDER BY c.embedding <=> $5
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
     ),
     ranked AS (
       SELECT c.document_id, d.file_name, d.file_type,
              cat.name::VARCHAR AS category_name,
              c.content, c.chunk_index, k.score,
              row_number() OVER (
                PARTITION BY c.document_id
                ORDER BY k.score DESC, c.chunk_index
              ) AS rn
       FROM combined k
       JOIN %I.document_chunks c ON c.id = k.chunk_id
       JOIN %I.documents d ON d.id = c.document_id
       LEFT JOIN public.document_categories cat ON cat.id = d.category_id
       WHERE d.is_deleted = false
     )
     SELECT r.document_id, r.file_name, r.file_type, r.category_name,
            r.content, r.chunk_index
     FROM ranked r
     WHERE $4 IS NULL OR r.rn <= $4
     ORDER BY r.score DESC, r.rn
     LIMIT $3',
    p_schema, p_schema, p_schema, p_schema, p_schema, p_schema
  ) USING p_tsquery, p_query_pattern, p_limit, p_per_doc, p_query_embedding;
END;
$function$;
