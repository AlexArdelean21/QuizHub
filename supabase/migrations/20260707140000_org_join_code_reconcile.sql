-- ============================================================
-- STEP 1 (DB layer): Organization "join code" system — RECONCILIATION
-- ============================================================
--
-- !!! TAKE A MANUAL BACKUP OF THE PRODUCTION DATABASE BEFORE RUNNING !!!
-- (This project has a single production Supabase project and no separate dev
--  DB, so run this once and verify. Every step below is written to be safe to
--  run once and idempotent where reasonable.)
--
-- WHY THIS IS A RECONCILIATION AND NOT A GREENFIELD MIGRATION
-- -----------------------------------------------------------
-- An equivalent join-code system was ALREADY deployed to production earlier
-- today (migrations 20260707120000 / 120100 / 130200 / 130300 / 130400), but
-- with different naming/design than the canonical spec for this feature:
--   * organizatii.cod_org           (spec wants: org_code)
--   * generate_cod_org()            (spec wants: generate_org_code(p_nume))
--   * org_join_requests table with columns created_at / resolved_at /
--     resolved_by (spec's requested_at / decided_at / decided_by), a client
--     INSERT policy (org_join_requests_insert_own) and a client UPDATE policy
--     (org_join_requests_update_admin).
--   * RPCs request_join_org(...) and resolve_join_request(...) instead of
--     submit_org_join_request / cancel_org_join_request / get_pending_join_requests.
--
-- This migration ALIGNS the live schema to the canonical spec WITHOUT breaking
-- the objects that are already wired into the app:
--   * Renames organizatii.cod_org -> org_code and repoints the two SECURITY
--     DEFINER functions that reference it (create_org_on_signup, request_join_org)
--     so nothing breaks. request_join_org keeps its parameter name (p_cod_org)
--     so app/profile/actions.ts continues to work unchanged.
--   * Adds generate_org_code(p_nume) as the single source of truth for code
--     generation (spec format: 4 name-derived uppercase letters + '-' + 4
--     digits, e.g. STAR-4821). generate_cod_org() is kept as a deprecated thin
--     wrapper so any lingering caller still works.
--   * Tightens org_join_requests to the spec's RLS shape: the SELECT policy is
--     kept (it already matches the spec), but the client INSERT and UPDATE
--     policies are DROPPED. All writes now go exclusively through SECURITY
--     DEFINER RPCs (submit/cancel here, resolve_join_request already live),
--     mirroring how invite_tokens consumption and updateUserRole work today.
--   * The org_join_requests columns are intentionally NOT renamed: app/profile/
--     page.tsx selects `status, created_at, organizatii(nume)` directly, so the
--     storage columns stay as-is. The spec's decided_at / decided_by map to the
--     live resolved_at / resolved_by, and the new read RPC exposes created_at
--     under the spec name `requested_at`.
--
-- Authorization model reminder (this project):
--   * `role` is the authoritative column ('super_admin' | 'org_admin' | 'user').
--   * profiles.org_id is NOT writable by authenticated/anon (column grants +
--     trigger from 20260606000001). It changes only via SECURITY DEFINER
--     functions or the service-role server client — an invariant preserved here.
--   * Seat/tier enforcement lives in public.check_org_limits(p_org_id, p_resource)
--     (jsonb: allowed / managed_manually / error) and its TypeScript wrapper
--     assertOrgLimit() in app/admin/actions.ts. This migration does NOT touch or
--     duplicate that logic; approve/reject (which must call it) is Step 2.

-- ------------------------------------------------------------
-- TASK 1a: Rename organizatii.cod_org -> org_code (idempotent guard).
-- The existing UNIQUE + NOT NULL constraints follow the column through the
-- rename, so org_code stays unique, not-null and fully backfilled.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizatii'
      AND column_name = 'cod_org'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizatii'
      AND column_name = 'org_code'
  ) THEN
    ALTER TABLE public.organizatii RENAME COLUMN cod_org TO org_code;
  END IF;
