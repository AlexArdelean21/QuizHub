-- resolve_join_request: an org_admin (or super_admin) approves/rejects a pending
-- join request. Atomic (single function body / transaction) with row lock.
--
-- GUARDS (do not rely on SECURITY DEFINER alone):
--   * The resolver must act as themselves (p_resolved_by = auth.uid()).
--   * The resolver's profile must be super_admin, OR org_admin whose org_id
--     matches the request's org_id — this is the critical authorization check.
--   * The request must still be 'pending' (locked FOR UPDATE to serialize
--     concurrent resolutions).
--   * On approval, slot availability is RE-CHECKED at this moment via the
--     existing check_org_limits(org_id, 'useri') — approving over the limit
--     fails loudly (matching the assertOrgLimit principle), never silently.
-- SECURITY DEFINER so it can UPDATE profiles / org_join_requests regardless of
-- RLS; EXECUTE granted to `authenticated` only.

create or replace function public.resolve_join_request(
  p_request_id uuid,
  p_decision text,
  p_resolved_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid;
  v_org_id      uuid;
  v_status      text;
  v_actor_role  text;
  v_actor_org   uuid;
  v_limit       jsonb;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decizie invalidă';
  end if;

  if auth.uid() is null or auth.uid() <> p_resolved_by then
    raise exception 'Nu ai permisiunea să rezolvi această cerere';
  end if;

  -- Lock the request to serialize concurrent resolutions.
  select user_id, org_id, status
    into v_user_id, v_org_id, v_status
  from public.org_join_requests
  where id = p_request_id
  for update;

  if not found or v_status <> 'pending' then
    raise exception 'Cererea nu mai este în așteptare';
  end if;

  -- Authorization: super_admin, or org_admin of this exact org.
  select role, org_id into v_actor_role, v_actor_org
  from public.profiles
  where id = p_resolved_by;

  if not (
    v_actor_role = 'super_admin'
    or (v_actor_role = 'org_admin' and v_actor_org = v_org_id)
  ) then
    raise exception 'Nu ai permisiunea să rezolvi această cerere';
  end if;

  if p_decision = 'rejected' then
    update public.org_join_requests
    set status = 'rejected', resolved_at = now(), resolved_by = p_resolved_by
    where id = p_request_id;
    return;
  end if;

  -- Approval path: re-check the 'useri' limit at this moment.
  v_limit := public.check_org_limits(v_org_id, 'useri');
  if not (
    coalesce((v_limit->>'allowed')::boolean, false)
    or coalesce((v_limit->>'managed_manually')::boolean, false)
  ) then
    raise exception 'Organizația nu mai are locuri libere';
  end if;

  update public.profiles
  set role = 'user', org_id = v_org_id
  where id = v_user_id;

  update public.org_join_requests
  set status = 'approved', resolved_at = now(), resolved_by = p_resolved_by
  where id = p_request_id;
end;
$$;

revoke all on function public.resolve_join_request(uuid, text, uuid) from public;
revoke all on function public.resolve_join_request(uuid, text, uuid) from anon;
grant execute on function public.resolve_join_request(uuid, text, uuid) to authenticated;
