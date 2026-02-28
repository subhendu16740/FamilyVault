-- =============================================
-- FamilyVault: Layer 1 — Common Tables
-- Run this FIRST in Supabase SQL Editor
-- =============================================

-- 1. Users (extends auth.users)
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

-- 2. Families
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

-- 3. Family Members
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

-- 4. Invitations
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

-- 5. Document Categories
CREATE TABLE public.document_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50),
  has_expiry BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.users(id)
);

-- 6. Notifications
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

-- 7. Audit Logs
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

-- Indexes for performance
CREATE INDEX idx_family_members_user ON public.family_members(user_id);
CREATE INDEX idx_family_members_family ON public.family_members(family_id);
CREATE INDEX idx_invitations_email ON public.invitations(invitee_email);
CREATE INDEX idx_invitations_status ON public.invitations(status);
CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_family ON public.audit_logs(family_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
