-- ============================================================================
-- 016: Re-chunk existing documents, and surface the ones never indexed
--
-- Chunk size is not cosmetic: multilingual-e5-small reads 512 tokens and
-- silently ignores the rest, so a chunk longer than that is embedded from its
-- opening only. In this vault chunks averaged ~1,750 characters and reached
-- 3,642, which puts the tail of most passages outside the model's window —
-- present in the database, findable by keyword, invisible to a question asked
-- in other words. The splitter is fixed in _shared/chunking.ts; this migration
-- is what lets already-stored documents be split again.
--
-- Re-chunking needs no OCR and no network: documents.ocr_text still holds the
-- full extracted text for every document that has chunks, so it is a pure
-- text pass. It therefore runs as a fast first phase of the existing rebuild,
-- with its own cursor, before the slow embedding phase.
--
-- rag_unindexed_documents exists because of the other thing this vault
-- revealed: a PDF uploaded on 13 August has sat at ingestion_status 'pending'
-- ever since, with no text and no chunks, and nothing ever told anyone. A
-- document that is not searchable should say so rather than quietly not
-- appear in answers.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

-- ─── Two more cursors on the rebuild registry ───────────────────────────────

ALTER TABLE public.family_embedding_state
  ADD COLUMN IF NOT EXISTS rechunk_cursor UUID,
  ADD COLUMN IF NOT EXISTS rechunked_at   TIMESTAMPTZ;

-- ─── Re-chunk helpers ───────────────────────────────────────────────────────

-- Documents still to re-split, in id order, largest text first within a page.
-- Only those with text: a document with none cannot be re-chunked, and is
-- reported by rag_unindexed_documents instead.
CREATE OR REPLACE FUNCTION public.rag_documents_to_rechunk(
  p_schema TEXT,
  p_after  UUID    DEFAULT NULL,
  p_limit  INTEGER DEFAULT 3
)
RETURNS TABLE(id UUID, ocr_text TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.ocr_text
     FROM %I.documents d
     WHERE d.is_deleted = false
       AND d.ocr_text IS NOT NULL
       AND length(d.ocr_text) > 0
       AND ($1 IS NULL OR d.id > $1)
     ORDER BY d.id
     LIMIT $2',
    p_schema
  ) USING p_after, p_limit;
END;
$function$;

-- Replace one document's chunks wholesale. Delete and insert happen in the
-- same statement pair inside one function call, so a reader never sees the
-- document half-chunked. Embeddings are optional: a chunk stored without one
-- is still found by keyword, and the embedding phase fills it in afterwards.
CREATE OR REPLACE FUNCTION public.rag_replace_document_chunks(
  p_schema      TEXT,
  p_document_id UUID,
  p_chunks      JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_chunk JSONB;
  v_count INTEGER := 0;
BEGIN
  EXECUTE format('DELETE FROM %I.document_chunks WHERE document_id = $1', p_schema)
    USING p_document_id;

  FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks)
  LOOP
    IF COALESCE(v_chunk->>'embedding', '') <> '' THEN
      EXECUTE format(
        'INSERT INTO %I.document_chunks
           (document_id, chunk_index, content, token_count, embedding, search_vector)
         VALUES ($1, $2, $3, $4, $5::vector(384), to_tsvector(''english'', $3))',
        p_schema
      ) USING p_document_id,
              (v_chunk->>'chunk_index')::int,
              v_chunk->>'content',
              (v_chunk->>'token_count')::int,
              v_chunk->>'embedding';
    ELSE
      EXECUTE format(
        'INSERT INTO %I.document_chunks
           (document_id, chunk_index, content, token_count, search_vector)
         VALUES ($1, $2, $3, $4, to_tsvector(''english'', $3))',
        p_schema
      ) USING p_document_id,
              (v_chunk->>'chunk_index')::int,
              v_chunk->>'content',
              (v_chunk->>'token_count')::int;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Documents that cannot be searched at all: no chunks to match against. The
-- app shows these rather than letting them look like documents with no answer.
CREATE OR REPLACE FUNCTION public.rag_unindexed_documents(p_schema TEXT)
RETURNS TABLE(file_name CHARACTER VARYING, ingestion_status CHARACTER VARYING)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT d.file_name, d.ingestion_status
     FROM %I.documents d
     WHERE d.is_deleted = false
       AND NOT EXISTS (
         SELECT 1 FROM %I.document_chunks c WHERE c.document_id = d.id
       )
     ORDER BY d.created_at DESC
     LIMIT 20',
    p_schema, p_schema
  );
END;
$function$;

-- Edge Functions run as service_role. Nothing else needs these.
REVOKE ALL ON FUNCTION public.rag_documents_to_rechunk(TEXT, UUID, INTEGER)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rag_replace_document_chunks(TEXT, UUID, JSONB)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rag_unindexed_documents(TEXT)                      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rag_documents_to_rechunk(TEXT, UUID, INTEGER)   TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_replace_document_chunks(TEXT, UUID, JSONB)  TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_unindexed_documents(TEXT)                   TO service_role;

-- Every family must go through the new splitter, so clear any completion mark
-- from the chunk-only rebuild. Cheap: the re-chunk phase needs no network.
UPDATE public.family_embedding_state
   SET rechunked_at = NULL,
       rechunk_cursor = NULL,
       completed_at = NULL;
