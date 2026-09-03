-- ============================================================================
-- Public exams, org-wide access, favourites, and a grants hardening pass.
--
-- Applied manually to production on 2026-09-03 as eleven separate steps, each
-- verified before and after. Consolidated here as a single file for the record.
--
-- DO NOT REPLAY AGAINST THE PRODUCTION DATABASE. ADD CONSTRAINT and
-- CREATE POLICY have no IF NOT EXISTS form and will fail. This file is
-- documentation and a starting point for a clean database.
--
-- Sections:
--   1. Columns: is_org_wide, is_public
--   2. Constraints and indexes for public exams
--   3. Trigger: only super_admin may set is_public
--   4. RLS: read public exams
--   5. RLS: read questions of public exams
--   6. Fix: public exams must not consume the personal-exam quota
--   7. Column: is_showcase
--   8. Table: examene_favorite
--   9. SECURITY: revoke TRUNCATE from anon and authenticated
--  10. Trigger: seed the showcase exam into new accounts' favourites
--  11. Backfill for pre-existing accounts
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Public exams and org-wide access.
--
-- Two separate booleans instead of one field with dual semantics
-- (e.g. "open within its domain"). With a single flag the public-read policy
-- would read `is_public = true AND org_id IS NULL`; dropping that second
-- conjunct anywhere would leak every tenant's open exams platform-wide.
-- Two orthogonal columns make that mistake impossible to express.
--
-- Rejected alternative: `visibility text CHECK IN ('private','org','public')`.
-- Private vs org is already fully determined by org_id / creator_user_id, so
-- an enum would duplicate derivable state AND force a rewrite of all five
-- existing RLS policies on `examene` — the highest-risk operation available
-- on a live production database. is_public is purely additive.
--
-- NOT NULL DEFAULT false is metadata-only on PG 11+; no table rewrite.
-- NOT NULL matters: with NULLs, `is_public = false` filters would skip rows.

ALTER TABLE public.examene
  ADD COLUMN IF NOT EXISTS is_org_wide boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_public   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.examene.is_org_wide IS
  'true = every member of the org has access, no acces_examene row needed. No expiry.';
COMMENT ON COLUMN public.examene.is_public IS
  'true = globally public exam. Valid only with org_id IS NULL. Settable by super_admin only.';


-- ----------------------------------------------------------------------------
-- Enforce "a public exam never belongs to an org" at the engine level.
--
-- This is defence in depth, not decoration. examene_update_privileged_only has
-- a WITH CHECK identical to its USING clause, so an org_admin cannot set
-- org_id = NULL. This CHECK closes the other direction: they cannot set
-- is_public = true while org_id is non-null either. The two conditions become
-- mutually unsatisfiable for a tenant admin regardless of how any future RLS
-- policy is written — a row that would leak simply cannot exist.
--
-- Validation is instant here: every existing row has is_public = false.

ALTER TABLE public.examene
  ADD CONSTRAINT examene_public_requires_no_org
  CHECK (NOT is_public OR org_id IS NULL);

CREATE INDEX IF NOT EXISTS examene_is_public_idx
  ON public.examene (id) WHERE is_public = true;

CREATE INDEX IF NOT EXISTS examene_org_wide_idx
  ON public.examene (org_id) WHERE is_org_wide = true;


-- ----------------------------------------------------------------------------
-- Only super_admin may flip is_public.
--
-- Why a trigger and not column-level grants: revoking UPDATE on the table and
-- re-granting per column would mean every future column added to `examene`
-- needs its own grant migration — the recurring trap already hit on `profiles`.
-- One trigger covers INSERT and UPDATE with no ongoing maintenance cost.
--
-- SECURITY INVOKER is mandatory. As DEFINER, current_user would resolve to the
-- function owner and the guard below would wave everything through.
--
-- Writes arriving as service_role/postgres are allowed: those paths are
-- authorised in server actions, which already check role. Blocking them here
-- would make publishing an exam impossible without disabling the trigger.
-- Consequence: this guard protects the RLS path (an org_admin's own client),
-- not the service-role path.

CREATE OR REPLACE FUNCTION public.enforce_is_public_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_public AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Doar super_admin poate crea examene publice.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Doar super_admin poate modifica statusul public al unui examen.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS examene_is_public_guard ON public.examene;

CREATE TRIGGER examene_is_public_guard
  BEFORE INSERT OR UPDATE ON public.examene
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_is_public_super_admin();


-- ----------------------------------------------------------------------------
-- Read access to public exams.
--
-- authenticated only, deliberately no `anon`. The homepage renders public exam
-- names through a server component using the service-role client, selecting
-- only safe columns. Granting anon a policy on `examene` would open a path
-- toward `intrebari`, whose anonymous read was explicitly closed earlier
-- precisely because it exposes correct answers.
--
-- The `org_id IS NULL` conjunct is redundant given
-- examene_public_requires_no_org. Kept as defence in depth; costs nothing.
--
-- Permissive policies OR together, so nothing any user sees today changes.
-- is_org_wide is absent here on purpose: org exams are already covered by
-- examene_select_own_org, and the allocated-vs-open distinction lives entirely
-- in fetchAccessibleExams.

CREATE POLICY examene_public_select
  ON public.examene
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_public = true AND org_id IS NULL);


