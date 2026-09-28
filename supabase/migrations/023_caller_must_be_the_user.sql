-- ============================================================================
-- 023: A user id passed by the caller is not an identity
--
-- Thirteen SECURITY DEFINER functions were executable with the PUBLIC anon key
-- — the one inside every web bundle — and none of them checked who was
-- calling. They run with the owner's rights, so row-level security never
-- applies. Seven of them take a user id as an ARGUMENT and trust it:
--
--   create_family          insert_family_document (p_uploaded_by)
--   delete_family_document update_family_document
--   get_user_notifications mark_notification_read
--   accept_pending_invitations
--
-- Demonstrated on DEV, as `anon` with NO login, knowing only a family id, a
-- document id and a member id (all of which every current and former member
-- has):
--
--   select update_family_document(<family>, <document>, <member>,
--                                 'RENAMED BY A STRANGER.pdf', null, null);
--
-- renamed another family's document. The same shape lets anyone delete a
-- family's documents, add documents to any vault attributed to any member,
-- and read anyone's notifications (which carry document names and expiry
-- dates). It also let a view-only member delete by passing an admin's id.
--
-- The rest are called only by the server, yet were open to everyone:
-- complete_document_ingestion would let a stranger rewrite a document's text
-- or plant passages that search then quotes as fact.
--
-- Migration 022 missed all of these because it only swept functions whose
-- first argument is p_schema. The general rule, now in CLAUDE.md: a
-- SECURITY DEFINER function reachable by a client must derive identity from
-- auth.uid(), never from an argument.
--
-- ── What this does ──────────────────────────────────────────────────────────
--
-- 1. Server-only functions: revoked from PUBLIC, anon and authenticated.
--    Edge Functions use the service-role key and keep working. Trigger and
--    event-trigger functions cannot be called directly anyway; revoked for
--    hygiene.
--
-- 2. App-called functions: the body is unchanged except for ONE new first
--    line, which refuses the call unless the passed user id IS the signed-in
--    user (or, for check_expiry_notifications, the caller is a member of the
--    family). Every call site in src/ already passes the signed-in user's own
--    `user.id`, so no app change is needed and no legitimate flow breaks.
--    One exception: get_user_notifications also gains a `::text` cast that
--    fixes a result-type error it has raised on every call (see its body).
--
--    The service role is let through on purpose. That is how an Edge Function
--    — the Gmail importer, for one — acts on behalf of a user it has already
--    verified.
--
--    anon loses EXECUTE on all of them: nothing in the app calls an RPC
--    before sign-in.
--
-- The seven restated bodies are identical on DEV and PROD, so one file serves
-- both. (Six OTHER functions differ between the two; that is a separate
-- reconciliation, and none of them is touched here.)
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================


-- ─── The two checks ─────────────────────────────────────────────────────────

