-- ============================================================================
-- 025: Only a family admin adds a member — and a client may change only what
--      the app itself changes
--
-- Found by the QA suite and a catalog audit (identical on DEV and PROD). Each
-- works with nothing but a signed-in account and the PostgREST API every web
-- bundle already talks to:
--
-- 1. ANY ACCOUNT COULD JOIN ANY FAMILY, AS ADMIN. The family_members INSERT
--    policy said `is_family_admin(family_id) OR user_id = auth.uid()` — the
--    second half lets a person insert themselves, with any role, into any
--    family whose id they know. Every current and former member knows it.
--    QA's "add itself to QA Vault A as admin" probe has failed on every run.
--
-- 2. ANY ACCOUNT COULD MAKE ITSELF SUPERUSER. users_update_own checks the ROW
--    (id = auth.uid()) and nothing else, and anon/authenticated hold UPDATE on
--    every column — including users.is_superuser. One PATCH to /users sets
--    it, and is_superuser() then opens SELECT on every family, member list,
--    invitation, notification, audit log and user profile.
--
-- 3. ANYONE COULD CREATE USER ROWS, OR TAKE AN EMAIL. users_insert_via_trigger
--    is `TO public WITH CHECK (true)`, and users.email is editable. A row
--    (or an edit) carrying someone else's email makes their sign-up fail on
--    users_email_key forever: handle_new_user's ON CONFLICT covers `id`, not
--    `email`. The trigger never needed the policy — handle_new_user is
--    SECURITY DEFINER, owned by postgres, which owns the table.
--
-- 4. Structural columns were editable: a family admin could rewrite
--    families.storage_namespace / vector_namespace / created_by, and move a
--    membership to another user (family_members.user_id). The namespace is
--    what every family RPC and storage policy resolves the family's schema
--    and folder from; only its UNIQUE constraint stood in the way.
--
-- 5. families_insert let a client create a family row directly, with no
--    schema behind it. The app only ever uses create_family().
--
-- ── The membership model after this ─────────────────────────────────────────
--
-- There is no invitation and no request. A family admin adds a person who
-- already has a FamilyVault account, by that account's email, through the
-- add-member Edge Function, which calls add_family_member() below as the
-- service role. The person is told by a notification, and can leave any
-- family (family_members_delete_self is unchanged). Clients can no longer
-- insert a membership at all, so nobody joins without an admin's say-so, and
-- the admin is always told whether an account exists for that email.
--
-- The invitations table is kept, write-locked, because the app on PROD still
-- reads it until this release ships there; nothing can accept an invitation
-- (accept_pending_invitations is dropped). Drop the table in a later
-- migration once PROD runs the new app.
--
-- ── What a client may still change ──────────────────────────────────────────
--
--   users           voice_mode_enabled, voice_language, document_languages
--                   (preferences.tsx — its own row only, per users_update_own)
--   families        name, description, family_icon (admins only, per policy)
--   family_members  role, alias, relationship, can_upload, can_delete
--                   (admins only, per policy)
--   notifications   is_read (own rows only, per policy)
--
-- A future screen that edits a profile (display_name, avatar_url, phone)
-- needs its column granted here first. That is the point: a new writable
-- column is a decision, not a default.
--
-- Apply: paste into the SQL editor — DEV first, then PROD — BEFORE the
-- add-member Edge Function is deployed there (i.e. before merging to dev /
-- main). Everything here is idempotent. The app currently on PROD keeps
-- working against it: nothing it writes is revoked.
-- ============================================================================


-- ─── 1. Memberships: no client inserts at all ───────────────────────────────
-- Adding is add_family_member()'s job (section 6). The creator's own
-- membership is written by create_family(), which is SECURITY DEFINER.

DROP POLICY IF EXISTS family_members_insert_admin ON public.family_members;
REVOKE INSERT ON public.family_members FROM anon, authenticated;

-- Admins may still change a member's role, name and permissions — never
-- which person or which family a membership belongs to.
REVOKE UPDATE ON public.family_members FROM anon, authenticated;
GRANT UPDATE (role, alias, relationship, can_upload, can_delete)
  ON public.family_members TO authenticated;


-- ─── 2. Users: one's own preferences, nothing else ──────────────────────────
-- Table-level REVOKE also removes any column-level grants, so the GRANT that
-- follows is the complete list.

REVOKE INSERT, UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (voice_mode_enabled, voice_language, document_languages)
  ON public.users TO authenticated;

DROP POLICY IF EXISTS users_insert_via_trigger ON public.users;


-- ─── 3. Families: created only by create_family(), renamed by admins ────────

DROP POLICY IF EXISTS families_insert ON public.families;
REVOKE INSERT, UPDATE ON public.families FROM anon, authenticated;
GRANT UPDATE (name, description, family_icon) ON public.families TO authenticated;


