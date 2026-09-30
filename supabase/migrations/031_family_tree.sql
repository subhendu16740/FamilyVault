-- ============================================================================
-- 031: the family tree — everyone in the family, and how they are related
--
-- A family is more than its accounts: a grandmother who will never sign in,
-- a child too young to. This adds the people and the links between them, so
-- the app can draw the tree, label each person from where the viewer stands
-- ("Your grandmother (Nani)"), mark documents as theirs, and answer
-- "Nani's pension papers".
--
--   • public.family_people — one row per person. A person with an account
--     carries its user_id. A member's own row is created with their
--     membership and takes their MEMBER id, so every document already marked
--     as a member's (documents.belongs_to_member) is now marked as that
--     person's, with nothing rewritten. Leaving the family, or deleting the
--     account, clears user_id: the family keeps the person in its tree, as
--     it keeps the documents they added, and the delete-account screen says
--     so.
--   • public.family_links — parent, spouse or sibling, never a label. What
--     someone is called depends on who is looking, and is worked out by
--     supabase/functions/_shared/kinship.ts. One link per pair of people.
--     A parent link reads from → to; spouse and sibling are stored once,
--     smaller id first. Both people must belong to the link's family (a
--     composite foreign key).
--   • Every member of the family reads the tree (RLS through
--     get_my_family_ids()). Clients write nothing directly. Four functions
--     do the writing: add_family_person, link_family_people,
--     update_family_person and remove_family_person. Each takes the caller
--     from auth.uid(). Only an admin changes the tree, except that a person
--     with an account may edit their own name, gender and birth date. The 023
--     sweep stays at zero rows. The helpers they share are revoked from every
--     client role.
--   • rag_documents_for_people() lists the documents marked as given people,
--     for rag-search ("Nani's pension papers"). It takes the family's schema,
--     so it is service role only, like every rag_* function.
--   • The document list and viewer name a document's person from the tree,
--     so a document marked as a grandmother's shows her name. Before this,
--     only members could be named — and the lookup did not check the family,
--     so a document marked with another family's member id named a stranger.
--
-- The app works before this is applied: the tree screen says it is not
-- switched on yet, and documents are marked with members as before.
--
-- Apply: paste into the SQL editor — DEV, then PROD in the same sitting, then
-- run qa/sql/sweep.sql (zero rows) and qa/sql/fingerprint.sql on both.
-- Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. People ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_people (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  -- Their FamilyVault account, while they are a member of this family.
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name  text        NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  -- Only used to name relations: Nana or Nani, Bua or Mama.
  gender        text        CHECK (gender IN ('female', 'male')),
  -- Only used to tell elder from younger (Tau or Chacha) and to show an age.
  birth_date    date        CHECK (birth_date >= DATE '1850-01-01'),
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- The target of family_links' composite keys.
  CONSTRAINT family_people_family_id_id_key UNIQUE (family_id, id),
  -- One person per account per family. NULLs do not collide.
  CONSTRAINT family_people_family_id_user_id_key UNIQUE (family_id, user_id)
);

CREATE INDEX IF NOT EXISTS family_people_user_idx ON public.family_people (user_id);


-- ─── 2. How they are related ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  from_person  uuid        NOT NULL,
  to_person    uuid        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('parent', 'spouse', 'sibling')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_links_from_fkey FOREIGN KEY (family_id, from_person)
    REFERENCES public.family_people (family_id, id) ON DELETE CASCADE,
  CONSTRAINT family_links_to_fkey FOREIGN KEY (family_id, to_person)
    REFERENCES public.family_people (family_id, id) ON DELETE CASCADE,
  CONSTRAINT family_links_not_self CHECK (from_person <> to_person),
  -- Spouse and sibling read both ways, so they are stored once.
  CONSTRAINT family_links_pair_order CHECK (kind = 'parent' OR from_person < to_person)
);

-- One link per pair, whatever its kind or direction: nobody is both someone's
-- parent and their spouse, or both parent and child of the same person.
CREATE UNIQUE INDEX IF NOT EXISTS family_links_one_per_pair
  ON public.family_links (LEAST(from_person, to_person), GREATEST(from_person, to_person));
CREATE INDEX IF NOT EXISTS family_links_family_idx ON public.family_links (family_id);
CREATE INDEX IF NOT EXISTS family_links_to_idx ON public.family_links (to_person);


-- ─── 3. Who may read and write ──────────────────────────────────────────────
ALTER TABLE public.family_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_links  ENABLE ROW LEVEL SECURITY;

