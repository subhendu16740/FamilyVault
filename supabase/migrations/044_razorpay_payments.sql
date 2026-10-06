-- ============================================================================
-- 044: Paying for Family Plus with Razorpay
--
-- A family pays for a month (₹100) or a year (₹1,100) at a time, by UPI,
-- card or net banking, and each payment adds that time to its Family Plus:
-- from the end of the time already paid for, or from now. Nothing renews by
-- itself, so nothing is charged without someone paying.
--
--   plan_payments        every Razorpay order the app makes, and the payment
--                        that paid it. Service role only: the payments Edge
--                        Function writes it, and no client reads it.
--   apply_plan_payment() adds the order's month or year to the family's
--                        plan, once: the app (after the checkout) and
--                        Razorpay's webhook (payment.captured / order.paid)
--                        both report a payment, and whichever comes second
--                        changes nothing. Service role only.
--
-- The price is never the client's to say: the payments function takes it
-- from PLUS_PRICE (supabase/functions/_shared/plan-text.ts), keeps it here
-- with the order, and checks the payment against it before calling this.
--
-- A refund is by hand, in the Razorpay dashboard, and then
-- select end_family_plan('<family id>');  (040) if the plan should end.
--
-- Apply after 043: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows). Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. Every order, and what paid it ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_payments (
  order_id   text PRIMARY KEY CHECK (order_id ~ '^order_[A-Za-z0-9]{6,40}$'),
  family_id  uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,     -- who paid
  period     text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  currency   text NOT NULL CHECK (currency IN ('INR', 'USD')),
  amount     integer NOT NULL CHECK (amount > 0),                   -- paise or cents
  status     text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid')),
  payment_id text UNIQUE CHECK (payment_id IS NULL OR payment_id ~ '^pay_[A-Za-z0-9]{6,40}$'),
  paid_at    timestamptz,
  paid_until timestamptz,                                           -- what this payment made it
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_payments_paid_has_payment CHECK ((status = 'paid') = (payment_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS plan_payments_family_idx ON public.plan_payments (family_id, created_at DESC);

ALTER TABLE public.plan_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_payments FROM PUBLIC, anon, authenticated;


-- ─── 2. A payment adds its month or year, once ──────────────────────────────
-- Returns the family's paid_until after it.
CREATE OR REPLACE FUNCTION public.apply_plan_payment(p_order_id text, p_payment_id text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r       public.plan_payments%ROWTYPE;
  v_from  timestamptz;
  v_until timestamptz;
BEGIN
  IF p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]{6,40}$' THEN
    RAISE EXCEPTION 'Not a Razorpay payment id.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.plan_payments WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such order.' USING ERRCODE = '22023';
  END IF;
  IF r.status = 'paid' THEN
    -- Reported again (the app and the webhook both say so): counted once.
    RETURN r.paid_until;
  END IF;

  -- One payment at a time per family, so two paid at the same moment add up
  -- rather than both starting from the same date.
  PERFORM 1 FROM public.families f WHERE f.id = r.family_id FOR UPDATE;

  -- Paid time adds on: from the end of the time already paid for, or from now.
  SELECT greatest(now(), coalesce(max(fp.paid_until), now())) INTO v_from
    FROM public.family_plans fp WHERE fp.family_id = r.family_id;
  v_until := v_from + CASE r.period WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END;

  PERFORM public.set_family_plan(r.family_id, v_until, 'razorpay', p_payment_id);
  UPDATE public.plan_payments
     SET status = 'paid', payment_id = p_payment_id, paid_at = now(), paid_until = v_until
   WHERE order_id = p_order_id;
  RETURN v_until;
END;
$fn$;
REVOKE ALL ON FUNCTION public.apply_plan_payment(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_payment(text, text) TO service_role;

COMMIT;
