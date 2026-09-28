-- ============================================================================
-- 021: The six functions and three policies that existed only in DEV
--
-- Closing part of the migration gap. These were authored while
-- `.gitignore` still contained `supabase/migrations/*.sql`, so they were
-- never committed — they exist in the DEV database and nowhere else, which
-- is why PROD, restored from the repo, cannot run the app.
--
-- The three policies matter more than they look:
--
--   users_insert_via_trigger    without it a new signup may never get its
--                               public.users row — signup itself breaks
--   users_select_family         without it family members cannot see each
--                               other, so the family screen is empty
--   family_members_delete_self  without it nobody can leave a family
--
-- shares_family() is created FIRST because users_select_family calls it.
--
-- Grants are left at the PostgreSQL default (EXECUTE to PUBLIC), which is
-- what DEV has, EXCEPT for get_document_chunks — see 022, which locks down
-- every function that takes a schema name.
--
-- Apply: paste into the SQL editor — DEV first (no-op there), then PROD.
-- ============================================================================

-- ─── shares_family: do these two users share any family? ────────────────────
-- SECURITY DEFINER so the policy that uses it does not re-enter
-- family_members' own RLS, which is the recursion migration 007 had to fix.
CREATE OR REPLACE FUNCTION public.shares_family(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  select exists (
    select 1 from public.family_members a
    join public.family_members b on a.family_id = b.family_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$fn$;

-- ─── accept_pending_invitations ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_pending_invitations(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_email text;
  v_count integer := 0;
  r record;
begin
  select email into v_email from public.users where id = p_user_id;
  if v_email is null then return 0; end if;

  for r in
    select * from public.invitations
    where lower(invitee_email) = lower(v_email)
      and status = 'pending'
      and expires_at > now()
  loop
    insert into public.family_members (family_id, user_id, role, can_upload, can_delete)
    values (r.family_id, p_user_id, coalesce(r.role, 'viewer'), true, (r.role = 'admin'))
    on conflict (family_id, user_id) do nothing;

    update public.invitations set status = 'accepted' where id = r.id;
    update public.families set is_personal = false where id = r.family_id;  -- vault becomes shared
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

-- ─── delete_family_document ─────────────────────────────────────────────────
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
  v_storage_path TEXT;
  v_uploaded_by UUID;
  v_can_delete BOOLEAN;
BEGIN
  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found: %', p_family_id;
  END IF;

  SELECT can_delete INTO v_can_delete
  FROM public.family_members
  WHERE family_id = p_family_id
    AND user_id = p_user_id;

  IF v_can_delete IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this family';
  END IF;

  EXECUTE format(
    'SELECT uploaded_by, storage_path FROM %I.documents WHERE id = $1',
    v_schema
  ) INTO v_uploaded_by, v_storage_path USING p_document_id;

  IF v_uploaded_by IS NULL THEN
    RAISE EXCEPTION 'Document not found: %', p_document_id;
  END IF;

  IF NOT v_can_delete AND v_uploaded_by != p_user_id THEN
    RAISE EXCEPTION 'User does not have permission to delete this document';
  END IF;

  EXECUTE format(
    'DELETE FROM %I.documents WHERE id = $1',
    v_schema
  ) USING p_document_id;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_user_id, p_family_id, 'delete_document', 'document', p_document_id);
END;
$fn$;

-- ─── update_family_document ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_family_document(
  p_family_id uuid,
  p_document_id uuid,
  p_user_id uuid,
  p_file_name character varying DEFAULT NULL::character varying,
  p_category_id uuid DEFAULT NULL::uuid,
  p_belongs_to_member uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_role TEXT;
  v_set_clauses TEXT[] := '{}';
BEGIN
  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found: %', p_family_id;
  END IF;

  SELECT role INTO v_role
  FROM public.family_members
  WHERE family_id = p_family_id
    AND user_id = p_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this family';
  END IF;

  IF v_role NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'User does not have permission to edit documents';
  END IF;

  IF p_file_name IS NOT NULL THEN
    v_set_clauses := array_append(v_set_clauses, format('file_name = %L', p_file_name));
  END IF;
  IF p_category_id IS NOT NULL THEN
    v_set_clauses := array_append(v_set_clauses, format('category_id = %L', p_category_id));
  END IF;
  IF p_belongs_to_member IS NOT NULL THEN
    v_set_clauses := array_append(v_set_clauses, format('belongs_to_member = %L', p_belongs_to_member));
  END IF;

  v_set_clauses := array_append(v_set_clauses, 'updated_at = now()');

  EXECUTE format(
    'UPDATE %I.documents SET %s WHERE id = %L',
    v_schema,
    array_to_string(v_set_clauses, ', '),
    p_document_id
  );

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_user_id, p_family_id, 'update_document', 'document', p_document_id);
END;
$fn$;

-- ─── set_document_description ───────────────────────────────────────────────
-- Adds the `description` column on demand, because create_family() has never
-- created it. Left as it is: this migration captures what exists, and moving
-- that DDL into create_family() is a separate change.
CREATE OR REPLACE FUNCTION public.set_document_description(
  p_family_id uuid, p_document_id uuid, p_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ns TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this family';
  END IF;

  SELECT storage_namespace INTO v_ns
  FROM public.families WHERE id = p_family_id;

  IF v_ns IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  EXECUTE format(
    'ALTER TABLE %I.documents ADD COLUMN IF NOT EXISTS description TEXT',
    v_ns
  );

  EXECUTE format(
    'UPDATE %I.documents SET description = $1, updated_at = now() WHERE id = $2',
    v_ns
  ) USING p_description, p_document_id;
END;
$fn$;

-- ─── get_document_chunks ────────────────────────────────────────────────────
-- Takes a schema name and performs NO membership check, so it is locked to
-- service_role here rather than inheriting the default PUBLIC grant. Only
-- rag-search calls it, with the service key. See 022.
CREATE OR REPLACE FUNCTION public.get_document_chunks(
  p_schema text, p_document_id uuid, p_limit integer DEFAULT 5
)
RETURNS TABLE(content text, chunk_index integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT c.content, c.chunk_index
     FROM %I.document_chunks c
     WHERE c.document_id = $1
     ORDER BY c.chunk_index
     LIMIT $2',
    p_schema
  ) USING p_document_id, p_limit;
END;
$fn$;

-- ─── The three missing policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS users_insert_via_trigger   ON public.users;
DROP POLICY IF EXISTS users_select_family        ON public.users;
DROP POLICY IF EXISTS family_members_delete_self ON public.family_members;

-- handle_new_user() inserts the row for a brand-new signup, before that user
-- can be matched by any ownership rule.
CREATE POLICY users_insert_via_trigger ON public.users
  FOR INSERT WITH CHECK (true);

-- Family members can see each other. Anyone else cannot.
CREATE POLICY users_select_family ON public.users
  FOR SELECT USING (public.shares_family(id));

-- Leaving a family is your own decision; removing someone else is the
-- admin policy's job.
CREATE POLICY family_members_delete_self ON public.family_members
  FOR DELETE USING (user_id = auth.uid());
