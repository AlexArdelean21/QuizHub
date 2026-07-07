-- examene: support personal (non-org) exams owned by a single user.
--
-- STEP 0 findings baked in:
--   * examene.org_id is ALREADY nullable in the live DB (is_nullable = YES),
--     so no existing NOT NULL constraint or org-scoped policy is weakened here.
--     The DROP NOT NULL below is defensive/idempotent (no-op on the live DB).
--   * All changes here are ADDITIVE. The existing org-scoped policies
--     (examene_select_own_org / _insert_ / _update_ / _delete_privileged_only)
--     are left completely untouched.

-- 1. Ensure org_id is nullable (idempotent — already nullable in the live DB).
alter table public.examene
  alter column org_id drop not null;

-- 2. Track the owner of a personal exam. Nullable by design: existing rows are
--    org exams with no truthful creator to backfill, so they stay NULL.
--    Application logic must set creator_user_id for every NEW personal exam.
alter table public.examene
  add column if not exists creator_user_id uuid references auth.users(id);

-- Helps the personal-exam policy and "my personal exams" lookups.
create index if not exists examene_creator_user_id_idx
  on public.examene (creator_user_id)
  where org_id is null;

-- 3. ADDITIVE personal-exam policy: a user fully owns their own personal exams
--    (org_id IS NULL AND creator_user_id = auth.uid()). FOR ALL covers
--    SELECT/INSERT/UPDATE/DELETE; combined with the existing per-command
--    policies via OR (permissive), so no existing capability is removed.
create policy examene_personal_owner
  on public.examene
  for all
  to authenticated
  using (org_id is null and creator_user_id = auth.uid())
  with check (org_id is null and creator_user_id = auth.uid());

-- 4. VERIFICATION NOTE (holds for the exact policies found in STEP 0):
--    examene_select_own_org = (my_role='super_admin') OR (org_id = my_org_id).
--    For a personal exam org_id IS NULL, so `org_id = my_org_id` is NULL (never
--    TRUE) for every non-super-admin — including other personal users whose
--    own org_id is also NULL, since `NULL = NULL` is NULL in SQL. Therefore the
--    org-scoped SELECT never leaks personal exams across users. The only
--    exception is super_admin, whose unconditional branch sees all rows
--    (personal exams included) — consistent with super-admin-sees-all.
