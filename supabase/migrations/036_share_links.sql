-- ============================================================================
-- 036: share one document by a link that expires
--
-- For a tax accountant, a visa agent, an insurance agent: someone outside the
-- family who needs one document, once, without an account. The document page
-- makes a link that lasts 1, 7 or 30 days; anyone with it can open that one
-- document until then; whoever made it, or a family admin, can turn it off;
-- the family sees every live link on the document's page, with how often it
-- was opened.
--
-- Before this, Share sent the file's raw storage address: it stopped working
-- after an hour without saying so, could not be turned off, and left no trace.
--
--   • The link's secret is 64 random hex characters (two v4 UUIDs, 244 bits)
--     in the part of the address after '#', which a browser never sends to a
--     server — so it is not in any web server's logs. Only its SHA-256 is
--     stored (token_hash), and clients cannot read even that.
--   • Who may share: a family admin, whoever added the document, or the
--     person it belongs to. The same three a family would ask.
--   • The person a document belongs to, if they have an account and did not
--     make the link, is told by a notification.
--   • Opening goes through the share Edge Function, which calls
--     open_document_share() — service role only, as it hands out a storage
--     path — and answers with a five-minute download address. A link stops
--     when it expires, is turned off, the document is deleted, or whoever
--     made it is no longer in the family.
--
-- The app works before this is applied: Share says links are not switched on
-- yet.
--
-- Apply: paste into the SQL editor — DEV, then PROD — then run
-- qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent. Needs 031 (the family tree: who a document belongs to).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.document_shares (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  document_id    uuid NOT NULL,            -- in the family's own schema; checked when made and when opened
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note           text CHECK (length(note) <= 80),   -- who it is for: "CA Sharma"
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  open_count     integer NOT NULL DEFAULT 0,
  last_opened_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_shares_document ON public.document_shares (family_id, document_id);

ALTER TABLE public.document_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_shares FROM PUBLIC, anon, authenticated;
-- The family reads its links — every column but the secret's hash.
GRANT SELECT (id, family_id, document_id, created_by, note, expires_at, revoked_at, revoked_by,
              open_count, last_opened_at, created_at)
  ON public.document_shares TO authenticated;

DROP POLICY IF EXISTS document_shares_select_family ON public.document_shares;
CREATE POLICY document_shares_select_family ON public.document_shares
  FOR SELECT TO authenticated
  USING (family_id IN (SELECT public.get_my_family_ids()));


-- Make a link. The caller from auth.uid(); returns the secret, the only time
-- it is ever seen.
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

REVOKE ALL ON FUNCTION public.create_document_share(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_document_share(uuid, uuid, integer, text) TO authenticated, service_role;


-- Turn a link off: whoever made it, or a family admin.
CREATE OR REPLACE FUNCTION public.revoke_document_share(p_share_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me    uuid := auth.uid();
  v_share public.document_shares%ROWTYPE;
BEGIN
  SELECT * INTO v_share FROM public.document_shares WHERE id = p_share_id;
  IF NOT FOUND OR v_me IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_members WHERE family_id = v_share.family_id AND user_id = v_me
  ) THEN
    RAISE EXCEPTION 'Not allowed: that link is not in your family' USING ERRCODE = '42501';
  END IF;
  IF v_share.created_by <> v_me AND NOT EXISTS (
    SELECT 1 FROM public.family_members WHERE family_id = v_share.family_id AND user_id = v_me AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only whoever made the link, or a family admin, can turn it off.' USING ERRCODE = '42501';
  END IF;
  IF v_share.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.document_shares SET revoked_at = now(), revoked_by = v_me WHERE id = p_share_id;
  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_share.family_id, 'unshare_document', 'document', v_share.document_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.revoke_document_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_document_share(uuid) TO authenticated, service_role;


-- A link opened: the share Edge Function only, by the secret's hash. Nothing
-- comes back for a link that has expired, been turned off, or lost its
-- document or its maker; otherwise the file to hand out, counted.
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
   WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now();
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

REVOKE ALL ON FUNCTION public.open_document_share(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_document_share(text) TO service_role;

COMMIT;
