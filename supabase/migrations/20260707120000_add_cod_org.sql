-- Add a short, human-friendly unique organization code (cod_org) to organizatii.
--
-- Format: "QH-" + 6 uppercase alphanumeric characters (e.g. QH-4F82K1).
-- The generator retries on collision. Existing rows are backfilled before the
-- NOT NULL + UNIQUE constraints are applied.
--
-- NOTE ON INDEXING: a UNIQUE constraint in Postgres is backed by an automatically
-- created unique B-tree index, so no separate CREATE INDEX is required for cod_org.

-- 1. Add the column (nullable for now so we can backfill).
alter table public.organizatii
  add column if not exists cod_org text;

-- 2. Unique code generator with bounded retries.
create or replace function public.generate_cod_org()
returns text
language plpgsql
as $$
declare
  v_alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_code text;
  v_exists boolean;
  v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;

    v_code := 'QH-';
    for i in 1..6 loop
      v_code := v_code
        || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    select exists (
      select 1 from public.organizatii where cod_org = v_code
    ) into v_exists;

    exit when not v_exists;

    if v_attempt >= 10 then
      raise exception 'Could not generate a unique cod_org after % attempts', v_attempt;
    end if;
  end loop;

  return v_code;
end;
$$;

-- 3. Backfill existing organizations that don't have a code yet.
update public.organizatii
set cod_org = public.generate_cod_org()
where cod_org is null;

-- 4. Enforce presence and uniqueness now that every row has a code.
alter table public.organizatii
  alter column cod_org set not null;

alter table public.organizatii
  add constraint organizatii_cod_org_key unique (cod_org);
