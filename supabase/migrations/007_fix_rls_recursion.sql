-- =============================================
-- FamilyVault: Fix ALL RLS infinite recursion
-- Run this AFTER 006_document_query_rpcs.sql
--
-- Multiple policies reference their own table or
-- reference users.is_superuser which triggers
-- the users policy recursively. Fix all of them
-- with SECURITY DEFINER helper functions.
-- =============================================

-- ========================
-- HELPER FUNCTIONS (bypass RLS)
-- ========================

-- Check if current user is superuser
CREATE OR REPLACE FUNCTION public.is_superuser()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_superuser FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- Get family IDs for the current user
CREATE OR REPLACE FUNCTION public.get_my_family_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT family_id FROM public.family_members WHERE user_id = auth.uid();
$$;

-- Check if current user is admin in a specific family
CREATE OR REPLACE FUNCTION public.is_family_admin(p_family_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ========================
-- FIX: USERS policies
-- ========================
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;

CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (
    id = auth.uid()
    OR public.is_superuser()
  );

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ========================
-- FIX: FAMILIES policies
-- ========================
DROP POLICY IF EXISTS "families_select_member" ON public.families;
DROP POLICY IF EXISTS "families_insert" ON public.families;
DROP POLICY IF EXISTS "families_update_admin" ON public.families;

CREATE POLICY "families_select_member" ON public.families
  FOR SELECT USING (
    id IN (SELECT public.get_my_family_ids())
    OR public.is_superuser()
  );

CREATE POLICY "families_insert" ON public.families
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "families_update_admin" ON public.families
  FOR UPDATE USING (
    public.is_family_admin(id)
  );

-- ========================
-- FIX: FAMILY_MEMBERS policies
-- ========================
DROP POLICY IF EXISTS "family_members_select" ON public.family_members;
DROP POLICY IF EXISTS "family_members_insert_admin" ON public.family_members;
DROP POLICY IF EXISTS "family_members_update_admin" ON public.family_members;
DROP POLICY IF EXISTS "family_members_delete_admin" ON public.family_members;

CREATE POLICY "family_members_select" ON public.family_members
  FOR SELECT USING (
    family_id IN (SELECT public.get_my_family_ids())
    OR public.is_superuser()
  );

CREATE POLICY "family_members_insert_admin" ON public.family_members
  FOR INSERT WITH CHECK (
    public.is_family_admin(family_id)
    OR user_id = auth.uid()
  );

CREATE POLICY "family_members_update_admin" ON public.family_members
  FOR UPDATE USING (
    public.is_family_admin(family_id)
  );

CREATE POLICY "family_members_delete_admin" ON public.family_members
  FOR DELETE USING (
    public.is_family_admin(family_id)
  );

-- ========================
-- FIX: INVITATIONS policies
-- ========================
DROP POLICY IF EXISTS "invitations_select" ON public.invitations;

CREATE POLICY "invitations_select" ON public.invitations
  FOR SELECT USING (
    invited_by = auth.uid()
    OR invitee_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR public.is_family_admin(family_id)
    OR public.is_superuser()
  );

-- ========================
-- FIX: NOTIFICATIONS policies
-- ========================
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_superuser()
  );

-- ========================
-- FIX: AUDIT_LOGS policies
-- ========================
DROP POLICY IF EXISTS "audit_logs_superuser" ON public.audit_logs;

CREATE POLICY "audit_logs_superuser" ON public.audit_logs
  FOR SELECT USING (
    public.is_superuser()
  );

-- ========================
-- FIX: DOCUMENT_CATEGORIES policies
-- ========================
DROP POLICY IF EXISTS "categories_select" ON public.document_categories;

CREATE POLICY "categories_select" ON public.document_categories
  FOR SELECT USING (
    is_system = true
    OR created_by = auth.uid()
    OR public.is_superuser()
  );

-- ========================
-- GRANTS
-- ========================
GRANT EXECUTE ON FUNCTION public.is_superuser TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_family_ids TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_family_admin TO authenticated;
