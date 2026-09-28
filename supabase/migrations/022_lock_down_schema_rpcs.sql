-- ============================================================================
-- 022: A schema name is not an access check
--
-- Twelve functions take the family's schema as a PARAMETER, are
-- SECURITY DEFINER, perform NO membership check, and were executable by
-- `authenticated` and `anon`. So any signed-in account could name another
-- family's schema and read — or destroy — its documents.
--
-- Demonstrated on DEV, as a real user through the real `authenticated`
-- role. A user belonging only to family_b2139a64:
--
--     select * from rag_retrieve_chunks(
--       'family_5fbc8888', 'passport | pan | insurance', '%a%', 5, NULL, NULL);
--
-- returned five chunks of ANOTHER family's tax return, in full text.
--
-- This is worse than the storage-bucket hole that migration 019 closed.
-- That one leaked the FILES; this leaks the extracted TEXT directly, with no
-- download and no file path to guess. And three of these functions WRITE:
-- rag_replace_document_chunks, rag_set_document_text and
-- rag_mark_ingestion_failed let a stranger overwrite or bury another
-- family's documents.
--
-- The fix is total, because the exposure was never needed: the app calls
-- NONE of these. Every one is invoked only by an Edge Function
-- (ingest-document, rag-search, reembed-index), each of which builds its
-- client with SUPABASE_SERVICE_ROLE_KEY. Grepping src/ for a direct call to
-- any of them returns nothing.
--
-- So service_role is the whole audience, and the grant says exactly that.
-- Nothing in the app changes, because nothing in the app could reach them
-- legitimately in the first place.
--
-- Why revoke rather than add membership checks: these functions receive a
-- schema NAME, not a family id, so a check would mean reverse-mapping the
-- name to a family on every call, in twelve places, each an opportunity to
-- get it wrong. Removing the reachability removes the class of bug. A
-- function that only the service role can call cannot be called by the wrong
-- person at all.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'rag\_%' OR p.proname = 'get_document_chunks')
      -- Only ever the schema-name-taking shape. A future rag_* helper that
      -- takes a family id and checks membership should not be swept up.
      AND pg_get_function_identity_arguments(p.oid) LIKE 'p_schema %'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
    RAISE NOTICE 'locked down %', fn.sig;
  END LOOP;
END $$;

-- Verify: this must return zero rows. Any row is a function a signed-in
-- account can still point at someone else's family.
--
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND (p.proname LIKE 'rag\_%' OR p.proname = 'get_document_chunks')
--     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_schema %'
--     AND (p.proacl IS NULL
--          OR array_to_string(p.proacl, ' ') ~ '(^|[ =])(anon|authenticated)=');
