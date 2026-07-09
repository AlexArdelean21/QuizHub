-- ============================================================
-- STEP 1 (DB layer): get_pending_join_requests(p_org_id) — admin read RPC
-- ============================================================
--
-- !!! TAKE A MANUAL BACKUP OF THE PRODUCTION DATABASE BEFORE RUNNING !!!
-- (Single production Supabase project, no separate dev DB. Safe to run once;
--  idempotent via CREATE OR REPLACE.)
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The pending-join-request approval flow (server action listPendingJoinRequests
-- in app/admin/join-requests/actions.ts) needs a SECURITY DEFINER read RPC that
-- returns the requester's nume/email. A plain table query cannot do this: the
-- requester is NOT yet a member of the org, so an org_admin's RLS on `profiles`
-- would hide the requester's row. This function reads across that boundary as
-- owner, after gating the caller with the SAME check used by the org-stats RPCs.
--
-- This is the canonical read RPC from the spec. It is extracted here as its own
-- standalone object (rather than applying 20260707140000_org_join_code_reconcile
-- .sql, which additionally renames organizatii.cod_org -> org_code and would
-- require app changes). It depends ONLY on already-live objects
-- (can_view_org_stats, org_join_requests, profiles) and reads the live
-- created_at column, exposing it under the spec name `requested_at`. If the
-- reconcile migration is applied later it re-creates this same function
-- (CREATE OR REPLACE), so there is no conflict.
--
-- LIVE FUNCTION SIGNATURES VERIFIED BEFORE WRITING THIS MIGRATION
-- --------------------------------------------------------------
--   can_view_org_stats     (p_org_id uuid)                                  -> boolean
--   check_org_limits       (p_org_id uuid, p_resource text)                 -> jsonb
--   leave_org_admin_role   (p_user_id uuid)                                 -> void
--   resolve_join_request   (p_request_id uuid, p_decision text, p_resolved_by uuid) -> void
--   get_pending_join_requests -> did NOT exist live prior to this migration.
-- ============================================================

-- The request `id` is exposed alongside the requester's identity so the admin
-- UI can call resolve_join_request(p_request_id, ...) on a specific row. A
-- DROP is required first because the RETURNS TABLE shape changes (CREATE OR
-- REPLACE cannot alter a function's return type).
DROP FUNCTION IF EXISTS public.get_pending_join_requests(uuid);

CREATE OR REPLACE FUNCTION public.get_pending_join_requests(p_org_id uuid)
RETURNS TABLE (
  id           uuid,
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
  SELECT r.id, r.user_id, p.nume, p.email, r.created_at AS requested_at
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

COMMENT ON FUNCTION public.get_pending_join_requests(uuid) IS
  'Returns pending org_join_requests (id, user_id, nume, email, requested_at) for the given org. id is the request id used by resolve_join_request. SECURITY DEFINER so it can read the requester profile across RLS; gated by can_view_org_stats (super_admin or org_admin of this org).';
