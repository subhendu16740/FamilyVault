-- ============================================================================
-- 020: A new family is born searchable
--
-- create_family() builds the per-family schema, and it did NOT create the
-- three things search needs: `embedding vector(384)`, `search_vector`, and the
-- HNSW index. Every existing family has them only because
-- upgrade_family_schema_for_search() was run BY HAND over each one — and
-- nothing in the app or the database ever calls that function.
--
-- So the next family to sign up would get a vault whose search is broken from
-- the moment it is created, with no error raised and nobody told. On PROD that
-- is the first real user.
--
-- The fix is one line: create_family() now calls the upgrade function it
-- should always have called. Reusing it rather than copying its DDL keeps one
-- definition of what "ready for search" means, so the next change to the
-- shape has one place to happen.
--
-- The whole body is restated because CREATE OR REPLACE takes the whole body,
-- and because this function is one of the ones that drifted: DEV and PROD were
-- carrying different versions (3,703 vs 4,035 characters). This makes them the
-- same, and puts the real definition in the repo for the first time.
--
-- `embedding_id varchar(100)` is left alone. It is vestigial — the real vector
-- is the `embedding` column added below — but removing a column is not this
-- migration's job.
--
-- Requires: upgrade_family_schema_for_search() and the `vector` extension,
-- both already present on DEV and PROD.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

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

  -- The line this migration exists for. Adds embedding vector(384),
  -- search_vector, the HNSW index and the GIN indexes — everything retrieval
  -- needs — so the family is searchable the moment it exists.
  perform public.upgrade_family_schema_for_search(v_family_id);

  insert into public.family_members (family_id, user_id, role, can_upload, can_delete)
  values (v_family_id, p_user_id, 'admin', true, true);

  insert into public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  values (p_user_id, v_family_id, 'create_family', 'family', v_family_id);

  return v_family_id;
end;
$fn$;
