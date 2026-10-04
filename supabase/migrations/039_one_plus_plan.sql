-- ============================================================================
-- 039: One Family Plus plan
--
-- 038 had two Plus plans, 5 GB monthly and 10 GB yearly. Now there is one,
-- paid by the month:
--
--   Free           1 GB, in total — not a monthly allowance
--   Family Plus   10 GB, ₹100 a month in India, $10 a month elsewhere
--
-- How a family pays no longer changes what it may keep, so plan_limits has
-- one row per plan and family_plans no longer records a period: paid_until
-- says how long a plan lasts. Prices are not kept here — what is charged is
-- the payment company's plan; the app only shows the price.
--
-- family_storage_status() loses its period column and set_family_plan() its
-- p_period argument. Plus by hand, for a month:
--
--   select set_family_plan('<family id>', now() + interval '1 month');
--
-- Apply after 038: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows) on both. Idempotent: the reshaping runs once,
-- while plan_limits still has 038's period column; after that the file only
-- restates the functions and grants. A plan given under 038 stays, at 10 GB.
-- ============================================================================

BEGIN;

-- ─── 1. One limit per plan ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'plan_limits' AND column_name = 'period') THEN
    ALTER TABLE public.family_plans DROP CONSTRAINT IF EXISTS family_plans_limits;
    DELETE FROM public.plan_limits WHERE plan = 'plus' AND period <> 'monthly';
    ALTER TABLE public.plan_limits DROP CONSTRAINT IF EXISTS plan_limits_free_has_no_period;
    ALTER TABLE public.plan_limits DROP CONSTRAINT IF EXISTS plan_limits_pkey;
    ALTER TABLE public.plan_limits DROP COLUMN period;
    ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_pkey PRIMARY KEY (plan);
    UPDATE public.plan_limits SET storage_bytes = 10::bigint * 1024 * 1024 * 1024 WHERE plan = 'plus';
    ALTER TABLE public.family_plans DROP COLUMN IF EXISTS period;
  END IF;
END $$;

INSERT INTO public.plan_limits (plan, storage_bytes) VALUES
  ('free',  1::bigint * 1024 * 1024 * 1024),
  ('plus', 10::bigint * 1024 * 1024 * 1024)
ON CONFLICT (plan) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'family_plans_plan' AND conrelid = 'public.family_plans'::regclass) THEN
    ALTER TABLE public.family_plans
      ADD CONSTRAINT family_plans_plan FOREIGN KEY (plan) REFERENCES public.plan_limits (plan);
  END IF;
END $$;

-- The family sees its plan; the payment reference stays with the server.
REVOKE ALL ON public.family_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT (family_id, plan, paid_until, updated_at) ON public.family_plans TO authenticated;


-- ─── 2. A family's plan, its limit, and what its files add up to ────────────
-- 038's, without the period. Its result changes shape, so it is dropped and
-- made again; nothing depends on it but family_storage_has_room(), below.
DROP FUNCTION IF EXISTS public.family_storage_status(uuid);
CREATE FUNCTION public.family_storage_status(p_family_id uuid)
RETURNS TABLE (plan text, paid_until timestamptz, limit_bytes bigint, used_bytes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ns    text;
  v_plan  text;
  v_until timestamptz;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);

  SELECT f.storage_namespace INTO v_ns FROM public.families f WHERE f.id = p_family_id;
  IF v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RETURN;
  END IF;

  SELECT fp.plan, fp.paid_until INTO v_plan, v_until
    FROM public.family_plans fp
   WHERE fp.family_id = p_family_id AND fp.paid_until > now();
  IF NOT FOUND THEN
    v_plan := 'free'; v_until := NULL;
  END IF;

  RETURN QUERY
  SELECT v_plan, v_until,
         (SELECT pl.storage_bytes FROM public.plan_limits pl WHERE pl.plan = v_plan),
         -- A size that is not a whole number is skipped, not cast: one odd
         -- row must not make every upload of the family fail.
         (SELECT coalesce(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$'
                                   THEN (o.metadata->>'size')::bigint END), 0)::bigint
            FROM storage.objects o
           WHERE o.bucket_id = 'documents'
             AND o.name LIKE replace(v_ns, '_', '\_') || '/%');
END;
$fn$;

-- Unchanged from 038; restated so every connection compiles it afresh
-- against the new family_storage_status().
CREATE OR REPLACE FUNCTION public.family_storage_has_room(p_folder text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_family uuid;
  r        record;
BEGIN
  SELECT f.id INTO v_family
    FROM public.families f
    JOIN public.family_members m ON m.family_id = f.id AND m.user_id = auth.uid()
   WHERE f.storage_namespace = p_folder;
  IF v_family IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO r FROM public.family_storage_status(v_family);
  RETURN coalesce(r.used_bytes < r.limit_bytes, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.family_storage_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.family_storage_has_room(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_storage_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.family_storage_has_room(text) TO authenticated, service_role;


-- ─── 3. Giving a family Plus — by hand now, from the payment webhook later ──
-- Service role only. A new or lapsed plan tells the family; a renewal is
-- quiet. To end one at once (a refund): end_family_plan() since 040 (a
-- deleted row would skip 040's countdown and keep the family's files).
DROP FUNCTION IF EXISTS public.set_family_plan(uuid, text, timestamptz, text, text);
CREATE OR REPLACE FUNCTION public.set_family_plan(
  p_family_id  uuid,
  p_paid_until timestamptz,
  p_source     text DEFAULT 'manual',
  p_source_ref text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_family text;
  v_was    timestamptz;
  v_limit  bigint;
BEGIN
  IF p_paid_until IS NULL OR p_paid_until <= now() THEN
    RAISE EXCEPTION 'paid_until must be in the future.' USING ERRCODE = '22023';
  END IF;
  SELECT f.name INTO v_family FROM public.families f WHERE f.id = p_family_id;
  IF v_family IS NULL THEN
    RAISE EXCEPTION 'No such family.' USING ERRCODE = '22023';
  END IF;

  SELECT fp.paid_until INTO v_was FROM public.family_plans fp WHERE fp.family_id = p_family_id;

  INSERT INTO public.family_plans (family_id, plan, paid_until, source, source_ref, updated_at)
  VALUES (p_family_id, 'plus', p_paid_until, coalesce(p_source, 'manual'), p_source_ref, now())
  ON CONFLICT (family_id) DO UPDATE
     SET paid_until = EXCLUDED.paid_until, source = EXCLUDED.source,
         source_ref = EXCLUDED.source_ref, updated_at = now();

  IF v_was IS NULL OR v_was <= now() THEN
    SELECT pl.storage_bytes INTO v_limit FROM public.plan_limits pl WHERE pl.plan = 'plus';
    INSERT INTO public.notifications (user_id, family_id, type, title, message)
    SELECT fm.user_id, p_family_id, 'plan',
           left(format('%s has Family Plus', v_family), 200),
           format('Room for %s GB of documents, until %s.',
                  trim_scale(round(v_limit / 1073741824.0, 1))::text,
                  to_char(p_paid_until AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY'))
      FROM public.family_members fm
     WHERE fm.family_id = p_family_id;
  END IF;

  INSERT INTO public.audit_logs (family_id, action, resource_type, resource_id)
  VALUES (p_family_id, 'set_family_plan', 'family', p_family_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_family_plan(uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_family_plan(uuid, timestamptz, text, text) TO service_role;

COMMIT;
