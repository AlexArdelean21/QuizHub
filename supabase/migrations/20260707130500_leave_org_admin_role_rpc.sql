-- leave_org_admin_role: an org_admin steps down to a regular 'user' while staying
-- a member of the same organization (org_id unchanged).
--
-- GUARDS (do not rely on SECURITY DEFINER alone):
--   * A caller may only demote themselves (p_user_id = auth.uid()).
--   * The caller must currently be an org_admin.
--   * The org must retain at least one other org_admin — the last admin cannot
--     abandon the organization (they must promote someone else first).
-- SECURITY DEFINER so it can UPDATE profiles regardless of RLS;
-- EXECUTE granted to `authenticated` only.

create or replace function public.leave_org_admin_role(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text;
  v_org_id      uuid;
  v_other_admins int;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Poți renunța doar la propriul rol';
  end if;

  select role, org_id into v_role, v_org_id
  from public.profiles
  where id = p_user_id
  for update;

  if not found or v_role <> 'org_admin' then
    raise exception 'Doar un administrator de organizație poate renunța la acest rol';
  end if;

  select count(*) into v_other_admins
  from public.profiles
  where org_id = v_org_id
    and role = 'org_admin'
    and id <> p_user_id;

  if v_other_admins = 0 then
    raise exception 'Ești singurul administrator al organizației — promovează pe altcineva înainte de a renunța la rol';
  end if;

  -- org_id intentionally left unchanged: the user remains a member.
  update public.profiles
  set role = 'user'
  where id = p_user_id;
end;
$$;

revoke all on function public.leave_org_admin_role(uuid) from public;
revoke all on function public.leave_org_admin_role(uuid) from anon;
grant execute on function public.leave_org_admin_role(uuid) to authenticated;
