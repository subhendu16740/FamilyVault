-- 047 — Only the person who added a document can delete it.
--
-- Until now delete_family_document (023) let a member whose membership has
-- can_delete — every admin — delete any document in the family, and everyone
-- else only the documents they added. Now a document is its adder's to
-- delete: not even an admin deletes a document someone else added. In a
-- personal vault (046) nothing changes; everything in it is its owner's.
--
-- What stays the same:
-- - The caller must be the user it says it is (assert_caller_is, 023) and a
--   member of the family. A viewer who added a document can still delete it.
-- - A document that is not there says so ("Document not found"), as before,
--   so a client can treat it as already gone.
-- - The server's own removals do not go through this function and keep
--   working: a family deleted with its last admin's account (029,
--   purge_family) and the removal after Family Plus ends (040,
--   plan_take_excess).
-- - Signature, owner and grants are unchanged (CREATE OR REPLACE keeps
--   them), so the app and QA call it as before.
--
-- A refusal now carries SQLSTATE 42501 (insufficient privilege) and still
-- says "does not have permission", which the app reads to explain it.
--
-- The file goes by the same rule (section 2). 019's delete policy on the
-- documents bucket let any member delete any file in the family's folder
-- through the Storage API, so a member refused here could still empty
-- someone else's document of its file — and a viewer always could. Now a
-- member deletes only a file no document holds (its document was just
-- deleted, which is how the app deletes: the row first, then the file; or
-- its upload never became a document), or the file of a document they added.
--
-- A document whose adder has left the family, or deleted their account, can
-- no longer be deleted by anyone in the family. It goes with the family.
--
-- Apply to DEV, then PROD. Then run qa/sql/sweep.sql on both (it must return
-- no rows) and compare qa/sql/fingerprint.sql between them.


-- ─── 1. The document ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_family_document(
  p_family_id uuid, p_document_id uuid, p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_found BOOLEAN;
  v_uploaded_by UUID;
BEGIN
  PERFORM public.assert_caller_is(p_user_id);

  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found: %', p_family_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id
      AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this family';
  END IF;

  EXECUTE format(
    'SELECT true, uploaded_by FROM %I.documents WHERE id = $1',
    v_schema
  ) INTO v_found, v_uploaded_by USING p_document_id;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'Document not found: %', p_document_id;
  END IF;

  -- Only the person who added it: no exception for admins (047).
  IF v_uploaded_by IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'User does not have permission to delete this document: only the person who added it can delete it'
      USING ERRCODE = '42501';
  END IF;

  EXECUTE format(
    'DELETE FROM %I.documents WHERE id = $1',
    v_schema
  ) USING p_document_id;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_user_id, p_family_id, 'delete_document', 'document', p_document_id);
END;
$fn$;


-- ─── 2. Its file ────────────────────────────────────────────────────────────
-- The bucket's delete policy asks this: may the caller delete this file? Only
-- in a family they are in, and only a file that no document holds or that
-- only documents they added hold. False when it cannot tell — refusing is the
-- safe direction, as in 038's family_storage_has_room.
CREATE OR REPLACE FUNCTION public.document_file_deletable(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me    uuid := auth.uid();
  v_ns    text := (storage.foldername(p_name))[1];
  v_total int;
  v_mine  int;
BEGIN
  IF v_me IS NULL OR v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.families f
      JOIN public.family_members m ON m.family_id = f.id AND m.user_id = v_me
     WHERE f.storage_namespace = v_ns
  ) THEN
    RETURN false;
  END IF;

  IF to_regclass(format('%I.documents', v_ns)) IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE format(
    'SELECT count(*)::int, (count(*) FILTER (WHERE uploaded_by = $2))::int
       FROM %I.documents WHERE storage_path = $1',
    v_ns
  ) INTO v_total, v_mine USING p_name, v_me;

  RETURN v_total = v_mine;
END;
$fn$;

REVOKE ALL ON FUNCTION public.document_file_deletable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_file_deletable(text) TO authenticated, service_role;

-- 019's policy, with that check added. Uploads (038) and reads are unchanged;
-- the server's own removals (029, 040) use the service role, which no policy
-- stops.
DROP POLICY IF EXISTS "delete own family documents" ON storage.objects;
CREATE POLICY "delete own family documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT f.storage_namespace
      FROM public.families f
      WHERE f.id IN (SELECT public.get_my_family_ids())
    )
    AND public.document_file_deletable(name)
  );