-- Refuses unless p_user_id is the signed-in user. SECURITY INVOKER: it only
-- reads the request's JWT claims, so it needs no rights of its own.
CREATE OR REPLACE FUNCTION public.assert_caller_is(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
BEGIN
  -- An Edge Function acting for a user it has already verified.
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed: that user id is not the signed-in user'
      USING ERRCODE = '42501';
  END IF;
END;
$fn$;

-- Refuses unless the signed-in user belongs to the family.
CREATE OR REPLACE FUNCTION public.assert_caller_in_family(p_family_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER   -- must read family_members past its own RLS
SET search_path TO 'public'
AS $fn$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not allowed: you are not a member of this family'
      USING ERRCODE = '42501';
  END IF;
END;
$fn$;


-- ─── App-called functions: same bodies, one new first line ─────────────────

CREATE OR REPLACE FUNCTION public.create_family(
  p_user_id       uuid,
  p_family_name   character varying,
  p_description   text              DEFAULT NULL::text,
  p_family_icon   character varying DEFAULT NULL::character varying,
  p_is_personal   boolean           DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_family_id  uuid;
  v_short_id   text;
  v_storage_ns text;
  v_vector_ns  text;
begin
  perform public.assert_caller_is(p_user_id);

  v_family_id  := gen_random_uuid();
  v_short_id   := replace(left(v_family_id::text, 8), '-', '');
  v_storage_ns := 'family_' || v_short_id;
  v_vector_ns  := 'fv_' || v_short_id;

  insert into public.families (id, name, description, created_by, family_icon, storage_namespace, vector_namespace, is_personal)
  values (v_family_id, p_family_name, p_description, p_user_id, p_family_icon, v_storage_ns, v_vector_ns, p_is_personal);

  execute format('create schema %I', v_storage_ns);

  execute format('create table %I.documents (
    id uuid primary key default gen_random_uuid(),
    uploaded_by uuid not null,
    file_name varchar(255) not null,
    file_type varchar(20) not null,
    file_size_bytes bigint,
    storage_path text not null,
    category_id uuid,
    belongs_to_member uuid,
    ocr_text text,
    ingestion_status varchar(20) default ''pending'',
    is_deleted boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )', v_storage_ns);

  execute format('create table %I.document_metadata (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references %I.documents(id) on delete cascade,
    key varchar(100) not null,
    value text not null,
    auto_extracted boolean default false,
    confidence float
  )', v_storage_ns, v_storage_ns);

  execute format('create table %I.document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references %I.documents(id) on delete cascade,
    chunk_index integer not null,
    content text not null,
    token_count integer,
    embedding_id varchar(100),
    created_at timestamptz default now()
  )', v_storage_ns, v_storage_ns);

  execute format('create table %I.expiry_alerts (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references %I.documents(id) on delete cascade,
    expiry_date date not null,
    alert_days_before integer[] default ''{90, 30, 7}'',
    last_notified_at timestamptz,
    is_expired boolean default false,
    auto_detected boolean default false
  )', v_storage_ns, v_storage_ns);

  execute format('create table %I.family_relationships (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null,
    related_to uuid not null,
    relationship_type varchar(50) not null,
    aliases text[]
  )', v_storage_ns);

  execute format('create index idx_%s_docs_category on %I.documents(category_id)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_docs_member on %I.documents(belongs_to_member)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_docs_status on %I.documents(ingestion_status)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_chunks_doc on %I.document_chunks(document_id)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_metadata_doc on %I.document_metadata(document_id)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_metadata_key on %I.document_metadata(key)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_expiry_date on %I.expiry_alerts(expiry_date)', v_short_id, v_storage_ns);

  perform public.upgrade_family_schema_for_search(v_family_id);

  insert into public.family_members (family_id, user_id, role, can_upload, can_delete)
  values (v_family_id, p_user_id, 'admin', true, true);

  insert into public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  values (p_user_id, v_family_id, 'create_family', 'family', v_family_id);

  return v_family_id;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.insert_family_document(
  p_family_id uuid,
  p_uploaded_by uuid,
  p_file_name character varying,
  p_file_type character varying,
  p_file_size_bytes bigint,
  p_storage_path text,
  p_category_id uuid DEFAULT NULL::uuid,
  p_belongs_to_member uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_doc_id UUID;
BEGIN
  PERFORM public.assert_caller_is(p_uploaded_by);

  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found: %', p_family_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id
      AND user_id = p_uploaded_by
      AND can_upload = true
  ) THEN
    RAISE EXCEPTION 'User does not have upload permission';
  END IF;

  v_doc_id := gen_random_uuid();

  EXECUTE format(
    'INSERT INTO %I.documents (id, uploaded_by, file_name, file_type, file_size_bytes, storage_path, category_id, belongs_to_member, ingestion_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ''pending'')',
    v_schema
  ) USING v_doc_id, p_uploaded_by, p_file_name, p_file_type, p_file_size_bytes, p_storage_path, p_category_id, p_belongs_to_member;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_uploaded_by, p_family_id, 'upload_document', 'document', v_doc_id);

  RETURN v_doc_id;
END;
$fn$;

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
  PERFORM public.assert_caller_is(p_user_id);

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
  PERFORM public.assert_caller_is(p_user_id);

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

CREATE OR REPLACE FUNCTION public.get_user_notifications(
  p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, family_id uuid, type character varying, title text, message text, document_ref uuid, is_read boolean, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.assert_caller_is(p_user_id);

  -- title::text: the column is varchar and the declared result is text, and
  -- RETURN QUERY demands an exact match. Without the cast this raised
  -- "structure of query does not match function result type" on EVERY call,
  -- rows or none, on DEV and PROD alike, so the notifications screen has
  -- never loaded. The only change to this body besides the guard.
  RETURN QUERY
  SELECT n.id, n.family_id, n.type, n.title::text, n.message,
         n.document_ref, n.is_read, n.created_at
  FROM public.notifications n
  WHERE n.user_id = p_user_id
  ORDER BY n.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_notification_id uuid, p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.assert_caller_is(p_user_id);

  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_notification_id AND user_id = p_user_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_expiry_notifications(p_family_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_count INTEGER := 0;
  v_alert RECORD;
  v_doc_name TEXT;
  v_days_until INTEGER;
  v_member RECORD;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);

  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_alert IN EXECUTE format(
    'SELECT a.id, a.document_id, a.expiry_date, a.last_notified_at,
            d.file_name, d.belongs_to_member
     FROM %I.expiry_alerts a
     JOIN %I.documents d ON d.id = a.document_id
     WHERE a.is_expired = false
       AND d.is_deleted = false
       AND (a.expiry_date - CURRENT_DATE) <= 90',
    v_schema, v_schema
  )
  LOOP
    v_days_until := v_alert.expiry_date - CURRENT_DATE;
    v_doc_name := v_alert.file_name;

    IF v_alert.last_notified_at IS NOT NULL
       AND v_alert.last_notified_at::date = CURRENT_DATE THEN
      CONTINUE;
    END IF;

    FOR v_member IN
      SELECT fm.user_id FROM public.family_members fm WHERE fm.family_id = p_family_id
    LOOP
      INSERT INTO public.notifications (user_id, family_id, type, title, message, document_ref)
      VALUES (
        v_member.user_id,
        p_family_id,
        'expiry',
        CASE
          WHEN v_days_until <= 0 THEN v_doc_name || ' has expired'
          WHEN v_days_until <= 7 THEN v_doc_name || ' expires in ' || v_days_until || ' days'
          WHEN v_days_until <= 30 THEN v_doc_name || ' expires in ' || v_days_until || ' days'
          ELSE v_doc_name || ' expires in ' || v_days_until || ' days'
        END,
        CASE
          WHEN v_days_until <= 0 THEN 'This document expired on ' || v_alert.expiry_date || '. Please renew it.'
          WHEN v_days_until <= 7 THEN 'Urgent: This document expires on ' || v_alert.expiry_date || '.'
          WHEN v_days_until <= 30 THEN 'This document expires on ' || v_alert.expiry_date || '. Plan for renewal.'
          ELSE 'This document expires on ' || v_alert.expiry_date || '.'
        END,
        v_alert.document_id
      )
      ON CONFLICT DO NOTHING;

      v_count := v_count + 1;
    END LOOP;

    EXECUTE format(
      'UPDATE %I.expiry_alerts SET
         last_notified_at = now(),
         is_expired = ($1 < CURRENT_DATE)
       WHERE id = $2',
      v_schema
    ) USING v_alert.expiry_date, v_alert.id;
  END LOOP;

  RETURN v_count;
END;
$fn$;


-- ─── Grants ─────────────────────────────────────────────────────────────────
-- REVOKE ... FROM PUBLIC alone is not enough: Supabase grants anon and
-- authenticated EXPLICITLY (the lesson of 022), so each is named.

DO $$
DECLARE
  fn RECORD;
BEGIN
  -- Server-only: no client role may call these at all.
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('complete_document_ingestion', 'create_expiry_alert',
                        'upgrade_family_schema_for_search', 'accept_pending_invitations',
                        'handle_new_user', 'rls_auto_enable')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;

  -- App-called: signed-in users only, and the new first line does the rest.
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('create_family', 'insert_family_document', 'delete_family_document',
                        'update_family_document', 'get_user_notifications',
                        'mark_notification_read', 'check_expiry_notifications',
                        'assert_caller_is', 'assert_caller_in_family')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
  END LOOP;
END $$;

-- Verify: this must return zero rows. Any row is an owner-rights function a
-- client can call that never asks who the caller is.
--
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND pg_get_function_result(p.oid) NOT IN ('trigger', 'event_trigger')
--     AND (p.proacl IS NULL OR array_to_string(p.proacl, ' ') ~ '(^|[ =])(anon|authenticated)=')
--     AND p.prosrc !~ 'auth\.uid\(\)|assert_caller_'
--     AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
--                     WHERE d.objid = p.oid AND d.deptype = 'e');
