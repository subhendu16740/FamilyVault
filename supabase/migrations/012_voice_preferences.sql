-- 012: Voice assistant preferences
--
-- Two per-user settings behind the Settings › Accessibility group:
--   voice_mode_enabled  — the search screen shows a tap-to-talk microphone
--                         and reads answers aloud
--   voice_language      — BCP-47 tag for both recognition and the voice,
--                         e.g. 'en-IN', 'hi-IN', 'bn-IN'
--
-- Stored on the account (not the device) so a relative can switch it on for
-- an elderly member from their own phone. The app also caches both values
-- locally and keeps working if this migration has not been applied yet —
-- the read simply fails and the local value is used.
--
-- The existing users_select_own / users_update_own policies already cover
-- reading and writing one's own row; no new RLS.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS voice_mode_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_language VARCHAR(10) NOT NULL DEFAULT 'en-IN';