-- Supabase grants every new table to anon and authenticated. Take it all back
-- by name (REVOKE ... FROM PUBLIC alone is not enough), then give members
-- SELECT only: every write goes through the functions below.
REVOKE ALL ON public.family_people, public.family_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.family_people, public.family_links TO authenticated;
GRANT ALL ON public.family_people, public.family_links TO service_role;

DROP POLICY IF EXISTS family_people_select_member ON public.family_people;
CREATE POLICY family_people_select_member ON public.family_people
  FOR SELECT TO authenticated
  USING (family_id IN (SELECT public.get_my_family_ids()));

DROP POLICY IF EXISTS family_links_select_member ON public.family_links;
CREATE POLICY family_links_select_member ON public.family_links
  FOR SELECT TO authenticated
  USING (family_id IN (SELECT public.get_my_family_ids()));


-- ─── 4. Shared checks (server only) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tree_check_details(p_display_name text, p_gender text, p_birth_date date)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
BEGIN
  IF p_display_name IS NULL OR char_length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'Please enter a name.' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(p_display_name)) > 80 THEN
    RAISE EXCEPTION 'That name is too long (80 characters at most).' USING ERRCODE = '22023';
  END IF;
  IF p_gender IS NOT NULL AND p_gender NOT IN ('female', 'male') THEN
    RAISE EXCEPTION 'Unknown gender.' USING ERRCODE = '22023';
  END IF;
  IF p_birth_date IS NOT NULL AND p_birth_date < DATE '1850-01-01' THEN
    RAISE EXCEPTION 'That date of birth is too far in the past.' USING ERRCODE = '22023';
  END IF;
END;
$fn$;

-- p_parent becomes a parent of p_child. Both are already known to be in the family.
CREATE OR REPLACE FUNCTION public.tree_add_parent(p_family_id uuid, p_parent uuid, p_child uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_existing record;
BEGIN
  SELECT from_person, to_person, kind INTO v_existing
    FROM public.family_links
   WHERE LEAST(from_person, to_person) = LEAST(p_parent, p_child)
     AND GREATEST(from_person, to_person) = GREATEST(p_parent, p_child);
  IF FOUND THEN
    IF v_existing.kind = 'parent' AND v_existing.from_person = p_parent THEN
      RETURN;                                   -- already recorded
    END IF;
    RAISE EXCEPTION 'These two are already connected in the tree.' USING ERRCODE = '23505';
  END IF;

  IF (SELECT count(*) FROM public.family_links WHERE to_person = p_child AND kind = 'parent') >= 2 THEN
    RAISE EXCEPTION 'Someone can have at most two parents in the tree.' USING ERRCODE = '23514';
  END IF;

  -- Nobody may become their own ancestor: refuse if the child is already
  -- above the parent.
  IF EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT p_parent
      UNION
      SELECT l.from_person FROM public.family_links l JOIN up ON l.to_person = up.id
       WHERE l.kind = 'parent'
    )
    SELECT 1 FROM up WHERE id = p_child
  ) THEN
    RAISE EXCEPTION 'That would make someone their own ancestor.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.family_links (family_id, from_person, to_person, kind)
  VALUES (p_family_id, p_parent, p_child, 'parent');
END;
$fn$;

