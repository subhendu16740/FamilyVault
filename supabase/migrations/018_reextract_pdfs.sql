-- ============================================================================
-- 018: Re-extract stored PDFs with the layout-aware reader
--
-- Text was pulled out of PDFs by reading the content stream in order, which
-- is the order the producing program happened to write glyphs in — not
-- reading order. For prose those coincide. For a table they do not: every
-- label comes out in one run and every figure in another, so the placements
-- report stored "Operations" and its "27 - 44" two hundred characters apart
-- with nine other functions in between, and no question about a row could be
-- answered from it.
--
-- _shared/pdf-text.ts now reads each piece of text with its position and
-- rebuilds lines, so the same table stores as:
--
--     Operations  28,73,765  31,61,743  27 - 44
--
-- That only helps documents extracted from here on unless the ones already
-- stored are read again, which is what this migration enables. Unlike the
-- re-chunk phase in 016, this one cannot work from documents.ocr_text — that
-- text is precisely what is wrong — so it downloads each PDF from storage
-- again. Slower, and still resumable from a cursor.
--
-- extractor_version records which reader produced a family's stored text, so
-- a future change to extraction re-runs this the same way changing the
-- embedding model re-runs the embedding phase.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

ALTER TABLE public.family_embedding_state
  ADD COLUMN IF NOT EXISTS extractor_version TEXT,
  ADD COLUMN IF NOT EXISTS reextract_cursor  UUID;

-- PDFs to read again, in id order. Images are excluded: their text comes from
-- OCR on the client, which never had a layout problem to fix.
CREATE OR REPLACE FUNCTION public.rag_documents_to_reextract(
  p_schema TEXT,
  p_after  UUID    DEFAULT NULL,
  p_limit  INTEGER DEFAULT 2
)
RETURNS TABLE(id UUID, storage_path TEXT, file_name CHARACTER VARYING)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.storage_path, d.file_name
     FROM %I.documents d
     WHERE d.is_deleted = false
       AND d.storage_path IS NOT NULL
       AND lower(d.storage_path) LIKE ''%%.pdf''
       AND ($1 IS NULL OR d.id > $1)
     ORDER BY d.id
     LIMIT $2',
    p_schema
  ) USING p_after, p_limit;
END;
$function$;

-- Replace a document's extracted text. The chunks are rewritten separately by
-- rag_replace_document_chunks, so a caller that fails between the two leaves
-- the document searchable on its old chunks rather than on nothing.
CREATE OR REPLACE FUNCTION public.rag_set_document_text(
  p_schema      TEXT,
  p_document_id UUID,
  p_ocr_text    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE format(
    'UPDATE %I.documents
        SET ocr_text = $2,
            search_vector = to_tsvector(''english'', $2),
            updated_at = now()
      WHERE id = $1',
    p_schema
  ) USING p_document_id, p_ocr_text;
END;
$function$;

REVOKE ALL ON FUNCTION public.rag_documents_to_reextract(TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rag_set_document_text(TEXT, UUID, TEXT)         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rag_documents_to_reextract(TEXT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_set_document_text(TEXT, UUID, TEXT)         TO service_role;

-- Send every family through the new reader. Clearing completed_at restarts
-- the rebuild; the embedding already done is not wasted, because re-extraction
-- rewrites the chunks it applied to anyway.
UPDATE public.family_embedding_state
   SET extractor_version = NULL,
       reextract_cursor  = NULL,
       rechunked_at      = NULL,
       rechunk_cursor    = NULL,
       completed_at      = NULL;
