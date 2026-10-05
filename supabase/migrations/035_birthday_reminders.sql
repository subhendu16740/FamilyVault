-- ============================================================================
-- 035: birthday reminders from the family tree
--
-- On the morning of a birthday, everyone in the family who wants birthday
-- reminders is told: "Today is Kamala Verma's 78th birthday". Each person
-- chooses for themselves in Settings › Notifications (users.birthday_reminders,
-- on until they switch it off); nobody is told about their own birthday.
--
-- The same clock as expiry reminders (034): run_reminders(), every hour, from
-- 9 in the morning India time, and on to phones and computers by the push
-- function like any notification. reminders_sent keeps each to once a year.
-- A birthday on 29 February is remembered on the 28th in other years. Nobody
-- over 110 is reminded of: a tree that goes back generations keeps
-- great-grandparents' birth years for the record, not for a party. For
-- someone in the tree who has passed away, remove their date of birth, or
-- switch birthday reminders off.
--
-- Clients may write birthday_reminders on their own row (users_update_own),
-- nothing more: a new writable column gets its own grant (025).
--
-- The app works before this is applied: the switch says birthday reminders
-- are not switched on yet.
--
-- Apply: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent. Needs 031 (the family tree) and 034 (the reminders clock).
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS birthday_reminders boolean NOT NULL DEFAULT true;
GRANT UPDATE (birthday_reminders) ON public.users TO authenticated;


-- Today's birthdays (India time), each made once, for every member who wants
-- them but the person themselves.
CREATE OR REPLACE FUNCTION public.queue_birthday_reminders(p_today date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_today date := coalesce(p_today, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_year  integer := extract(year FROM coalesce(p_today, (now() AT TIME ZONE 'Asia/Kolkata')::date));
  v_leap  boolean;
  p       record;
  v_age   integer;
  v_nth   text;
  v_count integer := 0;
BEGIN
  v_leap := v_year % 4 = 0 AND (v_year % 100 <> 0 OR v_year % 400 = 0);

  FOR p IN
    SELECT fp.id, fp.family_id, fp.display_name, fp.gender, fp.birth_date, fp.user_id
      FROM public.family_people fp
     WHERE fp.birth_date IS NOT NULL
       AND fp.birth_date < v_today
       AND (
         to_char(fp.birth_date, 'MM-DD') = to_char(v_today, 'MM-DD')
         OR (NOT v_leap AND to_char(fp.birth_date, 'MM-DD') = '02-29' AND to_char(v_today, 'MM-DD') = '02-28')
       )
  LOOP
    v_age := v_year - extract(year FROM p.birth_date)::integer;
    CONTINUE WHEN v_age < 1 OR v_age > 110;

    INSERT INTO public.reminders_sent (family_id, kind, ref_id, due_on, stage)
    VALUES (p.family_id, 'birthday', p.id, v_today, 0)
    ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;                  -- already sent today

    v_nth := v_age || CASE
               WHEN v_age % 100 BETWEEN 11 AND 13 THEN 'th'
               WHEN v_age % 10 = 1 THEN 'st'
               WHEN v_age % 10 = 2 THEN 'nd'
               WHEN v_age % 10 = 3 THEN 'rd'
               ELSE 'th' END;

    INSERT INTO public.notifications (user_id, family_id, type, title, message)
    SELECT fm.user_id, p.family_id, 'birthday',
           left(format('Today is %s''s %s birthday', p.display_name, v_nth), 200),
           format('Wish %s a happy birthday.',
                  CASE p.gender WHEN 'female' THEN 'her' WHEN 'male' THEN 'him' ELSE 'them' END)
      FROM public.family_members fm
      JOIN public.users u ON u.id = fm.user_id
     WHERE fm.family_id = p.family_id
       AND u.birthday_reminders
       AND fm.user_id IS DISTINCT FROM p.user_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.queue_birthday_reminders(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_birthday_reminders(date) TO service_role;


-- The clock (034), now with birthdays. One kind of reminder failing never
-- stops the other, or the push.
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
    BEGIN
      PERFORM public.queue_birthday_reminders();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'birthday reminders failed: %', SQLERRM;
    END;
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

COMMIT;
