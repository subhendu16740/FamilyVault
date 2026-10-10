-- ============================================================================
-- 050: Limits that keep one account from using up what every family shares,
--      and a document's file always in its own vault's folder
--
-- Everything AskLocker runs on is a free allowance shared by every family:
-- 1 GB of files and 5 GB of downloads a month for the whole Supabase
-- organisation, a 500 MB database that turns read-only when it is full
-- (and nobody can sign in then), about 25 questions a day of Groq, 500
-- scanned pages a day of OCR.space. A review on 9 October 2026 found that
-- one free account could use up each of them — and one hole that let a
-- person keep reading a document after their access to it had ended.
--
--   1. The hole. insert_family_document() took any file address it was
--      given, and ingest-document read whatever address it was sent, with
--      the service role. Anyone who had once seen another family's file
--      address — a member who has since left, anyone sent a share link
--      (the address is in the link's download URL) — could add a document
--      to their own vault "for" that address and have its text read into
--      their vault, where Ask answers from it. Now:
--        • insert_family_document() takes only an address in the vault's
--          own folder, whose file is there and which no other document in
--          the vault holds, and the size Storage measured, not the app's;
--        • start_document_read() (service role) hands ingest-document the
--          address from the document's own row, and only once: a document
--          already read, or found unreadable, is not read again.
--   2. Each day, for each person (India time), in daily_usage: documents
--      added (plan_limits.uploads_per_day: 50 on Free, 500 on Plus),
--      documents the server reads (twice that) and questions tried
--      (question_tries_per_day: 10 on Free, 100 on Plus). A try is counted
--      even when no answer comes of it — 049 gives such a question back,
--      but the AI service did the work — so asking nonsense on repeat, or
--      many questions at once, stops at the day's tries.
--   3. On Free, a person creates one family, besides their personal vault
--      (plan_limits.families_per_person). A family on Plus does not count.
--      Without it, one account made a new 200 MB family as often as it
--      liked: five of them are the whole organisation's 1 GB.
--   4. The same on every plan, because each is a row in the shared
--      database: 50 saved chats a person in a vault, 10 feedback messages
--      a day, 300 people in a family tree (members always fit), the newest
--      10 devices a person, 20 working links a document, 100 opens a link,
--      and 20 invitations a day from a family, 3 of them to the same person.
--   5. 10 MB a file: the documents bucket's limit, 50 MB before.
--
-- Every limit is kept here, so every way in obeys it — the app, an old app,
-- Gmail import, a script with the public key. Each refusal says what
-- happened and what to do, with a HINT the app and the functions read:
-- family_limit, bad_path, no_file, upload_limit, chat_limit, feedback_limit,
-- tree_full, share_limit, invite_limit. The numbers in plan_limits change in
-- the Table editor; the others are here.
--
-- Needs 049 (question_usage, person_on_plus). Apply after it: paste into the
-- SQL editor — DEV, then PROD — then run qa/sql/sweep.sql (zero rows).
-- Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. The numbers, per plan ──────────────────────────────────────────────
-- Added once, with their first values; applying 050 again changes no number
-- someone has since set in the Table editor.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'plan_limits' AND column_name = 'families_per_person') THEN
    ALTER TABLE public.plan_limits
      ADD COLUMN families_per_person integer CHECK (families_per_person IS NULL OR families_per_person >= 0);
    UPDATE public.plan_limits SET families_per_person = 1 WHERE plan = 'free';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'plan_limits' AND column_name = 'uploads_per_day') THEN
    ALTER TABLE public.plan_limits
      ADD COLUMN uploads_per_day integer CHECK (uploads_per_day IS NULL OR uploads_per_day > 0);
    UPDATE public.plan_limits SET uploads_per_day = CASE WHEN plan = 'free' THEN 50 ELSE 500 END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'plan_limits' AND column_name = 'question_tries_per_day') THEN
    ALTER TABLE public.plan_limits
      ADD COLUMN question_tries_per_day integer CHECK (question_tries_per_day IS NULL OR question_tries_per_day > 0);
    UPDATE public.plan_limits SET question_tries_per_day = CASE WHEN plan = 'free' THEN 10 ELSE 100 END;
  END IF;
