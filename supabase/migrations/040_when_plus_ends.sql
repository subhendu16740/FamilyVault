-- ============================================================================
-- 040: When Family Plus ends — 30 days, then the newest documents above the
--      free limit go
--
-- Plus is storage the family pays for; when the paying stops, so does the
-- storage. When a family's Plus ends (paid_until passes, or end_family_plan()
-- for a refund) and its files add up to more than the free limit:
--
--   day 0    "Family Plus has ended": what it holds, and the date
--   day 23   "In 7 days…"
--   day 29   "Tomorrow…"
--   day 30   the newest documents above the free limit are removed, until
--            the family is within it, and the family is told how many
--
-- Renewing (set_family_plan) stops it at any point; so does deleting
-- documents until the family is within the free limit. Each notice goes to
-- every member, under the bell and on their devices. How many days a family
-- has is plan_limits.grace_days (30, on the plus row) — change it in the
-- Table editor, like the limits themselves.
--
-- Safety, because this deletes documents:
--   • Only a family whose Plus has ENDED is ever touched. A family that was
--     never on Plus is not, whatever it holds.
--   • Nothing is removed before the "ended" notice and the "tomorrow"
--     warning have gone out, and never sooner than 20 hours after that
--     warning — so a clock that was down cannot skip the warnings.
--   • The newest files go first, and removal stops as soon as the family is
--     within the limit. Files without a document (a failed upload) go before
--     any document, once they are a day old.
--   • The database alone decides what goes (plan_take_excess); the Edge
--     Function only deletes the files it is handed. A lease keeps two runs
--     off one family, and a renewal refuses a removal already under way.
--
-- The files go through the Storage API, which SQL cannot call, so the
-- removal is done by the plans Edge Function: run_reminders() (034, the
-- hourly clock) calls it, at the address in push_config, when a family's
-- time is up. Everything here is service role only.
--
-- Apply after 039: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows). Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. How long a family has, and where each ended plan stands ─────────────
ALTER TABLE public.plan_limits ADD COLUMN IF NOT EXISTS grace_days integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'plan_limits_grace_days' AND conrelid = 'public.plan_limits'::regclass) THEN
    ALTER TABLE public.plan_limits
      ADD CONSTRAINT plan_limits_grace_days CHECK (grace_days IS NULL OR grace_days BETWEEN 1 AND 365);
  END IF;
END $$;
UPDATE public.plan_limits SET grace_days = 30 WHERE plan = 'plus' AND grace_days IS NULL;

ALTER TABLE public.family_plans
  ADD COLUMN IF NOT EXISTS ended_notice_at timestamptz,          -- "Family Plus has ended" went out
  ADD COLUMN IF NOT EXISTS warned_week_at  timestamptz,          -- "In 7 days…"
  ADD COLUMN IF NOT EXISTS warned_day_at   timestamptz,          -- "Tomorrow…"
  ADD COLUMN IF NOT EXISTS settled_at      timestamptz,          -- within the limit again, or cleaned up: done
  ADD COLUMN IF NOT EXISTS removed_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_until   timestamptz;          -- a clean-up run's lease
-- (Clients still read only family_id, plan, paid_until and updated_at — 039's
-- column grant; the app learns the date from family_storage_status().)


-- ─── 2. Small helpers ───────────────────────────────────────────────────────
-- What a family's folder in the documents bucket holds. A size that is not a
-- whole number is skipped, not cast: one odd row must not stop anything.
CREATE OR REPLACE FUNCTION public.family_files_bytes(p_ns text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT coalesce(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$'
                           THEN (o.metadata->>'size')::bigint END), 0)::bigint
    FROM storage.objects o
   WHERE p_ns ~ '^family_[0-9a-f]{8}$'
     AND o.bucket_id = 'documents'
     AND o.name LIKE replace(p_ns, '_', '\_') || '/%';
$fn$;

