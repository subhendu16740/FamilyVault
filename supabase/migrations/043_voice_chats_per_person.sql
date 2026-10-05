-- ============================================================================
-- 043: Voice chats are counted per person, not per family
--
-- 041 gave a free family 10 voice chats to share — a question asked by voice
-- or an answer read aloud, one per question. Now each person in a free
-- family has their own 10 (plan_limits.voice_answers is per person), so a
-- family of four can have up to 40, and nobody's use takes from anyone
-- else's. Family Plus still has no limit (NULL).
--
--   member_usage     one row per person per family: how many voice chats
--                    they have had there. Kept when they leave, so leaving
--                    and being asked back does not start them again; it
--                    goes with the family, or with their account.
--   claim_voice_answer()   unchanged in name and answer, now counts for the
--                    person asking (auth.uid()), in their own family only.
--   family_voice_status()  likewise: how many the person asking has left.
--
-- Everyone starts again from 10: 041 counted for the whole family, and who
-- used those cannot be told, so family_usage is dropped rather than shared
-- out.
--
-- Apply after 042: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows). Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. Each person's count, in each family ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_usage (
  family_id     uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_answers integer NOT NULL DEFAULT 0 CHECK (voice_answers >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);
-- The server's own count: no client reads or writes it.
ALTER TABLE public.member_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_usage FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.plan_limits.voice_answers IS
  'Voice chats each person in a family on this plan may have (043; per family before): a question asked by voice or an answer read aloud, one per question. NULL: no limit.';


-- ─── 2. One voice chat, for the person asking ───────────────────────────────
-- Yes, counting it, while they have some left (or the plan has no limit); no
-- once theirs are used. Any member, for their own family only.
CREATE OR REPLACE FUNCTION public.claim_voice_answer(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me    uuid := auth.uid();
  v_limit integer;
  v_used  integer;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Voice chats are counted for a person who is signed in'
      USING ERRCODE = '42501';
  END IF;

  SELECT pl.voice_answers INTO v_limit FROM public.plan_limits pl WHERE pl.plan = public.family_plan_now(p_family_id);
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'limit', NULL, 'used', NULL);
  END IF;

  INSERT INTO public.member_usage (family_id, user_id) VALUES (p_family_id, v_me)
  ON CONFLICT (family_id, user_id) DO NOTHING;
  -- Counted only while some are left, in one statement, so two answers at
  -- once cannot both take the last one.
  UPDATE public.member_usage SET voice_answers = voice_answers + 1, updated_at = now()
   WHERE family_id = p_family_id AND user_id = v_me AND voice_answers < v_limit
  RETURNING voice_answers INTO v_used;
  IF FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'limit', v_limit, 'used', v_used);
  END IF;

  SELECT u.voice_answers INTO v_used FROM public.member_usage u
   WHERE u.family_id = p_family_id AND u.user_id = v_me;
  RETURN jsonb_build_object('allowed', false, 'limit', v_limit, 'used', v_used);
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_voice_answer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_voice_answer(uuid) TO authenticated, service_role;


-- ─── 3. How many the person asking has left ─────────────────────────────────
-- What claim_voice_answer() would say, without using one: limit, used and
-- left, all NULL on a plan with no limit.
CREATE OR REPLACE FUNCTION public.family_voice_status(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me    uuid := auth.uid();
  v_limit integer;
  v_used  integer;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Voice chats are counted for a person who is signed in'
      USING ERRCODE = '42501';
  END IF;

  SELECT pl.voice_answers INTO v_limit FROM public.plan_limits pl WHERE pl.plan = public.family_plan_now(p_family_id);
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('limit', NULL, 'used', NULL, 'left', NULL);
  END IF;
  v_used := coalesce((SELECT u.voice_answers FROM public.member_usage u
                       WHERE u.family_id = p_family_id AND u.user_id = v_me), 0);
  RETURN jsonb_build_object('limit', v_limit, 'used', v_used, 'left', greatest(v_limit - v_used, 0));
END;
$fn$;
REVOKE ALL ON FUNCTION public.family_voice_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_voice_status(uuid) TO authenticated, service_role;


-- ─── 4. The family-wide count is gone ───────────────────────────────────────
DROP TABLE IF EXISTS public.family_usage;

COMMIT;