END
$do$;

COMMENT ON COLUMN public.plan_limits.families_per_person IS
  'Families on this plan one person may have created, besides their personal vault (050). NULL: no limit. A new family starts on Free, so the free row is the one read.';
COMMENT ON COLUMN public.plan_limits.uploads_per_day IS
  'Documents one person may add in a day, India time (050); the server reads at most twice as many. NULL: no limit.';
COMMENT ON COLUMN public.plan_limits.question_tries_per_day IS
  'Questions one person may try in a day, India time, answered or not (050). NULL: no limit.';


-- ─── 2. What each person did today ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_usage (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day            date NOT NULL,
  uploads        integer NOT NULL DEFAULT 0 CHECK (uploads >= 0),
  reads          integer NOT NULL DEFAULT 0 CHECK (reads >= 0),
  question_tries integer NOT NULL DEFAULT 0 CHECK (question_tries >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
-- The server's own count: no client reads or writes it.
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.daily_usage TO service_role;

-- Today, in India time: the count starts again at midnight there.
CREATE OR REPLACE FUNCTION public.usage_day()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date;
$fn$;

-- The day's number for this person: Plus's when any vault they are in is on
-- Plus (049's rule), Free's otherwise. NULL: no limit.
CREATE OR REPLACE FUNCTION public.person_daily_limit(p_user_id uuid, p_what text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  SELECT CASE p_what
           WHEN 'uploads'        THEN pl.uploads_per_day
           WHEN 'reads'          THEN pl.uploads_per_day * 2
           WHEN 'question_tries' THEN pl.question_tries_per_day
         END
    INTO v_n
    FROM public.plan_limits pl
   WHERE pl.plan = CASE WHEN public.person_on_plus(p_user_id) THEN 'plus' ELSE 'free' END;
  RETURN v_n;
END;
$fn$;

-- Count one for today, in one statement, so two at once cannot both take the
-- last one. {allowed, used, limit, plus}. Days older than a week are let go.
CREATE OR REPLACE FUNCTION public.claim_daily(p_user_id uuid, p_what text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_day   date := public.usage_day();
  v_limit integer;
  v_used  integer;
BEGIN
  IF p_what NOT IN ('uploads', 'reads', 'question_tries') THEN
    RAISE EXCEPTION 'Nothing called % is counted', p_what;
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Counted for a person who is signed in' USING ERRCODE = '42501';
  END IF;
  v_limit := public.person_daily_limit(p_user_id, p_what);

  DELETE FROM public.daily_usage WHERE user_id = p_user_id AND day < v_day - 7;
  INSERT INTO public.daily_usage (user_id, day) VALUES (p_user_id, v_day)
  ON CONFLICT (user_id, day) DO NOTHING;

  EXECUTE format(
    'UPDATE public.daily_usage SET %1$I = %1$I + 1, updated_at = now()
      WHERE user_id = $1 AND day = $2 AND ($3::integer IS NULL OR %1$I < $3)
      RETURNING %1$I', p_what)
    INTO v_used USING p_user_id, v_day, v_limit;
  IF v_used IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit);
  END IF;

  EXECUTE format('SELECT %1$I FROM public.daily_usage WHERE user_id = $1 AND day = $2', p_what)
    INTO v_used USING p_user_id, v_day;
  RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit,
                            'plus', public.person_on_plus(p_user_id));
END;
$fn$;


-- ─── 3. A document's file: in its vault's folder, there, and its own ───────
-- 023's insert_family_document, with what it never asked: whose folder the
-- address is in, whether the file is there, whether another document holds
-- it, and how many documents this person added today. The size is Storage's.
CREATE OR REPLACE FUNCTION public.insert_family_document(
  p_family_id uuid,
  p_uploaded_by uuid,
  p_file_name character varying,
  p_file_type character varying,
  p_file_size_bytes bigint,
  p_storage_path text,
  p_category_id uuid DEFAULT NULL::uuid,
  p_belongs_to_member uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_schema TEXT;
  v_doc_id UUID;
  v_size   BIGINT;
  v_taken  BOOLEAN;
  v_claim  JSONB;
BEGIN
  PERFORM public.assert_caller_is(p_uploaded_by);

  SELECT storage_namespace INTO v_schema
  FROM public.families
  WHERE id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found: %', p_family_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id
      AND user_id = p_uploaded_by
      AND can_upload = true
  ) THEN
    RAISE EXCEPTION 'User does not have upload permission';
  END IF;

  -- In this vault's own folder, and nowhere else: "<namespace>/<file>".
  IF p_storage_path IS NULL OR length(p_storage_path) > 1024
     OR left(p_storage_path, length(v_schema) + 1) <> v_schema || '/'
     OR length(p_storage_path) = length(v_schema) + 1
     OR p_storage_path ~ '(^|/)\.\.?(/|$)' OR p_storage_path ~ '//' OR position(E'\\' IN p_storage_path) > 0 THEN
    RAISE EXCEPTION 'That file is not in this vault.'
      USING ERRCODE = '42501', HINT = 'bad_path';
  END IF;

  -- The file is there: uploaded first, as the app and Gmail import do.
  SELECT (o.metadata->>'size')::bigint INTO v_size
    FROM storage.objects o
   WHERE o.bucket_id = 'documents' AND o.name = p_storage_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The file is missing. Try adding it again.'
      USING ERRCODE = 'P0001', HINT = 'no_file';
  END IF;

  -- And it is no other document's.
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.documents d WHERE d.storage_path = $1)', v_schema)
     INTO v_taken USING p_storage_path;
  IF v_taken THEN
    RAISE EXCEPTION 'Another document already uses this file.'
      USING ERRCODE = '42501', HINT = 'bad_path';
  END IF;

  v_claim := public.claim_daily(p_uploaded_by, 'uploads');
  IF NOT (v_claim->>'allowed')::boolean THEN
    RAISE EXCEPTION '%',
      CASE WHEN (v_claim->>'plus')::boolean
        THEN format('You have reached today''s limit of %s documents. You can add more tomorrow.', v_claim->>'limit')
        ELSE format('You have reached today''s limit of %s documents on Free. You can add more tomorrow.', v_claim->>'limit')
      END
      USING ERRCODE = 'P0001', HINT = 'upload_limit';
  END IF;

  v_doc_id := gen_random_uuid();

  EXECUTE format(
    'INSERT INTO %I.documents (id, uploaded_by, file_name, file_type, file_size_bytes, storage_path, category_id, belongs_to_member, ingestion_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ''pending'')',
    v_schema
  ) USING v_doc_id, p_uploaded_by, p_file_name, p_file_type, coalesce(v_size, p_file_size_bytes),
          p_storage_path, p_category_id, p_belongs_to_member;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (p_uploaded_by, p_family_id, 'upload_document', 'document', v_doc_id);

  RETURN v_doc_id;
END;
$fn$;


-- ─── 4. Reading a document: once, from its own row ─────────────────────────
-- ingest-document asks this before it reads anything, and reads only the
-- address it hands back. {ok, storage_path, file_bytes, schema} or
-- {ok: false, reason}: no_document, already_read (read, or found unreadable),
-- bad_path, no_file, read_limit. Takes a user id, so service role only.
CREATE OR REPLACE FUNCTION public.start_document_read(p_family_id uuid, p_document_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_schema text;
  v_path   text;
  v_status text;
  v_size   bigint;
  v_claim  jsonb;
BEGIN
  SELECT f.storage_namespace INTO v_schema FROM public.families f WHERE f.id = p_family_id;
  IF v_schema IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_document');
  END IF;

  EXECUTE format('SELECT d.storage_path, d.ingestion_status FROM %I.documents d
                   WHERE d.id = $1 AND NOT coalesce(d.is_deleted, false)', v_schema)
     INTO v_path, v_status USING p_document_id;
  IF v_path IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_document');
  END IF;
  IF v_status IN ('completed', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_read', 'status', v_status);
  END IF;
  IF left(v_path, length(v_schema) + 1) <> v_schema || '/' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_path');
  END IF;

  SELECT (o.metadata->>'size')::bigint INTO v_size
    FROM storage.objects o
   WHERE o.bucket_id = 'documents' AND o.name = v_path;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_file');
  END IF;

  v_claim := public.claim_daily(p_user_id, 'reads');
  IF NOT (v_claim->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'read_limit', 'limit', v_claim->'limit');
  END IF;

  RETURN jsonb_build_object('ok', true, 'storage_path', v_path, 'file_bytes', v_size, 'schema', v_schema);
END;
$fn$;


-- ─── 5. Families created on Free ───────────────────────────────────────────
-- 023's create_family, with one check first: on Free, a person creates
-- plan_limits.families_per_person families (1), besides their personal vault.
-- A family on Plus does not count. Serialised per person, so two tabs cannot
-- both make the last one.
CREATE OR REPLACE FUNCTION public.create_family(
  p_user_id       uuid,
  p_family_name   character varying,
  p_description   text              DEFAULT NULL::text,
  p_family_icon   character varying DEFAULT NULL::character varying,
  p_is_personal   boolean           DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_family_id  uuid;
  v_short_id   text;
  v_storage_ns text;
  v_vector_ns  text;
  v_cap        integer;
begin
  perform public.assert_caller_is(p_user_id);

  if not coalesce(p_is_personal, false) then
    perform pg_advisory_xact_lock(hashtext('create_family:' || p_user_id::text));
    select pl.families_per_person into v_cap from public.plan_limits pl where pl.plan = 'free';
    if v_cap is not null and (
      select count(*) from public.families f
       where f.created_by = p_user_id
         and not coalesce(f.is_personal, false)
         and public.family_plan_now(f.id) = 'free'
    ) >= v_cap then
      raise exception '%',
        case when v_cap = 0
          then 'On Free, you cannot create a family. Ask someone in your family to invite you instead.'
          else format('On Free, you can create %s besides your personal vault. To create another, move a family you created to Family Plus.',
                      case when v_cap = 1 then 'one family' else v_cap || ' families' end)
        end
        using errcode = 'P0001', hint = 'family_limit';
    end if;
  end if;

  v_family_id  := gen_random_uuid();
  v_short_id   := replace(left(v_family_id::text, 8), '-', '');
  v_storage_ns := 'family_' || v_short_id;
  v_vector_ns  := 'fv_' || v_short_id;

  insert into public.families (id, name, description, created_by, family_icon, storage_namespace, vector_namespace, is_personal)
  values (v_family_id, p_family_name, p_description, p_user_id, p_family_icon, v_storage_ns, v_vector_ns, p_is_personal);

  execute format('create schema %I', v_storage_ns);

  execute format('create table %I.documents (
    id uuid primary key default gen_random_uuid(),
    uploaded_by uuid not null,
    file_name varchar(255) not null,
    file_type varchar(20) not null,
    file_size_bytes bigint,
    storage_path text not null,
    category_id uuid,
    belongs_to_member uuid,
    ocr_text text,
    ingestion_status varchar(20) default ''pending'',
    is_deleted boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )', v_storage_ns);

  execute format('create table %I.document_metadata (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references %I.documents(id) on delete cascade,
    key varchar(100) not null,
    value text not null,
    auto_extracted boolean default false,
    confidence float
  )', v_storage_ns, v_storage_ns);

  execute format('create table %I.document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references %I.documents(id) on delete cascade,
    chunk_index integer not null,
    content text not null,
    token_count integer,
    embedding_id varchar(100),
    created_at timestamptz default now()
  )', v_storage_ns, v_storage_ns);

  execute format('create table %I.expiry_alerts (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references %I.documents(id) on delete cascade,
    expiry_date date not null,
    alert_days_before integer[] default ''{90, 30, 7}'',
    last_notified_at timestamptz,
    is_expired boolean default false,
    auto_detected boolean default false
  )', v_storage_ns, v_storage_ns);

  execute format('create table %I.family_relationships (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null,
    related_to uuid not null,
    relationship_type varchar(50) not null,
    aliases text[]
  )', v_storage_ns);

  execute format('create index idx_%s_docs_category on %I.documents(category_id)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_docs_member on %I.documents(belongs_to_member)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_docs_status on %I.documents(ingestion_status)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_chunks_doc on %I.document_chunks(document_id)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_metadata_doc on %I.document_metadata(document_id)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_metadata_key on %I.document_metadata(key)', v_short_id, v_storage_ns);
  execute format('create index idx_%s_expiry_date on %I.expiry_alerts(expiry_date)', v_short_id, v_storage_ns);

  perform public.upgrade_family_schema_for_search(v_family_id);

  insert into public.family_members (family_id, user_id, role, can_upload, can_delete)
  values (v_family_id, p_user_id, 'admin', true, true);

  insert into public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  values (p_user_id, v_family_id, 'create_family', 'family', v_family_id);

  return v_family_id;
end;
$fn$;


-- ─── 6. Questions: tries a day, as well as answers a month ─────────────────
-- 049's claim_question, with a try counted first. A try is never given back
-- (release_question gives back only the month's answer), so questions that
-- end in "nothing relevant", or in the AI service being busy, still stop at
-- the day's tries. Refused, it says why: reason 'tries' or 'month'.
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
  v_try     jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Questions are counted for a person who is signed in' USING ERRCODE = '42501';
  END IF;
  SELECT a.plus, a.monthly, a.ceiling INTO v_plus, v_monthly, v_ceiling FROM public.question_allowance(p_user_id) a;

  v_try := public.claim_daily(p_user_id, 'question_tries');
  IF NOT (v_try->>'allowed')::boolean THEN
    v_used := coalesce((SELECT u.questions FROM public.question_usage u
                         WHERE u.user_id = p_user_id AND u.month = v_month), 0);
    RETURN jsonb_build_object('allowed', false, 'reason', 'tries',
                              'tries', v_try->'used', 'tries_limit', v_try->'limit',
                              'used', v_used, 'limit', v_monthly, 'ceiling', v_ceiling,
                              'plus', coalesce(v_plus, false), 'resets_on', v_next);
  END IF;

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
                              'plus', coalesce(v_plus, false), 'resets_on', v_next,
                              'tries', v_try->'used', 'tries_limit', v_try->'limit');
  END IF;

  -- The month's are used up: nothing was asked, so the try goes back.
  UPDATE public.daily_usage SET question_tries = greatest(question_tries - 1, 0), updated_at = now()
   WHERE user_id = p_user_id AND day = public.usage_day();
  SELECT u.questions INTO v_used FROM public.question_usage u WHERE u.user_id = p_user_id AND u.month = v_month;
  RETURN jsonb_build_object('allowed', false, 'reason', 'month', 'used', v_used, 'limit', v_monthly, 'ceiling', v_ceiling,
                            'plus', coalesce(v_plus, false), 'resets_on', v_next);
END;
$fn$;


-- ─── 7. Saved chats: 50 a person in a vault ────────────────────────────────
-- Each is up to 256 KB of the shared database (028); 042 counts them in the
-- vault's storage, and this keeps their number in bounds too.
CREATE OR REPLACE FUNCTION public.saved_chats_within_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('saved_chats:' || NEW.user_id::text || ':' || NEW.family_id::text));
  IF (SELECT count(*) FROM public.saved_chats c
       WHERE c.user_id = NEW.user_id AND c.family_id = NEW.family_id) >= 50 THEN
    RAISE EXCEPTION 'You can keep 50 saved chats in a vault. Delete one to save this one.'
      USING ERRCODE = 'P0001', HINT = 'chat_limit';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS saved_chats_within_count ON public.saved_chats;
CREATE TRIGGER saved_chats_within_count
  BEFORE INSERT ON public.saved_chats
  FOR EACH ROW EXECUTE FUNCTION public.saved_chats_within_count();


-- ─── 8. Feedback: 10 messages a day ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS feedback_user_created ON public.feedback (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.feedback_within_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF (SELECT count(*) FROM public.feedback f
       WHERE f.user_id = NEW.user_id AND f.created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Thank you! You can send 10 messages a day. Please send this one tomorrow.'
      USING ERRCODE = 'P0001', HINT = 'feedback_limit';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS feedback_within_day ON public.feedback;
CREATE TRIGGER feedback_within_day
  BEFORE INSERT ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.feedback_within_day();


-- ─── 9. A family tree: 300 people ──────────────────────────────────────────
-- Members always fit: their person is made with the membership (031), and a
-- full tree must never stop someone joining.
CREATE OR REPLACE FUNCTION public.family_people_within_tree()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.user_id IS NULL AND (
    SELECT count(*) FROM public.family_people p WHERE p.family_id = NEW.family_id
  ) >= 300 THEN
    RAISE EXCEPTION 'This family tree is full at 300 people.'
      USING ERRCODE = 'P0001', HINT = 'tree_full';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS family_people_within_tree ON public.family_people;
CREATE TRIGGER family_people_within_tree
  BEFORE INSERT ON public.family_people
  FOR EACH ROW EXECUTE FUNCTION public.family_people_within_tree();


-- ─── 10. Devices: the newest 10 a person ───────────────────────────────────
-- Nothing is refused — a new phone must just work — the oldest is let go.
CREATE OR REPLACE FUNCTION public.push_subscriptions_newest_ten()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM public.push_subscriptions s
   WHERE s.id IN (
     SELECT p.id FROM public.push_subscriptions p
      WHERE p.user_id = NEW.user_id
      ORDER BY coalesce(p.last_used_at, p.created_at) DESC, p.created_at DESC
      OFFSET 10
   );
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS push_subscriptions_newest_ten ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_newest_ten
  AFTER INSERT OR UPDATE OF user_id ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.push_subscriptions_newest_ten();


-- ─── 11. Share links: 20 working a document, 100 opens a link ──────────────
CREATE OR REPLACE FUNCTION public.document_shares_within_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF (SELECT count(*) FROM public.document_shares s
       WHERE s.family_id = NEW.family_id AND s.document_id = NEW.document_id
         AND s.revoked_at IS NULL AND s.expires_at > now()) >= 20 THEN
    RAISE EXCEPTION 'This document has 20 working links. Turn one off to make another.'
      USING ERRCODE = 'P0001', HINT = 'share_limit';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS document_shares_within_limit ON public.document_shares;
CREATE TRIGGER document_shares_within_limit
  BEFORE INSERT ON public.document_shares
  FOR EACH ROW EXECUTE FUNCTION public.document_shares_within_limit();

-- 036's open_document_share, opening a link at most 100 times: each open
-- hands out download addresses, and downloads are the organisation's 5 GB a
-- month. Past it the link reads as gone, like one that expired.
CREATE OR REPLACE FUNCTION public.open_document_share(p_token_hash text)
RETURNS TABLE (storage_path text, file_name text, file_type text, expires_at timestamptz, shared_by text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_share public.document_shares%ROWTYPE;
  v_ns    text;
  v_doc   record;
  v_by    text;
BEGIN
  SELECT * INTO v_share FROM public.document_shares s
   WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now()
     AND s.open_count < 100;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.family_members m WHERE m.family_id = v_share.family_id AND m.user_id = v_share.created_by
  ) THEN
    RETURN;
  END IF;

  SELECT f.storage_namespace INTO v_ns FROM public.families f WHERE f.id = v_share.family_id;
  IF v_ns IS NULL OR v_ns !~ '^family_[0-9a-f]{8}$' THEN
    RETURN;
  END IF;
  EXECUTE format('SELECT d.storage_path, d.file_name, d.file_type FROM %I.documents d WHERE d.id = $1 AND NOT d.is_deleted', v_ns)
     INTO v_doc USING v_share.document_id;
  IF v_doc.storage_path IS NULL THEN
    RETURN;
  END IF;

  -- Whoever shared it, by first name: enough for the person who was sent it.
  SELECT split_part(btrim(u.display_name), ' ', 1) INTO v_by FROM public.users u WHERE u.id = v_share.created_by;
  UPDATE public.document_shares s SET open_count = s.open_count + 1, last_opened_at = now() WHERE s.id = v_share.id;

  RETURN QUERY SELECT v_doc.storage_path::text, v_doc.file_name::text, v_doc.file_type::text, v_share.expires_at, v_by;
END;
$fn$;


-- ─── 12. Invitations: 20 a day from a family, 3 to the same person ─────────
-- Each one is a notification on the person's phone (034). Withdrawing and
-- asking again made a new one each time, so a family could ring a stranger's
-- phone without end. Counted from audit_logs, which an invitation that is
-- withdrawn or declined does not take with it.
CREATE INDEX IF NOT EXISTS audit_logs_family_action_created ON public.audit_logs (family_id, action, created_at DESC);

CREATE OR REPLACE FUNCTION public.family_invites_within_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF (SELECT count(*) FROM public.audit_logs a
       WHERE a.family_id = NEW.family_id AND a.action = 'invite_sent'
         AND a.created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'This family has sent 20 invitations today. You can invite more tomorrow.'
      USING ERRCODE = 'P0001', HINT = 'invite_limit';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs a
       WHERE a.family_id = NEW.family_id AND a.action = 'invite_sent' AND a.resource_id = NEW.user_id
         AND a.created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'This person was invited 3 times today. You can ask them again tomorrow.'
      USING ERRCODE = 'P0001', HINT = 'invite_limit';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.family_invites_note_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (NEW.invited_by, NEW.family_id, 'invite_sent', 'user', NEW.user_id);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS family_invites_within_day ON public.family_invites;
CREATE TRIGGER family_invites_within_day
  BEFORE INSERT ON public.family_invites
  FOR EACH ROW EXECUTE FUNCTION public.family_invites_within_day();
DROP TRIGGER IF EXISTS family_invites_note_sent ON public.family_invites;
CREATE TRIGGER family_invites_note_sent
  AFTER INSERT ON public.family_invites
  FOR EACH ROW EXECUTE FUNCTION public.family_invites_note_sent();


-- ─── 13. Files up to 10 MB ─────────────────────────────────────────────────
-- The bucket was made by hand in the dashboard. Where Supabase does not let
-- this role change it — refused, or a guard on the storage tables — nothing
-- else in 050 is held back: the notice says to set it by hand.
DO $do$
BEGIN
  UPDATE storage.buckets SET file_size_limit = 10485760
   WHERE id = 'documents' AND (file_size_limit IS NULL OR file_size_limit > 10485760);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Set the documents bucket''s file size limit to 10 MB by hand: Storage › documents › Edit bucket (%).', SQLERRM;
END
$do$;


-- ─── 14. Who may call what ─────────────────────────────────────────────────
-- Take a user id, or are triggers: the server's alone.
REVOKE ALL ON FUNCTION public.usage_day() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_daily_limit(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_daily(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_document_read(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_question(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usage_day(), public.person_daily_limit(uuid, text), public.claim_daily(uuid, text),
  public.start_document_read(uuid, uuid, uuid), public.claim_question(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.saved_chats_within_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_within_day() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.family_people_within_tree() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_subscriptions_newest_ten() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.document_shares_within_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.family_invites_within_day() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.family_invites_note_sent() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.open_document_share(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_document_share(text) TO service_role;

-- Called by the app: signed-in people, and each checks who is calling first.
REVOKE ALL ON FUNCTION public.create_family(uuid, character varying, text, character varying, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_family(uuid, character varying, text, character varying, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.insert_family_document(uuid, uuid, character varying, character varying, bigint, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_family_document(uuid, uuid, character varying, character varying, bigint, text, uuid, uuid) TO authenticated, service_role;

COMMIT;
