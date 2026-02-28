-- =============================================
-- Add DELETE policy for invitations (admin can revoke)
-- and ensure family_members UPDATE/DELETE work for admins
-- =============================================

-- DELETE invitations: family admins can revoke
DROP POLICY IF EXISTS "invitations_delete_admin" ON public.invitations;

CREATE POLICY "invitations_delete_admin" ON public.invitations
  FOR DELETE USING (
    public.is_family_admin(family_id)
  );
