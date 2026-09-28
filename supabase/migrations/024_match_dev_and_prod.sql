-- ============================================================================
-- 024: DEV and PROD, made the same — and the repo made to hold both
--
-- Migration 021 claimed the two databases matched. That was checked by
-- comparing function NAMES, not bodies, and not columns at all. Compared
-- properly (every public function body, column, policy, index, constraint,
-- trigger and table grant), they differed in three ways that matter:
--
-- 1. PROD cannot create a vault. `families.is_personal` and
--    `users.emergency_info` were added to DEV by hand and never written down.
--    create_family() inserts is_personal, so on PROD it fails with
--      column "is_personal" of relation "families" does not exist
--    — the first real user could sign up and then never get past setup.
--
-- 2. PROD's document list and viewer fail. get_family_documents and
--    get_document_detail say `WHERE id = p_family_id`, and `id` is also one of
--    the function's own output columns, so PL/pgSQL refuses with
--      column reference "id" is ambiguous
--    DEV had been fixed by hand (`f.id`); PROD never got it.
--
-- 3. Five functions existed only in the databases, never in a migration:
--    complete_document_ingestion, create_expiry_alert,
--    hybrid_search_documents, rls_auto_enable,
--    upgrade_family_schema_for_search. A database rebuilt from this repo
--    could not ingest a document or create a family.
--
-- Where the two disagreed, the newer version wins — DEV in every case but
-- one: rag_set_chunk_embedding, where PROD matches migration 013 and DEV had
-- lost its DEFAULT.
--
-- Two bugs present on BOTH are fixed rather than captured, because writing
-- down a function known to be broken is how 020 and 021 carried security
-- holes forward:
--
--   hybrid_search_documents   the same ambiguous `id`; it has never
--                             returned a row on either project.
--   search_family_documents   built its tsquery from raw text when no word
--                             survived filtering, so "my id", or any
--                             multi-word Hindi query, raised
--                               syntax error in tsquery
--
-- Neither is reachable by a person today — nothing in src/ calls
-- searchDocuments(), and rag-search's keyword fallback runs as the service
-- role, which the membership check refuses — but both are one line.
--
-- Deliberately NOT reconciled: pg_graphql (enabled on PROD only), its two
-- event triggers, and three storage.buckets triggers. Those belong to the
-- Supabase platform version, not to this app.
--
-- Everything here is idempotent. CREATE OR REPLACE keeps each function's
-- existing grants; the grant block at the end matters only for a database
-- built from scratch, where 023 ran before these functions existed.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================


-- ─── 1. The two columns PROD never got ──────────────────────────────────────
-- Both tables are empty on PROD and already carry the column on DEV, so the
-- DEFAULT fills nothing that exists and the IF NOT EXISTS makes DEV a no-op.

ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS emergency_info jsonb NOT NULL DEFAULT '{}'::jsonb;


-- ─── 2. Functions that existed only in the databases ────────────────────────

