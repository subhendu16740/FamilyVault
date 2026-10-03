-- ============================================================================
-- 034: reminders that remind — once per stage, on every device that asks
--
-- Before this, an expiry reminder was made only when someone opened Home
-- (check_expiry_notifications), so nobody was told unless they were already
-- looking — and it was made again every day that someone did, for every
-- document within 90 days of running out. Now:
--
--   • The database's own clock (pg_cron, free on every Supabase plan) runs
--     run_reminders() every hour. From 9 in the morning, India time, it makes
--     each document's reminders for every member of its family: 90, 30 and 7
--     days before it runs out (the thresholds stored with each alert) and on
--     the day. Each goes once — reminders_sent remembers it — so the hourly
--     runs after the first find nothing new.
--   • check_expiry_notifications(), still called when Home opens, now makes
--     the same reminders by the same rule, once, instead of a fresh copy a day.
--   • Notifications go on to phones and computers by Web Push: free, through
--     the browser's own push service, encrypted so that service cannot read
--     them. A device is added in Settings › Notifications
--     (push_subscriptions: the owner's own rows). The push Edge Function sends
--     what is new (notifications.pushed_at) to each of its owner's devices
--     when run_reminders() calls it, between 8 in the morning and 10 at night,
--     India time, so nobody is woken. It makes this project's VAPID keys the
--     first time anyone turns reminders on, and leaves its address here
--     (push_config) for run_reminders() to call it by — nothing to set up by
--     hand.
--
-- Service role only: everything here but your own subscriptions. push_config
-- holds the VAPID private key (it can push to this app's subscribers and
-- nothing else), and push_pending() returns every waiting notification with
-- its devices; neither is reachable by a client. The 023 sweep stays at zero.
--
-- The app works before this is applied: turning reminders on says they are
-- not switched on yet, and Home's check keeps its old behaviour.
--
-- Apply: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent. It switches on two extensions, pg_cron and pg_net, both free.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- ─── 1. Devices: one row per browser that said yes ──────────────────────────
-- An endpoint is one browser's address at its push service. The server only
-- ever posts to the services browsers really use (the same list as
-- isPushServiceEndpoint() in _shared/webpush.ts), never to an address of a
-- client's choosing.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE
               CHECK (length(endpoint) <= 2000
                      AND endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/'),
  p256dh       text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  auth         text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{21,24}={0,2}$'),
  label        text CHECK (length(label) <= 80),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;

DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Saving is the caller's own, from auth.uid(). An endpoint belongs to one
-- browser, so when someone else signs in there it moves to them.
CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on reminders.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  VALUES (v_me, p_endpoint, p_p256dh, p_auth, nullif(left(btrim(coalesce(p_label, '')), 80), ''))
  ON CONFLICT (endpoint) DO UPDATE
     SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         label = excluded.label, created_at = now(), last_used_at = NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated, service_role;


-- ─── 2. What was sent, and what has gone to devices ─────────────────────────

-- One row per reminder sent: a document, its expiry date, the stage (days
-- before; 0 is the day itself). A new expiry date starts afresh.
CREATE TABLE IF NOT EXISTS public.reminders_sent (
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind ~ '^[a-z_]{1,20}$'),
  ref_id    uuid NOT NULL,
  due_on    date NOT NULL,
  stage     integer NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, kind, ref_id, due_on, stage)
);
ALTER TABLE public.reminders_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reminders_sent FROM PUBLIC, anon, authenticated;

-- When a notification went to its owner's devices. Clients may still update
-- only is_read (025).
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
CREATE INDEX IF NOT EXISTS notifications_waiting_push ON public.notifications (created_at) WHERE pushed_at IS NULL;


-- ─── 3. The reminders themselves ────────────────────────────────────────────

