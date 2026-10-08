-- ============================================================================
-- 049: What Family Plus adds — questions without a monthly limit, up to 8
--      members, and share links that last 30 days
--
-- A question is the most expensive thing AskLocker does: the AI reads about
-- 9,000 tokens to answer one, and its free allowance is about 25 questions a
-- day for everyone. Until now a free family could ask without end, so a few
-- busy free families could use it up for everyone, paying families included.
--
--   Questions     Free: 20 a month for each person. Family Plus: no monthly
--                 limit, with a fair-use ceiling of 500 a month for each
--                 person, which nobody reaches in normal use and which keeps
--                 one account from costing more than a family pays.
--   Members       Free: 4, as before. Family Plus: up to 8 who sign in, for
--                 joint families. Nobody is removed when Plus ends (041):
--                 a family above 4 keeps everyone and invites again once
--                 it is below.
--   Share links   Free: 1 or 7 days. Family Plus: 30 days as well. Links made
--                 before stay as they are.
--
--   • plan_limits gains questions_per_month (each person, a calendar month
--     in India time; NULL: no monthly limit) and questions_fair_use (the
--     ceiling where questions_per_month is NULL). Free 20; Plus NULL and
--     500. Numbers to change in the Table editor, like the rest.
--   • A person is on Plus for questions when any vault they are in — a
--     family or their personal vault — is on Family Plus: everyone in a Plus
--     family asks without a limit, in every vault they ask in.
--   • question_usage counts each person's questions, month by month. The
--     server's own: no client reads or writes it.
--   • claim_question(user) counts one before an answer is written, in one
--     statement, so two questions at once cannot both take the last one;
--     release_question(user) gives it back when no answer came (nothing
--     found, the AI service busy). Both take a user id, so both are service
--     role only: rag-search calls them with the caller from the session.
--   • question_status() is the person asking's own count, for Ask and
--     Settings to show: the caller from auth.uid().
--   • plan_limits.max_members for Plus goes from 4 to 8, where it is still 4.
--   • create_document_share() refuses a 30-day link for a vault on Free
--     (HINT plus_only); 1 and 7 days stay for everyone.
--
-- rag-search asks claim_question() and, where 049 is not applied, finds no
-- function and answers as before: no limit. An older rag-search counts
-- nothing. An older app shows the limit's answer as an answer.
--
-- Apply after 048: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows). Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. The limits ─────────────────────────────────────────────────────────
-- Added once, with Free's 20; applying 049 again changes no number someone
-- has since set in the Table editor.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'plan_limits' AND column_name = 'questions_per_month') THEN
    ALTER TABLE public.plan_limits
      ADD COLUMN questions_per_month integer CHECK (questions_per_month IS NULL OR questions_per_month > 0);
    UPDATE public.plan_limits SET questions_per_month = 20 WHERE plan = 'free';
  END IF;
END
$do$;
ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS questions_fair_use integer NOT NULL DEFAULT 500 CHECK (questions_fair_use > 0);

COMMENT ON COLUMN public.plan_limits.questions_per_month IS
  'Questions each person may ask in a calendar month (India time) on this plan (049). NULL: no monthly limit, up to questions_fair_use.';
COMMENT ON COLUMN public.plan_limits.questions_fair_use IS
  'The most questions one person may ask in a month where questions_per_month is NULL (049): fair use, which nobody reaches in normal use.';

-- Family Plus: up to 8 members. Only where it is still 041's 4, so a number
-- set since is kept.
UPDATE public.plan_limits SET max_members = 8 WHERE plan = 'plus' AND max_members = 4;


-- ─── 2. Each person's count, month by month ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.question_usage (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month      date NOT NULL,
  questions  integer NOT NULL DEFAULT 0 CHECK (questions >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);
-- The server's own count: no client reads or writes it.
ALTER TABLE public.question_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.question_usage TO service_role;


-- ─── 3. Helpers: this month, and whether a person is on Plus ────────────────
-- The month questions are counted in: the first day of it, in India time.
CREATE OR REPLACE FUNCTION public.question_month()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date;
$fn$;

