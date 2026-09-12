-- ============================================================================
-- 014: Which languages a person's documents are written in
--
-- OCR has always run in English only, so a scanned Hindi or Bengali page came
-- back as garbage — and no amount of multilingual embedding helps text that
-- was never read correctly in the first place.
--
-- Tesseract has models for every major Indian script, but they are ~10-20MB
-- each and downloaded on demand, so loading all of them for everyone would be
-- wasteful. Instead the person says which languages their documents use, and
-- OCR loads exactly those.
--
-- This is per-user rather than per-family on purpose: the person holding the
-- phone is the one scanning, and they know what they are scanning. Two members
-- of the same family can have different settings without conflict.
--
-- English is always included at OCR time whether or not it is in this list —
-- Indian documents are almost always bilingual — so the default of {eng} means
-- "English only" and adding Hindi means "Hindi and English".
--
-- The app tolerates this column being absent (it falls back to the local
-- cache, like the voice preferences in migration 012), but the setting will
-- not follow the account until it is applied.
--
-- Apply: paste into the SQL editor — DEV first, then PROD.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS document_languages TEXT[] NOT NULL DEFAULT ARRAY['eng'];
