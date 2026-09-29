-- ============================================================================
-- 027: what the Settings screens write — your own name and phone, the
-- notifications switch, and feedback
--
-- 025 left clients three writable columns on public.users (the voice and
-- document-language preferences) and said a new writable column needs its own
-- GRANT. These are those grants, and nothing wider:
--
--   1. display_name, phone — Settings › Profile. users_update_own (007)
--      already limits an UPDATE to the caller's own row, so each person can
--      rename only themselves. The name is what the family sees in member
--      lists and on documents, which is the point.
--
--   2. notifications_enabled — Settings › Notifications. Read by the app to
--      decide whether to show the bell's count and the notifications list.
--      Nothing server-side reads it: expiry alerts are still written for
--      every member (check_expiry_notifications, 023), and switching back on
--      shows them. Defaults to on, so every existing account is unchanged.
--
--   3. public.feedback — Help & FAQ › Send feedback. A signed-in person can
--      add a message as themselves and read nothing back, their own included;
--      the team reads them in the dashboard, as the service role. user_id is
--      never sent by the app: it defaults to auth.uid(), and the policy
--      rejects any other value.
--
-- The app works before this is applied: the profile name still changes (it
-- is also kept in the sign-in account), the notifications switch is kept on
-- the device, and sending feedback says it could not be sent.
--
-- Apply: paste into the SQL editor — DEV, then PROD in the same sitting, then
-- run qa/sql/fingerprint.sql on both: the "columns clients may write" row
-- changes on each. Idempotent. No function is added or changed, so the 023
-- sweep is unaffected.
-- ============================================================================

BEGIN;

-- ─── 1. Profile: your own name and phone ────────────────────────────────────

GRANT UPDATE (display_name, phone) ON public.users TO authenticated;


-- ─── 2. The notifications switch ───────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT true;

GRANT UPDATE (notifications_enabled) ON public.users TO authenticated;


-- ─── 3. Feedback: write-only for the person, read by the team ───────────────

CREATE TABLE IF NOT EXISTS public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  topic       text CHECK (topic IN ('problem', 'idea', 'question', 'other')),
  message     text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  app_version text CHECK (char_length(app_version) <= 40),
  platform    text CHECK (char_length(platform) <= 20),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON public.feedback (created_at DESC);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Supabase grants anon and authenticated everything on a new table; take it
-- all back by name (REVOKE ... FROM PUBLIC alone is not enough), then give
-- back exactly the columns the app sends. No SELECT, so a client cannot read
-- any row — the app inserts with return=minimal and never asks for one back.
REVOKE ALL ON public.feedback FROM PUBLIC, anon, authenticated;
GRANT INSERT (topic, message, app_version, platform) ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;

DROP POLICY IF EXISTS feedback_insert_own ON public.feedback;
CREATE POLICY feedback_insert_own ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

COMMIT;
