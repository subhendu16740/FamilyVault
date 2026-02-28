-- =============================================
-- FamilyVault: Create Family — DB Function
-- Run this AFTER 003_auth_trigger_and_seed.sql
--
-- This function handles the full family creation:
--   1. Generates storage & vector namespace names
--   2. Inserts into public.families
--   3. Creates the isolated per-family schema + tables + indexes
--   4. Adds the creator as admin member
--   5. Logs the action in audit_logs
-- =============================================

CREATE OR REPLACE FUNCTION public.create_family(
  p_user_id UUID,
  p_family_name VARCHAR(100),
  p_description TEXT DEFAULT NULL,
  p_family_icon VARCHAR(50) DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- runs with elevated privileges to create schemas
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_short_id TEXT;
  v_storage_ns TEXT;
  v_vector_ns TEXT;
BEGIN
  -- Generate a short unique ID for namespace names
  v_family_id := gen_random_uuid();
  v_short_id := replace(left(v_family_id::text, 8), '-', '');
  v_storage_ns := 'family_' || v_short_id;
  v_vector_ns := 'fv_' || v_short_id;

  -- 1. Insert family record
  INSERT INTO public.families (id, name, description, created_by, family_icon, storage_namespace, vector_namespace)
  VALUES (v_family_id, p_family_name, p_description, p_user_id, p_family_icon, v_storage_ns, v_vector_ns);

  -- 2. Create isolated schema
  EXECUTE format('CREATE SCHEMA %I', v_storage_ns);

  -- 3. Create documents table
  EXECUTE format('
    CREATE TABLE %I.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uploaded_by UUID NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(20) NOT NULL,
      file_size_bytes BIGINT,
      storage_path TEXT NOT NULL,
      category_id UUID,
      belongs_to_member UUID,
      ocr_text TEXT,
      ingestion_status VARCHAR(20) DEFAULT ''pending'',
      is_deleted BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )', v_storage_ns);

  -- 4. Create document_metadata table
  EXECUTE format('
    CREATE TABLE %I.document_metadata (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES %I.documents(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL,
      value TEXT NOT NULL,
      auto_extracted BOOLEAN DEFAULT false,
      confidence FLOAT
    )', v_storage_ns, v_storage_ns);

  -- 5. Create document_chunks table
  EXECUTE format('
    CREATE TABLE %I.document_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES %I.documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      embedding_id VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT now()
    )', v_storage_ns, v_storage_ns);

  -- 6. Create expiry_alerts table
  EXECUTE format('
    CREATE TABLE %I.expiry_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES %I.documents(id) ON DELETE CASCADE,
      expiry_date DATE NOT NULL,
      alert_days_before INTEGER[] DEFAULT ''{90, 30, 7}'',
      last_notified_at TIMESTAMPTZ,
      is_expired BOOLEAN DEFAULT false,
      auto_detected BOOLEAN DEFAULT false
    )', v_storage_ns, v_storage_ns);

  -- 7. Create family_relationships table
  EXECUTE format('
    CREATE TABLE %I.family_relationships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id UUID NOT NULL,
      related_to UUID NOT NULL,
      relationship_type VARCHAR(50) NOT NULL,
      aliases TEXT[]
    )', v_storage_ns);

  -- 8. Create indexes
  EXECUTE format('CREATE INDEX idx_%s_docs_category ON %I.documents(category_id)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_docs_member ON %I.documents(belongs_to_member)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_docs_status ON %I.documents(ingestion_status)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_chunks_doc ON %I.document_chunks(document_id)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_metadata_doc ON %I.document_metadata(document_id)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_metadata_key ON %I.document_metadata(key)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_expiry_date ON %I.expiry_alerts(expiry_date)', v_short_id, v_storage_ns);

  -- 9. Add creator as admin member
  INSERT INTO public.family_members (family_id, user_id, role, can_upload, can_delete)
  VALUES (v_family_id, p_user_id, 'admin', true, true);

  -- 10. Log the action
  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_user_id, v_family_id, 'create_family', 'family', v_family_id);

  RETURN v_family_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.create_family TO authenticated;
