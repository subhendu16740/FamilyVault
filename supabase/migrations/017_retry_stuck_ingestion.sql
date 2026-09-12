-- ============================================================================
-- 017: Retry documents whose ingestion never finished
--
-- A document can be uploaded, stored, and then never read: this vault held
-- "Harrier Insurance 2026-27.pdf" at ingestion_status 'pending' from 13 August
-- onwards, the 1.16 MB PDF sitting intact in storage the whole time, with no
-- text, no chunks, and nothing retrying it or saying so. A near-identical PDF
-- uploaded two days earlier ingested fine, so the file was never the problem.
--
-- Deleting and re-uploading is a workaround, not a fix. Everything needed for
-- a retry is already there — the storage path, the document row, and a
-- pipeline that can download and extract on its own — so the rebuild now
-- retries such documents itself, before it re-chunks anything.
--
-- Retries are bounded, which is the part worth getting right: a file that
-- genuinely cannot be read (an encrypted PDF, a photograph of nothing) must
-- not be retried on every search forever. A retry either produces text, and
-- the document leaves this list by gaining chunks, or it produces none, and
-- rag_mark_ingestion_failed moves it to 'failed' so it is never tried again.
-- Either way it is out of the list after one attempt.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

-- Documents with nothing for search to match, that are worth one attempt:
-- a file in storage, and not already given up on.
CREATE OR REPLACE FUNCTION public.rag_documents_to_ingest(
  p_schema TEXT,
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
       AND COALESCE(d.ingestion_status, '''') <> ''failed''
       AND NOT EXISTS (
         SELECT 1 FROM %I.document_chunks c WHERE c.document_id = d.id
       )
     ORDER BY d.created_at
     LIMIT $1',
    p_schema, p_schema
  ) USING p_limit;
END;
$function$;

-- Give up on one document, so it is never retried again. The row and the file
-- both stay: the app names it as unreadable and the person can replace it.
CREATE OR REPLACE FUNCTION public.rag_mark_ingestion_failed(
  p_schema      TEXT,
  p_document_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE format(
    'UPDATE %I.documents
        SET ingestion_status = ''failed'', updated_at = now()
      WHERE id = $1',
    p_schema
  ) USING p_document_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rag_documents_to_ingest(TEXT, INTEGER)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rag_mark_ingestion_failed(TEXT, UUID)       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rag_documents_to_ingest(TEXT, INTEGER)   TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_mark_ingestion_failed(TEXT, UUID)    TO service_role;
