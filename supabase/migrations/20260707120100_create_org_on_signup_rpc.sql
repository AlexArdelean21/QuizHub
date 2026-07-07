-- create_org_on_signup: atomically create a new organization and promote the
-- calling base user to org_admin of that organization.
--
-- SECURITY DEFINER so the function can INSERT into organizatii and UPDATE
-- profiles regardless of RLS. The guards below prevent abuse:
--   * Only base 'user' accounts with no org may create one. This makes the RPC
--     idempotent-ish (a second call for the same user fails once org_id is set)
--     and stops an existing org_admin/super_admin from spawning extra orgs.
--   * An authenticated caller may only act on their OWN profile (auth.uid()).
--     Callers with no JWT (e.g. trusted server/service contexts) skip this check.
--   * The enterprise tier can never be created here — it requires manual setup.
--
-- SCHEMA NOTES (differences from the original spec, adapted to this DB):
--   * plan_tiers.id and organizatii.tier_id are `smallint` (spec assumed uuid),
--     so p_tier_id is smallint.
--   * organizatii.slug is NOT NULL, so a slug is derived from the org name and
--     suffixed with the generated code to guarantee uniqueness.

create or replace function public.create_org_on_signup(
  p_user_id uuid,
  p_nume_org text,
  p_tier_id smallint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       text;
  v_existing   uuid;
  v_tier_nume  text;
  v_cod_org    text;
  v_slug       text;
  v_nume       text;
  v_org_id     uuid;
begin
  v_nume := btrim(coalesce(p_nume_org, ''));
  if v_nume = '' then
    raise exception 'Organization name is required';
  end if;

  -- An authenticated caller can only create an organization for themselves.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'You can only create an organization for your own account';
  end if;

  -- Lock the profile row to serialize concurrent attempts.
  select role, org_id
    into v_role, v_existing
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;
  if v_existing is not null then
    raise exception 'User already belongs to an organization';
  end if;
  if v_role <> 'user' then
    raise exception 'Only base user accounts can create an organization';
  end if;

  -- Validate the tier and forbid enterprise.
  select nume into v_tier_nume from public.plan_tiers where id = p_tier_id;
  if not found then
    raise exception 'Selected plan does not exist';
  end if;
  if v_tier_nume = 'enterprise' then
    raise exception 'Enterprise tier requires manual setup';
  end if;

  v_cod_org := public.generate_cod_org();

  -- Derive a slug from the name and suffix the code for guaranteed uniqueness.
  v_slug := regexp_replace(lower(v_nume), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then
    v_slug := 'org';
  end if;
  v_slug := v_slug || '-' || lower(replace(v_cod_org, 'QH-', ''));

  insert into public.organizatii
    (nume, slug, cod_org, tier_id, subscription_status, is_managed_manually)
  values
    (v_nume, v_slug, v_cod_org, p_tier_id, 'active', false)
  returning id into v_org_id;

  update public.profiles
  set role = 'org_admin',
      org_id = v_org_id
  where id = p_user_id;

  return v_org_id;
end;
$$;

-- Only authenticated users may call this (never anon).
revoke all on function public.create_org_on_signup(uuid, text, smallint) from public;
revoke all on function public.create_org_on_signup(uuid, text, smallint) from anon;
grant execute on function public.create_org_on_signup(uuid, text, smallint) to authenticated;
