-- ─── 046: Personal vaults — one per person, for them alone ─────────
--
-- Every account has a personal vault: a family of one (`is_personal`) that
-- nobody else can be invited to or join. Someone in no family uploads into
-- it; someone in a family is asked, on every upload, where the document goes
-- — their personal vault or one of their families. Ask searches every vault
-- a person is in (rag-search), or only the one they pick.
--
-- 1. One personal vault per person: a unique index on families(created_by)
--    where is_personal.
-- 2. ensure_personal_vault() returns the caller's personal vault, making it
--    the first time it is asked for. The caller comes from auth.uid(), never
--    a parameter (CLAUDE.md, point 2). Two tabs opening at once make one
--    vault, not two: the calls for one person are serialised, and the index
--    is the backstop.
-- 3. Nobody else joins a personal vault. Triggers on family_members and
--    family_invites refuse a membership for anyone but its owner, and any
--    invitation at all, on every path in: add-member, link-account,
--    accepting, and the older functions kept from 025 and 033. This is how
--    041 keeps its limits. Before 046, a vault's first member being joined by a
--    second turned it from personal into shared ("vault becomes shared");
--    now a personal vault stays personal, and sharing is what a family is
--    for. Those lines remain in the older functions and are never reached
--    for a personal vault: the insert before them is refused first.
--
-- Otherwise a personal vault is a family like any other: its own schema,
-- storage limit (Free 1 GB) and plan, its own family tree (so a document can
-- still be marked as Mom's), and it goes with the account (029: its last
-- admin and only member).
--
-- Safe to run more than once.
-- ────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. One personal vault per person ───────────────────────────
-- Before the index: a "personal" family someone else has already joined is
-- a shared one, and a person with two keeps the older as personal. Both are
-- no-ops on DEV and PROD today (one personal family on DEV, with only its
-- owner; none on PROD).
UPDATE public.families f SET is_personal = false
 WHERE f.is_personal
   AND EXISTS (SELECT 1 FROM public.family_members m
                WHERE m.family_id = f.id AND m.user_id IS DISTINCT FROM f.created_by);
UPDATE public.families f SET is_personal = false
 WHERE f.is_personal
   AND EXISTS (SELECT 1 FROM public.families g
                WHERE g.is_personal AND g.created_by = f.created_by
                  AND (g.created_at, g.id) < (f.created_at, f.id));

CREATE UNIQUE INDEX IF NOT EXISTS families_one_personal_vault
  ON public.families (created_by) WHERE is_personal;


-- ─── 2. The caller's personal vault, made when first asked for ──
CREATE OR REPLACE FUNCTION public.ensure_personal_vault()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_id FROM public.families WHERE created_by = v_me AND is_personal;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Two tabs at sign-in: the second waits for the first, then finds its vault.
  PERFORM pg_advisory_xact_lock(hashtextextended('personal_vault:' || v_me::text, 0));
  SELECT id INTO v_id FROM public.families WHERE created_by = v_me AND is_personal;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- create_family's own check (assert_caller_is) passes: auth.uid() is
  -- still the caller inside this function.
  RETURN public.create_family(v_me, 'Personal vault', NULL, NULL, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ensure_personal_vault() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_personal_vault() TO authenticated, service_role;


-- ─── 3. Nobody else joins a personal vault ──────────────────────
-- HINT 'personal_vault' lets add-member and link-account answer in these
-- words. Not 42501: they read that code as "only an admin can do this".
CREATE OR REPLACE FUNCTION public.personal_vault_stays_personal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_owner uuid;
BEGIN
  SELECT created_by INTO v_owner FROM public.families WHERE id = NEW.family_id AND is_personal;
  IF FOUND AND (TG_TABLE_NAME = 'family_invites' OR NEW.user_id IS DISTINCT FROM v_owner) THEN
    RAISE EXCEPTION 'A personal vault is for its owner alone: nobody else can be invited to it or join it. Create a family to share documents.'
      USING HINT = 'personal_vault';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.personal_vault_stays_personal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS family_members_personal_vault ON public.family_members;
CREATE TRIGGER family_members_personal_vault
  BEFORE INSERT ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.personal_vault_stays_personal();

DROP TRIGGER IF EXISTS family_invites_personal_vault ON public.family_invites;
CREATE TRIGGER family_invites_personal_vault
  BEFORE INSERT ON public.family_invites
  FOR EACH ROW EXECUTE FUNCTION public.personal_vault_stays_personal();

COMMIT;