END $$;

-- Keep the unique constraint name in sync with the new column name (cosmetic,
-- guarded so re-running is a no-op). The underlying unique B-tree index is
-- renamed together with the constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizatii_cod_org_key'
      AND conrelid = 'public.organizatii'::regclass
  ) THEN
    ALTER TABLE public.organizatii
      RENAME CONSTRAINT organizatii_cod_org_key TO organizatii_org_code_key;
  END IF;
END $$;

-- ------------------------------------------------------------
-- TASK 1b: generate_org_code(p_nume) — single source of truth for code
-- generation, used by backfill/new-org creation and future regeneration.
--
-- Format: 4 uppercase letters derived from the org name (falling back to random
-- letters when the name has fewer than 4 A-Z characters) + '-' + 4 random
-- digits, e.g. "STAR-4821". Retries on collision against organizatii.org_code.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_org_code(p_nume text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_letters CONSTANT text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_clean   text;
  v_prefix  text;
  v_code    text;
  v_exists  boolean;
  v_attempt int := 0;
BEGIN
  -- Keep only alphabetic characters from the name, uppercased.
  v_clean := upper(regexp_replace(coalesce(p_nume, ''), '[^A-Za-z]', '', 'g'));

  LOOP
    v_attempt := v_attempt + 1;

    -- Take up to 4 leading letters; pad with random letters if too short.
    v_prefix := substr(v_clean, 1, 4);
    WHILE length(v_prefix) < 4 LOOP
      v_prefix := v_prefix || substr(v_letters, 1 + floor(random() * 26)::int, 1);
    END LOOP;

    v_code := v_prefix || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');

    SELECT EXISTS (
      SELECT 1 FROM public.organizatii WHERE org_code = v_code
    ) INTO v_exists;

    EXIT WHEN NOT v_exists;

    IF v_attempt >= 20 THEN
      RAISE EXCEPTION 'Nu s-a putut genera un cod de organizație unic după % încercări', v_attempt;
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_org_code(text) FROM public;
REVOKE ALL ON FUNCTION public.generate_org_code(text) FROM anon;
-- Code generation is only ever invoked from other SECURITY DEFINER functions /
-- the service role; no direct grant to authenticated is required.

COMMENT ON FUNCTION public.generate_org_code(text) IS
  'Generates a unique human-readable org code: 4 name-derived uppercase letters + "-" + 4 digits (e.g. STAR-4821). Single source of truth for org code generation.';

-- Deprecated: keep generate_cod_org() working as a thin wrapper so any lingering
-- caller keeps functioning after the rename above.
CREATE OR REPLACE FUNCTION public.generate_cod_org()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.generate_org_code(NULL);
$$;

COMMENT ON FUNCTION public.generate_cod_org() IS
  'DEPRECATED: use generate_org_code(p_nume). Retained as a wrapper for backward compatibility.';

-- ------------------------------------------------------------
-- TASK 1c: Repoint the two live SECURITY DEFINER functions that referenced the
-- old column name so they keep working after the rename.
-- ------------------------------------------------------------

-- create_org_on_signup: same guards as before; now writes org_code and derives
-- the code from the org name via generate_org_code().
CREATE OR REPLACE FUNCTION public.create_org_on_signup(
  p_user_id uuid,
  p_nume_org text,
  p_tier_id smallint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       text;
  v_existing   uuid;
  v_tier_nume  text;
  v_org_code   text;
  v_slug       text;
  v_nume       text;
  v_org_id     uuid;
BEGIN
  v_nume := btrim(coalesce(p_nume_org, ''));
  IF v_nume = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  -- An authenticated caller can only create an organization for themselves.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only create an organization for your own account';
  END IF;

  -- Lock the profile row to serialize concurrent attempts.
  SELECT role, org_id
    INTO v_role, v_existing
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'User already belongs to an organization';
  END IF;
  IF v_role <> 'user' THEN
    RAISE EXCEPTION 'Only base user accounts can create an organization';
  END IF;

  -- Validate the tier and forbid enterprise.
  SELECT nume INTO v_tier_nume FROM public.plan_tiers WHERE id = p_tier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected plan does not exist';
  END IF;
  IF v_tier_nume = 'enterprise' THEN
    RAISE EXCEPTION 'Enterprise tier requires manual setup';
  END IF;

  v_org_code := public.generate_org_code(v_nume);

  -- Derive a slug from the name and suffix the code for guaranteed uniqueness.
  v_slug := regexp_replace(lower(v_nume), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  IF v_slug = '' THEN
    v_slug := 'org';
  END IF;
  v_slug := v_slug || '-' || lower(replace(v_org_code, '-', ''));

  INSERT INTO public.organizatii
    (nume, slug, org_code, tier_id, subscription_status, is_managed_manually)
  VALUES
    (v_nume, v_slug, v_org_code, p_tier_id, 'active', false)
  RETURNING id INTO v_org_id;

  UPDATE public.profiles
  SET role = 'org_admin',
      org_id = v_org_id
  WHERE id = p_user_id;

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_org_on_signup(uuid, text, smallint) FROM public;
REVOKE ALL ON FUNCTION public.create_org_on_signup(uuid, text, smallint) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_org_on_signup(uuid, text, smallint) TO authenticated;

-- request_join_org: kept for backward compatibility (app/profile/actions.ts
-- still calls it with p_cod_org). Signature/param names are unchanged; only the
-- lookup column is repointed to org_code and made case-insensitive.
CREATE OR REPLACE FUNCTION public.request_join_org(
  p_user_id uuid,
  p_cod_org text,
  p_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  uuid;
  v_request uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Poți trimite cereri doar pentru propriul cont';
  END IF;

  SELECT id INTO v_org_id
  FROM public.organizatii
  WHERE org_code = upper(btrim(p_cod_org));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizația nu a fost găsită';
  END IF;

  BEGIN
    INSERT INTO public.org_join_requests (user_id, org_id, message, status)
    VALUES (p_user_id, v_org_id, nullif(btrim(coalesce(p_message, '')), ''), 'pending')
    RETURNING id INTO v_request;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ai deja o cerere în așteptare';
  END;

  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.request_join_org(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.request_join_org(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_join_org(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------
-- TASK 2: Reconcile org_join_requests constraints + RLS to the spec.
-- ------------------------------------------------------------

-- Tighten the pending-uniqueness rule to "at most ONE pending request per user"
-- (spec), replacing the previous per-(user, org) rule. Safe: the table is empty
-- and even otherwise this only strengthens the constraint.
DROP INDEX IF EXISTS public.org_join_requests_unique_pending;

CREATE UNIQUE INDEX IF NOT EXISTS org_join_requests_one_pending_per_user
  ON public.org_join_requests (user_id)
  WHERE status = 'pending';

-- Fast "pending requests for this org" lookups (idempotent; already present).
CREATE INDEX IF NOT EXISTS org_join_requests_org_status_idx
  ON public.org_join_requests (org_id, status);

ALTER TABLE public.org_join_requests ENABLE ROW LEVEL SECURITY;

-- SELECT policy stays: requester sees own; org_admin sees own org; super_admin
-- sees all. (Matches the spec exactly; app/profile/page.tsx relies on it.)
DROP POLICY IF EXISTS org_join_requests_select_scoped ON public.org_join_requests;
CREATE POLICY org_join_requests_select_scoped
  ON public.org_join_requests
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR get_my_role() = 'super_admin'
    OR (get_my_role() = 'org_admin' AND org_id = get_my_org())
  );

-- Drop the direct client write policies. Per spec, ALL writes go through
-- SECURITY DEFINER RPCs (which bypass RLS internally on purpose):
--   * INSERT  -> submit_org_join_request / request_join_org
--   * UPDATE  -> resolve_join_request (Step 2 approve/reject)
--   * DELETE  -> cancel_org_join_request
DROP POLICY IF EXISTS org_join_requests_insert_own ON public.org_join_requests;
DROP POLICY IF EXISTS org_join_requests_update_admin ON public.org_join_requests;

-- ------------------------------------------------------------
-- TASK 3: submit_org_join_request(p_org_code) — canonical submit RPC.
-- Validates (server-side) that the caller has NO org yet and no pending request,
-- then inserts a pending row and returns the target org name for a confirmation
-- message. SECURITY DEFINER so the INSERT bypasses RLS in a controlled way.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_org_join_request(p_org_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org_id  uuid;
  v_nume    text;
  v_org_id_of_caller uuid;
  v_has_pending boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat.';
  END IF;

  -- Resolve the organization by its (case-insensitive, trimmed) code.
  SELECT id, nume INTO v_org_id, v_nume
  FROM public.organizatii
  WHERE org_code = upper(btrim(p_org_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cod de organizație invalid.';
  END IF;

  -- The caller must not already belong to an organization.
  SELECT org_id INTO v_org_id_of_caller
  FROM public.profiles
  WHERE id = v_uid;

  IF v_org_id_of_caller IS NOT NULL THEN
    RAISE EXCEPTION 'Faci deja parte dintr-o organizație.';
  END IF;

  -- The caller must not already have a pending request.
  SELECT EXISTS (
    SELECT 1 FROM public.org_join_requests
    WHERE user_id = v_uid AND status = 'pending'
  ) INTO v_has_pending;

  IF v_has_pending THEN
    RAISE EXCEPTION 'Ai deja o cerere în așteptare.';
  END IF;

  INSERT INTO public.org_join_requests (user_id, org_id, status)
  VALUES (v_uid, v_org_id, 'pending');

  RETURN v_nume;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_org_join_request(text) FROM public;
REVOKE ALL ON FUNCTION public.submit_org_join_request(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_org_join_request(text) TO authenticated;

-- ------------------------------------------------------------
-- TASK 4: cancel_org_join_request() — canonical cancel RPC.
--
-- DESIGN CHOICE: we DELETE the caller's own pending row (rather than marking it
-- 'rejected'). Rationale: a self-cancel is not a rejection, and deleting lets
-- the user immediately re-request and keeps app/profile/page.tsx (which shows
-- the latest request) from surfacing a stale/misleading 'rejected' state that
-- the user caused themselves. No-op (returns false) when there is nothing to
-- cancel — never raises.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_org_join_request()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_deleted int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.org_join_requests
  WHERE user_id = v_uid AND status = 'pending';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_org_join_request() FROM public;
REVOKE ALL ON FUNCTION public.cancel_org_join_request() FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_org_join_request() TO authenticated;

-- ------------------------------------------------------------
-- TASK 5: get_pending_join_requests(p_org_id) — canonical read RPC for admins.
--
-- Returns pending requests for the given org joined against profiles. The live
-- created_at column is exposed under the spec name `requested_at`. Authorization
-- reuses public.can_view_org_stats (the exact same super_admin / same-org
-- org_admin gate used by the stats RPCs) rather than re-deriving it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_join_requests(p_org_id uuid)
RETURNS TABLE (
  user_id      uuid,
  nume         text,
  email        text,
  requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Same authorization gate as the org-stats RPCs: empty set unless the caller
  -- is super_admin or an org_admin of this exact org.
  IF NOT public.can_view_org_stats(p_org_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.user_id, p.nume, p.email, r.created_at AS requested_at
  FROM public.org_join_requests r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.org_id = p_org_id
    AND r.status = 'pending'
  ORDER BY r.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_join_requests(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_pending_join_requests(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pending_join_requests(uuid) TO authenticated;
