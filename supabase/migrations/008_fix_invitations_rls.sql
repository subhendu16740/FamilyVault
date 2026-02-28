-- =============================================
-- Fix invitations RLS policies
-- The SELECT and INSERT policies use raw subqueries
-- that can fail due to cross-table RLS evaluation.
-- Replace with SECURITY DEFINER helpers.
-- =============================================

-- SELECT: any family member can see invitations for their family
DROP POLICY IF EXISTS "invitations_select" ON public.invitations;

CREATE POLICY "invitations_select" ON public.invitations
  FOR SELECT USING (
    family_id IN (SELECT public.get_my_family_ids())
    OR public.is_superuser()
  );

-- INSERT: only family admins can create invitations
DROP POLICY IF EXISTS "invitations_insert_admin" ON public.invitations;

CREATE POLICY "invitations_insert_admin" ON public.invitations
  FOR INSERT WITH CHECK (
    public.is_family_admin(family_id)
  );
