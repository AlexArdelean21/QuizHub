-- ============================================================
-- STEP 1 (DB layer): "Leave organization" for regular users
-- ============================================================
--
-- !!! TAKE A MANUAL BACKUP OF THE PRODUCTION DATABASE BEFORE RUNNING !!!
-- (This project has a single production Supabase project and no separate dev
--  DB, so run this once and verify. The statement below is safe to run once
--  and is idempotent — CREATE OR REPLACE.)
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Adds `leave_organization()` so a plain user can remove themselves from their
-- org without going through an admin. org_admin cannot use this — they must call
-- `leave_org_admin_role()` first (which demotes them to plain user), then call
-- this. super_admin cannot use it either (they operate outside the org
-- membership model).
--
-- Why a SECURITY DEFINER function (not a direct client UPDATE): profiles.org_id
-- is not writable by authenticated/anon (column-level REVOKE + the BEFORE UPDATE
-- trigger prevent_profile_privilege_escalation from 20260606000001). This
-- function runs as owner, so it can null out org_id while the caller's own
-- session still cannot.
--
-- LIVE FUNCTION SIGNATURES VERIFIED BEFORE WRITING THIS MIGRATION
-- (SELECT proname, pg_get_function_identity_arguments(oid), pg_get_function_result(oid) FROM pg_proc WHERE proname IN (...);)
-- --------------------------------------------------------------
--   can_view_org_stats     (p_org_id uuid)                                  -> boolean
--   check_org_limits       (p_org_id uuid, p_resource text)                 -> jsonb
--   leave_org_admin_role   (p_user_id uuid)                                 -> void
--   resolve_join_request   (p_request_id uuid, p_decision text, p_resolved_by uuid) -> void
--   get_pending_join_requests  -> NOT PRESENT in the live database (only defined in the
--       unapplied 20260707140000_org_join_code_reconcile.sql). Flagged to the author;
--       no dependency on it in this migration.
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_organization()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_org  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat.';
  END IF;

  SELECT role, org_id INTO v_role, v_org
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profilul nu a fost găsit.';
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Nu faci parte din nicio organizație.';
  END IF;

  -- Business rule: only plain users can self-leave. org_admin must first
  -- relinquish the admin role (leave_org_admin_role), and super_admin operates
  -- outside org membership entirely.
  IF v_role = 'org_admin' THEN
    RAISE EXCEPTION 'Renunță întâi la rolul de administrator, apoi poți ieși din organizație.';
  END IF;
  IF v_role = 'super_admin' THEN
    RAISE EXCEPTION 'Super admin nu poate ieși din organizație prin această acțiune.';
  END IF;

  UPDATE public.profiles
  SET org_id = NULL
  WHERE id = v_uid;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_organization() FROM public;
REVOKE ALL ON FUNCTION public.leave_organization() FROM anon;
GRANT EXECUTE ON FUNCTION public.leave_organization() TO authenticated;

COMMENT ON FUNCTION public.leave_organization() IS
  'Allows a plain user (role = user) to remove themselves from their organization by setting org_id = NULL. org_admin must demote themselves first; super_admin is not eligible.';
