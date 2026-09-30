-- ============================================================================
-- 028: saved chats — Ask › Save chat, and the clock that lists them
--
-- A conversation on Ask lived only on the screen: leaving, refreshing or
-- starting a new question lost it. This keeps the ones a person chooses to
-- save, in their account, so they are there on any device.
--
--   • Only the person who saved a chat ever sees it — not their family, not
--     an admin. A chat is made of answers drawn from a family's documents, so
--     it belongs to its owner's MEMBERSHIP of that family: a foreign key to
--     family_members (family_id, user_id) with ON DELETE CASCADE. Leave the
--     family, or be removed from it, and your chats about it are deleted with
--     the membership — no function, no trigger, and referential actions pass
--     RLS by design. Both projects carry family_members' UNIQUE (family_id,
--     user_id), which the key needs.
--   • Nothing is saved without the Save button. After that, the chat keeps
--     itself up to date as the conversation goes on, until it is deleted.
--   • Clients write only the columns the app writes (the 025 rule): INSERT
--     family_id, title, messages; UPDATE title, messages, updated_at. user_id
--     is never sent: it defaults to auth.uid(), and the policies reject any
--     other value.
--   • Membership is checked with get_my_family_ids() (007), which takes the
--     caller from auth.uid(). No function is added or changed, so the 023
--     sweep is unaffected.
--
-- The app works before this is applied: Save chat and the saved-chats list
-- say saving is not switched on yet, and asking questions is unchanged.
--
-- Apply: paste into the SQL editor — DEV, then PROD in the same sitting, then
-- run qa/sql/fingerprint.sql on both: the columns, policies, RLS, indexes,
-- constraints, table grants and client-writable-columns rows change on each.
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_chats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  -- [{ role: 'user' | 'ai', text, sources?: [{ id, file_name, … }] }, …]
  messages    jsonb NOT NULL
              CHECK (jsonb_typeof(messages) = 'array' AND pg_column_size(messages) <= 262144),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_chats_membership_fkey FOREIGN KEY (family_id, user_id)
    REFERENCES public.family_members (family_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS saved_chats_owner_idx
  ON public.saved_chats (user_id, family_id, updated_at DESC);

ALTER TABLE public.saved_chats ENABLE ROW LEVEL SECURITY;

-- Supabase grants anon and authenticated everything on a new table; take it
-- all back by name (REVOKE ... FROM PUBLIC alone is not enough), then give
-- back exactly what the app does.
REVOKE ALL ON public.saved_chats FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.saved_chats TO authenticated;
GRANT INSERT (family_id, title, messages) ON public.saved_chats TO authenticated;
GRANT UPDATE (title, messages, updated_at) ON public.saved_chats TO authenticated;
GRANT ALL ON public.saved_chats TO service_role;

DROP POLICY IF EXISTS saved_chats_select_own ON public.saved_chats;
CREATE POLICY saved_chats_select_own ON public.saved_chats
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND family_id IN (SELECT public.get_my_family_ids()));

DROP POLICY IF EXISTS saved_chats_insert_own ON public.saved_chats;
CREATE POLICY saved_chats_insert_own ON public.saved_chats
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND family_id IN (SELECT public.get_my_family_ids()));

DROP POLICY IF EXISTS saved_chats_update_own ON public.saved_chats;
CREATE POLICY saved_chats_update_own ON public.saved_chats
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND family_id IN (SELECT public.get_my_family_ids()))
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS saved_chats_delete_own ON public.saved_chats;
CREATE POLICY saved_chats_delete_own ON public.saved_chats
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMIT;
