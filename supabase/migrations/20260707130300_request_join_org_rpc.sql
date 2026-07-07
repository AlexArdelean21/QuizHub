-- request_join_org: a user submits a request to join an organization by its code.
--
-- GUARDS (do not rely on SECURITY DEFINER alone):
--   * A caller may only create a request for their OWN account
--     (p_user_id must equal auth.uid()) — prevents forging requests for others.
--   * The org must exist (looked up by cod_org).
--   * At most one pending request per (user, org): enforced by the partial unique
--     index org_join_requests_unique_pending; the unique_violation is caught and
--     re-raised as a clean, user-facing message.
-- SECURITY DEFINER so the INSERT bypasses RLS write scoping in a controlled way;
-- EXECUTE granted to `authenticated` only.

create or replace function public.request_join_org(
  p_user_id uuid,
  p_cod_org text,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_request uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Poți trimite cereri doar pentru propriul cont';
  end if;

  select id into v_org_id
  from public.organizatii
  where cod_org = btrim(p_cod_org);

  if not found then
    raise exception 'Organizația nu a fost găsită';
  end if;

  begin
    insert into public.org_join_requests (user_id, org_id, message, status)
    values (p_user_id, v_org_id, nullif(btrim(coalesce(p_message, '')), ''), 'pending')
    returning id into v_request;
  exception
    when unique_violation then
      raise exception 'Ai deja o cerere în așteptare pentru această organizație';
  end;

  return v_request;
end;
$$;

revoke all on function public.request_join_org(uuid, text, text) from public;
revoke all on function public.request_join_org(uuid, text, text) from anon;
grant execute on function public.request_join_org(uuid, text, text) to authenticated;
