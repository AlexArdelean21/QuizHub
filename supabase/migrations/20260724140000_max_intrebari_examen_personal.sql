-- Plafon de intrebari per examen personal.
--
-- Examenele personale (org_id IS NULL) sunt create de utilizatori pe cont propriu,
-- fara abonament si fara limitele de tier ale organizatiilor. Fara plafon, un cont
-- gratuit poate importa nelimitat in baza de date. Coloana e per-utilizator, in
-- aceeasi logica cu profiles.max_examene_personale, ca sa poata fi ridicata punctual
-- fara deploy.
--
-- DOMENIU: se aplica EXCLUSIV examenelor cu org_id IS NULL. Examenele de organizatie
-- raman fara plafon de intrebari; ele sunt guvernate de plan_tiers / check_org_limits().
--
-- Plafonul e verificat in server action (app/my-exams/actions.ts), nu printr-un
-- CHECK constraint — validarea are nevoie de un COUNT pe intrebari, ce nu se poate
-- exprima declarativ.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS max_intrebari_examen_personal integer NOT NULL DEFAULT 500;

COMMENT ON COLUMN public.profiles.max_intrebari_examen_personal IS
  'Numar maxim de intrebari per examen personal (org_id IS NULL). Nu se aplica examenelor de organizatie.';