-- One family's reminders due today (India time): for each document with an
-- expiry date, the stage it is in — the smallest threshold not yet passed,
-- or 0 from the day itself until three days after — made once, for every
-- member. A document added with 20 days left gets its 30-day reminder, not
-- the 90-day one it is already past; one that ran out long ago gets none.
CREATE OR REPLACE FUNCTION public.queue_family_expiry_reminders(p_family_id uuid, p_today date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_today date := coalesce(p_today, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_ns    text;
  a       record;
  v_days  integer;
  v_stage integer;
  v_when  text;
  v_title text;
  v_body  text;
  v_count integer := 0;
BEGIN
  SELECT storage_namespace INTO v_ns FROM public.families WHERE id = p_family_id;
  IF v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$'
     OR to_regclass(format('%I.expiry_alerts', v_ns)) IS NULL THEN
    RETURN 0;
  END IF;

  FOR a IN EXECUTE format($q$
    SELECT al.document_id, al.expiry_date, al.alert_days_before, d.file_name, p.display_name AS whose
      FROM %1$I.expiry_alerts al
      JOIN %1$I.documents d ON d.id = al.document_id AND NOT d.is_deleted
      LEFT JOIN public.family_people p ON p.id = d.belongs_to_member AND p.family_id = $2
     WHERE al.expiry_date BETWEEN $1 - 3 AND $1 + 366
  $q$, v_ns) USING v_today, p_family_id
  LOOP
    v_days := a.expiry_date - v_today;
    IF v_days <= 0 THEN
      v_stage := 0;
    ELSE
      SELECT min(t) INTO v_stage
        FROM unnest(coalesce(a.alert_days_before, '{90,30,7}'::integer[])) AS t
       WHERE t >= v_days;
      CONTINUE WHEN v_stage IS NULL;          -- further off than the first reminder
    END IF;

    INSERT INTO public.reminders_sent (family_id, kind, ref_id, due_on, stage)
    VALUES (p_family_id, 'expiry', a.document_id, a.expiry_date, v_stage)
    ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;                  -- already sent

    v_when  := to_char(a.expiry_date, 'FMDD Mon YYYY');
    v_title := left(regexp_replace(a.file_name, '\.(pdf|jpe?g|png)$', '', 'i'), 150) || CASE
                 WHEN v_days < 0 THEN ' has expired'
                 WHEN v_days = 0 THEN ' expires today'
                 WHEN v_days = 1 THEN ' expires tomorrow'
                 ELSE format(' expires in %s days', v_days) END;
    v_body  := format('%s on %s', CASE WHEN v_days < 0 THEN 'Expired' ELSE 'Expires' END, v_when)
               || coalesce(' · ' || a.whose, '') || '. '
               || CASE WHEN v_days <= 0 THEN 'Renew it, then add the new one to FamilyVault.'
                       WHEN v_days <= 7 THEN 'Renew it soon.'
                       WHEN v_days <= 30 THEN 'A good time to renew it.'
                       ELSE 'Plenty of time to renew it.' END;

    INSERT INTO public.notifications (user_id, family_id, type, title, message, document_ref)
    SELECT fm.user_id, p_family_id, 'expiry', v_title, v_body, a.document_id
      FROM public.family_members fm
     WHERE fm.family_id = p_family_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

-- Every family, for the clock. One family's trouble never stops the rest.
CREATE OR REPLACE FUNCTION public.queue_expiry_reminders(p_today date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_today date := coalesce(p_today, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_total integer := 0;
  f       record;
BEGIN
  FOR f IN SELECT id FROM public.families ORDER BY created_at LOOP
    BEGIN
      v_total := v_total + public.queue_family_expiry_reminders(f.id, v_today);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reminders for family % failed: %', f.id, SQLERRM;
    END;
  END LOOP;
  -- A stage is only ever looked for until three days after the date.
  DELETE FROM public.reminders_sent WHERE due_on < v_today - 7;
  RETURN v_total;
END;
$fn$;

-- Home still calls this when it opens: the same reminders, by the same rule,
-- once — no longer a fresh copy of each every day.
CREATE OR REPLACE FUNCTION public.check_expiry_notifications(p_family_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);
  RETURN public.queue_family_expiry_reminders(p_family_id);
END;
$fn$;


-- ─── 4. The push function's own ─────────────────────────────────────────────

-- One row: this project's VAPID keys, made by the push function the first
-- time anyone turns reminders on, and the address run_reminders() calls it
-- by. send_lease keeps two sends from running at once.
CREATE TABLE IF NOT EXISTS public.push_config (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  vapid_public  text NOT NULL,
  vapid_private text NOT NULL,
  subject       text NOT NULL,
  functions_url text,
  anon_key      text,
  send_lease    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_config FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_keys()
RETURNS TABLE (public_key text, private_key text, contact text, has_address boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT c.vapid_public, c.vapid_private, c.subject, c.functions_url IS NOT NULL AND c.anon_key IS NOT NULL
    FROM public.push_config c
   WHERE c.id;
$fn$;

-- The first keys win, so two first calls at once agree; the address is kept fresh.
CREATE OR REPLACE FUNCTION public.push_setup(
  p_vapid_public text, p_vapid_private text, p_subject text, p_functions_url text, p_anon_key text
)
RETURNS TABLE (public_key text, private_key text, contact text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.push_config AS c (vapid_public, vapid_private, subject, functions_url, anon_key)
  VALUES (p_vapid_public, p_vapid_private, p_subject, p_functions_url, p_anon_key)
  ON CONFLICT (id) DO UPDATE
     SET functions_url = coalesce(excluded.functions_url, c.functions_url),
         anon_key      = coalesce(excluded.anon_key, c.anon_key),
         updated_at    = now();
  RETURN QUERY SELECT c.vapid_public, c.vapid_private, c.subject FROM public.push_config c WHERE c.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.push_claim_send()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH claimed AS (
    UPDATE public.push_config
       SET send_lease = now()
     WHERE id AND (send_lease IS NULL OR send_lease < now() - interval '50 seconds')
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$fn$;

-- What is waiting for devices: a day's unread notifications of people who
-- have reminders on somewhere and have not switched notifications off, each
-- with every device of its owner. The limit counts notifications, so none is
-- half sent.
CREATE OR REPLACE FUNCTION public.push_pending(p_limit integer DEFAULT 100)
RETURNS TABLE (
  notification_id uuid, kind text, title text, message text, document_ref uuid, family_id uuid,
  subscription_id uuid, endpoint text, p256dh text, auth text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH waiting AS (
    SELECT n.id, n.type, n.title, n.message, n.document_ref, n.family_id, n.user_id, n.created_at
      FROM public.notifications n
      JOIN public.users u ON u.id = n.user_id
     WHERE n.pushed_at IS NULL
       AND n.created_at > now() - interval '1 day'
       AND NOT coalesce(n.is_read, false)
       AND coalesce(u.notifications_enabled, true)
       AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = n.user_id)
     ORDER BY n.created_at
     LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
  )
  SELECT w.id, w.type::text, w.title::text, w.message, w.document_ref, w.family_id,
         s.id, s.endpoint, s.p256dh, s.auth
    FROM waiting w
    JOIN public.push_subscriptions s ON s.user_id = w.user_id
   ORDER BY w.created_at, s.created_at;
$fn$;

-- After a send: those notifications are done, dead devices are forgotten,
-- live ones remembered.
CREATE OR REPLACE FUNCTION public.push_done(
  p_notifications uuid[], p_gone uuid[] DEFAULT '{}', p_delivered uuid[] DEFAULT '{}'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE public.notifications SET pushed_at = now() WHERE id = ANY (p_notifications) AND pushed_at IS NULL;
  DELETE FROM public.push_subscriptions WHERE id = ANY (p_gone);
  UPDATE public.push_subscriptions SET last_used_at = now() WHERE id = ANY (p_delivered);
$fn$;


-- ─── 5. The clock ───────────────────────────────────────────────────────────
-- Every hour at five past. Reminders are made from 9 in the morning, India
-- time — the first run after nine makes the day's, the rest find them sent —
-- and devices are told between 8 in the morning and 10 at night, so a
-- notification made overnight waits for the morning.

CREATE OR REPLACE FUNCTION public.run_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_hour integer := extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata');
  v_cfg  public.push_config%ROWTYPE;
BEGIN
  IF v_hour >= 9 THEN
    PERFORM public.queue_expiry_reminders();
  END IF;

  IF v_hour < 8 OR v_hour >= 22 THEN
    RETURN;
  END IF;
  SELECT * INTO v_cfg FROM public.push_config WHERE id;
  IF NOT FOUND OR v_cfg.functions_url IS NULL OR v_cfg.anon_key IS NULL THEN
    RETURN;                                   -- nobody has turned reminders on yet
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.pushed_at IS NULL AND n.created_at > now() - interval '1 day'
       AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = n.user_id)
  ) THEN
    RETURN;                                   -- nothing waiting
  END IF;
  PERFORM net.http_post(
    url                  := v_cfg.functions_url || '/push',
    body                 := jsonb_build_object('action', 'send'),
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_cfg.anon_key,
                              'apikey', v_cfg.anon_key),
    timeout_milliseconds := 60000
  );
END;
$fn$;

SELECT cron.schedule('familyvault-reminders', '5 * * * *', 'SELECT public.run_reminders()');


-- ─── 6. Grants ──────────────────────────────────────────────────────────────
-- All server-only: they take no caller, or return other people's data.

REVOKE ALL ON FUNCTION public.queue_family_expiry_reminders(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_expiry_reminders(date)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_keys()                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_setup(text, text, text, text, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_claim_send()                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_pending(integer)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_done(uuid[], uuid[], uuid[])           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_reminders()                             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_family_expiry_reminders(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_expiry_reminders(date)               TO service_role;
GRANT EXECUTE ON FUNCTION public.push_keys()                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.push_setup(text, text, text, text, text)    TO service_role;
GRANT EXECUTE ON FUNCTION public.push_claim_send()                           TO service_role;
GRANT EXECUTE ON FUNCTION public.push_pending(integer)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.push_done(uuid[], uuid[], uuid[])           TO service_role;
GRANT EXECUTE ON FUNCTION public.run_reminders()                             TO service_role;

COMMIT;
