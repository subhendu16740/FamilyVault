-- ============================================================================
-- 041: What each plan allows: 4 members, and the first 10 voice chats
--
-- Two more limits per plan, beside storage (038–040):
--
--   members         the people who sign in and see the family's documents:
--                   4 on every plan. Everyone can still be in the family
--                   tree — a grandmother who will never sign in is not a
--                   member and does not count.
--   voice chats     the first 10 are free, for the whole family together:
--                   a question asked by voice or an answer read aloud, one
--                   per question (counted as voice_answers). After that the
--                   family types and reads, and voice is part of Family
--                   Plus. The answer is always on the screen. (042 adds a
--                   way to read how many are left.)
--
-- Both are columns of plan_limits — max_members and voice_answers (NULL
-- there: every answer) — so they change in the Table editor, like the storage
-- limits, without an update to the app.
--
-- Members, kept by two triggers, so every way in obeys them, the older
-- add-member and link-account included:
--   • a family at its limit takes no new membership: accepting an invitation
--     is refused, with the reason in words;
--   • an invitation waiting for its answer holds a place, so a new one is
--     refused once members and invitations together reach the limit, and
--     nobody is invited to a family with no room for them.
-- Nobody is ever removed. A family above its limit (the limit lowered later)
-- keeps everyone, and invites again once it is below.
--
-- Answers read aloud: before reading a new answer, the app asks
-- claim_voice_answer(), which counts one for a family on a plan with a limit
-- and says no once the family has used them. The reading itself is done by
-- the device's own voice, so this is the app's rule to keep; it is counted
-- here so that another browser or phone does not start again from 10.
--
-- Apply after 040: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows). Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. Two more limits per plan ────────────────────────────────────────────
ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS max_members integer NOT NULL DEFAULT 4 CHECK (max_members BETWEEN 1 AND 100);

-- Set when the column is made, and never again: a number changed in the
-- Table editor stays changed when this file runs a second time.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'plan_limits' AND column_name = 'voice_answers') THEN
    ALTER TABLE public.plan_limits
      ADD COLUMN voice_answers integer CHECK (voice_answers IS NULL OR voice_answers >= 0);
    UPDATE public.plan_limits SET voice_answers = 10 WHERE plan = 'free';
  END IF;
END $$;


-- ─── 2. Which plan a family is on now ───────────────────────────────────────
-- Plus while its plan is paid up (039), Free otherwise and with no plan.
CREATE OR REPLACE FUNCTION public.family_plan_now(p_family_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT coalesce((SELECT fp.plan FROM public.family_plans fp
                    WHERE fp.family_id = p_family_id AND fp.paid_until > now()), 'free');
$fn$;
REVOKE ALL ON FUNCTION public.family_plan_now(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_plan_now(uuid) TO service_role;


-- ─── 3. Members: no more than the plan allows ───────────────────────────────
CREATE OR REPLACE FUNCTION public.family_members_within_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_family  text;
  v_max     integer;
  v_members integer;
BEGIN
  -- One membership at a time per family, so two people accepting at once
  -- cannot both take the last place.
  SELECT f.name INTO v_family FROM public.families f WHERE f.id = NEW.family_id FOR UPDATE;
  SELECT pl.max_members INTO v_max FROM public.plan_limits pl WHERE pl.plan = public.family_plan_now(NEW.family_id);
  SELECT count(*) INTO v_members FROM public.family_members m WHERE m.family_id = NEW.family_id;
  IF v_members >= v_max THEN
    RAISE EXCEPTION '% is full: a family can have % members. Ask its admin to make room, then accept again.',
                    v_family, v_max
      USING ERRCODE = 'P0001', HINT = 'family_full';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.family_members_within_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS family_members_within_limit ON public.family_members;
CREATE TRIGGER family_members_within_limit
  BEFORE INSERT ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_members_within_limit();


-- ─── 4. An invitation holds a place ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.family_invites_within_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_family  text;
  v_max     integer;
  v_members integer;
  v_waiting integer;
BEGIN
  -- Asked already: the invitation is kept as it is (or pointed at a tree
  -- entry, 037), not added, so it takes no new place.
  IF EXISTS (SELECT 1 FROM public.family_invites i
              WHERE i.family_id = NEW.family_id AND i.user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  SELECT f.name INTO v_family FROM public.families f WHERE f.id = NEW.family_id FOR UPDATE;
  SELECT pl.max_members INTO v_max FROM public.plan_limits pl WHERE pl.plan = public.family_plan_now(NEW.family_id);
  SELECT count(*) INTO v_members FROM public.family_members m WHERE m.family_id = NEW.family_id;
  SELECT count(*) INTO v_waiting FROM public.family_invites i WHERE i.family_id = NEW.family_id;
  IF v_members + v_waiting >= v_max THEN
    RAISE EXCEPTION '% is full: a family can have % members, and it has %. To invite someone else, %. Anyone can still be added to the family tree, without an account.',
                    v_family, v_max,
                    CASE WHEN v_waiting = 0 THEN v_members::text
                         ELSE format('%s %s and %s %s waiting',
                                     v_members, CASE v_members WHEN 1 THEN 'member' ELSE 'members' END,
                                     v_waiting, CASE v_waiting WHEN 1 THEN 'invitation' ELSE 'invitations' END) END,
                    CASE WHEN v_waiting = 0 THEN 'remove a member'
                         ELSE 'withdraw an invitation or remove a member' END
      USING ERRCODE = 'P0001', HINT = 'family_full';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.family_invites_within_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS family_invites_within_limit ON public.family_invites;
CREATE TRIGGER family_invites_within_limit
  BEFORE INSERT ON public.family_invites
  FOR EACH ROW EXECUTE FUNCTION public.family_invites_within_limit();


-- ─── 5. Answers read aloud: counted per family ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_usage (
  family_id     uuid PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
  voice_answers integer NOT NULL DEFAULT 0 CHECK (voice_answers >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- The server's own count: no client reads or writes it.
ALTER TABLE public.family_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_usage FROM PUBLIC, anon, authenticated;

-- One answer to read aloud: yes, counting it, while the family's plan has
-- some left (or no limit); no once they are used. Any member may ask, for
-- their own family only.
CREATE OR REPLACE FUNCTION public.claim_voice_answer(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);

  SELECT pl.voice_answers INTO v_limit FROM public.plan_limits pl WHERE pl.plan = public.family_plan_now(p_family_id);
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'limit', NULL, 'used', NULL);
  END IF;

  INSERT INTO public.family_usage (family_id) VALUES (p_family_id) ON CONFLICT (family_id) DO NOTHING;
  -- Counted only while some are left, in one statement, so two answers at
  -- once cannot both take the last one.
  UPDATE public.family_usage SET voice_answers = voice_answers + 1, updated_at = now()
   WHERE family_id = p_family_id AND voice_answers < v_limit
  RETURNING voice_answers INTO v_used;
  IF FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'limit', v_limit, 'used', v_used);
  END IF;

  SELECT u.voice_answers INTO v_used FROM public.family_usage u WHERE u.family_id = p_family_id;
  RETURN jsonb_build_object('allowed', false, 'limit', v_limit, 'used', v_used);
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_voice_answer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_voice_answer(uuid) TO authenticated, service_role;

COMMIT;
