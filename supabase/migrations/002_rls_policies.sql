-- =============================================
-- FamilyVault: Row-Level Security Policies
-- Run this AFTER 001_common_tables.sql
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;

-- ========================
-- USERS
-- ========================
-- Users can read/update their own profile. Superuser sees all.
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (
    id = auth.uid()
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ========================
-- FAMILIES
-- ========================
-- Only members can see their families
CREATE POLICY "families_select_member" ON public.families
  FOR SELECT USING (
    id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

-- Only the create_family function (via service role) inserts families
CREATE POLICY "families_insert" ON public.families
  FOR INSERT WITH CHECK (created_by = auth.uid());

-- Only admin members can update family details
CREATE POLICY "families_update_admin" ON public.families
  FOR UPDATE USING (
    id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ========================
-- FAMILY MEMBERS
-- ========================
-- Members can see fellow members of the same family
CREATE POLICY "family_members_select" ON public.family_members
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

-- Admins can insert/update/delete members
CREATE POLICY "family_members_insert_admin" ON public.family_members
  FOR INSERT WITH CHECK (
    family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
    OR user_id = auth.uid() -- allow self-insert when accepting invitation
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

-- ========================
-- INVITATIONS
-- ========================
-- Visible to inviter or family admins
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

-- ========================
-- NOTIFICATIONS
-- ========================
-- Users can only see/update their own notifications
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (
    user_id = auth.uid()
    OR (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ========================
-- AUDIT LOGS
-- ========================
-- Superuser only
CREATE POLICY "audit_logs_superuser" ON public.audit_logs
  FOR SELECT USING (
    (SELECT is_superuser FROM public.users WHERE id = auth.uid())
  );

-- Allow inserts from authenticated users (logging their own actions)
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ========================
-- DOCUMENT CATEGORIES
-- ========================
-- System categories visible to all, custom categories to their creator
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