-- ----------------------------------------------------------------------------
-- Questions belonging to public exams.
--
-- Without this, public exams appear in the selector with zero questions:
-- intrebari_select_own_org filters on
--   examen_id IN (SELECT id FROM examene WHERE org_id = my_org_id)
-- and a public exam has org_id IS NULL, so `NULL = my_org_id` is never true.
-- Same class of bug as 20260724120000 for personal exams.
--
-- SECURITY DEFINER is required here (unlike the is_public guard trigger): the
-- function must read `examene` bypassing RLS, otherwise the two policies
-- recurse into each other.
--
-- bigint signature mirrors owns_personal_exam even though examene.id is int4;
-- the implicit widening cast is harmless and keeps the two helpers uniform.

CREATE OR REPLACE FUNCTION public.is_public_exam(p_examen_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.examene e
     WHERE e.id = p_examen_id
       AND e.is_public = true
       AND e.org_id IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_public_exam(bigint) TO authenticated;

DROP POLICY IF EXISTS intrebari_public_exam_select ON public.intrebari;

CREATE POLICY intrebari_public_exam_select
  ON public.intrebari
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (public.is_public_exam(examen_id));


-- ----------------------------------------------------------------------------
-- Public exams must not consume the personal-exam quota.
--
-- A public exam has org_id IS NULL and a creator_user_id, so it looked exactly
-- like a personal exam to this trigger. Two bugs followed:
--   1. creating one could be rejected by the tier limit
--   2. worse, the count() had no is_public filter, so each public exam
--      permanently ate a slot for all FUTURE personal exams
--
-- The matching count in createPersonalExam (app/my-exams/actions.ts) was fixed
-- in the same change. Both must filter identically, otherwise the server action
-- rejects the insert before this trigger ever runs.

CREATE OR REPLACE FUNCTION public.enforce_personal_exam_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max   integer;
  v_count integer;
BEGIN
  -- Only personal exams fall under this limit.
  -- Public exams have org_id IS NULL but are not personal.
  IF NEW.org_id IS NOT NULL
     OR NEW.creator_user_id IS NULL
     OR NEW.is_public THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(max_examene_personale, 0)
    INTO v_max
    FROM public.profiles
   WHERE id = NEW.creator_user_id;

  IF v_max IS NULL THEN
    v_max := 0;
  END IF;

  SELECT count(*)
    INTO v_count
    FROM public.examene
   WHERE creator_user_id = NEW.creator_user_id
     AND org_id IS NULL
     AND is_public = false;   -- public exams do not consume the quota

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Ai atins limita de examene proprii'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;


-- ----------------------------------------------------------------------------
-- The demo exam seeded into every new account's favourites.
--
-- The CHECK below also removes the need for a separate guard: an org_admin
-- cannot set is_showcase on their own exam, because doing so would require
-- is_public = true, which the examene_is_public_guard trigger blocks.
--
-- The unique partial index is the standard trick for "at most one row": every
-- row that enters the index carries the same value (true), so a second one
-- collides. Drop the index if multiple showcase exams are ever wanted.
--
-- Note on scope: is_showcase does NOT drive visibility. It only marks which
-- exam gets seeded at signup (see 20260903090900). An earlier design had
-- fetchAccessibleExams surface it unconditionally, which made the exam
-- impossible for a user to remove — the star appeared broken.

ALTER TABLE public.examene
  ADD COLUMN IF NOT EXISTS is_showcase boolean NOT NULL DEFAULT false;

ALTER TABLE public.examene
  ADD CONSTRAINT examene_showcase_requires_public
  CHECK (NOT is_showcase OR is_public);

CREATE UNIQUE INDEX IF NOT EXISTS examene_single_showcase_idx
  ON public.examene (is_showcase) WHERE is_showcase;

COMMENT ON COLUMN public.examene.is_showcase IS
  'Demo exam seeded into new accounts favourites. Requires is_public. At most one per platform.';


-- ----------------------------------------------------------------------------
-- User-chosen public exams.
--
-- Only public exams are favouritable. Org exams and personal exams always
-- appear in the selector: letting a learner hide an exam their org_admin
-- allocated would break the B2B promise that the organisation controls what
-- its people practise.
--
-- is_public_exam(examen_id) in WITH CHECK is what actually enforces that
-- invariant. Without it a direct API call could insert a favourite pointing at
-- an org exam, and the UI would render something that should not exist.
--
-- No UPDATE policy and no UPDATE grant: a favourite is created or deleted,
-- never modified.
--
-- Composite PK doubles as the uniqueness guarantee and the lookup index.
-- The separate examen_id index serves the ON DELETE CASCADE from `examene`.

CREATE TABLE IF NOT EXISTS public.examene_favorite (
  user_id    uuid        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  examen_id  integer     NOT NULL REFERENCES public.examene(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, examen_id)
);

CREATE INDEX IF NOT EXISTS examene_favorite_examen_id_idx
  ON public.examene_favorite (examen_id);

ALTER TABLE public.examene_favorite ENABLE ROW LEVEL SECURITY;

CREATE POLICY examene_favorite_select_own
  ON public.examene_favorite FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY examene_favorite_insert_own
  ON public.examene_favorite FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_public_exam(examen_id));

