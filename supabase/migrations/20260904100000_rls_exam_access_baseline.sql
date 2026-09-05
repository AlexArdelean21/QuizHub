-- =============================================================================
-- RLS: stratul de acces pe `examene` si `intrebari` — BASELINE
-- =============================================================================
-- Reconstruieste in repo starea aplicata manual prin SQL Editor in sesiunea de
-- migrare RLS. Continutul e extras direct din `pg_get_functiondef` si
-- `pg_get_expr` pe productie (2026-09-04), nu rescris din memorie.
--
-- CONTEXT (bresa reparata):
--   Orice membru al unei organizatii putea citi, prin request direct la
--   PostgREST, toate intrebarile org-ului cu `raspuns_corect`,
--   `raspunsuri_corecte` si `explicatie`, inclusiv la examene la care nu avea
--   alocare. Masurat: 57 din 71 de intrebari scurse (80%).
--
-- MODELUL DE ACCES (SELECT):
--   super_admin                      -> tot
--   org_admin                        -> tot org-ul
--   user, is_org_wide = true         -> examen + intrebari
--   user, alocare valida             -> examen + intrebari
--   user, alocare EXPIRATA           -> examen DA, intrebari NU
--   user, fara alocare               -> nimic
--   proprietar examen personal       -> examen + intrebari (org_id IS NULL)
--   orice autentificat, examen public-> examen + intrebari (org_id IS NULL)
--
--   Vizibilitatea la alocare expirata e intentionata: pastreaza istoricul si
--   statisticile. La reacordare istoricul continua automat, fiind cheiat pe
--   (user_id, examen_id), iar `grantExamAccess` face UPDATE, nu recreare.
--
-- LECTII (nu modifica fara sa le citesti):
--   1. O politica pe tabela X nu poate contine un subquery care citeste tot X.
--      Prima versiune folosea `my_visible_exam_ids()`, care reinteroga
--      `examene`. Rezultat: INSERT pe `examene` esua cu 42501, fiindca functia
--      STABLE foloseste snapshot-ul de la inceputul instructiunii si nu vede
--      randul nou. Conditiile pe randul curent se scriu INLINE; doar
--      lookup-urile in ALTE tabele merg prin functie.
--   2. Functiile in politici returneaza SETOF, nu boolean. `x IN (SELECT ...)`
--      produce un hashed SubPlan cu loops=1; un predicat boolean per rand e
--      evaluat de N ori. La 3.646 de randuri diferenta a fost ~7.000 buffere.
--   3. Apelurile scalare se infasoara in `(SELECT f())`, ridicat de planner ca
--      InitPlan. `STABLE` singur NU memoizeaza.
--   4. Orice politica noua se testeaza cu `INSERT ... RETURNING` pe fiecare
--      rol, nu doar cu SELECT. Acolo a fost gaura in bateria initiala.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Curatare cod mort
-- -----------------------------------------------------------------------------
-- Abandonata: reinteroga `examene` din politica de pe `examene` (lectia 1).
-- Confirmat ca nicio politica nu o mai referentiaza.
DROP FUNCTION IF EXISTS public.my_visible_exam_ids();

-- -----------------------------------------------------------------------------
-- 1. Functii-helper
-- -----------------------------------------------------------------------------
-- Toate sunt STABLE + SECURITY DEFINER + `SET search_path` fixat. SECURITY
-- DEFINER e necesar ca sa poata citi `profiles` / `acces_examene` fara sa
-- declanseze RLS-ul acelor tabele din interiorul unei politici.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_org()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$function$;

-- Alocarile utilizatorului, FARA filtru pe expirare. Intentionat: sustine
-- randul "alocare expirata -> vede examenul". Nu adauga `data_expirare > now()`
-- aici; filtrul pe expirare traieste in `my_readable_exam_ids`.
CREATE OR REPLACE FUNCTION public.my_allocated_exam_ids()
RETURNS SETOF integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.examen_id
  FROM public.acces_examene a
  WHERE a.user_id = auth.uid();
