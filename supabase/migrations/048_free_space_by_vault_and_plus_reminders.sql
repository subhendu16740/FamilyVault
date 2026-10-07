-- ============================================================================
-- 048: Free space by vault — 100 MB for your personal vault, 200 MB for a
--      family — and expiry reminders are part of Family Plus
--
-- Free was 1 GB for every vault (039). Supabase's Free plan holds 1 GB of
-- files for the whole project, all vaults together, so 1 GB a vault could not
-- be kept past the first full one. Now:
--
--   Free          a personal vault 100 MB, a family 200 MB — in total, files
--                 and saved chats together, as before (042)
--   Family Plus   10 GB, either kind of vault (unchanged)
--
--   • plan_limits gains personal_storage_bytes: what a personal vault may
--     keep on that plan where it differs from a family (NULL: the same as
--     storage_bytes). Both stay numbers to change in the Table editor.
--   • vault_storage_bytes(family, plan) is the one place a vault's limit is
--     read. Everything that read plan_limits.storage_bytes for a vault reads
--     it instead: family_storage_status() (so the upload policy, Settings ›
--     Storage and Gmail import), the saved-chat trigger (042), and the
--     countdown and removal after Family Plus ends (040). set_family_plan()
--     still reads storage_bytes for its "Room for 10 GB" notice: Plus is the
--     same for both kinds of vault.
--   • family_storage_status() also says whether the vault is personal, so the
--     app says "your personal vault" rather than "your family".
--   • Notices write sizes with size_text(): "200 MB", "1.5 GB".
--
-- Lowering the free limit deletes nothing. A vault that was always free and
-- holds more than its new limit keeps everything; it adds nothing — no
-- document, no saved chat — until it is back under it. Only a vault whose
-- Family Plus ENDS is ever cleaned up (040), and now down to its own free
-- limit: 200 MB for a family, 100 MB for a personal vault.
--
-- Expiry reminders (034) — on the bell and on devices — are now for vaults
-- on Family Plus only, like the Reminders page. queue_family_expiry_reminders()
-- makes nothing for a vault on Free (the hourly clock and Home's call both go
-- through it) and records nothing either, so a vault that moves to Plus gets
-- the reminder for each document's current stage at the next hourly run.
-- Birthday reminders (035) stay for every family. The expiry notice now
-- names AskLocker, not FamilyVault.
--
-- Apply after 047: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows) and compare qa/sql/fingerprint.sql. Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. The limits ──────────────────────────────────────────────────────────
ALTER TABLE public.plan_limits ADD COLUMN IF NOT EXISTS personal_storage_bytes bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'plan_limits_personal_storage_bytes'
                    AND conrelid = 'public.plan_limits'::regclass) THEN
    ALTER TABLE public.plan_limits
      ADD CONSTRAINT plan_limits_personal_storage_bytes
      CHECK (personal_storage_bytes IS NULL OR personal_storage_bytes > 0);
  END IF;
END $$;

UPDATE public.plan_limits
   SET storage_bytes = 200::bigint * 1024 * 1024,
       personal_storage_bytes = 100::bigint * 1024 * 1024
 WHERE plan = 'free';


