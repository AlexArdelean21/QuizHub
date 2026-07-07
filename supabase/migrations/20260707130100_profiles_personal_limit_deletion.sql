-- profiles: per-user personal exam limit + account-deletion grace period.
--
-- No RLS changes here. STEP 0 confirmed profiles UPDATE is already restricted to
-- the owner (policies "Users can update own profile" / "Userul își vede propriul
-- profil" USING auth.uid() = id) or super_admin ("Super Admin vede tot"). So a
-- user cannot set another user's deletion_requested_at via a direct table UPDATE.
-- The new columns are not referenced by any existing policy.

-- 1. Personal exam cap. DEFAULT 2 is a truthful backfill (it's the limit we want
--    every existing account to have), so NOT NULL is safe.
alter table public.profiles
  add column if not exists max_examene_personale smallint not null default 2;

-- 2. Deletion grace period marker. NULL = active account; non-NULL = deletion
--    requested (14-day grace window before anonymization, handled elsewhere).
alter table public.profiles
  add column if not exists deletion_requested_at timestamptz null;