CREATE POLICY examene_favorite_delete_own
  ON public.examene_favorite FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.examene_favorite TO authenticated;
REVOKE ALL ON public.examene_favorite FROM anon;

-- Supabase default privileges GRANT ALL on new tables, so the grant above is
-- additive rather than exclusive. Strip what RLS cannot filter.
REVOKE UPDATE, TRUNCATE, TRIGGER, REFERENCES
  ON public.examene_favorite FROM authenticated;


-- ----------------------------------------------------------------------------
-- SECURITY: revoke TRUNCATE from anon and authenticated across the schema.
--
-- Not related to the public-exams feature. Found while auditing grants on the
-- new favourites table.
--
-- TRUNCATE is DDL, not DML — RLS policies are never evaluated for it. It is the
-- one destructive command that bypasses the layer the entire platform's
-- security rests on. Every table in `public` had granted it to both anon and
-- authenticated (Supabase's default ALTER DEFAULT PRIVILEGES ... GRANT ALL,
-- which includes TRUNCATE, TRIGGER and REFERENCES alongside the four DML
-- privileges).
--
-- Not reachable through PostgREST, which does not expose TRUNCATE. Reachable by
-- anyone who signs up, takes their JWT and connects to Postgres directly.
-- `TRUNCATE profiles CASCADE` would have been irrecoverable.
--
-- No regression risk: SELECT/INSERT/UPDATE/DELETE are untouched. TRIGGER and
-- REFERENCES are DDL privileges the application never uses — migrations run as
-- postgres.
--
-- The ALTER DEFAULT PRIVILEGES statement is the durable half. Without it every
-- new table silently reintroduces the hole.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  ) LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM anon, authenticated',
      r.tablename
    );
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;


-- ----------------------------------------------------------------------------
-- Seed the showcase exam into every new account's favourites.
--
-- Solves cold start: a user with no org, no personal exams and no favourites
-- would otherwise land on an empty selector that looks broken.
--
-- Seeding a row rather than special-casing is_showcase in fetchAccessibleExams
-- is what makes the demo REMOVABLE. It is an ordinary favourite: one star, one
-- meaning, everywhere. Un-star it and it is gone for good; re-add it from the
-- library if wanted.
--
-- A separate trigger rather than an edit to handle_new_user: modifying the
-- function the whole signup flow depends on, for something cosmetic, is not
-- worth the risk.
--
-- EXCEPTION WHEN OTHERS THEN NULL is deliberate. If no showcase exam exists, or
-- anything else fails, signup must still succeed. A missing demo is an
-- annoyance; a blocked signup is a lost customer.
--
-- AFTER INSERT because the profiles row must exist before the FK is satisfied.

CREATE OR REPLACE FUNCTION public.seed_showcase_favorite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_id integer;
BEGIN
  BEGIN
    SELECT id INTO v_exam_id
      FROM public.examene
     WHERE is_showcase = true
     LIMIT 1;

    IF v_exam_id IS NOT NULL THEN
      INSERT INTO public.examene_favorite (user_id, examen_id)
      VALUES (NEW.id, v_exam_id)
      ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- seeding must never block registration
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_seed_showcase_favorite ON public.profiles;

CREATE TRIGGER profiles_seed_showcase_favorite
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_showcase_favorite();


-- ----------------------------------------------------------------------------
-- One-off backfill: give existing accounts the showcase favourite.
--
-- Historical. The trigger in 20260903090900 only fires for new signups, so the
-- 44 accounts that predate it needed this. Idempotent and harmless if replayed
-- on a fresh database: with no showcase exam the CROSS JOIN yields no rows,
-- and ON CONFLICT DO NOTHING covers the rest.

INSERT INTO public.examene_favorite (user_id, examen_id)
SELECT p.id, e.id
FROM public.profiles p
CROSS JOIN (SELECT id FROM public.examene WHERE is_showcase = true LIMIT 1) e
ON CONFLICT DO NOTHING;


