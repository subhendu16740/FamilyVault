-- ============================================================================
-- 038: Family Plus, and a storage limit on every plan
--
-- What a family may keep, by plan — never unlimited:
--
--   Free                    1 GB
--   Family Plus, monthly    5 GB
--   Family Plus, yearly    10 GB
--
-- The numbers live in plan_limits, one row per plan, so they can change
-- without a migration (Table editor › plan_limits; anyone may read them, the
-- pricing page included). A family is on Plus while its family_plans row is
-- paid up (paid_until is in the future); otherwise, and with no row at all,
-- it is on Free. There is no payment yet: Plus is given by hand from the SQL
-- editor with set_family_plan(), and the payment webhook will call the same
-- function. Members read their own family's plan; nobody else writes it.
--
-- The limit is kept by the server, not the app. The documents bucket's
-- upload policy refuses a new file once the family's files add up to its
-- limit. A policy cannot see the size of the file being uploaded, so the
-- last file may take a family past its limit by that one file (the bucket
-- refuses files over 50 MB); the app checks first, with the file's size, and
-- says why. Gmail import uploads as the service role, which passes no
-- policy, so it asks family_storage_status() before it stores anything.
--
-- Used space is what the family's folder in the bucket holds — the files
-- themselves, as the policy counts them — so the app, the policy and Gmail
-- import all agree.
--
-- When Plus ends, nothing is deleted: the family keeps every document, reads
-- and searches them, and only cannot add more while it is over the free
-- limit.
--
-- Apply: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent. Needs 019 (the bucket's policies) and 023.
-- ============================================================================

BEGIN;

-- ─── 1. The plans, and what each may keep ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan          text NOT NULL CHECK (plan IN ('free', 'plus')),
  period        text NOT NULL CHECK (period IN ('none', 'monthly', 'yearly')),
  storage_bytes bigint NOT NULL CHECK (storage_bytes > 0),
  PRIMARY KEY (plan, period),
  CONSTRAINT plan_limits_free_has_no_period CHECK ((plan = 'free') = (period = 'none'))
);
INSERT INTO public.plan_limits (plan, period, storage_bytes) VALUES
  ('free', 'none',     1::bigint * 1024 * 1024 * 1024),
  ('plus', 'monthly',  5::bigint * 1024 * 1024 * 1024),
  ('plus', 'yearly',  10::bigint * 1024 * 1024 * 1024)
ON CONFLICT (plan, period) DO NOTHING;

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plan_limits TO anon, authenticated;
DROP POLICY IF EXISTS plan_limits_read ON public.plan_limits;
CREATE POLICY plan_limits_read ON public.plan_limits
  FOR SELECT TO anon, authenticated
  USING (true);


-- ─── 2. Which family is on Plus, and until when ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_plans (
  family_id  uuid PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
  plan       text NOT NULL DEFAULT 'plus' CHECK (plan = 'plus'),
  period     text NOT NULL,
  paid_until timestamptz NOT NULL,
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'razorpay', 'dodo')),
  source_ref text CHECK (length(source_ref) <= 200),        -- the payment company's subscription id
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_plans_limits FOREIGN KEY (plan, period) REFERENCES public.plan_limits (plan, period)
);

ALTER TABLE public.family_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_plans FROM PUBLIC, anon, authenticated;
-- The family sees its plan; the payment reference stays with the server.
GRANT SELECT (family_id, plan, period, paid_until, updated_at) ON public.family_plans TO authenticated;
DROP POLICY IF EXISTS family_plans_select_family ON public.family_plans;
CREATE POLICY family_plans_select_family ON public.family_plans
  FOR SELECT TO authenticated
  USING (family_id IN (SELECT public.get_my_family_ids()));


