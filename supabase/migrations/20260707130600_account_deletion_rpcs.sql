-- Account deletion grace-period toggles. These only flip
-- profiles.deletion_requested_at; the actual anonymization/scheduled deletion
-- (and user_consents retention handling) is a separate Edge Function + cron
-- piece designed later — intentionally NOT implemented here.
--
-- GUARDS (do not rely on SECURITY DEFINER alone):
--   * Each function acts only on the caller's own account
--     (p_user_id = auth.uid()) — the parameter is never trusted blindly.
-- SECURITY DEFINER so the UPDATE runs regardless of RLS nuances;
-- EXECUTE granted to `authenticated` only.

create or replace function public.request_account_deletion(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Poți solicita ștergerea doar pentru propriul cont';
  end if;

  update public.profiles
  set deletion_requested_at = now()
  where id = p_user_id;
end;
$$;

create or replace function public.cancel_account_deletion(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Poți anula ștergerea doar pentru propriul cont';
  end if;

  update public.profiles
  set deletion_requested_at = null
  where id = p_user_id;
end;
$$;

revoke all on function public.request_account_deletion(uuid) from public;
revoke all on function public.request_account_deletion(uuid) from anon;
grant execute on function public.request_account_deletion(uuid) to authenticated;

revoke all on function public.cancel_account_deletion(uuid) from public;
revoke all on function public.cancel_account_deletion(uuid) from anon;
grant execute on function public.cancel_account_deletion(uuid) to authenticated;