-- Adds the vector and full-text columns and their indexes to a family's
-- schema. create_family() calls it (020); complete_document_ingestion calls
-- it again as a self-heal for schemas created before 020.
CREATE OR REPLACE FUNCTION public.upgrade_family_schema_for_search(p_family_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
BEGIN
  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  -- 384 dims: multilingual-e5-small today, all-MiniLM-L6-v2 before it.
  EXECUTE format(
    'ALTER TABLE %I.document_chunks ADD COLUMN IF NOT EXISTS embedding vector(384)',
    v_schema
  );

  EXECUTE format(
    'ALTER TABLE %I.document_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector',
    v_schema
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_chunks_embedding ON %I.document_chunks USING hnsw (embedding vector_cosine_ops)',
    replace(left(p_family_id::text, 8), '-', ''), v_schema
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_chunks_search ON %I.document_chunks USING gin (search_vector)',
    replace(left(p_family_id::text, 8), '-', ''), v_schema
  );

  EXECUTE format(
    'ALTER TABLE %I.documents ADD COLUMN IF NOT EXISTS search_vector tsvector',
    v_schema
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_docs_search ON %I.documents USING gin (search_vector)',
    replace(left(p_family_id::text, 8), '-', ''), v_schema
  );
END;
$fn$;

-- Stores a document's text, chunks and metadata. Called by _shared/ingest.ts
-- with the service role. DEV's version: it self-heals the search columns,
-- which PROD's did not.
CREATE OR REPLACE FUNCTION public.complete_document_ingestion(
  p_family_id uuid,
  p_document_id uuid,
  p_ocr_text text,
  p_chunks jsonb,
  p_metadata jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_chunk JSONB;
  v_meta JSONB;
BEGIN
  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  -- Self-heal: ensure this schema has the search/embedding columns.
  -- (Personal "My Space" schemas were created without them.)
  PERFORM public.upgrade_family_schema_for_search(p_family_id);

  EXECUTE format(
    'UPDATE %I.documents SET
       ocr_text = $1,
       search_vector = to_tsvector(''english'', $1),
       ingestion_status = ''completed'',
       updated_at = now()
     WHERE id = $2',
    v_schema
  ) USING p_ocr_text, p_document_id;

  -- Insert chunks with embeddings (skip null/empty embeddings gracefully)
  FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks)
  LOOP
    IF v_chunk->>'embedding' IS NOT NULL AND v_chunk->>'embedding' != '' THEN
      EXECUTE format(
        'INSERT INTO %I.document_chunks (document_id, chunk_index, content, token_count, embedding, search_vector)
         VALUES ($1, $2, $3, $4, $5::vector(384), to_tsvector(''english'', $3))',
        v_schema
      ) USING
        p_document_id,
        (v_chunk->>'chunk_index')::int,
        v_chunk->>'content',
        (v_chunk->>'token_count')::int,
        v_chunk->>'embedding';
    ELSE
      EXECUTE format(
        'INSERT INTO %I.document_chunks (document_id, chunk_index, content, token_count, search_vector)
         VALUES ($1, $2, $3, $4, to_tsvector(''english'', $3))',
        v_schema
      ) USING
        p_document_id,
        (v_chunk->>'chunk_index')::int,
        v_chunk->>'content',
        (v_chunk->>'token_count')::int;
    END IF;
  END LOOP;

  FOR v_meta IN SELECT * FROM jsonb_array_elements(p_metadata)
  LOOP
    EXECUTE format(
      'INSERT INTO %I.document_metadata (document_id, key, value, auto_extracted, confidence)
       VALUES ($1, $2, $3, true, $4)',
      v_schema
    ) USING
      p_document_id,
      v_meta->>'key',
      v_meta->>'value',
      (v_meta->>'confidence')::float;
  END LOOP;
END;
$fn$;

-- One alert per document: updates it if present, else creates it with the
-- 90/30/7-day thresholds. Called by _shared/ingest.ts with the service role.
CREATE OR REPLACE FUNCTION public.create_expiry_alert(
  p_family_id uuid, p_document_id uuid, p_expiry_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_alert_id UUID;
BEGIN
  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  EXECUTE format(
    'SELECT id FROM %I.expiry_alerts WHERE document_id = $1 LIMIT 1',
    v_schema
  ) INTO v_alert_id USING p_document_id;

  IF v_alert_id IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I.expiry_alerts SET
         expiry_date = $1,
         is_expired = ($1 < CURRENT_DATE),
         auto_detected = true
       WHERE document_id = $2
       RETURNING id',
      v_schema
    ) INTO v_alert_id USING p_expiry_date, p_document_id;
  ELSE
    EXECUTE format(
      'INSERT INTO %I.expiry_alerts (document_id, expiry_date, alert_days_before, is_expired, auto_detected)
       VALUES ($1, $2, ''{90, 30, 7}'', ($2 < CURRENT_DATE), true)
       RETURNING id',
      v_schema
    ) INTO v_alert_id USING p_document_id, p_expiry_date;
  END IF;

  RETURN v_alert_id;
END;
$fn$;

-- Supabase's "enable RLS on new tables" helper, fired by the `ensure_rls`
-- event trigger. Both are created by the platform; the function is captured
-- here only so the repo lists every function in `public`.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $fn$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$fn$;

-- Vector + full-text document search. FIXED here: `WHERE id = p_family_id`
-- collided with the output column `id`, so it raised "column reference id is
-- ambiguous" on every call and has never returned a row. The lookups are now
-- qualified; nothing else changes.
CREATE OR REPLACE FUNCTION public.hybrid_search_documents(
  p_family_id uuid,
  p_query text,
  p_query_embedding vector DEFAULT NULL::vector,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(id uuid, file_name character varying, file_type character varying, file_size_bytes bigint, storage_path text, category_name character varying, member_name character varying, member_relationship character varying, created_at timestamp with time zone, relevance text, similarity double precision, rank double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_ts_query tsquery;
BEGIN
  SELECT f.storage_namespace INTO v_schema
  FROM public.families f
  WHERE f.id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.family_id = p_family_id AND fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_ts_query := plainto_tsquery('english', p_query);

  IF p_query_embedding IS NOT NULL THEN
    RETURN QUERY EXECUTE format(
      'WITH vector_results AS (
         SELECT DISTINCT ON (dc.document_id)
           dc.document_id,
           1 - (dc.embedding <=> $1) AS vec_score
         FROM %I.document_chunks dc
         WHERE dc.embedding IS NOT NULL
         ORDER BY dc.document_id, dc.embedding <=> $1
         LIMIT $2 * 2
       ),
       text_results AS (
         SELECT d.id AS document_id,
           ts_rank(d.search_vector, $3) AS text_score
         FROM %I.documents d
         WHERE d.search_vector @@ $3 AND d.is_deleted = false
         LIMIT $2 * 2
       ),
       combined AS (
         SELECT
           COALESCE(v.document_id, t.document_id) AS document_id,
           COALESCE(v.vec_score, 0) AS vec_score,
           COALESCE(t.text_score, 0) AS text_score,
           COALESCE(v.vec_score, 0) * 0.7 + COALESCE(t.text_score, 0) * 0.3 AS combined_score,
           CASE
             WHEN v.vec_score IS NOT NULL AND t.text_score IS NOT NULL THEN ''both''
             WHEN v.vec_score IS NOT NULL THEN ''semantic''
             ELSE ''keyword''
           END AS match_type
         FROM vector_results v
         FULL OUTER JOIN text_results t ON v.document_id = t.document_id
       )
       SELECT
         d.id, d.file_name, d.file_type, d.file_size_bytes, d.storage_path,
         cat.name AS category_name,
         fm_user.display_name AS member_name,
         fm.relationship AS member_relationship,
         d.created_at,
         c.match_type AS relevance,
         c.vec_score AS similarity,
         c.combined_score AS rank
       FROM combined c
       JOIN %I.documents d ON d.id = c.document_id
       LEFT JOIN public.document_categories cat ON d.category_id = cat.id
       LEFT JOIN public.family_members fm ON d.belongs_to_member = fm.id
       LEFT JOIN public.users fm_user ON fm.user_id = fm_user.id
       WHERE d.is_deleted = false
       ORDER BY c.combined_score DESC
       LIMIT $2',
      v_schema, v_schema, v_schema
    ) USING p_query_embedding, p_limit, v_ts_query;
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT
         d.id, d.file_name, d.file_type, d.file_size_bytes, d.storage_path,
         cat.name AS category_name,
         fm_user.display_name AS member_name,
         fm.relationship AS member_relationship,
         d.created_at,
         CASE
           WHEN d.file_name ILIKE ''%%'' || $1 || ''%%'' THEN ''filename''
           ELSE ''content''
         END AS relevance,
         0::float AS similarity,
         CASE
           WHEN d.file_name ILIKE ''%%'' || $1 || ''%%'' THEN 1.0
           ELSE ts_rank(d.search_vector, $2)::float
         END AS rank
       FROM %I.documents d
       LEFT JOIN public.document_categories cat ON d.category_id = cat.id
       LEFT JOIN public.family_members fm ON d.belongs_to_member = fm.id
       LEFT JOIN public.users fm_user ON fm.user_id = fm_user.id
       WHERE d.is_deleted = false
         AND (d.file_name ILIKE ''%%'' || $1 || ''%%'' OR d.search_vector @@ $2)
       ORDER BY rank DESC
       LIMIT $3',
      v_schema
    ) USING p_query, v_ts_query, p_limit;
  END IF;
END;
$fn$;


-- ─── 3. Functions whose bodies differed ─────────────────────────────────────

-- DEV's version: qualified lookups. PROD's bare `WHERE id = p_family_id`
-- collides with the output column `id` and fails on every call.
CREATE OR REPLACE FUNCTION public.get_family_documents(
  p_family_id uuid, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, uploaded_by uuid, file_name character varying, file_type character varying, file_size_bytes bigint, storage_path text, category_id uuid, category_name character varying, belongs_to_member uuid, member_name text, member_relationship text, ingestion_status character varying, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.family_id = p_family_id AND fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT f.storage_namespace INTO v_schema
  FROM public.families f WHERE f.id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.uploaded_by, d.file_name, d.file_type, d.file_size_bytes,
            d.storage_path, d.category_id,
            c.name::VARCHAR AS category_name,
            d.belongs_to_member,
            COALESCE(fm.alias, u.display_name)::TEXT AS member_name,
            fm.relationship::TEXT AS member_relationship,
            d.ingestion_status,
            d.created_at, d.updated_at
     FROM %I.documents d
     LEFT JOIN public.document_categories c ON c.id = d.category_id
     LEFT JOIN public.family_members fm ON fm.id = d.belongs_to_member
     LEFT JOIN public.users u ON u.id = fm.user_id
     WHERE d.is_deleted = false
     ORDER BY d.created_at DESC
     LIMIT $1 OFFSET $2', v_schema
  ) USING p_limit, p_offset;
END;
$fn$;

-- Same fix, same reason.
CREATE OR REPLACE FUNCTION public.get_document_detail(p_family_id uuid, p_document_id uuid)
RETURNS TABLE(id uuid, uploaded_by uuid, uploader_name text, file_name character varying, file_type character varying, file_size_bytes bigint, storage_path text, category_id uuid, category_name character varying, belongs_to_member uuid, member_name text, member_relationship text, ingestion_status character varying, created_at timestamp with time zone, updated_at timestamp with time zone, metadata jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.family_id = p_family_id AND fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT f.storage_namespace INTO v_schema
  FROM public.families f WHERE f.id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.uploaded_by,
            u_uploader.display_name::TEXT AS uploader_name,
            d.file_name, d.file_type, d.file_size_bytes,
            d.storage_path, d.category_id,
            c.name::VARCHAR AS category_name,
            d.belongs_to_member,
            COALESCE(fm.alias, u_member.display_name)::TEXT AS member_name,
            fm.relationship::TEXT AS member_relationship,
            d.ingestion_status,
            d.created_at, d.updated_at,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object(
                ''key'', m.key, ''value'', m.value,
                ''auto_extracted'', m.auto_extracted, ''confidence'', m.confidence
              ))
              FROM %I.document_metadata m WHERE m.document_id = d.id),
              ''[]''::jsonb
            ) AS metadata
     FROM %I.documents d
     LEFT JOIN public.document_categories c ON c.id = d.category_id
     LEFT JOIN public.family_members fm ON fm.id = d.belongs_to_member
     LEFT JOIN public.users u_member ON u_member.id = fm.user_id
     LEFT JOIN public.users u_uploader ON u_uploader.id = d.uploaded_by
     WHERE d.id = $1 AND d.is_deleted = false', v_schema, v_schema
  ) USING p_document_id;
