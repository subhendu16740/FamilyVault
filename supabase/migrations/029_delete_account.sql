-- ============================================================================
-- 029: delete your account — everything, at once, for good
--
-- Both stores require that a person can delete their account from inside the
-- app (Apple 5.1.1(v); Google Play's account-deletion policy). Until now the
-- app said "send us a message", with no address to send it to.
--
-- What deleting an account deletes, immediately and with nothing kept:
--
--   • Every family the person is the last admin of, or the last member of:
--     its documents, their text and search index, its files, its members'
--     access, notifications and saved chats about it. Other members of such a
--     family lose it too; the app says so, by name, before anything happens.
--   • In a family that keeps another admin, the person leaves, as with Leave
--     family today: the family keeps its documents, including the ones this
--     person added. If they had created that family, the family passes to
--     its longest-standing admin (families.created_by is ON DELETE RESTRICT).
--   • Their own rows: profile, notifications, audit entries, invitations they
--     sent; custom categories they made stay, unattributed. The Edge Function
--     then deletes the sign-in itself (auth.users), which takes their Gmail
--     connection, feedback and any saved chats with it (ON DELETE CASCADE).
--
-- Files are not rows: Storage refuses direct deletes from storage.objects,
-- so delete-account removes them through the Storage API, using
-- family_storage_objects() to list them.
--
-- All four functions are SERVICE ROLE ONLY. account_deletion_plan() and
-- delete_account_data() take a user id as a parameter, which is exactly what
-- CLAUDE.md "Read this first" point 2 forbids for anything a client can call:
-- granted to `authenticated`, anyone could delete anyone. The caller is
-- established by delete-account from their session, and nothing else calls
-- these. Revoked from anon and authenticated BY NAME (REVOKE ... FROM PUBLIC
-- alone is not enough on Supabase), so the 023 sweep stays at zero rows.
--
-- The app works before this is applied: Delete account says it is not
-- switched on yet.
--
-- Apply: paste into the SQL editor — DEV, then PROD in the same sitting, then
-- run qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent.
-- ============================================================================

BEGIN;

-- ─── What deleting this account would do ────────────────────────────────────
-- One row per family the person belongs to. The confirmation screen shows it,
-- and delete_account_data() acts on it, so the rule lives in one place:
-- a family goes with the account when nobody would be left to manage it.
CREATE OR REPLACE FUNCTION public.account_deletion_plan(p_user_id uuid)
RETURNS TABLE (
  family_id         uuid,
  family_name       text,
  storage_namespace text,
  role              text,
  other_members     integer,
  other_admins      integer,
  document_count    integer,
  your_documents    integer,
  delete_family     boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT f.id, f.name, f.storage_namespace, m.role, m.joined_at,
           (SELECT count(*) FROM public.family_members o
             WHERE o.family_id = f.id AND o.user_id <> p_user_id)::int AS others,
           (SELECT count(*) FROM public.family_members o
             WHERE o.family_id = f.id AND o.user_id <> p_user_id AND o.role = 'admin')::int AS admins
      FROM public.family_members m
      JOIN public.families f ON f.id = m.family_id
     WHERE m.user_id = p_user_id
     ORDER BY m.joined_at
  LOOP
    family_id         := r.id;
    family_name       := r.name;
    storage_namespace := r.storage_namespace;
    role              := r.role;
    other_members     := r.others;
    other_admins      := r.admins;
    delete_family     := r.others = 0 OR (r.role = 'admin' AND r.admins = 0);
    document_count    := 0;
    your_documents    := 0;
    IF to_regclass(format('%I.documents', r.storage_namespace)) IS NOT NULL THEN
      EXECUTE format(
        'SELECT count(*)::int, (count(*) FILTER (WHERE uploaded_by = $1))::int FROM %I.documents',
        r.storage_namespace)
        INTO document_count, your_documents
        USING p_user_id;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

-- ─── One family, gone: rows, schema, index state ────────────────────────────
-- The files are the Edge Function's job (see above). Returns the storage
-- namespace, so it knows which folder to empty.
CREATE OR REPLACE FUNCTION public.purge_family(p_family_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ns text;
BEGIN
  SELECT storage_namespace INTO v_ns FROM public.families WHERE id = p_family_id;
  IF v_ns IS NULL THEN
    RETURN NULL;
  END IF;
  -- The schema name comes from the database, but it is about to be dropped
  -- with CASCADE: refuse anything that is not a family schema.
  IF v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'refusing to drop unexpected schema %', v_ns;
  END IF;

  -- audit_logs.family_id has no ON DELETE action, so it would block the family.
  DELETE FROM public.audit_logs WHERE family_id = p_family_id;
  DELETE FROM public.family_embedding_state WHERE storage_namespace = v_ns;
  -- family_members, invitations and notifications cascade; saved chats go with
  -- the memberships; gmail_import_items forget the family (SET NULL).
  DELETE FROM public.families WHERE id = p_family_id;
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_ns);
  RETURN v_ns;
END;
$fn$;

-- ─── Everything in the database that is this person's ──────────────────────
-- One transaction: it all goes, or nothing does and the call can be retried.
-- Safe to call again for someone already deleted: it finds nothing.
CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r       record;
  v_ns    text;
  v_heir  uuid;
  v_gone  text[] := '{}';
  v_left  integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  FOR r IN SELECT * FROM public.account_deletion_plan(p_user_id) LOOP
    IF r.delete_family THEN
      v_ns := public.purge_family(r.family_id);
      IF v_ns IS NOT NULL THEN
        v_gone := v_gone || v_ns;
      END IF;
    ELSE
      DELETE FROM public.family_members WHERE family_id = r.family_id AND user_id = p_user_id;
      v_left := v_left + 1;
    END IF;
  END LOOP;

  -- Families this person created and no longer belongs to, now or from before.
  -- With members left, the longest-standing admin (or member) takes them on;
  -- with nobody left, nobody can reach them, so they go too.
  FOR r IN SELECT f.id FROM public.families f WHERE f.created_by = p_user_id LOOP
    SELECT o.user_id INTO v_heir
      FROM public.family_members o
     WHERE o.family_id = r.id AND o.user_id <> p_user_id
     ORDER BY (o.role = 'admin') DESC, o.joined_at
     LIMIT 1;
    IF v_heir IS NULL THEN
      v_ns := public.purge_family(r.id);
      IF v_ns IS NOT NULL THEN
        v_gone := v_gone || v_ns;
      END IF;
    ELSE
      UPDATE public.families SET created_by = v_heir WHERE id = r.id;
    END IF;
  END LOOP;

  UPDATE public.document_categories SET created_by = NULL WHERE created_by = p_user_id;
  DELETE FROM public.invitations WHERE invited_by = p_user_id;
  DELETE FROM public.audit_logs WHERE user_id = p_user_id;
  -- Remaining memberships (none by now) and notifications cascade.
  DELETE FROM public.users WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'deleted_namespaces', to_jsonb(v_gone),
    'families_deleted', cardinality(v_gone),
    'families_left', v_left
  );
END;
$fn$;

-- ─── The files in one family's folder ───────────────────────────────────────
-- Every path in the documents bucket under the family's folder, at any depth.
-- delete-account removes them through the Storage API and asks again until
-- none are left (PostgREST returns at most a page of rows per call).
CREATE OR REPLACE FUNCTION public.family_storage_objects(p_storage_namespace text)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_storage_namespace IS NULL OR p_storage_namespace !~ '^family_[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'unexpected storage namespace %', p_storage_namespace;
  END IF;
  -- starts_with, not LIKE: the "_" in family_ is a LIKE wildcard.
  RETURN QUERY
    SELECT o.name::text
      FROM storage.objects o
     WHERE o.bucket_id = 'documents'
       AND starts_with(o.name, p_storage_namespace || '/')
     ORDER BY o.name;
END;
$fn$;

-- ─── Server only ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.account_deletion_plan(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_family(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_account_data(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.family_storage_objects(text)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_plan(uuid)  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_family(uuid)           TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_account_data(uuid)    TO service_role;
GRANT EXECUTE ON FUNCTION public.family_storage_objects(text) TO service_role;

COMMIT;
