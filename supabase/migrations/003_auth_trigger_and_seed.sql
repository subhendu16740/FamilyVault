-- =============================================
-- FamilyVault: Auth Trigger + Seed Data
-- Run this AFTER 002_rls_policies.sql
-- =============================================

-- ========================
-- AUTH TRIGGER
-- Auto-create public.users row when a new user signs up
-- ========================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, auth_provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'provider', 'email')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists (safe re-run)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========================
-- SEED: System Document Categories
-- ========================
INSERT INTO public.document_categories (name, icon, has_expiry, is_system, created_by) VALUES
  ('Passport', '🛂', true, true, NULL),
  ('National ID / Aadhaar', '🪪', false, true, NULL),
  ('PAN Card', '💳', false, true, NULL),
  ('Driving License', '🚗', true, true, NULL),
  ('Voter ID', '🗳️', false, true, NULL),
  ('Birth Certificate', '👶', false, true, NULL),
  ('Marriage Certificate', '💒', false, true, NULL),
  ('Death Certificate', '📜', false, true, NULL),
  ('Health Insurance', '🏥', true, true, NULL),
  ('Life Insurance', '🛡️', true, true, NULL),
  ('Vehicle Insurance', '🚘', true, true, NULL),
  ('Property Documents', '🏠', false, true, NULL),
  ('Tax Returns', '📊', false, true, NULL),
  ('Bank Statements', '🏦', false, true, NULL),
  ('Medical Records', '🩺', false, true, NULL),
  ('Prescriptions', '💊', true, true, NULL),
  ('Educational Certificates', '🎓', false, true, NULL),
  ('Employment Letters', '💼', false, true, NULL),
  ('Utility Bills', '📑', false, true, NULL),
  ('Visa / Travel Docs', '✈️', true, true, NULL),
  ('Legal Documents', '⚖️', false, true, NULL),
  ('Warranty Cards', '🔧', true, true, NULL),
  ('Other', '📁', false, true, NULL);