-- "1.25" for 1.25 GB, as the notices write sizes.
CREATE OR REPLACE FUNCTION public.gb_text(p_bytes bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT trim_scale(round(p_bytes / 1073741824.0, 2))::text;
$fn$;

-- "4 Nov 2026", India time, as every notice writes dates.
CREATE OR REPLACE FUNCTION public.ist_day(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT to_char(p_at AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY');
$fn$;

-- When an ended plan's files above the free limit are due to go: NULL while
-- the family is on Plus, once its lapse is settled, or while it is within
-- the free limit. Counted from the end of Plus, or from the "ended" notice if
-- that went out later, so a family always has its full time after being told.
CREATE OR REPLACE FUNCTION public.plan_removal_at(p_family_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  fp     record;
  v_ns   text;
  v_free bigint;
  v_days integer;
BEGIN
  SELECT * INTO fp FROM public.family_plans WHERE family_id = p_family_id;
  IF NOT FOUND OR fp.paid_until > now() OR fp.settled_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT f.storage_namespace INTO v_ns FROM public.families f WHERE f.id = p_family_id;
  SELECT pl.storage_bytes INTO v_free FROM public.plan_limits pl WHERE pl.plan = 'free';
  IF v_free IS NULL OR public.family_files_bytes(v_ns) <= v_free THEN
    RETURN NULL;
  END IF;
  SELECT pl.grace_days INTO v_days FROM public.plan_limits pl WHERE pl.plan = 'plus';
  RETURN greatest(fp.paid_until, coalesce(fp.ended_notice_at, now()))
         + make_interval(days => coalesce(v_days, 30));
END;
$fn$;


-- ─── 3. A family's plan, its limit, what its files add up to — and when ─────
-- 039's, with removal_at: when the documents above the free limit go, for a
-- family whose Plus has ended (NULL otherwise). Its result changes shape, so
-- it is dropped and made again; family_storage_has_room() is restated after.
DROP FUNCTION IF EXISTS public.family_storage_status(uuid);
CREATE FUNCTION public.family_storage_status(p_family_id uuid)
RETURNS TABLE (plan text, paid_until timestamptz, limit_bytes bigint, used_bytes bigint, removal_at timestamptz)
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
         public.family_files_bytes(v_ns),
         public.plan_removal_at(p_family_id);
END;
$fn$;

-- Unchanged from 038; restated so every connection compiles it afresh.
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


-- ─── 4. Giving Plus, renewing it, ending it at once ─────────────────────────
-- 039's, and a renewal starts the family afresh: any countdown stops.
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

  SELECT fp.paid_until INTO v_was FROM public.family_plans fp WHERE fp.family_id = p_family_id FOR UPDATE;

  INSERT INTO public.family_plans (family_id, plan, paid_until, source, source_ref, updated_at)
  VALUES (p_family_id, 'plus', p_paid_until, coalesce(p_source, 'manual'), p_source_ref, now())
  ON CONFLICT (family_id) DO UPDATE
     SET paid_until = EXCLUDED.paid_until, source = EXCLUDED.source,
         source_ref = EXCLUDED.source_ref, updated_at = now(),
         ended_notice_at = NULL, warned_week_at = NULL, warned_day_at = NULL,
         settled_at = NULL, removed_count = 0, cleanup_until = NULL;

  IF v_was IS NULL OR v_was <= now() THEN
    SELECT pl.storage_bytes INTO v_limit FROM public.plan_limits pl WHERE pl.plan = 'plus';
    INSERT INTO public.notifications (user_id, family_id, type, title, message)
    SELECT fm.user_id, p_family_id, 'plan',
           left(format('%s has Family Plus', v_family), 200),
           format('Room for %s GB of documents, until %s.',
                  trim_scale(round(v_limit / 1073741824.0, 1))::text,
                  public.ist_day(p_paid_until))
      FROM public.family_members fm
     WHERE fm.family_id = p_family_id;
  END IF;

  INSERT INTO public.audit_logs (family_id, action, resource_type, resource_id)
  VALUES (p_family_id, 'set_family_plan', 'family', p_family_id);
END;
$fn$;

-- A refund, or Plus taken back: it ends now, and the 30 days begin. (Deleting
-- the family_plans row instead would leave its files above the limit kept
-- for ever.)
CREATE OR REPLACE FUNCTION public.end_family_plan(p_family_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.family_plans
     SET paid_until = least(paid_until, now()), updated_at = now()
   WHERE family_id = p_family_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This family has no Family Plus to end.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_logs (family_id, action, resource_type, resource_id)
  VALUES (p_family_id, 'end_family_plan', 'family', p_family_id);
END;
$fn$;


-- ─── 5. The notices — every hour, from run_reminders() ──────────────────────
CREATE OR REPLACE FUNCTION public.queue_plan_notices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r       record;
  v_free  bigint;
  v_days  integer;
  v_used  bigint;
  v_when  timestamptz;
  v_title text;
  v_msg   text;
  v_made  integer := 0;
BEGIN
  SELECT pl.storage_bytes INTO v_free FROM public.plan_limits pl WHERE pl.plan = 'free';
  SELECT pl.grace_days INTO v_days FROM public.plan_limits pl WHERE pl.plan = 'plus';
  v_days := coalesce(v_days, 30);
  IF v_free IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT fp.family_id, fp.paid_until, fp.ended_notice_at, fp.warned_week_at, fp.warned_day_at,
           f.name AS family_name, f.storage_namespace AS ns
      FROM public.family_plans fp
      JOIN public.families f ON f.id = fp.family_id
     WHERE fp.paid_until <= now() AND fp.settled_at IS NULL
       FOR UPDATE OF fp SKIP LOCKED
  LOOP
    v_used  := public.family_files_bytes(r.ns);
    v_title := NULL;

    IF v_used <= v_free THEN
      -- Within the free limit: nothing will be removed, and this lapse is done.
      IF r.ended_notice_at IS NULL THEN
        v_title := format('Family Plus has ended for %s', r.family_name);
        v_msg   := 'Your documents stay. The Reminders page and Import from Gmail are part of Family Plus; renew any time to have them again.';
      ELSE
        v_title := format('%s is within the free %s GB', r.family_name, public.gb_text(v_free));
        v_msg   := 'Nothing will be removed.';
      END IF;
      UPDATE public.family_plans
         SET ended_notice_at = coalesce(ended_notice_at, now()), settled_at = now(), cleanup_until = NULL
       WHERE family_id = r.family_id;
    ELSE
      v_when := greatest(r.paid_until, coalesce(r.ended_notice_at, now())) + make_interval(days => v_days);
      IF r.ended_notice_at IS NULL THEN
        v_title := format('Family Plus has ended for %s', r.family_name);
        v_msg   := format('%s holds %s GB, more than the free %s GB. Renew Family Plus, or delete documents, by %s. After that, the newest documents above %s GB are removed.',
                          r.family_name, public.gb_text(v_used), public.gb_text(v_free),
                          public.ist_day(v_when), public.gb_text(v_free));
        UPDATE public.family_plans SET ended_notice_at = now() WHERE family_id = r.family_id;
      ELSIF r.warned_week_at IS NULL AND now() >= v_when - interval '7 days' AND v_when - now() > interval '1 day' THEN
        v_title := format('In 7 days, documents will be removed from %s', r.family_name);
        v_msg   := format('On %s, the newest documents above the free %s GB will be removed. Renew Family Plus, or delete documents to get under %s GB, to keep them.',
                          public.ist_day(v_when), public.gb_text(v_free), public.gb_text(v_free));
        UPDATE public.family_plans SET warned_week_at = now() WHERE family_id = r.family_id;
      ELSIF r.warned_day_at IS NULL AND now() >= v_when - interval '1 day' THEN
        v_title := format('Tomorrow, documents will be removed from %s', r.family_name);
        v_msg   := format('On %s, the newest documents above the free %s GB will be removed, unless Family Plus is renewed or documents are deleted to get under %s GB.',
                          public.ist_day(greatest(v_when, now() + interval '20 hours')), public.gb_text(v_free), public.gb_text(v_free));
        UPDATE public.family_plans SET warned_day_at = now() WHERE family_id = r.family_id;
      END IF;
    END IF;

    IF v_title IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, family_id, type, title, message)
      SELECT fm.user_id, r.family_id, 'plan', left(v_title, 200), v_msg
        FROM public.family_members fm
       WHERE fm.family_id = r.family_id;
      v_made := v_made + 1;
    END IF;
  END LOOP;

  RETURN v_made;
END;
$fn$;


-- ─── 6. The clean-up: whose time is up, what goes, and closing the books ────
-- Families whose time is up: Plus ended, told, warned the day before (20
-- hours ago at least), past their date, still above the free limit.
CREATE OR REPLACE FUNCTION public.plan_cleanup_candidates()
RETURNS TABLE (family_id uuid, storage_namespace text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_free bigint;
  v_days integer;
BEGIN
  SELECT pl.storage_bytes INTO v_free FROM public.plan_limits pl WHERE pl.plan = 'free';
  SELECT pl.grace_days INTO v_days FROM public.plan_limits pl WHERE pl.plan = 'plus';
  IF v_free IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT fp.family_id, f.storage_namespace::text
    FROM public.family_plans fp
    JOIN public.families f ON f.id = fp.family_id
   WHERE fp.paid_until <= now()
     AND fp.settled_at IS NULL
     AND fp.ended_notice_at IS NOT NULL
     AND fp.warned_day_at IS NOT NULL
     AND fp.warned_day_at <= now() - interval '20 hours'
     AND now() >= greatest(fp.paid_until, fp.ended_notice_at) + make_interval(days => coalesce(v_days, 30))
     AND public.family_files_bytes(f.storage_namespace) > v_free
   ORDER BY fp.paid_until;
END;
$fn$;

-- run_reminders() asks this before calling the plans function.
CREATE OR REPLACE FUNCTION public.plan_cleanup_waiting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.plan_cleanup_candidates());
$fn$;

-- Claims up to p_max families for one run: a ten-minute lease each.
CREATE OR REPLACE FUNCTION public.plan_cleanup_due(p_max integer DEFAULT 10)
RETURNS TABLE (family_id uuid, storage_namespace text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.family_id, c.storage_namespace FROM public.plan_cleanup_candidates() c
           LIMIT greatest(1, least(coalesce(p_max, 10), 50))
  LOOP
    UPDATE public.family_plans fp
       SET cleanup_until = now() + interval '10 minutes'
     WHERE fp.family_id = r.family_id
       AND (fp.cleanup_until IS NULL OR fp.cleanup_until < now());
    IF FOUND THEN
      family_id := r.family_id;
      storage_namespace := r.storage_namespace;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$fn$;

-- What goes from one claimed family, decided here and only here: the newest
-- files first (files without a document first of all, once a day old), only
-- as many as bring the family within the free limit, at most p_max a run.
-- Their documents are deleted now (chunks, details and alerts go with them);
-- the names come back for the plans function to delete the files.
CREATE OR REPLACE FUNCTION public.plan_take_excess(p_family_id uuid, p_max integer DEFAULT 500)
RETURNS TABLE (name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  fp      record;
  v_ns    text;
  v_free  bigint;
  v_used  bigint;
  v_names text[];
  v_docs  uuid[];
  v_gone  integer := 0;
BEGIN
  SELECT * INTO fp FROM public.family_plans WHERE family_plans.family_id = p_family_id FOR UPDATE;
  IF NOT FOUND OR fp.cleanup_until IS NULL OR fp.cleanup_until < now() THEN
    RAISE EXCEPTION 'This family is not being cleaned up.' USING ERRCODE = '55000';
  END IF;
  IF fp.paid_until > now() OR fp.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Family Plus was renewed, or this family is settled.' USING ERRCODE = '55000';
  END IF;

  SELECT f.storage_namespace INTO v_ns FROM public.families f WHERE f.id = p_family_id;
  IF v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RETURN;
  END IF;
  SELECT pl.storage_bytes INTO v_free FROM public.plan_limits pl WHERE pl.plan = 'free';
  v_used := public.family_files_bytes(v_ns);
  IF v_free IS NULL OR v_used <= v_free THEN
    RETURN;
  END IF;

  EXECUTE format($q$
    WITH files AS (
      SELECT o.name::text AS name,
             CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$' THEN (o.metadata->>'size')::bigint ELSE 0 END AS size_bytes,
             d.id AS document_id,
             o.created_at
        FROM storage.objects o
        LEFT JOIN %I.documents d ON d.storage_path = o.name
       WHERE o.bucket_id = 'documents'
         AND o.name LIKE $1
         AND (d.id IS NOT NULL OR o.created_at < now() - interval '1 day')
    ), ordered AS (
      SELECT f.*, coalesce(sum(f.size_bytes) OVER (
               ORDER BY (f.document_id IS NULL) DESC, f.created_at DESC, f.name
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
        FROM files f
    ), picked AS (
      SELECT o.name, o.document_id FROM ordered o
       WHERE $2 - o.before > $3
       ORDER BY (o.document_id IS NULL) DESC, o.created_at DESC, o.name
       LIMIT $4
    )
    SELECT array_agg(p.name), array_agg(p.document_id) FILTER (WHERE p.document_id IS NOT NULL) FROM picked p
  $q$, v_ns)
  INTO v_names, v_docs
  USING replace(v_ns, '_', '\_') || '/%', v_used, v_free, greatest(1, least(coalesce(p_max, 500), 1000));

  IF coalesce(array_length(v_docs, 1), 0) > 0 THEN
    EXECUTE format('DELETE FROM %I.documents WHERE id = ANY($1)', v_ns) USING v_docs;
    GET DIAGNOSTICS v_gone = ROW_COUNT;
  END IF;

  IF coalesce(array_length(v_names, 1), 0) > 0 THEN
    UPDATE public.family_plans SET removed_count = removed_count + v_gone WHERE family_plans.family_id = p_family_id;
    INSERT INTO public.audit_logs (family_id, action, resource_type, resource_id, metadata)
    VALUES (p_family_id, 'plan_remove_documents', 'family', p_family_id,
            jsonb_build_object('documents', v_gone, 'files', array_length(v_names, 1),
                               'document_ids', to_jsonb(coalesce(v_docs, '{}'::uuid[]))));
  END IF;

  RETURN QUERY SELECT unnest(coalesce(v_names, '{}'::text[]));
END;
$fn$;

-- After a run's files are gone: within the limit, the lapse is settled and
-- the family is told what went; still above it, the next run carries on.
CREATE OR REPLACE FUNCTION public.plan_settle(p_family_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  fp     record;
  v_ns   text;
  v_name text;
  v_free bigint;
BEGIN
  SELECT * INTO fp FROM public.family_plans WHERE family_id = p_family_id FOR UPDATE;
  IF NOT FOUND OR fp.settled_at IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT f.storage_namespace, f.name INTO v_ns, v_name FROM public.families f WHERE f.id = p_family_id;
  SELECT pl.storage_bytes INTO v_free FROM public.plan_limits pl WHERE pl.plan = 'free';

  IF fp.paid_until > now() OR public.family_files_bytes(v_ns) > v_free THEN
    UPDATE public.family_plans SET cleanup_until = NULL WHERE family_id = p_family_id;
    RETURN false;
  END IF;

  UPDATE public.family_plans SET settled_at = now(), cleanup_until = NULL WHERE family_id = p_family_id;
  IF fp.removed_count > 0 THEN
    INSERT INTO public.notifications (user_id, family_id, type, title, message)
    SELECT fm.user_id, p_family_id, 'plan',
           left(format('%s %s removed from %s', fp.removed_count,
                       CASE WHEN fp.removed_count = 1 THEN 'document was' ELSE 'documents were' END, v_name), 200),
           format('Family Plus ended on %s, and %s held more than the free %s GB, so the newest documents above it were removed. Renew Family Plus to add more.',
                  public.ist_day(fp.paid_until), v_name, public.gb_text(v_free))
      FROM public.family_members fm
     WHERE fm.family_id = p_family_id;
  END IF;
  RETURN true;
END;
$fn$;


-- ─── 7. The hourly clock: 035's, and the Family Plus work first ─────────────
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
  -- Family Plus that has ended (040): the notices every run, and the plans
  -- function when a family's time is up. A failure here never stops the
  -- reminders below.
  BEGIN
    PERFORM public.queue_plan_notices();
    IF public.plan_cleanup_waiting() THEN
      SELECT * INTO v_cfg FROM public.push_config WHERE id;
      IF FOUND AND v_cfg.functions_url IS NOT NULL AND v_cfg.anon_key IS NOT NULL THEN
        PERFORM net.http_post(
          url                  := v_cfg.functions_url || '/plans',
          body                 := jsonb_build_object('action', 'cleanup'),
          headers              := jsonb_build_object(
                                    'Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_cfg.anon_key,
                                    'apikey', v_cfg.anon_key),
          timeout_milliseconds := 120000
        );
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Family Plus housekeeping failed: %', SQLERRM;
  END;

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


-- ─── 8. Service role only, all of it ────────────────────────────────────────
REVOKE ALL ON FUNCTION public.family_files_bytes(text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gb_text(bigint)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ist_day(timestamptz)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_removal_at(uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_family_plan(uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_family_plan(uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_plan_notices()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_cleanup_candidates()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_cleanup_waiting()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_cleanup_due(integer)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_take_excess(uuid, integer)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_settle(uuid)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_reminders()                     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_files_bytes(text), public.gb_text(bigint), public.ist_day(timestamptz),
                          public.plan_removal_at(uuid), public.set_family_plan(uuid, timestamptz, text, text),
                          public.end_family_plan(uuid), public.queue_plan_notices(), public.plan_cleanup_candidates(),
                          public.plan_cleanup_waiting(), public.plan_cleanup_due(integer),
                          public.plan_take_excess(uuid, integer), public.plan_settle(uuid), public.run_reminders()
  TO service_role;

COMMIT;
