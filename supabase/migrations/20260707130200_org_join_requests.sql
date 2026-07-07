-- org_join_requests: a user asks to join an organization (by code); an org_admin
-- of that org (or super_admin) approves/rejects. New table, RLS enabled from the
-- start. Unrelated to the invite_tokens flow.

create table if not exists public.org_join_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  org_id      uuid not null references public.organizatii(id),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  message     text null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users(id)
);

-- At most one pending request per (user, org). Approved/rejected rows don't
-- block a future re-request.
create unique index if not exists org_join_requests_unique_pending
  on public.org_join_requests (user_id, org_id)
  where status = 'pending';

-- Helpful lookup index for an org_admin listing their org's pending requests.
create index if not exists org_join_requests_org_status_idx
  on public.org_join_requests (org_id, status);

alter table public.org_join_requests enable row level security;

-- INSERT: a user may only create a request for themselves. No org restriction
-- (the whole point is requesting to join an org you're not in yet).
create policy org_join_requests_insert_own
  on public.org_join_requests
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- SELECT: the requester sees their own; an org_admin sees requests for their org;
-- super_admin sees all. Uses SECURITY DEFINER helpers to avoid RLS recursion.
create policy org_join_requests_select_scoped
  on public.org_join_requests
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or get_my_role() = 'super_admin'
    or (get_my_role() = 'org_admin' and org_id = get_my_org())
  );

-- UPDATE: only an org_admin of the matching org (or super_admin) — never the
-- requesting user. Both USING and WITH CHECK keep the row inside the same org.
create policy org_join_requests_update_admin
  on public.org_join_requests
  for update
  to authenticated
  using (
    get_my_role() = 'super_admin'
    or (get_my_role() = 'org_admin' and org_id = get_my_org())
  )
  with check (
    get_my_role() = 'super_admin'
    or (get_my_role() = 'org_admin' and org_id = get_my_org())
  );

-- No DELETE policy: requests are resolved (status change), not deleted.