-- ─── 2. Helpers ─────────────────────────────────────────────────────────────
-- What a vault may keep on a plan: a personal vault's own number where the
-- plan has one, the family number otherwise. NULL for an unknown vault or plan.
CREATE OR REPLACE FUNCTION public.vault_storage_bytes(p_family_id uuid, p_plan text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE WHEN f.is_personal THEN coalesce(pl.personal_storage_bytes, pl.storage_bytes)
              ELSE pl.storage_bytes END
    FROM public.families f
    JOIN public.plan_limits pl ON pl.plan = p_plan
   WHERE f.id = p_family_id;
$fn$;

-- "200 MB", "95.5 MB", "1.5 GB": a size as the notices write it.
CREATE OR REPLACE FUNCTION public.size_text(p_bytes bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
           WHEN p_bytes >= 1073741824 THEN trim_scale(round(p_bytes / 1073741824.0, 2))::text || ' GB'
           WHEN p_bytes >= 104857600  THEN round(p_bytes / 1048576.0)::text || ' MB'
           ELSE trim_scale(round(coalesce(p_bytes, 0) / 1048576.0, 1))::text || ' MB'
         END;
$fn$;


-- ─── 3. When an ended plan's files go (040's), against the vault's own limit ─
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
  v_free := public.vault_storage_bytes(p_family_id, 'free');
  IF v_free IS NULL OR public.family_files_bytes(v_ns) <= v_free THEN
    RETURN NULL;
  END IF;
  SELECT pl.grace_days INTO v_days FROM public.plan_limits pl WHERE pl.plan = 'plus';
  RETURN greatest(fp.paid_until, coalesce(fp.ended_notice_at, now()))
         + make_interval(days => coalesce(v_days, 30));
END;
$fn$;


-- ─── 4. A vault's storage (042's), with its own limit, and whether it is personal
-- Its result changes shape, so it is dropped and made again, and
-- family_storage_has_room() (which the upload policy calls) is restated after it.
DROP FUNCTION IF EXISTS public.family_storage_status(uuid);
CREATE FUNCTION public.family_storage_status(p_family_id uuid)
RETURNS TABLE (plan text, paid_until timestamptz, limit_bytes bigint, used_bytes bigint,
               removal_at timestamptz, chats_bytes bigint, personal boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ns       text;
  v_personal boolean;
  v_plan     text;
  v_until    timestamptz;
  v_chats    bigint;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);

  SELECT f.storage_namespace, f.is_personal INTO v_ns, v_personal
    FROM public.families f WHERE f.id = p_family_id;
  IF v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RETURN;
  END IF;

  SELECT fp.plan, fp.paid_until INTO v_plan, v_until
    FROM public.family_plans fp
   WHERE fp.family_id = p_family_id AND fp.paid_until > now();
  IF NOT FOUND THEN
    v_plan := 'free'; v_until := NULL;
  END IF;

  v_chats := public.family_chats_bytes(p_family_id);
  RETURN QUERY
  SELECT v_plan, v_until,
         public.vault_storage_bytes(p_family_id, v_plan),
         public.family_files_bytes(v_ns) + v_chats,
         public.plan_removal_at(p_family_id),
         v_chats,
         coalesce(v_personal, false);
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