-- A spouse or sibling link, stored once with the smaller id first.
CREATE OR REPLACE FUNCTION public.tree_add_pair(p_family_id uuid, p_a uuid, p_b uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_kind text;
BEGIN
  SELECT kind INTO v_kind
    FROM public.family_links
   WHERE LEAST(from_person, to_person) = LEAST(p_a, p_b)
     AND GREATEST(from_person, to_person) = GREATEST(p_a, p_b);
  IF FOUND THEN
    IF v_kind = p_kind THEN RETURN; END IF;     -- already recorded
    RAISE EXCEPTION 'These two are already connected in the tree.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.family_links (family_id, from_person, to_person, kind)
  VALUES (p_family_id, LEAST(p_a, p_b), GREATEST(p_a, p_b), p_kind);
END;
$fn$;

-- "p_person is the <p_relation> of p_relative" (and, for a child, of
-- p_other_parent too).
CREATE OR REPLACE FUNCTION public.tree_connect(
  p_family_id uuid, p_person uuid, p_relation text, p_relative uuid, p_other_parent uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF p_relation NOT IN ('parent', 'child', 'spouse', 'sibling') THEN
    RAISE EXCEPTION 'Unknown relation.' USING ERRCODE = '22023';
  END IF;
  IF p_relative IS NULL THEN
    RAISE EXCEPTION 'Choose who they are related to.' USING ERRCODE = '22023';
  END IF;
  IF p_relative = p_person THEN
    RAISE EXCEPTION 'Someone cannot be their own relative.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.family_people WHERE id = p_relative AND family_id = p_family_id) THEN
    RAISE EXCEPTION 'That person is not in this family''s tree.' USING ERRCODE = '22023';
  END IF;

  CASE p_relation
    WHEN 'parent' THEN
      PERFORM public.tree_add_parent(p_family_id, p_person, p_relative);
    WHEN 'child' THEN
      PERFORM public.tree_add_parent(p_family_id, p_relative, p_person);
      IF p_other_parent IS NOT NULL THEN
        IF p_other_parent IN (p_person, p_relative) THEN
          RAISE EXCEPTION 'Choose a different second parent.' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.family_people WHERE id = p_other_parent AND family_id = p_family_id) THEN
          RAISE EXCEPTION 'That person is not in this family''s tree.' USING ERRCODE = '22023';
        END IF;
        PERFORM public.tree_add_parent(p_family_id, p_other_parent, p_person);
      END IF;
    ELSE
      PERFORM public.tree_add_pair(p_family_id, p_person, p_relative, p_relation);
  END CASE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tree_check_details(text, text, date)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tree_add_parent(uuid, uuid, uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tree_add_pair(uuid, uuid, uuid, text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tree_connect(uuid, uuid, text, uuid, uuid)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tree_check_details(text, text, date)       TO service_role;
GRANT EXECUTE ON FUNCTION public.tree_add_parent(uuid, uuid, uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.tree_add_pair(uuid, uuid, uuid, text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.tree_connect(uuid, uuid, text, uuid, uuid) TO service_role;


-- ─── 5. What the app calls ──────────────────────────────────────────────────

-- Add someone, already connected: "the new person is the <relation> of
-- <relative>". Admins only. Returns the new person's id.
CREATE OR REPLACE FUNCTION public.add_family_person(
  p_family_id    uuid,
  p_display_name text,
  p_gender       text DEFAULT NULL,
  p_birth_date   date DEFAULT NULL,
  p_relation     text DEFAULT NULL,
  p_relative     uuid DEFAULT NULL,
  p_other_parent uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me  uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_me IS NULL OR NOT public.is_family_admin(p_family_id) THEN
    RAISE EXCEPTION 'Only a family admin can change the family tree.' USING ERRCODE = '42501';
  END IF;
  IF p_birth_date > current_date THEN
    RAISE EXCEPTION 'That date of birth is in the future.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.tree_check_details(p_display_name, p_gender, p_birth_date);

  INSERT INTO public.family_people (family_id, display_name, gender, birth_date, created_by)
  VALUES (p_family_id, btrim(p_display_name), p_gender, p_birth_date, v_me)
  RETURNING id INTO v_id;

  IF p_relation IS NOT NULL THEN
    PERFORM public.tree_connect(p_family_id, v_id, p_relation, p_relative, p_other_parent);
  END IF;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, p_family_id, 'add_person', 'family_person', v_id);
  RETURN v_id;
END;
$fn$;

-- Connect someone already in the tree: p_person is the <relation> of
-- p_relative. Admins only.
CREATE OR REPLACE FUNCTION public.link_family_people(
  p_family_id    uuid,
  p_person       uuid,
  p_relation     text,
  p_relative     uuid,
  p_other_parent uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR NOT public.is_family_admin(p_family_id) THEN
    RAISE EXCEPTION 'Only a family admin can change the family tree.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.family_people WHERE id = p_person AND family_id = p_family_id) THEN
    RAISE EXCEPTION 'That person is not in this family''s tree.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.tree_connect(p_family_id, p_person, p_relation, p_relative, p_other_parent);

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, p_family_id, 'link_person', 'family_person', p_person);
END;
$fn$;

-- Name, gender and date of birth. An admin, or the person themselves.
CREATE OR REPLACE FUNCTION public.update_family_person(
  p_person_id    uuid,
  p_display_name text,
  p_gender       text DEFAULT NULL,
  p_birth_date   date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me     uuid := auth.uid();
  v_family uuid;
  v_user   uuid;
BEGIN
  SELECT family_id, user_id INTO v_family, v_user FROM public.family_people WHERE id = p_person_id;
  -- Spelled out: with v_user NULL, a bare `v_user = v_me` is NULL, and
  -- NOT (false OR NULL) is NULL too, which IF reads as "don't raise".
  IF v_me IS NULL OR v_family IS NULL
     OR NOT (public.is_family_admin(v_family) OR (v_user IS NOT NULL AND v_user = v_me)) THEN
    RAISE EXCEPTION 'Only a family admin, or the person themselves, can change these details.' USING ERRCODE = '42501';
  END IF;
  IF p_birth_date > current_date THEN
    RAISE EXCEPTION 'That date of birth is in the future.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.tree_check_details(p_display_name, p_gender, p_birth_date);

  UPDATE public.family_people
     SET display_name = btrim(p_display_name), gender = p_gender, birth_date = p_birth_date, updated_at = now()
   WHERE id = p_person_id;

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_family, 'update_person', 'family_person', p_person_id);
END;
$fn$;

-- Take someone out of the tree, with their links. Their documents stay in the
-- family, no longer marked as theirs. Someone with an account leaves through
-- Manage Family instead. Admins only.
CREATE OR REPLACE FUNCTION public.remove_family_person(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me     uuid := auth.uid();
  v_family uuid;
  v_user   uuid;
  v_ns     text;
BEGIN
  SELECT family_id, user_id INTO v_family, v_user FROM public.family_people WHERE id = p_person_id;
  IF v_me IS NULL OR v_family IS NULL OR NOT public.is_family_admin(v_family) THEN
    RAISE EXCEPTION 'Only a family admin can change the family tree.' USING ERRCODE = '42501';
  END IF;
  IF v_user IS NOT NULL THEN
    RAISE EXCEPTION 'They have an account: remove them from the family in Manage Family instead.' USING ERRCODE = '22023';
  END IF;

  SELECT storage_namespace INTO v_ns FROM public.families WHERE id = v_family;
  IF v_ns ~ '^family_[0-9a-f]{8}$' THEN
    EXECUTE format('UPDATE %I.documents SET belongs_to_member = NULL WHERE belongs_to_member = $1', v_ns)
      USING p_person_id;
  END IF;

  DELETE FROM public.family_people WHERE id = p_person_id;   -- links cascade

  INSERT INTO public.audit_logs (user_id, family_id, action, resource_type, resource_id)
  VALUES (v_me, v_family, 'remove_person', 'family_person', p_person_id);
END;
$fn$;

-- Signed-in members only: anon never reaches these.
REVOKE ALL ON FUNCTION public.add_family_person(uuid, text, text, date, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_family_people(uuid, uuid, text, uuid, uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_family_person(uuid, text, text, date)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_family_person(uuid)                                FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_family_person(uuid, text, text, date, text, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_family_people(uuid, uuid, text, uuid, uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_family_person(uuid, text, text, date)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_family_person(uuid)                                TO authenticated, service_role;


-- ─── 6. Members are people too ──────────────────────────────────────────────
-- A member's own person takes their member id (so documents marked as theirs
-- stay marked) and the name the family knows them by. Leaving clears the
-- account, not the person.
CREATE OR REPLACE FUNCTION public.family_people_follow_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.family_people (id, family_id, user_id, display_name, created_by, created_at)
    SELECT NEW.id, NEW.family_id, NEW.user_id,
           left(coalesce(nullif(btrim(NEW.alias), ''), nullif(btrim(u.display_name), ''),
                         nullif(split_part(u.email, '@', 1), ''), 'Family member'), 80),
           NEW.user_id, coalesce(NEW.joined_at, now())
      FROM (SELECT 1) AS one
      LEFT JOIN public.users u ON u.id = NEW.user_id
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  UPDATE public.family_people SET user_id = NULL, updated_at = now()
   WHERE family_id = OLD.family_id AND user_id = OLD.user_id;
  RETURN OLD;
END;
$fn$;

REVOKE ALL ON FUNCTION public.family_people_follow_members() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS family_people_follow_members ON public.family_members;
CREATE TRIGGER family_people_follow_members
  AFTER INSERT OR DELETE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_people_follow_members();

-- Everyone who is already a member.
INSERT INTO public.family_people (id, family_id, user_id, display_name, created_by, created_at)
SELECT m.id, m.family_id, m.user_id,
       left(coalesce(nullif(btrim(m.alias), ''), nullif(btrim(u.display_name), ''),
                     nullif(split_part(u.email, '@', 1), ''), 'Family member'), 80),
       m.user_id, coalesce(m.joined_at, now())
  FROM public.family_members m
  LEFT JOIN public.users u ON u.id = m.user_id
ON CONFLICT DO NOTHING;


-- ─── 7. Search: the documents marked as someone's ───────────────────────────
-- "Nani's pension papers" should find what the family marked as Nani's even
-- where the text never says her name (a scan, or a name the PDF reader
-- mangled). rag-search asks for these by person. Like every rag_* function it
-- takes the family's schema as a parameter, so it is SERVICE ROLE ONLY
-- (CLAUDE.md "Read this first", point 1).
CREATE OR REPLACE FUNCTION public.rag_documents_for_people(p_schema text, p_people uuid[], p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, file_name text, file_type text, category_name text, belongs_to_member uuid, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_schema IS NULL OR p_schema !~ '^family_[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'unexpected schema %', p_schema;
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.file_name::text, d.file_type::text, c.name::text, d.belongs_to_member, d.created_at
       FROM %I.documents d
       LEFT JOIN public.document_categories c ON c.id = d.category_id
      WHERE d.is_deleted = false AND d.belongs_to_member = ANY ($1)
      ORDER BY d.created_at DESC
      LIMIT $2', p_schema)
    USING p_people, LEAST(GREATEST(coalesce(p_limit, 20), 1), 50);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rag_documents_for_people(text, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rag_documents_for_people(text, uuid[], integer) TO service_role;


-- ─── 8. Name a document's person from the tree ──────────────────────────────
-- Unchanged but for the name: the tree's name first, then the member's alias
-- and profile name, as before — each only for someone of THIS family. The old
-- member lookup did not check the family, so a document marked with another
-- family's member id showed that stranger's name.
CREATE OR REPLACE FUNCTION public.get_family_documents(p_family_id uuid, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, uploaded_by uuid, file_name character varying, file_type character varying, file_size_bytes bigint, storage_path text, category_id uuid, category_name character varying, belongs_to_member uuid, member_name text, member_relationship text, ingestion_status character varying, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_schema TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.family_id = p_family_id AND fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT f.storage_namespace INTO v_schema
  FROM public.families f WHERE f.id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.uploaded_by, d.file_name, d.file_type, d.file_size_bytes,
            d.storage_path, d.category_id,
            c.name::VARCHAR AS category_name,
            d.belongs_to_member,
            COALESCE(fp.display_name, fm.alias, u.display_name)::TEXT AS member_name,
            fm.relationship::TEXT AS member_relationship,
            d.ingestion_status,
            d.created_at, d.updated_at
     FROM %I.documents d
     LEFT JOIN public.document_categories c ON c.id = d.category_id
     LEFT JOIN public.family_people fp ON fp.id = d.belongs_to_member AND fp.family_id = $3
     LEFT JOIN public.family_members fm ON fm.id = d.belongs_to_member AND fm.family_id = $3
     LEFT JOIN public.users u ON u.id = fm.user_id
     WHERE d.is_deleted = false
     ORDER BY d.created_at DESC
     LIMIT $1 OFFSET $2', v_schema
  ) USING p_limit, p_offset, p_family_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_document_detail(p_family_id uuid, p_document_id uuid)
 RETURNS TABLE(id uuid, uploaded_by uuid, uploader_name text, file_name character varying, file_type character varying, file_size_bytes bigint, storage_path text, category_id uuid, category_name character varying, belongs_to_member uuid, member_name text, member_relationship text, ingestion_status character varying, created_at timestamp with time zone, updated_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_schema TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.family_id = p_family_id AND fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT f.storage_namespace INTO v_schema
  FROM public.families f WHERE f.id = p_family_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Family not found';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.uploaded_by,
            u_uploader.display_name::TEXT AS uploader_name,
            d.file_name, d.file_type, d.file_size_bytes,
            d.storage_path, d.category_id,
            c.name::VARCHAR AS category_name,
            d.belongs_to_member,
            COALESCE(fp.display_name, fm.alias, u_member.display_name)::TEXT AS member_name,
            fm.relationship::TEXT AS member_relationship,
            d.ingestion_status,
            d.created_at, d.updated_at,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object(
                ''key'', m.key, ''value'', m.value,
                ''auto_extracted'', m.auto_extracted, ''confidence'', m.confidence
              ))
              FROM %I.document_metadata m WHERE m.document_id = d.id),
              ''[]''::jsonb
            ) AS metadata
     FROM %I.documents d
     LEFT JOIN public.document_categories c ON c.id = d.category_id
     LEFT JOIN public.family_people fp ON fp.id = d.belongs_to_member AND fp.family_id = $2
     LEFT JOIN public.family_members fm ON fm.id = d.belongs_to_member AND fm.family_id = $2
     LEFT JOIN public.users u_member ON u_member.id = fm.user_id
     LEFT JOIN public.users u_uploader ON u_uploader.id = d.uploaded_by
     WHERE d.id = $1 AND d.is_deleted = false', v_schema, v_schema
  ) USING p_document_id, p_family_id;
END;
$function$;

COMMIT;
