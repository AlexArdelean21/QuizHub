-- Migration: intrebari_personal_exam_select
--
-- PROBLEMA:
-- Politica existenta intrebari_select_own_org (migrarea 20260606000002) permite SELECT
-- pe intrebari doar pentru super_admin sau pentru examene cu org_id = org_id-ul userului.
-- Examenele personale au org_id IS NULL, deci `org_id = my_org_id` evalueaza NULL,
-- niciodata TRUE. Rezultat: proprietarul unui examen personal vede examenul
-- (via examene_personal_owner) dar NU poate citi nicio intrebare din el.
-- Aceasta migrare adauga ramura lipsa, DOAR pentru SELECT.
--
-- STRICT ADITIV: nu atinge, nu redenumeste si nu recreeaza politicile existente.
-- Fara politici de INSERT/UPDATE/DELETE (scrierea vine intr-un pas ulterior).

CREATE OR REPLACE FUNCTION public.owns_personal_exam(p_examen_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.examene e
     WHERE e.id = p_examen_id
       AND e.org_id IS NULL
       AND e.creator_user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.owns_personal_exam(bigint) TO authenticated;

DROP POLICY IF EXISTS intrebari_personal_owner_select ON public.intrebari;

CREATE POLICY intrebari_personal_owner_select
  ON public.intrebari
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (public.owns_personal_exam(examen_id));
