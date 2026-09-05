-- =============================================================================
-- Storage RLS: bucket `question-images`
-- =============================================================================
-- VULNERABILITATE REPARATA (confirmata empiric 2026-09-04):
--
--   1. ENUMERARE ANONIMA. Politica `public_can_read_question_images` era
--      acordata rolului `public` (deci si `anon`) cu singura conditie
--      `bucket_id = 'question-images'`. Cheia anon e in bundle-ul client, deci
--      oricine putea lista bucket-ul si descarca tot continutul, fara cont.
--      Masurat: 58 din 58 de obiecte vizibile ca `anon`.
--      Mai grava decat bresa pe PostgREST reparata anterior, unde atacatorul
--      trebuia sa fie macar membru al organizatiei.
--
--   2. SCRIERE CROSS-TENANT (INSERT). `admins_can_upload_question_images`
--      verifica doar ca rolul e super_admin sau org_admin, fara conditie pe org
--      sau pe path. Uploadul din `components/admin/QuestionEditorModal.tsx`
--      merge prin clientul de sesiune, nu prin service_role, deci politica se
--      aplica efectiv. Orice org_admin putea incarca in folderul oricarui
--      examen din platforma, iar `upsert: true` insemna suprascriere daca
--      cunostea path-ul.
--
--   3. SCRIERE CROSS-TENANT (UPDATE). `admins_can_update_question_images`
--      avea aceeasi lipsa.
--
-- STRUCTURA PATH: `{examen_id}/{intrebare_id}/{Date.now()}.{ext}`
--   generat in `QuestionEditorModal.tsx` si `app/my-exams/actions.ts`.
--   foldername(name)[1] = examen_id, foldername(name)[2] = intrebare_id.
--
-- NOTA IMPORTANTA — bucket public:
--   `question-images` are `public = true`. Obiectele se servesc prin
--   /storage/v1/object/public/... FARA sa treaca prin RLS. Politicile de aici
--   guverneaza doar LISTAREA si SCRIEREA prin API-ul de storage.
--   Consecinte:
--     - Aceasta migrare NU poate rupe afisarea imaginilor in quiz. Codul
--       foloseste getPublicUrl() si stocheaza URL absolut in intrebari.image_url.
--     - Un URL deja cunoscut ramane accesibil oricui. Acceptabil pentru ca
--       path-ul contine Date.now() in milisecunde si URL-urile se obtin doar
--       din `intrebari`, care e sub RLS corect.
--     - Inchiderea completa cere bucket privat + URL-uri semnate, ceea ce e
--       modificare de cod plus backfill al coloanei image_url (stocheaza URL
--       absolut, nu path). Faza 2, nu aici.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- SELECT
-- -----------------------------------------------------------------------------
-- Scopat pe `intrebari`, nu pe `my_readable_exam_ids()`. Subquery-ul trece prin
-- RLS-ul lui `intrebari`, deci mosteneste automat modelul complet de acces
-- (organizatie + personale + publice) si ramane corect daca modelul se
-- schimba. Varianta pe `my_readable_exam_ids()` a fost incercata prima si e
-- gresita: functia acopera doar ramura de organizatie, deci proprietarul unui
-- examen personal nu si-ar fi putut lista propriile imagini.
DROP POLICY IF EXISTS "public_can_read_question_images" ON storage.objects;
DROP POLICY IF EXISTS "question_images_select_scoped"   ON storage.objects;

CREATE POLICY "question_images_select_scoped"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'question-images'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.intrebari
    )
  );

-- -----------------------------------------------------------------------------
-- INSERT
-- -----------------------------------------------------------------------------
-- Subquery-ul pe `examene` trece prin RLS-ul acelei tabele: un org_admin vede
-- doar examenele org-ului sau, deci poate incarca doar in folderele lor.
-- Comparatia se face pe text, nu cu ::int, ca sa nu arunce eroare daca vreun
-- obiect are un prim folder nenumeric.
DROP POLICY IF EXISTS "admins_can_upload_question_images" ON storage.objects;
DROP POLICY IF EXISTS "question_images_insert_scoped"     ON storage.objects;

CREATE POLICY "question_images_insert_scoped"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'question-images'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
        = ANY (ARRAY['super_admin', 'org_admin'])
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.examene
    )
  );

-- -----------------------------------------------------------------------------
-- UPDATE
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admins_can_update_question_images" ON storage.objects;
DROP POLICY IF EXISTS "question_images_update_scoped"     ON storage.objects;

CREATE POLICY "question_images_update_scoped"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'question-images'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
        = ANY (ARRAY['super_admin', 'org_admin'])
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.examene
    )
  )
  WITH CHECK (
    bucket_id = 'question-images'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
        = ANY (ARRAY['super_admin', 'org_admin'])
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.examene
    )
  );

COMMIT;

-- =============================================================================
-- DE STIUT
-- =============================================================================
-- Nu exista politica de DELETE pe `question-images` pentru `authenticated`.
-- Nu e o bresa, dar inseamna ca imaginile sterse din intrebari raman orfane in
-- storage la nesfarsit. Uploadurile prin `app/my-exams/actions.ts` folosesc
-- service_role si ocolesc RLS oricum. De rezolvat impreuna cu curatarea
-- orfanilor, nu izolat.
-- =============================================================================

-- =============================================================================
-- VERIFICARE (ruleaza separat, NU face parte din migrare)
-- =============================================================================
-- Rezultate obtinute pe productie dupa aplicare, 2026-09-04:
--   anon               -> 0   (era 58)
--   org_admin acefae39 -> 1   (singurul examen cu imagini din org-ul lui)
--   INSERT cross-org   -> 42501
--
-- BEGIN;
-- SET LOCAL ROLE anon;
-- SELECT current_user::text, count(*) AS anon_vede
-- FROM storage.objects WHERE bucket_id = 'question-images';
-- ROLLBACK;
--
-- BEGIN;
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"65c22e2a-27b7-44fb-ae1a-be909f5cd02d","role":"authenticated","aud":"authenticated"}', true);
-- SET LOCAL ROLE authenticated;
-- SELECT current_user::text, count(*) AS org_admin_vede
-- FROM storage.objects WHERE bucket_id = 'question-images';
-- ROLLBACK;
--
-- -- INSERT cross-org: tudornitu e org_admin in acefae39, folderul 12 e alt org.
-- BEGIN;
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"65c22e2a-27b7-44fb-ae1a-be909f5cd02d","role":"authenticated","aud":"authenticated"}', true);
-- SET LOCAL ROLE authenticated;
-- INSERT INTO storage.objects (bucket_id, name, owner)
-- VALUES ('question-images', '12/99999/test.png', auth.uid())
-- RETURNING name;   -- asteptat: 42501
-- ROLLBACK;
-- =============================================================================