END;
$fn$;

-- Qualified on DEV; PROD's worked (no output column is named id here) but
-- the two are made identical.
CREATE OR REPLACE FUNCTION public.get_family_stats(p_family_id uuid)
RETURNS TABLE(doc_count bigint, member_count bigint, category_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.family_id = p_family_id AND fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT f.storage_namespace INTO v_schema
  FROM public.families f WHERE f.id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT
       (SELECT count(*) FROM %I.documents WHERE is_deleted = false) AS doc_count,
       (SELECT count(*) FROM public.family_members WHERE family_id = $1) AS member_count,
       (SELECT count(DISTINCT category_id) FROM %I.documents WHERE is_deleted = false AND category_id IS NOT NULL) AS category_count',
    v_schema, v_schema
  ) USING p_family_id;
END;
$fn$;

-- DEV's version. PROD's had no search_path (an owner-rights function
-- resolving names through the caller's path) and no ON CONFLICT, so if a
-- public.users row already existed for the id, the insert — and with it the
-- whole signup — failed.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
begin
  insert into public.users (id, email, display_name, avatar_url, auth_provider)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    coalesce(new.raw_app_meta_data->>'provider', 'email')
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

-- DEV's version (adds full-text matching), with its tsquery made safe.
-- DEV fell back to the RAW query text when no word survived filtering, and
-- to_tsquery rejects raw text: "my id" (every word too short) and any
-- multi-word Hindi query (every character stripped) raised
--   syntax error in tsquery
-- Now the words are split on any whitespace, and when none survive the
-- tsquery is NULL, so the full-text arm simply matches nothing and the
-- ILIKE arms still run.
CREATE OR REPLACE FUNCTION public.search_family_documents(
  p_family_id uuid, p_query text, p_limit integer DEFAULT 20
)
RETURNS TABLE(id uuid, file_name character varying, file_type character varying, category_id uuid, category_name character varying, belongs_to_member uuid, member_name text, member_relationship text, created_at timestamp with time zone, relevance text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_pattern TEXT;
  v_words TEXT;
  v_tsquery tsquery;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.family_id = p_family_id AND fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT f.storage_namespace INTO v_schema
  FROM public.families f WHERE f.id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  v_pattern := '%' || p_query || '%';

  -- Words of 3+ letters joined with | (OR) for broader matching.
  v_words := array_to_string(
    array(
      SELECT w FROM regexp_split_to_table(
        regexp_replace(lower(p_query), '[^a-z0-9\s]', '', 'g'), '\s+'
      ) AS w
      WHERE length(w) > 2
    ),
    ' | '
  );

  IF v_words <> '' THEN
    v_tsquery := to_tsquery('english', v_words);
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.file_name, d.file_type, d.category_id,
            c.name::VARCHAR AS category_name,
            d.belongs_to_member,
            COALESCE(fm.alias, u.display_name)::TEXT AS member_name,
            fm.relationship::TEXT AS member_relationship,
            d.created_at,
            CASE
              WHEN d.file_name ILIKE $1 THEN ''filename''
              WHEN d.search_vector IS NOT NULL
                   AND d.search_vector @@ $3 THEN ''content''
              WHEN d.ocr_text ILIKE $1 THEN ''content''
              ELSE ''partial''
            END AS relevance
     FROM %I.documents d
     LEFT JOIN public.document_categories c ON c.id = d.category_id
     LEFT JOIN public.family_members fm ON fm.id = d.belongs_to_member
     LEFT JOIN public.users u ON u.id = fm.user_id
     WHERE d.is_deleted = false
       AND (
         d.file_name ILIKE $1
         OR d.ocr_text ILIKE $1
         OR (d.search_vector IS NOT NULL AND d.search_vector @@ $3)
       )
     ORDER BY
       CASE WHEN d.file_name ILIKE $1 THEN 0
            WHEN d.search_vector IS NOT NULL
                 AND d.search_vector @@ $3 THEN 1
            ELSE 2
       END,
       d.created_at DESC
     LIMIT $2', v_schema
  ) USING v_pattern, p_limit, v_tsquery;
END;
$fn$;

-- PROD matches migration 013 here; DEV had lost the DEFAULT. Adding a
-- default is allowed by CREATE OR REPLACE (removing one is not).
CREATE OR REPLACE FUNCTION public.rag_set_chunk_embedding(
  p_schema    text,
  p_chunk_id  uuid,
  p_embedding vector DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  EXECUTE format(
    'UPDATE %I.document_chunks SET embedding = $2 WHERE id = $1',
    p_schema
  ) USING p_chunk_id, p_embedding;
END;
$fn$;

-- The last three differed only in comments and line endings (CRLF on DEV,
-- from the original paste). Restated from 021 and 023 so every body is
-- byte-identical and the check below needs no exceptions.

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


-- ─── 4. Grants, for a database built from scratch ───────────────────────────
-- On DEV and PROD these change nothing: CREATE OR REPLACE kept the grants 023
-- set. On a fresh build, 023 ran before the captured functions existed, so
-- they would still carry the default EXECUTE-to-PUBLIC.

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('complete_document_ingestion', 'create_expiry_alert',
                        'upgrade_family_schema_for_search', 'rls_auto_enable')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;


-- Verify: run on BOTH projects; the two results must be identical row for
-- row. Line endings are normalised because DEV's untouched bodies still carry
-- the CRLFs of their original paste.
--
--   SELECT p.oid::regprocedure::text AS sig,
--          md5(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')) AS body,
--          coalesce(array_to_string(p.proacl, ' '), 'NULL') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
--                     WHERE d.objid = p.oid AND d.deptype = 'e')
--   ORDER BY 1;