-- ─── 4. Notifications: a client only marks its own as read ──────────────────

REVOKE INSERT, UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;


-- ─── 5. Invitations: retired ────────────────────────────────────────────────
-- SELECT (members) and DELETE (admins) stay, for the app still on PROD.

DROP POLICY IF EXISTS invitations_insert_admin ON public.invitations;
DROP POLICY IF EXISTS invitations_update ON public.invitations;
REVOKE INSERT, UPDATE ON public.invitations FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.accept_pending_invitations(uuid);


-- ─── 6. add_family_member(): the only way into a family ─────────────────────
-- Service role only: the add-member Edge Function verifies the caller's
-- token, passes the caller as p_added_by, and this re-checks that they are an
-- admin so the function is safe on its own.
--
-- The account is found in auth.users, not public.users: auth.users.email is
-- the address the person signs in with, and only a CONFIRMED, live,
-- non-anonymous account counts — an unconfirmed sign-up for someone else's
-- address must not be able to catch a membership meant for its owner.
--
-- Returns a status the Edge Function turns into a sentence:
--   added | already_member | no_account | invalid_email

CREATE OR REPLACE FUNCTION public.add_family_member(
  p_family_id uuid,
  p_added_by uuid,
  p_email text,
  p_role text DEFAULT 'viewer',
  p_alias text DEFAULT NULL,
  p_relationship text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := coalesce(nullif(btrim(p_role), ''), 'viewer');
  v_user uuid;
  v_name text;
  v_family text;
  v_adder text;
  v_member uuid;
BEGIN
  IF v_role NOT IN ('admin', 'viewer') THEN
    RAISE EXCEPTION 'Unknown role: %', v_role USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = p_added_by AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed: only a family admin can add members'
      USING ERRCODE = '42501';
  END IF;

  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('status', 'invalid_email');
  END IF;

  SELECT a.id, u.display_name INTO v_user, v_name
  FROM auth.users a
  JOIN public.users u ON u.id = a.id
  WHERE lower(a.email) = v_email
    AND a.email_confirmed_at IS NOT NULL
    AND a.deleted_at IS NULL
    AND NOT coalesce(a.is_anonymous, false)
    AND (a.banned_until IS NULL OR a.banned_until < now())
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'no_account');
  END IF;

  INSERT INTO public.family_members (family_id, user_id, role, alias, relationship, can_upload, can_delete)
  VALUES (
    p_family_id, v_user, v_role,
    left(nullif(btrim(p_alias), ''), 120),
    left(nullif(btrim(p_relationship), ''), 40),
    true,
    v_role = 'admin'
  )
  ON CONFLICT (family_id, user_id) DO NOTHING
  RETURNING id INTO v_member;

  IF v_member IS NULL THEN
    RETURN jsonb_build_object('status', 'already_member', 'user_id', v_user, 'display_name', v_name);
  END IF;

  -- The vault is shared now (accept_pending_invitations did the same).
  UPDATE public.families SET is_personal = false WHERE id = p_family_id AND is_personal;

  SELECT name INTO v_family FROM public.families WHERE id = p_family_id;
  SELECT display_name INTO v_adder FROM public.users WHERE id = p_added_by;

  -- Being added needs no consent, so it must never be silent.
  INSERT INTO public.notifications (user_id, family_id, type, title, message)
  VALUES (
    v_user, p_family_id, 'member',
    format('You were added to %s', v_family),
    format('%s added you to %s as %s. Switch to it, or leave it, from Manage Family.',
           coalesce(v_adder, 'A family admin'), v_family,
           CASE v_role WHEN 'admin' THEN 'an admin' ELSE 'a viewer' END)
  );

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_added_by, p_family_id, 'add_member', 'family_member', v_member);

  RETURN jsonb_build_object(
    'status', 'added',
    'member_id', v_member,
    'user_id', v_user,
    'display_name', v_name,
    'role', v_role,
    'family_name', v_family
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.add_family_member(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_family_member(uuid, uuid, text, text, text, text)
  TO service_role;


-- Verify, on both projects:
--
--   1. qa/sql/sweep.sql returns zero rows.
--   2. What a client may write — exactly the list in the header:
--
--        SELECT table_name, privilege_type, string_agg(column_name, ', ' ORDER BY column_name)
--        FROM information_schema.column_privileges
--        WHERE table_schema = 'public' AND grantee = 'authenticated'
--          AND privilege_type IN ('INSERT', 'UPDATE')
--          AND table_name IN ('users', 'families', 'family_members', 'notifications', 'invitations')
--        GROUP BY 1, 2 ORDER BY 1, 2;
--
--   3. qa/sql/fingerprint.sql matches between DEV and PROD once both have it.
