-- ============================================================================
-- 030: a profile goes with its sign-in
--
-- public.users had no foreign key to auth.users. Deleting an account in the
-- app never depended on one: delete_account_data() (029) removes the profile
-- itself. But deleting a person from the Supabase dashboard (Authentication ›
-- Users › Delete) removed ONLY the sign-in. The profile stayed, with its
-- email, name and phone. So did the memberships, every family only that
-- person managed, its documents and its files, with no way left to sign in
-- and delete them. DEV holds two such profiles, from sign-ups deleted by
-- hand in March 2026. PROD holds none.
--
-- After this:
--
--   • A sign-in deleted by any route takes its profile with it, and the
--     profile's memberships and notifications with that (both already
--     cascade from public.users).
--   • Some sign-ins cannot be deleted from the dashboard at all: anyone who
--     created a family, or has history that 029 deletes explicitly. The
--     reason is that families.created_by is ON DELETE RESTRICT, and
--     audit_logs, invitations and document_categories point at the profile
--     with NO ACTION. The dashboard now refuses ("Database error deleting
--     user") instead of half-deleting. That refusal is the point. An
--     account is deleted by the app's Delete account, or, for someone who
--     cannot sign in, by the steps in CLAUDE.md › Deleting your account.
--
-- Profiles that are already orphaned go first, through delete_account_data(),
-- so the same rules as an in-app deletion clean up whatever they still own.
-- Their files, if any, cannot be removed from SQL, so the NOTICE names the
-- folders to delete in Storage. Neither project has any today.
--
-- No app or Edge Function change depends on this; apply it whenever.
--
-- Apply: paste into the SQL editor — DEV, then PROD in the same sitting, then
-- run qa/sql/fingerprint.sql on both (the constraint hash changes on each).
-- Idempotent.
-- ============================================================================

BEGIN;

-- ─── Profiles whose sign-in is already gone ─────────────────────────────────
DO $$
DECLARE
  r       record;
  v_done  jsonb;
BEGIN
  FOR r IN
    SELECT u.id FROM public.users u
     WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id)
  LOOP
    v_done := public.delete_account_data(r.id);
    IF (v_done->>'families_deleted')::int > 0 THEN
      RAISE NOTICE 'Deleted families of a profile with no sign-in; delete these folders in Storage › documents: %',
        v_done->'deleted_namespaces';
    END IF;
  END LOOP;
END $$;

-- ─── From now on, the profile follows the sign-in ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass AND conname = 'users_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;

-- Check, on both projects — must return 0:
--   SELECT count(*) FROM public.users u
--    WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id);
