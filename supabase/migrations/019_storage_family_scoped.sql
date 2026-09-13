-- ============================================================================
-- 019: Scope the documents bucket to the family that owns the file
--
-- Every policy on the `documents` bucket said the same thing:
--
--     USING (bucket_id = 'documents')          -- role: authenticated
--
-- There was no check on the PATH, and paths are `family_<short id>/<file>`.
-- The bucket is private, so this was never open to the public internet — but
-- any account that could sign in could list the whole bucket, download every
-- file in it, and DELETE them. Signing up is open, and the anon key ships
-- inside the web bundle by design, because Row-Level Security is supposed to
-- be the boundary. Here there was none.
--
-- On DEV that is 16 files across 4 families: passports, PAN cards, insurance
-- policies, a tax return. One family's members could read another's.
--
-- The first path segment IS the owning family: it equals
-- `families.storage_namespace`. So that is what the policies compare against,
-- via get_my_family_ids(), which is SECURITY DEFINER and therefore does not
-- re-enter family_members' own RLS (the recursion migration 007 had to fix).
--
-- Edge Functions are unaffected: they use the service-role key, which bypasses
-- RLS entirely, so ingest and the rebuild still read every file they need.
--
-- No UPDATE policy is added, because there was none before and adding one
-- would grant something the app has never relied on.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

-- Both naming schemes that exist across the two projects.
DROP POLICY IF EXISTS "auth read documents"   ON storage.objects;
DROP POLICY IF EXISTS "auth upload documents" ON storage.objects;
DROP POLICY IF EXISTS "auth_read"             ON storage.objects;
DROP POLICY IF EXISTS "auth_upload"           ON storage.objects;
DROP POLICY IF EXISTS "auth_delete"           ON storage.objects;

-- Replacements, should this ever be re-run.
DROP POLICY IF EXISTS "read own family documents"   ON storage.objects;
DROP POLICY IF EXISTS "upload own family documents" ON storage.objects;
DROP POLICY IF EXISTS "delete own family documents" ON storage.objects;

CREATE POLICY "read own family documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT f.storage_namespace
      FROM public.families f
      WHERE f.id IN (SELECT public.get_my_family_ids())
    )
  );

CREATE POLICY "upload own family documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT f.storage_namespace
      FROM public.families f
      WHERE f.id IN (SELECT public.get_my_family_ids())
    )
  );

CREATE POLICY "delete own family documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT f.storage_namespace
      FROM public.families f
      WHERE f.id IN (SELECT public.get_my_family_ids())
    )
  );
