-- ============================================================================
-- 045: A nickname for anyone in the family tree
--
-- The tree used to add a Hindi word to every relation by itself — "Mother
-- (Maa)", "Sister (Behen)" — words a family may not use at all. Now the family
-- gives a person a nickname of its own ("Pinky", "Bablu", "Maa"): one per
-- person, the same for everyone in the family, shown beside their relation.
-- Ask understands it too: "Pinky's passport" finds Priya's.
--
--   family_people.nickname        at most 40 characters; NULL for none.
--                                 Members read it (031's table grant);
--                                 nobody writes the table directly.
--   set_family_person_nickname()  an admin, or the person themselves — 031's
--                                 rule, the caller from auth.uid(). Blank
--                                 clears it.
--   link_family_person_account()  033's, restated with one line more: when an
--                                 entry and a member become one, the entry's
--                                 nickname carries over unless the member has
--                                 one — like a gender or a date of birth.
--
-- Apply after 044: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows). Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. The nickname ────────────────────────────────────────────────────────
ALTER TABLE public.family_people
  ADD COLUMN IF NOT EXISTS nickname text CHECK (nickname IS NULL OR char_length(btrim(nickname)) BETWEEN 1 AND 40);


-- ─── 2. Set or clear it: an admin, or the person themselves ─────────────────
CREATE OR REPLACE FUNCTION public.set_family_person_nickname(p_person_id uuid, p_nickname text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me       uuid := auth.uid();
  v_family   uuid;
  v_user     uuid;
  v_nickname text := nullif(regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g'), '');
BEGIN
  SELECT family_id, user_id INTO v_family, v_user FROM public.family_people WHERE id = p_person_id;
  -- 031's rule, spelled out the same way: with v_user NULL, a bare
  -- `v_user = v_me` is NULL, and NOT (false OR NULL) does not raise.
  IF v_me IS NULL OR v_family IS NULL
     OR NOT (public.is_family_admin(v_family) OR (v_user IS NOT NULL AND v_user = v_me)) THEN
    RAISE EXCEPTION 'Only a family admin, or the person themselves, can change these details.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_nickname) > 40 THEN
    RAISE EXCEPTION 'A nickname can be at most 40 characters.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.family_people SET nickname = v_nickname, updated_at = now() WHERE id = p_person_id;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_family, 'update_person', 'family_person', p_person_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_family_person_nickname(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_person_nickname(uuid, text) TO authenticated, service_role;


-- ─── 3. Two entries become one: the nickname comes along (033, restated) ────
-- Unchanged from 033 but for the line marked 045.
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
         nickname     = coalesce(m.nickname, v_person.nickname),   -- 045
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
