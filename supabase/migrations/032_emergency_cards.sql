-- ============================================================================
-- 032: an emergency card for each person in the family tree
--
-- What a doctor, a neighbour or a relative needs in the first minutes: blood
-- group, allergies, conditions, medicines, the family doctor, the health
-- insurance policy and who to call. One card per person in the tree, with or
-- without an account — the grandmother who will never sign in needs one most.
--
--   • public.family_emergency_cards — one row per person, keyed by the
--     person's id and tied to the person's own family by a composite foreign
--     key to family_people, so a card can never point at another family's
--     person. Taking someone out of the tree takes their card with it; a
--     family deleted with an account (029) takes its cards with it.
--   • Every member of the family reads every card (RLS through
--     get_my_family_ids()): in an emergency, whoever is there needs it.
--     Clients write nothing directly. save_emergency_card() takes the caller
--     from auth.uid() and lets an admin, or the person themselves, write —
--     the same rule as update_family_person in 031, spelled out the same way.
--     It checks every field with a message a person can act on, and saving
--     an empty card deletes it. The 023 sweep stays at zero rows.
--   • A card is about one person's health, so it goes with them: leaving the
--     family, being removed from it, or deleting the account (029 deletes the
--     memberships) deletes the card of the person who held that membership.
--     The family keeps the person in its tree, by name, as 031 does — not
--     their medical details. An admin can write a new card for them.
--
-- users.emergency_info (an unused column from DEV, written down in 024) is
-- left alone. The app works before this is applied: the card says it is not
-- switched on yet.
--
-- Apply: paste into the SQL editor — DEV, then PROD in the same sitting, then
-- run qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. The cards ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_emergency_cards (
  person_id      uuid        PRIMARY KEY,
  family_id      uuid        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  -- 'hh' is the Bombay blood group: rare, found mostly in India, and often
  -- mistyped as O. Someone who has it can only receive hh blood.
  blood_group    text        CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'hh')),
  allergies      text        CHECK (char_length(allergies) <= 500),
  conditions     text        CHECK (char_length(conditions) <= 500),
  medicines      text        CHECK (char_length(medicines) <= 1000),
  doctor_name    text        CHECK (char_length(doctor_name) <= 80),
  doctor_phone   text        CHECK (doctor_phone ~ '^\+?[0-9(][0-9 ()-]{2,19}$'),
  insurer        text        CHECK (char_length(insurer) <= 80),
  policy_number  text        CHECK (char_length(policy_number) <= 40),
  -- Up to three people to call: [{ "name", "relation"?, "phone" }].
  contacts       jsonb       NOT NULL DEFAULT '[]'::jsonb
                             CHECK (CASE WHEN jsonb_typeof(contacts) = 'array'
                                         THEN jsonb_array_length(contacts) <= 3 ELSE false END),
  notes          text        CHECK (char_length(notes) <= 1000),
  updated_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_emergency_cards_person_fkey FOREIGN KEY (family_id, person_id)
    REFERENCES public.family_people (family_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS family_emergency_cards_family_idx ON public.family_emergency_cards (family_id);


-- ─── 2. Who may read and write ──────────────────────────────────────────────
ALTER TABLE public.family_emergency_cards ENABLE ROW LEVEL SECURITY;

-- Supabase grants every new table to anon and authenticated. Take it all back
-- by name, then give members SELECT only: every write goes through
-- save_emergency_card().
REVOKE ALL ON public.family_emergency_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.family_emergency_cards TO authenticated;
GRANT ALL ON public.family_emergency_cards TO service_role;

DROP POLICY IF EXISTS family_emergency_cards_select_member ON public.family_emergency_cards;
CREATE POLICY family_emergency_cards_select_member ON public.family_emergency_cards
  FOR SELECT TO authenticated
  USING (family_id IN (SELECT public.get_my_family_ids()));


-- ─── 3. Saving a card ───────────────────────────────────────────────────────
-- p_card: { blood_group, allergies, conditions, medicines, doctor_name,
-- doctor_phone, insurer, policy_number, contacts: [{name, relation, phone}],
-- notes }. Missing or blank fields are cleared. An admin, or the person
-- themselves.
CREATE OR REPLACE FUNCTION public.save_emergency_card(p_person_id uuid, p_card jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me       uuid := auth.uid();
  v_family   uuid;
  v_user     uuid;
  v_card     jsonb := coalesce(p_card, '{}'::jsonb);
  v_field    text;
  v_label    text;
  v_max      integer;
  v_contacts jsonb := '[]'::jsonb;
  v_c        jsonb;
  v_name     text;
  v_rel      text;
  v_phone    text;
  r          public.family_emergency_cards%ROWTYPE;
BEGIN
  SELECT family_id, user_id INTO v_family, v_user FROM public.family_people WHERE id = p_person_id;
  -- Spelled out as in 031: with v_user NULL, a bare `v_user = v_me` is NULL,
  -- and NOT (false OR NULL) is NULL too, which IF reads as "don't raise".
  IF v_me IS NULL OR v_family IS NULL
     OR NOT (public.is_family_admin(v_family) OR (v_user IS NOT NULL AND v_user = v_me)) THEN
    RAISE EXCEPTION 'Only a family admin, or the person themselves, can change an emergency card.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_card) <> 'object' THEN
    RAISE EXCEPTION 'The emergency card could not be read.' USING ERRCODE = '22023';
  END IF;

  FOR v_field, v_label, v_max IN
    SELECT * FROM (VALUES
      ('allergies', 'Allergies', 500), ('conditions', 'Health conditions', 500),
      ('medicines', 'Medicines', 1000), ('doctor_name', 'The doctor''s name', 80),
      ('insurer', 'The insurance company', 80), ('policy_number', 'The policy number', 40),
      ('notes', 'Other notes', 1000)) AS f(field, label, lim)
  LOOP
    IF char_length(btrim(v_card ->> v_field)) > v_max THEN
      RAISE EXCEPTION '% can be % characters at most.', v_label, v_max USING ERRCODE = '22023';
    END IF;
  END LOOP;

  r.person_id     := p_person_id;
  r.family_id     := v_family;
  r.blood_group   := nullif(replace(btrim(v_card ->> 'blood_group'), '−', '-'), '');
  r.allergies     := nullif(btrim(v_card ->> 'allergies'), '');
  r.conditions    := nullif(btrim(v_card ->> 'conditions'), '');
  r.medicines     := nullif(btrim(v_card ->> 'medicines'), '');
  r.doctor_name   := nullif(btrim(v_card ->> 'doctor_name'), '');
  r.doctor_phone  := nullif(btrim(v_card ->> 'doctor_phone'), '');
  r.insurer       := nullif(btrim(v_card ->> 'insurer'), '');
  r.policy_number := nullif(btrim(v_card ->> 'policy_number'), '');
  r.notes         := nullif(btrim(v_card ->> 'notes'), '');

  IF r.blood_group IS NOT NULL AND r.blood_group NOT IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'hh') THEN
    RAISE EXCEPTION 'Choose a blood group from the list.' USING ERRCODE = '22023';
  END IF;
  IF r.doctor_phone IS NOT NULL AND (r.doctor_phone !~ '^\+?[0-9(][0-9 ()-]{2,19}$'
     OR length(regexp_replace(r.doctor_phone, '\D', '', 'g')) NOT BETWEEN 3 AND 15) THEN
    RAISE EXCEPTION 'The doctor''s phone number doesn''t look right. Use digits, like +91 98765 43210.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_card -> 'contacts') = 'array' THEN
    FOR v_c IN SELECT value FROM jsonb_array_elements(v_card -> 'contacts') LOOP
      v_name  := nullif(btrim(v_c ->> 'name'), '');
      v_rel   := nullif(btrim(v_c ->> 'relation'), '');
      v_phone := nullif(btrim(v_c ->> 'phone'), '');
      CONTINUE WHEN v_name IS NULL AND v_rel IS NULL AND v_phone IS NULL;   -- an empty row on the form
      IF v_name IS NULL OR v_phone IS NULL THEN
        RAISE EXCEPTION 'Each person to call needs a name and a phone number.' USING ERRCODE = '22023';
      END IF;
      IF char_length(v_name) > 80 OR char_length(coalesce(v_rel, '')) > 40 THEN
        RAISE EXCEPTION 'A name can be 80 characters at most, and a relation 40.' USING ERRCODE = '22023';
      END IF;
      IF v_phone !~ '^\+?[0-9(][0-9 ()-]{2,19}$' OR length(regexp_replace(v_phone, '\D', '', 'g')) NOT BETWEEN 3 AND 15 THEN
        RAISE EXCEPTION '%''s phone number doesn''t look right. Use digits, like +91 98765 43210.', v_name USING ERRCODE = '22023';
      END IF;
      v_contacts := v_contacts || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object('name', v_name, 'relation', v_rel, 'phone', v_phone)));
    END LOOP;
    IF jsonb_array_length(v_contacts) > 3 THEN
      RAISE EXCEPTION 'Add at most three people to call.' USING ERRCODE = '22023';
    END IF;
  ELSIF jsonb_typeof(v_card -> 'contacts') IS DISTINCT FROM 'null' AND v_card ? 'contacts' THEN
    RAISE EXCEPTION 'The emergency card could not be read.' USING ERRCODE = '22023';
  END IF;
  r.contacts := v_contacts;

  -- Nothing left on it: the card goes.
  IF r.blood_group IS NULL AND r.allergies IS NULL AND r.conditions IS NULL AND r.medicines IS NULL
     AND r.doctor_name IS NULL AND r.doctor_phone IS NULL AND r.insurer IS NULL AND r.policy_number IS NULL
     AND r.notes IS NULL AND jsonb_array_length(r.contacts) = 0 THEN
    DELETE FROM public.family_emergency_cards WHERE person_id = p_person_id;
    INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
    VALUES (v_me, v_family, 'clear_emergency_card', 'family_person', p_person_id);
    RETURN;
  END IF;

  INSERT INTO public.family_emergency_cards
    (person_id, family_id, blood_group, allergies, conditions, medicines, doctor_name, doctor_phone,
     insurer, policy_number, contacts, notes, updated_by, updated_at)
  VALUES
    (r.person_id, r.family_id, r.blood_group, r.allergies, r.conditions, r.medicines, r.doctor_name, r.doctor_phone,
     r.insurer, r.policy_number, r.contacts, r.notes, v_me, now())
  ON CONFLICT (person_id) DO UPDATE SET
    blood_group = EXCLUDED.blood_group, allergies = EXCLUDED.allergies, conditions = EXCLUDED.conditions,
    medicines = EXCLUDED.medicines, doctor_name = EXCLUDED.doctor_name, doctor_phone = EXCLUDED.doctor_phone,
    insurer = EXCLUDED.insurer, policy_number = EXCLUDED.policy_number, contacts = EXCLUDED.contacts,
    notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_family, 'save_emergency_card', 'family_person', p_person_id);
END;
$fn$;

-- Signed-in members only: anon never reaches it.
REVOKE ALL ON FUNCTION public.save_emergency_card(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_emergency_card(uuid, jsonb) TO authenticated, service_role;


-- ─── 4. A card goes with its person's membership ────────────────────────────
-- Fires before 031's family_people_follow_members (triggers on one event run
-- in name order), while the person still carries the account; a member's
-- person also has the member's id, which covers either order.
CREATE OR REPLACE FUNCTION public.emergency_cards_follow_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM public.family_emergency_cards c
   WHERE c.family_id = OLD.family_id
     AND (c.person_id = OLD.id
          OR c.person_id IN (SELECT p.id FROM public.family_people p
                              WHERE p.family_id = OLD.family_id AND p.user_id = OLD.user_id));
  RETURN OLD;
END;
$fn$;

REVOKE ALL ON FUNCTION public.emergency_cards_follow_members() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS emergency_cards_follow_members ON public.family_members;
CREATE TRIGGER emergency_cards_follow_members
  AFTER DELETE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.emergency_cards_follow_members();

COMMIT;