-- Is any vault this person is in — a family or their personal vault — on
-- Family Plus? Takes a user id, so it is the server's alone.
CREATE OR REPLACE FUNCTION public.person_on_plus(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members m
     WHERE m.user_id = p_user_id AND public.family_plan_now(m.family_id) = 'plus'
  );
$fn$;

-- What the plan allows this person: its monthly number (NULL: none), and the
-- ceiling actually kept (the monthly number, or fair use where there is none).
CREATE OR REPLACE FUNCTION public.question_allowance(p_user_id uuid)
RETURNS TABLE (plus boolean, monthly integer, ceiling integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_plus boolean := public.person_on_plus(p_user_id);
BEGIN
  RETURN QUERY
  SELECT v_plus, pl.questions_per_month, coalesce(pl.questions_per_month, pl.questions_fair_use)
    FROM public.plan_limits pl
   WHERE pl.plan = CASE WHEN v_plus THEN 'plus' ELSE 'free' END;
END;
$fn$;


-- ─── 4. One question, for the person asking ────────────────────────────────
-- Yes, counting it, while they have some left this month; no once they are
-- used. Service role only: rag-search passes the caller from the session.
CREATE OR REPLACE FUNCTION public.claim_question(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_month   date := public.question_month();
  v_plus    boolean;
  v_monthly integer;
  v_ceiling integer;
  v_used    integer;
  v_next    date := (public.question_month() + interval '1 month')::date;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Questions are counted for a person who is signed in' USING ERRCODE = '42501';
  END IF;
  SELECT a.plus, a.monthly, a.ceiling INTO v_plus, v_monthly, v_ceiling FROM public.question_allowance(p_user_id) a;

  INSERT INTO public.question_usage (user_id, month) VALUES (p_user_id, v_month)
  ON CONFLICT (user_id, month) DO NOTHING;
  -- Counted only while some are left, in one statement, so two questions at
  -- once cannot both take the last one. No ceiling at all (a plan row
  -- without one) counts and allows.
  UPDATE public.question_usage SET questions = questions + 1, updated_at = now()
   WHERE user_id = p_user_id AND month = v_month AND (v_ceiling IS NULL OR questions < v_ceiling)
  RETURNING questions INTO v_used;
  IF FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_monthly, 'ceiling', v_ceiling,
                              'plus', coalesce(v_plus, false), 'resets_on', v_next);
  END IF;

  SELECT u.questions INTO v_used FROM public.question_usage u WHERE u.user_id = p_user_id AND u.month = v_month;
  RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_monthly, 'ceiling', v_ceiling,
                            'plus', coalesce(v_plus, false), 'resets_on', v_next);
END;
$fn$;