-- ─── 3. A family's plan, its limit, and what its files add up to ────────────
-- For a member, or the server (assert_caller_in_family lets the service role
-- through): Settings › Storage, the upload check, and Gmail import.
CREATE OR REPLACE FUNCTION public.family_storage_status(p_family_id uuid)
RETURNS TABLE (plan text, period text, paid_until timestamptz, limit_bytes bigint, used_bytes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ns     text;
  v_plan   text;
  v_period text;
  v_until  timestamptz;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);

  SELECT f.storage_namespace INTO v_ns FROM public.families f WHERE f.id = p_family_id;
  IF v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RETURN;
  END IF;

  SELECT fp.plan, fp.period, fp.paid_until INTO v_plan, v_period, v_until
    FROM public.family_plans fp
   WHERE fp.family_id = p_family_id AND fp.paid_until > now();
  IF NOT FOUND THEN
    v_plan := 'free'; v_period := 'none'; v_until := NULL;
  END IF;

  RETURN QUERY
  SELECT v_plan, v_period, v_until,
         (SELECT pl.storage_bytes FROM public.plan_limits pl WHERE pl.plan = v_plan AND pl.period = v_period),
         -- A size that is not a whole number is skipped, not cast: one odd
         -- row must not make every upload of the family fail.
         (SELECT coalesce(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$'
                                   THEN (o.metadata->>'size')::bigint END), 0)::bigint
            FROM storage.objects o
           WHERE o.bucket_id = 'documents'
             AND o.name LIKE replace(v_ns, '_', '\_') || '/%');
END;
$fn$;

-- The bucket's upload policy asks this: is there room for another file in the
-- family that owns this folder? False for a family the caller is not in, and
-- false when the limit cannot be read — refusing is the safe direction.
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


-- ─── 4. Uploads stop at the limit ───────────────────────────────────────────
-- 019's policy, with the room check added.
DROP POLICY IF EXISTS "upload own family documents" ON storage.objects;
CREATE POLICY "upload own family documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT f.storage_namespace
      FROM public.families f
      WHERE f.id IN (SELECT public.get_my_family_ids())
    )
    AND public.family_storage_has_room((storage.foldername(name))[1])
  );


-- ─── 5. Giving a family Plus — by hand now, from the payment webhook later ──
-- Service role only. A new or lapsed plan tells the family; a renewal is
-- quiet. To end one at once (a refund): delete the family's family_plans row.
CREATE OR REPLACE FUNCTION public.set_family_plan(
  p_family_id  uuid,
  p_period     text,
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
  IF p_period IS NULL OR p_period NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'Family Plus is monthly or yearly.' USING ERRCODE = '22023';
  END IF;
  IF p_paid_until IS NULL OR p_paid_until <= now() THEN
    RAISE EXCEPTION 'paid_until must be in the future.' USING ERRCODE = '22023';
  END IF;
  SELECT f.name INTO v_family FROM public.families f WHERE f.id = p_family_id;
  IF v_family IS NULL THEN
    RAISE EXCEPTION 'No such family.' USING ERRCODE = '22023';
  END IF;

  SELECT fp.paid_until INTO v_was FROM public.family_plans fp WHERE fp.family_id = p_family_id;

  INSERT INTO public.family_plans (family_id, plan, period, paid_until, source, source_ref, updated_at)
  VALUES (p_family_id, 'plus', p_period, p_paid_until, coalesce(p_source, 'manual'), p_source_ref, now())
  ON CONFLICT (family_id) DO UPDATE
     SET period = EXCLUDED.period, paid_until = EXCLUDED.paid_until,
         source = EXCLUDED.source, source_ref = EXCLUDED.source_ref, updated_at = now();

  IF v_was IS NULL OR v_was <= now() THEN
    SELECT pl.storage_bytes INTO v_limit FROM public.plan_limits pl WHERE pl.plan = 'plus' AND pl.period = p_period;
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

REVOKE ALL ON FUNCTION public.set_family_plan(uuid, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_family_plan(uuid, text, timestamptz, text, text) TO service_role;

COMMIT;
