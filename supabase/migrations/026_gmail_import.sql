-- ============================================================================
-- 026: Gmail import — the three tables behind "Import from Gmail"
--
-- A person connects their OWN Gmail account; FamilyVault looks through it for
-- attachments that look like documents (PDFs and photos), the person ticks
-- the ones they want, and each goes through the normal upload pipeline into
-- the family's vault. Nothing is imported without that tick.
--
-- The Edge Functions gmail-connect, gmail-callback, gmail-scan and
-- gmail-import do all of it on the service role. No client reads or writes
-- these tables, so RLS is on with NO policies and every client grant is
-- revoked — the shape of family_embedding_state, and of 025's rule that a
-- client writes only what the app writes.
--
--   gmail_oauth_states   one row per "Connect Gmail" press, good for ten
--                        minutes: who pressed it, where the browser returns,
--                        and the PKCE verifier, which never leaves the server
--   gmail_connections    one per person: the Google address, the refresh
--                        token ENCRYPTED (AES-GCM; the key is the
--                        GMAIL_TOKEN_KEY Edge Function secret, never stored
--                        here), and the scan's cursor and lease
--   gmail_import_items   what the scan found: message and part ids, and the
--                        details shown for review (sender, subject, file
--                        name, size). Only the person who connected sees
--                        them — Dad's inbox is not the family's business
--                        until he imports a file.
--
-- Metadata only: no email body and no attachment is stored until someone
-- imports it, and then only the attachment, as a family document. Gmail's
-- attachment ids are deliberately NOT kept: they change on every fetch and
-- every one ever issued stays valid, so the import looks the part up again.
--
-- Disconnecting revokes the token at Google and deletes the connection and
-- everything found. Deleting the account deletes all of it (cascade).
-- Documents already imported stay in the vault: they are the family's now.
--
-- Apply: paste into the SQL editor — DEV and PROD in the same sitting, so
-- the DEV/PROD fingerprint (qa/sql/fingerprint.sql) stays identical. The
-- tables do nothing on a project where the Gmail functions are not deployed.
-- Idempotent. No function is added, so the 023 sweep is unaffected.
-- ============================================================================


-- ─── 1. One "Connect Gmail" press ───────────────────────────────────────────
-- Claimed exactly once, by the account that created it, within ten minutes
-- (gmail-connect's finish). The callback only reads return_to.

CREATE TABLE IF NOT EXISTS public.gmail_oauth_states (
  state          text        PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  return_to      text        NOT NULL,
  code_verifier  text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  used_at        timestamptz
);

CREATE INDEX IF NOT EXISTS gmail_oauth_states_expires_idx
  ON public.gmail_oauth_states (expires_at);


-- ─── 2. A person's connected Gmail account ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gmail_connections (
  user_id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email       text        NOT NULL,
  refresh_token_enc  text        NOT NULL,
  scopes             text        NOT NULL,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  -- Google refused the refresh token: revoked by the person, or the 7-day
  -- limit Google puts on tokens while the app is in "Testing".
  expired_at         timestamptz,
  -- Gmail's page token for the next batch. NULL before the first batch and
  -- after the last one (scan_finished_at says which).
  scan_page_token    text,
  scan_started_at    timestamptz,
  scan_finished_at   timestamptz,
  -- One batch at a time per person: a conditional update takes it.
  scan_lease_until   timestamptz,
  messages_scanned   integer     NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);


-- ─── 3. What the scan found ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gmail_import_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id      text        NOT NULL,
  part_id         text        NOT NULL,
  file_name       text        NOT NULL,
  mime_type       text        NOT NULL,
  size_bytes      integer     NOT NULL DEFAULT 0,
  sender          text,
  subject         text,
  sent_at         timestamptz,
  suggestion      text        NOT NULL CHECK (suggestion IN ('suggested', 'maybe', 'unlikely')),
  reason          text,
  category_guess  text,
  status          text        NOT NULL DEFAULT 'found'
                              CHECK (status IN ('found', 'importing', 'imported', 'duplicate', 'failed')),
  error           text,
  -- When an import took it. An import that died mid-way leaves 'importing'
  -- behind; after five minutes the item may be claimed again.
  claimed_at      timestamptz,
  family_id       uuid        REFERENCES public.families(id) ON DELETE SET NULL,
  document_id     uuid,
  content_sha256  text,
  imported_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id, part_id)
);

CREATE INDEX IF NOT EXISTS gmail_import_items_user_idx
  ON public.gmail_import_items (user_id, status);
-- The duplicate check at import: the same bytes already imported by this
-- person into this family.
CREATE INDEX IF NOT EXISTS gmail_import_items_sha_idx
  ON public.gmail_import_items (user_id, family_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;


-- ─── 4. Service role only ───────────────────────────────────────────────────
-- RLS with no policies hides every row from anon and authenticated; the
-- revokes remove the table rights Supabase grants them by default, so even
-- the attempt is refused. The Edge Functions check the caller themselves.

ALTER TABLE public.gmail_oauth_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_import_items  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gmail_oauth_states  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gmail_connections   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gmail_import_items  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.gmail_oauth_states  TO service_role;
GRANT ALL ON TABLE public.gmail_connections   TO service_role;
GRANT ALL ON TABLE public.gmail_import_items  TO service_role;


-- ─── Check (run after applying; expect three rows, all false) ───────────────
-- SELECT table_name,
--        has_table_privilege('authenticated', 'public.' || table_name, 'SELECT') AS authenticated_can_read,
--        has_table_privilege('anon', 'public.' || table_name, 'SELECT')          AS anon_can_read
-- FROM (VALUES ('gmail_oauth_states'), ('gmail_connections'), ('gmail_import_items')) t(table_name);
