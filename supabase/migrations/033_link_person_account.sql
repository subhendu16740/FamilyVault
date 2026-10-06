-- ============================================================================
-- 033: link a person in the family tree to their FamilyVault account
--
-- The tree holds people with and without accounts (031). When someone added
-- by name later signs up, adding them through Manage Family gave them a
-- second entry: a new person under their new member id, beside the old one
-- with the links, the documents marked as theirs and their emergency card.
-- Now an admin links the existing entry to the account instead, from the
-- person's page:
--
--   • Not a member yet: they join the family as a viewer, and their
--     membership takes the person's id. 031's rule is that a member is a
--     person under their member id, so the person they already were IS their
--     member person: links, documents and emergency card stay exactly where
--     they are, nothing rewritten. They are told by a notification, as when
--     added by email (025).
--   • Already a member (the duplicate exists): the two entries become one.
--     The member's own person keeps its id and takes the tree entry's name
--     (the name the family knows them by, as 031 prefers the membership
--     alias), a gender or birth date it lacks, the entry's links — re-made
--     through 031's helpers, so the tree's rules still hold —, the documents
--     marked as the entry, and its emergency card if the member has none.
--     The entry is then removed. A link the rules refuse (a third parent,
--     someone their own ancestor) refuses the whole join, with that message.
--
-- link_family_person_account() takes a user id (the admin), so it is service
-- role only (CLAUDE.md point 2): the link-account Edge Function verifies the
-- caller, and the function checks again that the caller is an admin. The 023
-- sweep stays at zero rows.
--
-- The app works before this is applied: linking says it is not switched on
-- yet. link-account is deployed by merging to dev / main, as ever.
--
-- Apply: paste into the SQL editor — DEV, then PROD in the same sitting, then
-- run qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.link_family_person_account(
  p_family_id uuid,
  p_linked_by uuid,
  p_person_id uuid,
  p_email     text
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
  v_member uuid;     -- the account's own person in this family, when already a member
  v_links  jsonb;
  v_ns     text;
  v_family text;
  v_adder  text;
  l        record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
     WHERE family_id = p_family_id AND user_id = p_linked_by AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed: only a family admin can link someone to their account'
      USING ERRCODE = '42501';
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

  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('status', 'invalid_email');
  END IF;

  -- The same account lookup as add_family_member() (025).
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

  SELECT id INTO v_member FROM public.family_people
   WHERE family_id = p_family_id AND user_id = v_user;

  -- ── Not a member yet: they join, and their membership takes this person's id.
  IF v_member IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.family_members WHERE family_id = p_family_id AND user_id = v_user) THEN
      -- A member with no person: 031 gave every member one, so refuse rather than guess.
      RETURN jsonb_build_object('status', 'already_member', 'display_name', v_name);
    END IF;
    IF EXISTS (SELECT 1 FROM public.family_members WHERE id = p_person_id) THEN
      RAISE EXCEPTION 'That entry cannot be linked: its id is already a membership.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.family_members (id, family_id, user_id, role, can_upload, can_delete)
    VALUES (p_person_id, p_family_id, v_user, 'viewer', true, false);
    -- 031's trigger found the person already there and left it alone; give it the account.
    UPDATE public.family_people SET user_id = v_user, updated_at = now() WHERE id = p_person_id;

    UPDATE public.families SET is_personal = false WHERE id = p_family_id AND is_personal;
    SELECT name INTO v_family FROM public.families WHERE id = p_family_id;
    SELECT display_name INTO v_adder FROM public.users WHERE id = p_linked_by;

    -- Being added needs no consent, so it must never be silent (025).
    INSERT INTO public.notifications (user_id, family_id, type, title, message)
    VALUES (
      v_user, p_family_id, 'member',
      format('You were added to %s', v_family),
      format('%s added you to %s as a viewer, as %s in the family tree. Switch to it, or leave it, from Manage Family.',
             coalesce(v_adder, 'A family admin'), v_family, v_person.display_name)
    );
    INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
    VALUES (p_linked_by, p_family_id, 'link_person_account', 'family_person', p_person_id);

    RETURN jsonb_build_object(
      'status', 'linked', 'member_id', p_person_id, 'user_id', v_user,
      'display_name', v_person.display_name, 'role', 'viewer', 'family_name', v_family
    );
  END IF;

  -- ── Already a member: the tree entry and the member's own person become one.
  -- The entry's links are lifted off first, so 031's checks (two parents at
  -- most, nobody their own ancestor) judge the joined person, not both.
  SELECT coalesce(jsonb_agg(jsonb_build_object('from_person', fl.from_person, 'to_person', fl.to_person, 'kind', fl.kind)), '[]'::jsonb)
    INTO v_links
    FROM public.family_links fl
   WHERE fl.family_id = p_family_id AND p_person_id IN (fl.from_person, fl.to_person);
  DELETE FROM public.family_links
   WHERE family_id = p_family_id AND p_person_id IN (from_person, to_person);

  FOR l IN SELECT * FROM jsonb_to_recordset(v_links) AS x(from_person uuid, to_person uuid, kind text) LOOP
    CONTINUE WHEN v_member IN (l.from_person, l.to_person);   -- a link between the two entries ends with the join
    IF l.kind = 'parent' THEN
      IF l.from_person = p_person_id THEN
        PERFORM public.tree_add_parent(p_family_id, v_member, l.to_person);
      ELSE
        PERFORM public.tree_add_parent(p_family_id, l.from_person, v_member);
      END IF;
    ELSE
      PERFORM public.tree_add_pair(
        p_family_id, v_member,
        CASE WHEN l.from_person = p_person_id THEN l.to_person ELSE l.from_person END,
        l.kind);
    END IF;
  END LOOP;

  SELECT storage_namespace INTO v_ns FROM public.families WHERE id = p_family_id;
  IF v_ns ~ '^family_[0-9a-f]{8}$' THEN
    EXECUTE format('UPDATE %I.documents SET belongs_to_member = $1 WHERE belongs_to_member = $2', v_ns)
      USING v_member, p_person_id;
  END IF;

  -- The member's own card wins; otherwise the entry's card is theirs now.
  IF NOT EXISTS (SELECT 1 FROM public.family_emergency_cards WHERE person_id = v_member) THEN
    UPDATE public.family_emergency_cards SET person_id = v_member WHERE person_id = p_person_id;
  END IF;

  UPDATE public.family_people m
     SET display_name = v_person.display_name,
         gender       = coalesce(m.gender, v_person.gender),
         birth_date   = coalesce(m.birth_date, v_person.birth_date),
         updated_at   = now()
   WHERE m.id = v_member;

  DELETE FROM public.family_people WHERE id = p_person_id;   -- a card not moved goes with it

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_linked_by, p_family_id, 'merge_person_into_member', 'family_person', v_member);

  RETURN jsonb_build_object(
    'status', 'merged', 'member_id', v_member, 'user_id', v_user,
    'display_name', v_person.display_name
  );
END;
$fn$;

-- Server only: it takes the admin's user id as a parameter.
REVOKE ALL ON FUNCTION public.link_family_person_account(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_family_person_account(uuid, uuid, uuid, text) TO service_role;

COMMIT;
