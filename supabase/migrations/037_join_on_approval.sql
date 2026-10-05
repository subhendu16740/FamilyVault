-- ============================================================================
-- 037: nobody joins a family without saying yes
--
-- Until now an admin's Add (025) or Link to their FamilyVault account (033)
-- made someone a member at once, and told them afterwards. Now both send an
-- invitation, and the person joins only when they accept:
--
--   • add-member and link-account write a row in family_invites, and the
--     person gets an 'invite' notification — on their devices too (034).
--     They see the family's name and who asked; nothing of its documents.
--   • Until they answer, the family sees them as Pending approval: in Manage
--     Family, and on the person's page when the invitation came from a link.
--     Any admin can withdraw it.
--   • Accept: the membership is made then, as it was made before — a viewer,
--     or under the tree entry's id when the invitation came from a link, so
--     their links, documents and emergency card stay theirs (033). The
--     family's admins are told.
--   • Decline: the invitation goes, and the family's admins are told.
--   • Linking an entry to someone who is ALREADY a member still makes the
--     two entries one at once (033): they are in the family already, and
--     nothing new opens up to them.
--
-- invite_family_member() and invite_family_person_account() take the admin's
-- user id, so they are service role only (CLAUDE.md point 2): the Edge
-- Functions check the caller, and the functions check again. The four the app
-- calls — get_my_invitations(), accept_family_invite(), decline_family_invite()
-- and cancel_family_invite() — take the caller from auth.uid().
--
-- add_family_member() (025) and link_family_person_account() (033) are left
-- as they are, for the add-member and link-account deployed before this
-- release: until a project's functions are updated, it keeps adding as it
-- does today rather than failing. Nothing calls add_family_member() once both
-- projects run this release; a later migration drops it, with the join
-- branch of link_family_person_account().
--
-- Apply: paste into the SQL editor — DEV, then PROD — BEFORE merging (the
-- new add-member and link-account need it), then run qa/sql/sweep.sql (zero
-- rows) and qa/sql/fingerprint.sql on both. Idempotent. Needs 031 and 033.
-- ============================================================================

BEGIN;

