-- =============================================
-- FamilyVault: Document Query RPCs
-- Run this AFTER 005_update_auth_trigger_google.sql
--
-- Server-side SECURITY DEFINER functions to safely
-- query per-family schema tables from the client.
-- =============================================

-- 1. Get recent documents for a family (with category name and member info)
CREATE OR REPLACE FUNCTION public.get_family_documents(
  p_family_id UUID,
  p_limit INT DEFAULT 10,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  uploaded_by UUID,
  file_name VARCHAR,
  file_type VARCHAR,
  file_size_bytes BIGINT,
  storage_path TEXT,
  category_id UUID,
  category_name VARCHAR,
  belongs_to_member UUID,
  member_name TEXT,
  member_relationship TEXT,
  ingestion_status VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schema TEXT;
BEGIN
  -- Verify caller is a member of this family
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT storage_namespace INTO v_schema
  FROM public.families WHERE id = p_family_id;

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
$$;

-- 2. Get a single document with its metadata
CREATE OR REPLACE FUNCTION public.get_document_detail(
  p_family_id UUID,
  p_document_id UUID
)
RETURNS TABLE (
  id UUID,
  uploaded_by UUID,
  uploader_name TEXT,
  file_name VARCHAR,
  file_type VARCHAR,
  file_size_bytes BIGINT,
  storage_path TEXT,
  category_id UUID,
  category_name VARCHAR,
  belongs_to_member UUID,
  member_name TEXT,
  member_relationship TEXT,
  ingestion_status VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schema TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT storage_namespace INTO v_schema
  FROM public.families WHERE id = p_family_id;

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
$$;

-- 3. Get family stats
CREATE OR REPLACE FUNCTION public.get_family_stats(p_family_id UUID)
RETURNS TABLE (
  doc_count BIGINT,
  member_count BIGINT,
  category_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schema TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT storage_namespace INTO v_schema
  FROM public.families WHERE id = p_family_id;

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
$$;

-- 4. Search documents (basic ILIKE on file_name and ocr_text)
CREATE OR REPLACE FUNCTION public.search_family_documents(
  p_family_id UUID,
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  file_name VARCHAR,
  file_type VARCHAR,
  category_id UUID,
  category_name VARCHAR,
  belongs_to_member UUID,
  member_name TEXT,
  member_relationship TEXT,
  created_at TIMESTAMPTZ,
  relevance TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schema TEXT;
  v_pattern TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT storage_namespace INTO v_schema
  FROM public.families WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  v_pattern := '%' || p_query || '%';

  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.file_name, d.file_type, d.category_id,
            c.name::VARCHAR AS category_name,
            d.belongs_to_member,
            COALESCE(fm.alias, u.display_name)::TEXT AS member_name,
            fm.relationship::TEXT AS member_relationship,
            d.created_at,
            CASE
              WHEN d.file_name ILIKE $1 THEN ''filename''
              WHEN d.ocr_text ILIKE $1 THEN ''content''
              ELSE ''partial''
            END AS relevance
     FROM %I.documents d
     LEFT JOIN public.document_categories c ON c.id = d.category_id
     LEFT JOIN public.family_members fm ON fm.id = d.belongs_to_member
     LEFT JOIN public.users u ON u.id = fm.user_id
     WHERE d.is_deleted = false
       AND (d.file_name ILIKE $1 OR d.ocr_text ILIKE $1)
     ORDER BY
       CASE WHEN d.file_name ILIKE $1 THEN 0 ELSE 1 END,
       d.created_at DESC
     LIMIT $2', v_schema
  ) USING v_pattern, p_limit;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_family_documents TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_document_detail TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_family_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_family_documents TO authenticated;