$function$;

-- Examenele ale caror INTREBARI pot fi citite. Acopera DOAR ramura de
-- organizatie. Examenele personale si publice sunt acoperite de politici
-- separate (`intrebari_personal_owner_select`, `intrebari_public_exam_select`).
-- Consecinta: pentru un utilizator fara org functia intoarce multimea vida,
-- ceea ce e corect, nu un bug.
CREATE OR REPLACE FUNCTION public.my_readable_exam_ids()
RETURNS SETOF integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT role, org_id FROM public.profiles WHERE id = auth.uid()
  )
  SELECT e.id
  FROM public.examene e, me
  WHERE
    me.role = 'super_admin'
    OR (
      me.org_id IS NOT NULL
      AND e.org_id = me.org_id
      AND (
        me.role = 'org_admin'
        OR e.is_org_wide
        OR EXISTS (
          SELECT 1 FROM public.acces_examene a
          WHERE a.examen_id = e.id
            AND a.user_id = auth.uid()
            AND a.data_expirare > now()
        )
      )
    );
$function$;

-- `org_id IS NULL` e obligatoriu in ambele functii de mai jos. Fara el, un
-- org_admin care pune `is_public = true` pe un examen intern ar face
-- intrebarile lizibile pentru orice utilizator autentificat din platforma,
-- desi randul din `examene` ar ramane invizibil. Simetria cu
-- `examene_public_select` / `examene_personal_owner_select` e ceea ce inchide
-- scurgerea. Verificat empiric 2026-09-04.
CREATE OR REPLACE FUNCTION public.is_public_exam(p_examen_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.examene e
     WHERE e.id = p_examen_id
       AND e.is_public = true
       AND e.org_id IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.owns_personal_exam(p_examen_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.examene e
     WHERE e.id = p_examen_id
       AND e.org_id IS NULL
       AND e.creator_user_id = auth.uid()
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_role()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_org()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_allocated_exam_ids()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_readable_exam_ids()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_public_exam(bigint)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_personal_exam(bigint)       TO authenticated;

COMMENT ON FUNCTION public.my_allocated_exam_ids() IS
  'Alocarile utilizatorului, FARA filtru pe data_expirare. Intentionat: sustine "alocare expirata -> vede examenul, nu vede intrebarile". Filtrul pe expirare e in my_readable_exam_ids().';
COMMENT ON FUNCTION public.my_readable_exam_ids() IS
  'Acopera DOAR ramura de organizatie. Examenele personale si publice sunt acoperite de politici SELECT separate pe intrebari.';

-- -----------------------------------------------------------------------------
-- 2. Politici pe `examene`
-- -----------------------------------------------------------------------------
ALTER TABLE public.examene ENABLE ROW LEVEL SECURITY;

-- SELECT: ramura organizatie. Conditiile pe randul curent sunt inline (lectia 1).
DROP POLICY IF EXISTS "examene_select_own_org" ON public.examene;
CREATE POLICY "examene_select_own_org"
  ON public.examene FOR SELECT TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'super_admin'
    OR (
      org_id IS NOT NULL
      AND org_id = (SELECT public.get_my_org())
      AND (
        (SELECT public.get_my_role()) = 'org_admin'
        OR is_org_wide
        OR id IN (SELECT x FROM public.my_allocated_exam_ids() AS x)
      )
    )
  );

-- SELECT: examene personale. `org_id IS NULL` separa spatiul personal de cel
-- organizational; fara el, un examen de org cu creator setat ar ramane vizibil
-- dupa iesirea utilizatorului din organizatie.
DROP POLICY IF EXISTS "examene_personal_owner_select" ON public.examene;
CREATE POLICY "examene_personal_owner_select"
  ON public.examene FOR SELECT TO authenticated
  USING (org_id IS NULL AND creator_user_id = auth.uid());

-- SELECT: examene publice.
DROP POLICY IF EXISTS "examene_public_select" ON public.examene;
CREATE POLICY "examene_public_select"
  ON public.examene FOR SELECT TO authenticated
  USING (is_public = true AND org_id IS NULL);

DROP POLICY IF EXISTS "examene_insert_privileged_only" ON public.examene;
CREATE POLICY "examene_insert_privileged_only"
  ON public.examene FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "examene_update_privileged_only" ON public.examene;
CREATE POLICY "examene_update_privileged_only"
  ON public.examene FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "examene_delete_privileged_only" ON public.examene;
CREATE POLICY "examene_delete_privileged_only"
  ON public.examene FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    )
  );

