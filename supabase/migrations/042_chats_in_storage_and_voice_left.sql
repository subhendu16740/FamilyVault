-- ============================================================================
-- 042: Saved chats take the family's storage too; how many voice chats are left
--
-- Saved chats (028) were outside the storage limit (038–040). Now they count:
--
--   • family_storage_status() adds a family's saved chats to what its files
--     use, and says how much of it is chats (chats_bytes). So Settings ›
--     Storage, the documents bucket's upload policy and Gmail import all
--     count the same bytes: files and chats together.
--   • A chat that would take a family past its limit is not saved: a trigger
--     refuses a new chat, or a saved chat growing, without room for it (HINT
--     storage_full). The same size or smaller is always allowed. The app asks
--     first and says what to do: Family Plus on the free plan, making room on
--     Plus.
--   • Nothing removes a chat. When Plus ends (040), only documents above the
--     free limit are removed, as before — a family whose chats keep it over
--     the limit afterwards can read everything and add nothing until it
--     makes room.
--
-- A chat's size is what it says: octet_length(messages::text). A chat is at
-- most 256 KB (028), so two saved at the same moment can take a family past
-- its limit by at most that, as a last file can (038).
--
-- Voice chats (041's answers read aloud, now counted as voice chats: one
-- question asked by voice or answer read aloud, once per question):
-- family_voice_status() says how many a family has left without using one,
-- for Ask and Settings to show. Any member, for their own family only.
--
-- Apply after 041: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows). Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. What a family's saved chats add up to ───────────────────────────────
CREATE OR REPLACE FUNCTION public.family_chats_bytes(p_family_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT coalesce(sum(octet_length(c.messages::text)), 0)::bigint
    FROM public.saved_chats c
   WHERE c.family_id = p_family_id;
$fn$;
REVOKE ALL ON FUNCTION public.family_chats_bytes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_chats_bytes(uuid) TO service_role;


-- ─── 2. A family's storage: its files and its saved chats ───────────────────
-- 040's, with chats in used_bytes and on their own in chats_bytes. Its result
-- changes shape, so it is dropped and made again, and family_storage_has_room()
-- (which the upload policy calls) is restated after it.
DROP FUNCTION IF EXISTS public.family_storage_status(uuid);
CREATE FUNCTION public.family_storage_status(p_family_id uuid)
RETURNS TABLE (plan text, paid_until timestamptz, limit_bytes bigint, used_bytes bigint, removal_at timestamptz, chats_bytes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ns    text;
  v_plan  text;
  v_until timestamptz;
  v_chats bigint;
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

  v_chats := public.family_chats_bytes(p_family_id);
  RETURN QUERY
  SELECT v_plan, v_until,
         (SELECT pl.storage_bytes FROM public.plan_limits pl WHERE pl.plan = v_plan),
         public.family_files_bytes(v_ns) + v_chats,
         public.plan_removal_at(p_family_id),
         v_chats;
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


-- ─── 3. A chat is saved only when it fits ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.saved_chats_within_storage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_grows bigint := octet_length(NEW.messages::text)
                  - CASE WHEN TG_OP = 'UPDATE' THEN octet_length(OLD.messages::text) ELSE 0 END;
  v_ns    text;
  v_limit bigint;
  v_used  bigint;
BEGIN
  -- The same size or smaller: a new title, a shorter chat. Always allowed.
  IF v_grows <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT f.storage_namespace INTO v_ns FROM public.families f WHERE f.id = NEW.family_id;
  SELECT pl.storage_bytes INTO v_limit FROM public.plan_limits pl WHERE pl.plan = public.family_plan_now(NEW.family_id);
  -- Before an update this still counts the chat as it was, so used + grows
  -- is what the family would hold with the chat saved.
  v_used := public.family_files_bytes(v_ns) + public.family_chats_bytes(NEW.family_id);
  IF v_limit IS NOT NULL AND v_used + v_grows > v_limit THEN
    RAISE EXCEPTION 'There is no room to save this chat: your family has used % GB of its % GB. Delete documents or saved chats you no longer need to make room%.',
                    public.gb_text(v_used), public.gb_text(v_limit),
                    CASE WHEN public.family_plan_now(NEW.family_id) = 'free' THEN ', or move to Family Plus for more' ELSE '' END
      USING ERRCODE = 'P0001', HINT = 'storage_full';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.saved_chats_within_storage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS saved_chats_within_storage ON public.saved_chats;
CREATE TRIGGER saved_chats_within_storage
  BEFORE INSERT OR UPDATE OF messages ON public.saved_chats
  FOR EACH ROW EXECUTE FUNCTION public.saved_chats_within_storage();


-- ─── 4. How many voice chats a family has left ──────────────────────────────
-- What claim_voice_answer() (041) would say, without using one: limit, used
-- and left, all NULL on a plan with no limit.
CREATE OR REPLACE FUNCTION public.family_voice_status(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  PERFORM public.assert_caller_in_family(p_family_id);

  SELECT pl.voice_answers INTO v_limit FROM public.plan_limits pl WHERE pl.plan = public.family_plan_now(p_family_id);
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('limit', NULL, 'used', NULL, 'left', NULL);
  END IF;
  v_used := coalesce((SELECT u.voice_answers FROM public.family_usage u WHERE u.family_id = p_family_id), 0);
  RETURN jsonb_build_object('limit', v_limit, 'used', v_used, 'left', greatest(v_limit - v_used, 0));
END;
$fn$;
REVOKE ALL ON FUNCTION public.family_voice_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_voice_status(uuid) TO authenticated, service_role;

COMMIT;