-- No answer came of it (nothing found, the AI service busy): the question
-- is given back. Service role only, like claim_question().
CREATE OR REPLACE FUNCTION public.release_question(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE public.question_usage SET questions = questions - 1, updated_at = now()
   WHERE user_id = p_user_id AND month = public.question_month() AND questions > 0;
$fn$;


-- ─── 5. How many the person asking has left ────────────────────────────────
-- What claim_question() would say, without using one: limit (NULL on a plan
-- with no monthly limit), used, left (of the ceiling actually kept), whether
-- they are on Plus, and the day the count starts again.
CREATE OR REPLACE FUNCTION public.question_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me      uuid := auth.uid();
  v_plus    boolean;
  v_monthly integer;
  v_ceiling integer;
  v_used    integer;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Questions are counted for a person who is signed in' USING ERRCODE = '42501';
  END IF;
  SELECT a.plus, a.monthly, a.ceiling INTO v_plus, v_monthly, v_ceiling FROM public.question_allowance(v_me) a;
  v_used := coalesce((SELECT u.questions FROM public.question_usage u
                       WHERE u.user_id = v_me AND u.month = public.question_month()), 0);
  RETURN jsonb_build_object(
    'limit', v_monthly,
    'ceiling', v_ceiling,
    'used', v_used,
    'left', CASE WHEN v_ceiling IS NULL THEN NULL ELSE greatest(v_ceiling - v_used, 0) END,
    'plus', coalesce(v_plus, false),
    'resets_on', (public.question_month() + interval '1 month')::date
  );
END;
$fn$;


-- ─── 6. A 30-day share link is part of Family Plus ─────────────────────────
-- 036's function, unchanged but for the plan check after the days check.
CREATE OR REPLACE FUNCTION public.create_document_share(
  p_family_id uuid, p_document_id uuid, p_days integer, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me      uuid := auth.uid();
  v_role    text;
  v_ns      text;
  v_doc     record;
  v_mine    uuid;
  v_owner   uuid;
  v_token   text;
  v_id      uuid;
  v_expires timestamptz;
  v_note    text := nullif(left(btrim(coalesce(p_note, '')), 80), '');
  v_by      text;
BEGIN
  SELECT role INTO v_role FROM public.family_members WHERE family_id = p_family_id AND user_id = v_me;
  IF v_me IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Not allowed: you are not a member of this family' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT IN (1, 7, 30) THEN
    RAISE EXCEPTION 'A link lasts 1, 7 or 30 days.' USING ERRCODE = '22023';
  END IF;
  IF p_days = 30 AND public.family_plan_now(p_family_id) <> 'plus' THEN
    RAISE EXCEPTION 'A link that lasts 30 days is part of Family Plus. On Free a link lasts 1 or 7 days.'
      USING ERRCODE = 'P0001', HINT = 'plus_only';
  END IF;

  SELECT storage_namespace INTO v_ns FROM public.families WHERE id = p_family_id;
  IF v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'That document is not in this family.' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT id, file_name, uploaded_by, belongs_to_member FROM %I.documents WHERE id = $1 AND NOT is_deleted', v_ns)
     INTO v_doc USING p_document_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'That document is not in this family.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_mine FROM public.family_people WHERE family_id = p_family_id AND user_id = v_me;
  IF NOT (v_role = 'admin' OR v_doc.uploaded_by = v_me
          OR (v_doc.belongs_to_member IS NOT NULL AND v_mine IS NOT NULL AND v_doc.belongs_to_member = v_mine)) THEN
    RAISE EXCEPTION 'Only a family admin, whoever added this document, or the person it belongs to can share it.'
      USING ERRCODE = '42501';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(days => p_days);
  INSERT INTO public.document_shares (family_id, document_id, token_hash, created_by, note, expires_at)
  VALUES (p_family_id, p_document_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_me, v_note, v_expires)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, p_family_id, 'share_document', 'document', p_document_id);

  -- The person it belongs to hears of it, unless they made the link themselves.
  SELECT user_id INTO v_owner FROM public.family_people
   WHERE id = v_doc.belongs_to_member AND family_id = p_family_id;
  IF v_owner IS NOT NULL AND v_owner <> v_me THEN
    SELECT display_name INTO v_by FROM public.users WHERE id = v_me;
    INSERT INTO public.notifications (user_id, family_id, type, title, message, document_ref)
    VALUES (
      v_owner, p_family_id, 'share',
      left(format('%s shared %s by link', coalesce(v_by, 'Someone in your family'),
                  regexp_replace(v_doc.file_name, '\.(pdf|jpe?g|png)$', '', 'i')), 200),
      format('Anyone with the link can open it until %s%s. It can be turned off on the document''s page.',
             to_char(v_expires AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY'),
             coalesce(' — for ' || v_note, '')),
      p_document_id
    );
  END IF;

  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
END;
$fn$;


-- ─── 7. Grants ─────────────────────────────────────────────────────────────
-- Functions that take a user id are the server's alone (point 2 of
-- CLAUDE.md); question_status() takes the caller from auth.uid().
REVOKE ALL ON FUNCTION public.question_month() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_on_plus(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.question_allowance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_question(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_question(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.question_month(), public.person_on_plus(uuid), public.question_allowance(uuid),
  public.claim_question(uuid), public.release_question(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.question_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.question_status() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_document_share(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_document_share(uuid, uuid, integer, text) TO authenticated, service_role;

COMMIT;