-- ─── 1. Invitations: one per account per family, until it is answered ──────
CREATE TABLE IF NOT EXISTS public.family_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,   -- the account asked
  email        text NOT NULL CHECK (length(email) <= 320),                  -- as the admin typed it
  person_id    uuid,                                     -- the tree entry they will be, from a link
  role         text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  alias        text CHECK (length(alias) <= 120),
  relationship text CHECK (length(relationship) <= 40),
  invited_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- The entry is in the same family; taking it out of the tree withdraws
  -- the invitation to be it.
  CONSTRAINT family_invites_person FOREIGN KEY (family_id, person_id)
    REFERENCES public.family_people (family_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS family_invites_one_per_account ON public.family_invites (family_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS family_invites_one_per_person ON public.family_invites (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS family_invites_user ON public.family_invites (user_id);

ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_invites FROM PUBLIC, anon, authenticated;
-- The family sees who has not answered yet: the address it asked, not the
-- account behind it (that is theirs to show by accepting). Written only by
-- the functions below.
GRANT SELECT (id, family_id, email, person_id, role, invited_by, created_at)
  ON public.family_invites TO authenticated;

DROP POLICY IF EXISTS family_invites_select_family ON public.family_invites;
CREATE POLICY family_invites_select_family ON public.family_invites
  FOR SELECT TO authenticated
  USING (family_id IN (SELECT public.get_my_family_ids()));


-- ─── 2. A membership answers any invitation to it ───────────────────────────
-- However it is made — accepting, the family's creator, or an add-member
-- deployed before this release — nobody stays Pending approval in a family
-- they are already in.
CREATE OR REPLACE FUNCTION public.family_invites_follow_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM public.family_invites WHERE family_id = NEW.family_id AND user_id = NEW.user_id;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.family_invites_follow_members() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS family_invites_follow_members ON public.family_members;
CREATE TRIGGER family_invites_follow_members
  AFTER INSERT ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_invites_follow_members();


-- ─── 3. Asking: by email (add-member) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_family_member(
  p_family_id    uuid,
  p_invited_by   uuid,
  p_email        text,
  p_role         text DEFAULT 'viewer',
  p_alias        text DEFAULT NULL,
  p_relationship text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_role   text := coalesce(nullif(btrim(p_role), ''), 'viewer');
  v_user   uuid;
  v_name   text;
  v_invite uuid;
  v_family text;
  v_adder  text;
BEGIN
  IF v_role NOT IN ('admin', 'viewer') THEN
    RAISE EXCEPTION 'Unknown role: %', v_role USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
     WHERE family_id = p_family_id AND user_id = p_invited_by AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed: only a family admin can add members' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR length(v_email) > 320 THEN
    RETURN jsonb_build_object('status', 'invalid_email');
  END IF;

  -- The same account lookup as 025 and 033.
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
  IF EXISTS (SELECT 1 FROM public.family_members WHERE family_id = p_family_id AND user_id = v_user) THEN
    RETURN jsonb_build_object('status', 'already_member', 'display_name', v_name);
  END IF;

  INSERT INTO public.family_invites (family_id, user_id, email, role, alias, relationship, invited_by)
  VALUES (p_family_id, v_user, v_email, v_role,
          left(nullif(btrim(p_alias), ''), 120), left(nullif(btrim(p_relationship), ''), 40), p_invited_by)
  ON CONFLICT (family_id, user_id) DO NOTHING
  RETURNING id INTO v_invite;
  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('status', 'already_invited', 'email', v_email);
  END IF;

  SELECT name INTO v_family FROM public.families WHERE id = p_family_id;
  SELECT display_name INTO v_adder FROM public.users WHERE id = p_invited_by;
  INSERT INTO public.notifications (user_id, family_id, type, title, message)
  VALUES (
    v_user, p_family_id, 'invite',
    left(format('%s invited you to join %s', coalesce(v_adder, 'A family admin'), v_family), 200),
    format('Join %s as %s? You see its documents only if you accept. Answer on Home or in Manage Family.',
           v_family, CASE v_role WHEN 'admin' THEN 'an admin' ELSE 'a viewer' END)
  );
  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_invited_by, p_family_id, 'invite_member', 'family_invite', v_invite);

  RETURN jsonb_build_object('status', 'invited', 'invite_id', v_invite, 'email', v_email, 'role', v_role);
END;
$fn$;


-- ─── 4. Asking: as someone already in the tree (link-account) ───────────────
CREATE OR REPLACE FUNCTION public.invite_family_person_account(
  p_family_id  uuid,
  p_invited_by uuid,
  p_person_id  uuid,
  p_email      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_person public.family_people%ROWTYPE;
  v_user   uuid;
  v_name   text;
  v_other  text;
  v_invite uuid;
  v_new    boolean;
  v_family text;
  v_adder  text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
     WHERE family_id = p_family_id AND user_id = p_invited_by AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed: only a family admin can link someone to their account' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_person FROM public.family_people
   WHERE id = p_person_id AND family_id = p_family_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_person');
  END IF;
  IF v_person.user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_linked', 'display_name', v_person.display_name);
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR length(v_email) > 320 THEN
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

  -- In the family already: nothing new opens up to them, so the two entries
  -- become one now, as 033 does it.
  IF EXISTS (SELECT 1 FROM public.family_members WHERE family_id = p_family_id AND user_id = v_user) THEN
    RETURN public.link_family_person_account(p_family_id, p_invited_by, p_person_id, p_email);
  END IF;
  IF EXISTS (SELECT 1 FROM public.family_members WHERE id = p_person_id) THEN
    RAISE EXCEPTION 'That entry cannot be linked: its id is already a membership.' USING ERRCODE = '23505';
  END IF;

  -- Someone else is already asked to be this person.
  SELECT email INTO v_other FROM public.family_invites WHERE person_id = p_person_id AND user_id <> v_user;
  IF v_other IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_invited', 'email', v_other);
  END IF;

  -- Asked already, by email alone: when they accept, they join as this
  -- person, so their place in the tree is kept.
  INSERT INTO public.family_invites AS fi (family_id, user_id, email, person_id, invited_by)
  VALUES (p_family_id, v_user, v_email, p_person_id, p_invited_by)
  ON CONFLICT (family_id, user_id) DO UPDATE SET person_id = EXCLUDED.person_id
  RETURNING fi.id, (fi.xmax = 0) INTO v_invite, v_new;

  IF v_new THEN
    SELECT name INTO v_family FROM public.families WHERE id = p_family_id;
    SELECT display_name INTO v_adder FROM public.users WHERE id = p_invited_by;
    INSERT INTO public.notifications (user_id, family_id, type, title, message)
    VALUES (
      v_user, p_family_id, 'invite',
      left(format('%s invited you to join %s', coalesce(v_adder, 'A family admin'), v_family), 200),
      format('Join %s as a viewer, as %s in the family tree? You see its documents only if you accept. Answer on Home or in Manage Family.',
             v_family, v_person.display_name)
    );
  END IF;
  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_invited_by, p_family_id, 'invite_person_account', 'family_person', p_person_id);

  RETURN jsonb_build_object(
    'status', 'invited', 'invite_id', v_invite, 'email', v_email, 'display_name', v_person.display_name
  );
END;
$fn$;

-- Server only: both take the admin's user id as a parameter.
REVOKE ALL ON FUNCTION public.invite_family_member(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_family_member(uuid, uuid, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.invite_family_person_account(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_family_person_account(uuid, uuid, uuid, text) TO service_role;


-- ─── 5. Answering, and withdrawing — the caller from auth.uid() ─────────────

-- The invitations waiting for the signed-in person: which family, who asked,
-- and the tree entry they would be.
CREATE OR REPLACE FUNCTION public.get_my_invitations()
RETURNS TABLE (id uuid, family_id uuid, family_name text, invited_by_name text, person_name text,
               role text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT i.id, i.family_id, f.name::text, u.display_name::text, p.display_name::text, i.role, i.created_at
    FROM public.family_invites i
    JOIN public.families f ON f.id = i.family_id
    LEFT JOIN public.users u ON u.id = i.invited_by
    LEFT JOIN public.family_people p ON p.id = i.person_id
   WHERE i.user_id = auth.uid()
   ORDER BY i.created_at;
$fn$;

-- Yes: the membership is made now.
CREATE OR REPLACE FUNCTION public.accept_family_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me     uuid := auth.uid();
  v_inv    public.family_invites%ROWTYPE;
  v_person public.family_people%ROWTYPE;
  v_member uuid;
  v_family text;
  v_name   text;
BEGIN
  SELECT * INTO v_inv FROM public.family_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR v_inv.user_id <> v_me THEN
    RAISE EXCEPTION 'Not allowed: that invitation is not yours, or it was withdrawn' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO v_family FROM public.families WHERE id = v_inv.family_id;

  IF v_inv.person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.family_people
     WHERE id = v_inv.person_id AND family_id = v_inv.family_id
       FOR UPDATE;
    IF NOT FOUND OR v_person.user_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.family_members WHERE id = v_inv.person_id) THEN
      -- Someone else is that person now: this invitation cannot be kept.
      DELETE FROM public.family_invites WHERE id = v_inv.id;
      RETURN jsonb_build_object('status', 'gone');
    END IF;
    INSERT INTO public.family_members (id, family_id, user_id, role, can_upload, can_delete)
    VALUES (v_inv.person_id, v_inv.family_id, v_me, v_inv.role, true, v_inv.role = 'admin')
    RETURNING id INTO v_member;
    -- 031's trigger found the person already there and left it alone; give it the account.
    UPDATE public.family_people SET user_id = v_me, updated_at = now() WHERE id = v_inv.person_id;
  ELSE
    INSERT INTO public.family_members (family_id, user_id, role, alias, relationship, can_upload, can_delete)
    VALUES (v_inv.family_id, v_me, v_inv.role, v_inv.alias, v_inv.relationship, true, v_inv.role = 'admin')
    RETURNING id INTO v_member;
  END IF;
  -- (The membership's trigger has removed the invitation.)

  UPDATE public.families SET is_personal = false WHERE id = v_inv.family_id AND is_personal;
  UPDATE public.notifications SET is_read = true
   WHERE user_id = v_me AND family_id = v_inv.family_id AND type = 'invite' AND NOT coalesce(is_read, false);

  SELECT display_name INTO v_name FROM public.users WHERE id = v_me;
  INSERT INTO public.notifications (user_id, family_id, type, title, message)
  SELECT fm.user_id, v_inv.family_id, 'member',
         left(format('%s joined %s', coalesce(v_name, v_inv.email), v_family), 200),
         format('%s accepted the invitation and can now see %s''s documents, as %s.',
                coalesce(v_name, v_inv.email), v_family,
                CASE v_inv.role WHEN 'admin' THEN 'an admin' ELSE 'a viewer' END)
    FROM public.family_members fm
   WHERE fm.family_id = v_inv.family_id AND fm.role = 'admin' AND fm.user_id <> v_me;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_inv.family_id, 'accept_invite', 'family_member', v_member);

  RETURN jsonb_build_object('status', 'joined', 'family_id', v_inv.family_id, 'family_name', v_family, 'member_id', v_member);
END;
$fn$;

-- No: the invitation goes, and the family's admins hear it.
CREATE OR REPLACE FUNCTION public.decline_family_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me     uuid := auth.uid();
  v_inv    public.family_invites%ROWTYPE;
  v_family text;
BEGIN
  SELECT * INTO v_inv FROM public.family_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR v_inv.user_id <> v_me THEN
    RAISE EXCEPTION 'Not allowed: that invitation is not yours, or it was withdrawn' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.family_invites WHERE id = v_inv.id;
  UPDATE public.notifications SET is_read = true
   WHERE user_id = v_me AND family_id = v_inv.family_id AND type = 'invite' AND NOT coalesce(is_read, false);

  -- In the words the admin used: the address they typed.
  SELECT name INTO v_family FROM public.families WHERE id = v_inv.family_id;
  INSERT INTO public.notifications (user_id, family_id, type, title, message)
  SELECT fm.user_id, v_inv.family_id, 'member',
         left(format('%s said no to joining %s', v_inv.email, v_family), 200),
         'They will not see the family''s documents. You can invite them again if they change their mind.'
    FROM public.family_members fm
   WHERE fm.family_id = v_inv.family_id AND fm.role = 'admin';

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_inv.family_id, 'decline_invite', 'family_invite', v_inv.id);
END;
$fn$;

-- Withdrawn by an admin, with the notice of it.
CREATE OR REPLACE FUNCTION public.cancel_family_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me  uuid := auth.uid();
  v_inv public.family_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM public.family_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_members
     WHERE family_id = v_inv.family_id AND user_id = v_me AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed: only a family admin can withdraw an invitation' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.family_invites WHERE id = v_inv.id;
  DELETE FROM public.notifications
   WHERE user_id = v_inv.user_id AND family_id = v_inv.family_id AND type = 'invite';
  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_inv.family_id, 'cancel_invite', 'family_invite', v_inv.id);
END;
$fn$;

-- Signed-in people only: anon never reaches these.
REVOKE ALL ON FUNCTION public.get_my_invitations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_family_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_family_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_family_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_invitations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_family_invite(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_family_invite(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_family_invite(uuid) TO authenticated, service_role;

COMMIT;
