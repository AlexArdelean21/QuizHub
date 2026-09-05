-- =============================================================================
-- profiles: inchiderea escaladarii de privilegii prin INSERT
-- =============================================================================
-- VULNERABILITATE (latenta, nu exploatabila la momentul reparatiei):
--
--   `anon` si `authenticated` aveau GRANT INSERT pe coloanele privilegiate
--   `role`, `rol`, `org_id`, `has_access_default_quiz`. Migrarea F-01 revocase
--   corect UPDATE pe aceleasi coloane, dar nu si INSERT.
--
--   Politica `Users can insert their own profile` e `WITH CHECK (auth.uid() = id)`.
--   Trigger-ul `enforce_profile_immutable_fields` e doar pe UPDATE; nu exista
--   echivalent pe INSERT.
--
--   Singurul lucru care oprea escaladarea era cheia primara pe `id`: randul de
--   profil exista deja (creat de `handle_new_user`), deci un al doilea INSERT
--   dadea 23505. Aparare reala, dar accidentala.
--
--   Lantul care ar fi deschis-o: DELETE pe propriul rand, urmat de INSERT cu
--   `role = 'super_admin'`. Verificat 2026-09-04: nu exista politica de DELETE
--   pentru `authenticated` pe `profiles`, deci DELETE-ul intoarce 0 randuri si
--   lantul e rupt AZI. Dar stergerea self-service GDPR (Art. 17) e pe roadmap
--   si va construi exact acea cale.
--
--   Ruta prin PostgREST `Prefer: resolution=merge-duplicates` (care genereaza
--   INSERT ... ON CONFLICT DO UPDATE) era deja inchisa: Postgres cere privilegiu
--   de UPDATE pe coloanele din clauza SET, revocate de F-01, iar trigger-ul de
--   UPDATE se aplica oricum.
--
-- SIGURANTA (verificat in cod inainte de aplicare):
--   Nu exista niciun `.insert()` sau `.upsert()` pe `profiles` din client.
--     - profilul se creeaza exclusiv prin `handle_new_user` (SECURITY DEFINER,
--       detinut de postgres, neafectat de granturi pe `authenticated`)
--     - organizatia prin RPC-ul `create_org_on_signup`
--     - invitatiile prin `lib/auth/invite-token.ts`, care foloseste service_role
--   Confirmat empiric dupa aplicare: cont nou creat prin formularul de signup,
--   profil generat corect cu role='user', org_id NULL,
--   has_access_default_quiz=true (valoarea DEFAULT, dovada ca trigger-ul de mai
--   jos nu s-a declansat pe calea SECURITY DEFINER).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Stratul de granturi
-- -----------------------------------------------------------------------------
REVOKE INSERT (role, rol, org_id, has_access_default_quiz)
  ON public.profiles FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Aparare in adancime
-- -----------------------------------------------------------------------------
-- Acopera cazul in care cineva reacorda grantul candva (s-a mai intamplat:
-- pg_stat_statements arata un REVOKE identic rulat si apoi pierdut).
--
-- `current_user` e 'authenticated' / 'anon' doar pe calea PostgREST. In
-- interiorul unei functii SECURITY DEFINER e proprietarul functiei, deci
-- `handle_new_user` trece neatins. Asta e mecanismul care face trigger-ul
-- inofensiv pentru fluxul de signup.
--
-- ATENTIE: functia NU atinge `rol`. Coloana e duplicat mort al lui `role` si e
-- programata pentru eliminare; grantul revocat mai sus o acopera. Nu adauga
-- referinte la `rol` aici — plpgsql rezolva NEW.<coloana> la executie, iar o
-- redenumire ulterioara ar rupe tacut orice modificare de profil facuta de un
-- user obisnuit, lasand intacte scrierile prin service_role.
CREATE OR REPLACE FUNCTION public.enforce_profile_insert_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.role                     := 'user';
    NEW.org_id                   := NULL;
    NEW.has_access_default_quiz  := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profile_insert_defaults ON public.profiles;
CREATE TRIGGER enforce_profile_insert_defaults
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_insert_defaults();

COMMENT ON FUNCTION public.enforce_profile_insert_defaults() IS
  'Aparare in adancime peste REVOKE INSERT pe coloanele privilegiate din profiles. Se aplica doar inserarilor venite prin PostgREST ca anon/authenticated; functiile SECURITY DEFINER (handle_new_user) ruleaza ca owner si nu sunt afectate.';

COMMIT;

-- =============================================================================
-- CAPCANA DE RETINUT
-- =============================================================================
-- RLS e singurul strat de aparare cand exista GRANT-uri blanket pe tabele.
-- ORICE coloana noua adaugata la `profiles` care are nevoie de INSERT sau
-- UPDATE din client cere un GRANT explicit la nivel de coloana, intr-o migrare
-- separata. Invers, orice coloana privilegiata noua cere un REVOKE explicit —
-- nu e acoperita de aceasta migrare.
-- =============================================================================

-- =============================================================================
-- VERIFICARE (ruleaza separat, NU face parte din migrare)
-- =============================================================================
-- Rezultat obtinut pe productie dupa aplicare: 42501.
--
-- BEGIN;
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"a4600019-18b0-4c7a-9e52-cadf6159852c","role":"authenticated","aud":"authenticated"}', true);
-- SET LOCAL ROLE authenticated;
-- INSERT INTO public.profiles (id, email, role)
-- VALUES ('00000000-0000-0000-0000-000000000001', 'x@y.z', 'super_admin')
-- RETURNING id, role;   -- asteptat: 42501
-- ROLLBACK;
--
-- -- Granturile ramase pe coloanele privilegiate (asteptat: zero randuri INSERT)
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public' AND table_name = 'profiles'
--   AND grantee IN ('anon', 'authenticated')
--   AND column_name IN ('role', 'rol', 'org_id', 'has_access_default_quiz')
-- ORDER BY grantee, column_name, privilege_type;
--
-- -- ROLLBACK, daca signup-ul se rupe:
-- --   GRANT INSERT (role, rol, org_id, has_access_default_quiz)
-- --     ON public.profiles TO anon, authenticated;
-- --   DROP TRIGGER IF EXISTS enforce_profile_insert_defaults ON public.profiles;
-- =============================================================================
