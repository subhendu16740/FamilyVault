-- =============================================
-- FamilyVault: COMPLETE DATABASE SETUP
-- Paste this entire file into Supabase SQL Editor and run once.
-- =============================================

-- =============================================
-- PART 1: COMMON TABLES
-- =============================================

CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,
  auth_provider VARCHAR(20) NOT NULL DEFAULT 'email',
  biometric_enabled BOOLEAN DEFAULT false,
  is_superuser BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE TABLE public.families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  family_icon VARCHAR(50),
  encryption_key_ref VARCHAR(255),
  storage_namespace VARCHAR(50) UNIQUE NOT NULL,
  vector_namespace VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  alias VARCHAR(50),
  relationship VARCHAR(50),
  can_upload BOOLEAN DEFAULT true,
  can_delete BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(family_id, user_id)
);

CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.users(id),
  invitee_email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.document_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50),
  has_expiry BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.users(id)
);

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT,
  document_ref UUID,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id),
  family_id UUID REFERENCES public.families(id),
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  ip_address INET,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_family_members_user ON public.family_members(user_id);
CREATE INDEX idx_family_members_family ON public.family_members(family_id);
CREATE INDEX idx_invitations_email ON public.invitations(invitee_email);
CREATE INDEX idx_invitations_status ON public.invitations(status);
CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_family ON public.audit_logs(family_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);


-- =============================================
-- PART 2: ROW-LEVEL SECURITY
-- =============================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;

-- Users
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (
    id = auth.uid()
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Families
CREATE POLICY "families_select_member" ON public.families
  FOR SELECT USING (
    id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "families_insert" ON public.families
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "families_update_admin" ON public.families
  FOR UPDATE USING (
    id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Family Members
CREATE POLICY "family_members_select" ON public.family_members
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "family_members_insert_admin" ON public.family_members
  FOR INSERT WITH CHECK (
    family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
    OR user_id = auth.uid()
  );

CREATE POLICY "family_members_update_admin" ON public.family_members
  FOR UPDATE USING (
    family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "family_members_delete_admin" ON public.family_members
  FOR DELETE USING (
    family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Invitations
CREATE POLICY "invitations_select" ON public.invitations
  FOR SELECT USING (
    invited_by = auth.uid()
    OR invitee_email = (SELECT email FROM public.users WHERE id = auth.uid())
    OR family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "invitations_insert_admin" ON public.invitations
  FOR INSERT WITH CHECK (
    family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "invitations_update" ON public.invitations
  FOR UPDATE USING (
    invited_by = auth.uid()
    OR invitee_email = (SELECT email FROM public.users WHERE id = auth.uid())
    OR family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Notifications
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (
    user_id = auth.uid()
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Audit Logs
CREATE POLICY "audit_logs_superuser" ON public.audit_logs
  FOR SELECT USING (
    (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Document Categories
CREATE POLICY "categories_select" ON public.document_categories
  FOR SELECT USING (
    is_system = true
    OR created_by = auth.uid()
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "categories_insert" ON public.document_categories
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND is_system = false
  );


-- =============================================
-- PART 3: AUTH TRIGGER + SEED DATA
-- =============================================

-- Auto-create public.users row on signup (supports email + Google OAuth)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url, auth_provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed system document categories
INSERT INTO public.document_categories (name, icon, has_expiry, is_system, created_by) VALUES
  ('Passport', '🛂', true, true, NULL),
  ('National ID / Aadhaar', '🪪', false, true, NULL),
  ('PAN Card', '💳', false, true, NULL),
  ('Driving License', '🚗', true, true, NULL),
  ('Voter ID', '🗳️', false, true, NULL),
  ('Birth Certificate', '👶', false, true, NULL),
  ('Marriage Certificate', '💒', false, true, NULL),
  ('Death Certificate', '📜', false, true, NULL),
  ('Health Insurance', '🏥', true, true, NULL),
  ('Life Insurance', '🛡️', true, true, NULL),
  ('Vehicle Insurance', '🚘', true, true, NULL),
  ('Property Documents', '🏠', false, true, NULL),
  ('Tax Returns', '📊', false, true, NULL),
  ('Bank Statements', '🏦', false, true, NULL),
  ('Medical Records', '🩺', false, true, NULL),
  ('Prescriptions', '💊', true, true, NULL),
  ('Educational Certificates', '🎓', false, true, NULL),
  ('Employment Letters', '💼', false, true, NULL),
  ('Utility Bills', '📑', false, true, NULL),
  ('Visa / Travel Docs', '✈️', true, true, NULL),
  ('Legal Documents', '⚖️', false, true, NULL),
  ('Warranty Cards', '🔧', true, true, NULL),
  ('Other', '📁', false, true, NULL);


-- =============================================
-- PART 4: CREATE FAMILY FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION public.create_family(
  p_user_id UUID,
  p_family_name VARCHAR(100),
  p_description TEXT DEFAULT NULL,
  p_family_icon VARCHAR(50) DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_short_id TEXT;
  v_storage_ns TEXT;
  v_vector_ns TEXT;
BEGIN
  v_family_id := gen_random_uuid();
  v_short_id := replace(left(v_family_id::text, 8), '-', '');
  v_storage_ns := 'family_' || v_short_id;
  v_vector_ns := 'fv_' || v_short_id;

  -- Insert family record
  INSERT INTO public.families (id, name, description, created_by, family_icon, storage_namespace, vector_namespace)
  VALUES (v_family_id, p_family_name, p_description, p_user_id, p_family_icon, v_storage_ns, v_vector_ns);

  -- Create isolated schema
  EXECUTE format('CREATE SCHEMA %I', v_storage_ns);

  -- Documents table
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

  -- Document metadata table
  EXECUTE format('
    CREATE TABLE %I.document_metadata (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES %I.documents(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL,
      value TEXT NOT NULL,
      auto_extracted BOOLEAN DEFAULT false,
      confidence FLOAT
    )', v_storage_ns, v_storage_ns);

  -- Document chunks table
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

  -- Expiry alerts table
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

  -- Family relationships table
  EXECUTE format('
    CREATE TABLE %I.family_relationships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id UUID NOT NULL,
      related_to UUID NOT NULL,
      relationship_type VARCHAR(50) NOT NULL,
      aliases TEXT[]
    )', v_storage_ns);

  -- Indexes
  EXECUTE format('CREATE INDEX idx_%s_docs_category ON %I.documents(category_id)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_docs_member ON %I.documents(belongs_to_member)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_docs_status ON %I.documents(ingestion_status)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_chunks_doc ON %I.document_chunks(document_id)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_metadata_doc ON %I.document_metadata(document_id)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_metadata_key ON %I.document_metadata(key)', v_short_id, v_storage_ns);
  EXECUTE format('CREATE INDEX idx_%s_expiry_date ON %I.expiry_alerts(expiry_date)', v_short_id, v_storage_ns);

  -- Add creator as admin
  INSERT INTO public.family_members (family_id, user_id, role, can_upload, can_delete)
  VALUES (v_family_id, p_user_id, 'admin', true, true);

  -- Audit log
  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_user_id, v_family_id, 'create_family', 'family', v_family_id);

  RETURN v_family_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_family TO authenticated;


-- =============================================
-- SETUP COMPLETE!
-- 7 tables created, RLS enabled, 23 categories seeded,
-- auth trigger active, create_family() function ready.
-- =============================================
