-- ============================================================
-- Allow users to update their own profiles.hide_org_banner
-- ============================================================
--
-- CONTEXT: 20260606000001_security_f01_f02_profile_immutable_fields.sql revoked
-- the table-wide UPDATE on public.profiles from authenticated/anon and re-granted
-- it on an explicit allowlist of non-sensitive, self-service columns
-- (nume, email, streak_zile, ultima_activitate). Because that revoke is
-- table-wide, ANY column added to profiles afterwards is unwritable by
-- authenticated at the PostgreSQL permission layer — before RLS even runs.
--
-- hide_org_banner is a per-user UI preference ("stop showing me the
-- 'join an organization' dashboard banner"). It is not an authorization input:
-- nothing reads it to decide access, only whether to paint a banner. So it
-- belongs on the same self-service allowlist rather than behind a
-- SECURITY DEFINER RPC.
--
-- This grant is column-scoped and additive; it does not touch the revoke above,
-- so the sensitive columns (rol, role, org_id, has_access_default_quiz) stay
-- unwritable. Row scoping is unchanged and still enforced by the existing
-- "Users can update own profile" policy — USING (auth.uid() = id) — so a user
-- can only ever flip this flag on their own row.
--
-- CAVEAT: the hide_org_banner column itself was added directly to the remote DB
-- and has no migration of its own, so this file assumes it already exists.
--
-- Written by lib/actions/org-banner.ts -> hideOrgBanner().
GRANT UPDATE (hide_org_banner)
  ON public.profiles
  TO authenticated;