-- ─── 5. A chat is saved only when it fits (042's), in the vault's own limit ──
CREATE OR REPLACE FUNCTION public.saved_chats_within_storage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_grows    bigint := octet_length(NEW.messages::text)
                     - CASE WHEN TG_OP = 'UPDATE' THEN octet_length(OLD.messages::text) ELSE 0 END;
  v_ns       text;
  v_personal boolean;
  v_plan     text;
  v_limit    bigint;
  v_used     bigint;
BEGIN
  -- The same size or smaller: a new title, a shorter chat. Always allowed.
  IF v_grows <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT f.storage_namespace, f.is_personal INTO v_ns, v_personal
    FROM public.families f WHERE f.id = NEW.family_id;
  v_plan  := public.family_plan_now(NEW.family_id);
  v_limit := public.vault_storage_bytes(NEW.family_id, v_plan);
  -- Before an update this still counts the chat as it was, so used + grows
  -- is what the vault would hold with the chat saved.
  v_used := public.family_files_bytes(v_ns) + public.family_chats_bytes(NEW.family_id);
  IF v_limit IS NOT NULL AND v_used + v_grows > v_limit THEN
    RAISE EXCEPTION 'There is no room to save this chat: % has used % of its %. Delete documents or saved chats you no longer need to make room%.',
                    CASE WHEN v_personal THEN 'your personal vault' ELSE 'your family' END,
                    public.size_text(v_used), public.size_text(v_limit),
                    CASE WHEN v_plan = 'free' THEN ', or move to Family Plus for more' ELSE '' END
      USING ERRCODE = 'P0001', HINT = 'storage_full';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.saved_chats_within_storage() FROM PUBLIC, anon, authenticated;


-- ─── 6. The notices after Plus ends (040's), against the vault's own limit ──
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
  v_who   text;
  v_head  text;
  v_title text;
  v_msg   text;
  v_made  integer := 0;
BEGIN
  SELECT pl.grace_days INTO v_days FROM public.plan_limits pl WHERE pl.plan = 'plus';
  v_days := coalesce(v_days, 30);

  FOR r IN
    SELECT fp.family_id, fp.paid_until, fp.ended_notice_at, fp.warned_week_at, fp.warned_day_at,
           f.name AS family_name, f.storage_namespace AS ns, f.is_personal
      FROM public.family_plans fp
      JOIN public.families f ON f.id = fp.family_id
     WHERE fp.paid_until <= now() AND fp.settled_at IS NULL
       FOR UPDATE OF fp SKIP LOCKED
  LOOP
    v_free := public.vault_storage_bytes(r.family_id, 'free');
    CONTINUE WHEN v_free IS NULL;
    v_used  := public.family_files_bytes(r.ns);
    v_who   := CASE WHEN r.is_personal THEN 'your personal vault' ELSE r.family_name END;
    v_head := CASE WHEN r.is_personal THEN 'Your personal vault' ELSE r.family_name END;
    v_title := NULL;

    IF v_used <= v_free THEN
      -- Within the free limit: nothing will be removed, and this lapse is done.
      IF r.ended_notice_at IS NULL THEN
        v_title := format('Family Plus has ended for %s', v_who);
        v_msg   := 'Your documents stay. Expiry reminders, the Reminders page and Import from Gmail are part of Family Plus; renew any time to have them again.';
      ELSE
        v_title := format('%s is within the free %s', v_head, public.size_text(v_free));
        v_msg   := 'Nothing will be removed.';
      END IF;
      UPDATE public.family_plans
         SET ended_notice_at = coalesce(ended_notice_at, now()), settled_at = now(), cleanup_until = NULL
       WHERE family_id = r.family_id;
    ELSE
      v_when := greatest(r.paid_until, coalesce(r.ended_notice_at, now())) + make_interval(days => v_days);
      IF r.ended_notice_at IS NULL THEN
        v_title := format('Family Plus has ended for %s', v_who);
        v_msg   := format('%s holds %s, more than the free %s. Renew Family Plus, or delete documents, by %s. After that, the newest documents above %s are removed. Expiry reminders, the Reminders page and Import from Gmail are part of Family Plus.',
                          v_head, public.size_text(v_used), public.size_text(v_free),
                          public.ist_day(v_when), public.size_text(v_free));
        UPDATE public.family_plans SET ended_notice_at = now() WHERE family_id = r.family_id;
      ELSIF r.warned_week_at IS NULL AND now() >= v_when - interval '7 days' AND v_when - now() > interval '1 day' THEN
        v_title := format('In 7 days, documents will be removed from %s', v_who);
        v_msg   := format('On %s, the newest documents above the free %s will be removed. Renew Family Plus, or delete documents to get under %s, to keep them.',
                          public.ist_day(v_when), public.size_text(v_free), public.size_text(v_free));
        UPDATE public.family_plans SET warned_week_at = now() WHERE family_id = r.family_id;
      ELSIF r.warned_day_at IS NULL AND now() >= v_when - interval '1 day' THEN
        v_title := format('Tomorrow, documents will be removed from %s', v_who);
        v_msg   := format('On %s, the newest documents above the free %s will be removed, unless Family Plus is renewed or documents are deleted to get under %s.',
                          public.ist_day(greatest(v_when, now() + interval '20 hours')),
                          public.size_text(v_free), public.size_text(v_free));
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


-- ─── 7. The clean-up after Plus ends (040's), down to the vault's own limit ─
-- Vaults whose time is up: Plus ended, told, warned the day before (20 hours
-- ago at least), past their date, still above their free limit.
CREATE OR REPLACE FUNCTION public.plan_cleanup_candidates()
RETURNS TABLE (family_id uuid, storage_namespace text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_days integer;
BEGIN
  SELECT pl.grace_days INTO v_days FROM public.plan_limits pl WHERE pl.plan = 'plus';
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
     AND public.family_files_bytes(f.storage_namespace) > public.vault_storage_bytes(fp.family_id, 'free')
   ORDER BY fp.paid_until;
END;
$fn$;

-- What goes from one claimed vault, decided here and only here (040's rule,
-- the vault's own free limit): the newest files first (files without a
-- document first of all, once a day old), only as many as bring it within
-- the limit, at most p_max a run.
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
  v_free := public.vault_storage_bytes(p_family_id, 'free');
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
-- the vault's members are told what went; still above it, the next run carries on.
CREATE OR REPLACE FUNCTION public.plan_settle(p_family_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  fp         record;
  v_ns       text;
  v_name     text;
  v_personal boolean;
  v_who      text;
  v_free     bigint;
BEGIN
  SELECT * INTO fp FROM public.family_plans WHERE family_id = p_family_id FOR UPDATE;
  IF NOT FOUND OR fp.settled_at IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT f.storage_namespace, f.name, f.is_personal INTO v_ns, v_name, v_personal
    FROM public.families f WHERE f.id = p_family_id;
  v_free := public.vault_storage_bytes(p_family_id, 'free');

  IF fp.paid_until > now() OR public.family_files_bytes(v_ns) > v_free THEN
    UPDATE public.family_plans SET cleanup_until = NULL WHERE family_id = p_family_id;
    RETURN false;
  END IF;

  UPDATE public.family_plans SET settled_at = now(), cleanup_until = NULL WHERE family_id = p_family_id;
  IF fp.removed_count > 0 THEN
    v_who := CASE WHEN v_personal THEN 'your personal vault' ELSE v_name END;
    INSERT INTO public.notifications (user_id, family_id, type, title, message)
    SELECT fm.user_id, p_family_id, 'plan',
           left(format('%s %s removed from %s', fp.removed_count,
                       CASE WHEN fp.removed_count = 1 THEN 'document was' ELSE 'documents were' END, v_who), 200),
           format('Family Plus ended on %s, and %s held more than the free %s, so the newest documents above it were removed. Renew Family Plus to add more.',
                  public.ist_day(fp.paid_until), v_who, public.size_text(v_free))
      FROM public.family_members fm
     WHERE fm.family_id = p_family_id;
  END IF;
  RETURN true;
END;
$fn$;


-- ─── 8. Expiry reminders are part of Family Plus (034's, gated) ─────────────
-- One vault's reminders due today (India time), as 034 made them — for a
-- vault on Family Plus only. Nothing is made or recorded for a vault on Free,
-- so a vault that moves to Plus gets each document's current stage next run.
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
  IF public.family_plan_now(p_family_id) <> 'plus' THEN
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
               || CASE WHEN v_days <= 0 THEN 'Renew it, then add the new one to AskLocker.'
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


-- ─── 9. Service role only: the helpers, and everything restated above ───────
-- (CREATE OR REPLACE keeps the grants 034 and 040 gave; said again here so
-- this file is right on its own.)
REVOKE ALL ON FUNCTION public.vault_storage_bytes(uuid, text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.size_text(bigint)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_removal_at(uuid)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_plan_notices()                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_cleanup_candidates()                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_take_excess(uuid, integer)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_settle(uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_family_expiry_reminders(uuid, date)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_storage_bytes(uuid, text), public.size_text(bigint),
                          public.plan_removal_at(uuid), public.queue_plan_notices(),
                          public.plan_cleanup_candidates(), public.plan_take_excess(uuid, integer),
                          public.plan_settle(uuid), public.queue_family_expiry_reminders(uuid, date)
   TO service_role;

COMMIT;