COMMENT ON POLICY "examene_select_own_org" ON public.examene IS
  'Ramura organizatie. Alocarea expirata pastreaza vizibilitatea examenului (istoric/statistici), dar nu si a intrebarilor.';

-- -----------------------------------------------------------------------------
-- 3. Politici pe `intrebari`
-- -----------------------------------------------------------------------------
ALTER TABLE public.intrebari ENABLE ROW LEVEL SECURITY;

-- Cele trei politici SELECT sunt permisive si se combina cu OR. Impreuna
-- formeaza modelul complet; niciuna singura nu il descrie.
DROP POLICY IF EXISTS "intrebari_select_own_org" ON public.intrebari;
CREATE POLICY "intrebari_select_own_org"
  ON public.intrebari FOR SELECT TO authenticated
  USING (examen_id IN (SELECT x FROM public.my_readable_exam_ids() AS x));

DROP POLICY IF EXISTS "intrebari_personal_owner_select" ON public.intrebari;
CREATE POLICY "intrebari_personal_owner_select"
  ON public.intrebari FOR SELECT TO authenticated
  USING (public.owns_personal_exam(examen_id::bigint));

DROP POLICY IF EXISTS "intrebari_public_exam_select" ON public.intrebari;
CREATE POLICY "intrebari_public_exam_select"
  ON public.intrebari FOR SELECT TO authenticated
  USING (public.is_public_exam(examen_id::bigint));

DROP POLICY IF EXISTS "intrebari_insert_privileged_only" ON public.intrebari;
CREATE POLICY "intrebari_insert_privileged_only"
  ON public.intrebari FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND examen_id IN (
        SELECT id FROM public.examene
        WHERE org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "intrebari_update_privileged_only" ON public.intrebari;
CREATE POLICY "intrebari_update_privileged_only"
  ON public.intrebari FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND examen_id IN (
        SELECT id FROM public.examene
        WHERE org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
    )
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND examen_id IN (
        SELECT id FROM public.examene
        WHERE org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "intrebari_delete_privileged_only" ON public.intrebari;
CREATE POLICY "intrebari_delete_privileged_only"
  ON public.intrebari FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'org_admin'
      AND examen_id IN (
        SELECT id FROM public.examene
        WHERE org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

COMMENT ON POLICY "intrebari_select_own_org" ON public.intrebari IS
  'Una din trei politici SELECT permisive. Acopera doar ramura de organizatie; personale si publice au politici proprii.';

COMMIT;

-- =============================================================================
-- VERIFICARE (ruleaza separat, NU face parte din migrare)
-- =============================================================================
-- Regresie cross-tenant: `muzicaard` (605d16c6-...) are alocari valide la
-- examenele 13 si 14 din org 90664c00, dar apartine org-ului acefae39.
-- Trebuie sa vada 0 din ele. Daca apar, o politica a fost scrisa cu OR acolo
-- unde trebuia AND pe org.
--
-- BEGIN;
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"605d16c6-f6ff-4096-8e2d-4b27a1c2589f","role":"authenticated","aud":"authenticated"}', true);
-- SET LOCAL ROLE authenticated;
-- SELECT current_user::text,
--        (SELECT count(*) FROM public.examene   WHERE id IN (13,14))         AS trebuie_0,
--        (SELECT count(*) FROM public.intrebari WHERE examen_id IN (13,14))  AS trebuie_0_bis;
-- ROLLBACK;
-- =============================================================================
