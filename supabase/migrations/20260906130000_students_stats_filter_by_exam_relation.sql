-- Restrict the students list to members who actually relate to the selected
-- exam.
--
-- Until now `org_students` filtered on org + role only, so every member of the
-- organisation appeared under every exam, most of them with an empty row of
-- zeros. A member is now included when any of these is true:
--
--   * a row in `acces_examene` for the exam — deliberately with no date check,
--     so an expired grant still keeps the student visible;
--   * answer history for the exam;
--   * a simulation or practice session for the exam.
--
-- The two session clauses go beyond access + history because neither is
-- guaranteed: org-wide exams are reachable without any `acces_examene` row,
-- and a simulation finalised without answering anything writes a session but
-- no `istoric_raspunsuri`. Without them such a student would be dropped from
-- the list while still reporting simulari_finalizate > 0.
--
-- Signature is unchanged, so CREATE OR REPLACE keeps the existing grant.

CREATE OR REPLACE FUNCTION public.get_org_students_stats(
  p_org_id     uuid,
  p_examen_id  bigint,
  p_search     text    DEFAULT NULL,
  p_sort       text    DEFAULT 'nume_asc',
  p_limit      int     DEFAULT 25,
  p_offset     int     DEFAULT 0
)
RETURNS TABLE (
  user_id              uuid,
  nume                 text,
  email                text,
  simulari_finalizate  int,
  scor_mediu           numeric,
  rata_trecere_pct     numeric,
  ultima_activitate    timestamptz,
  nivel_pregatire_pct  numeric,
  examene_participate  int,
  examene_acces        int,
  timp_dedicat_secunde bigint,
  total_count          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prag       int;
  v_pool_size  int;
BEGIN
  IF NOT public.can_view_org_stats(p_org_id) THEN
    RETURN;
  END IF;

  SELECT prag_trecere::int INTO v_prag
    FROM public.examene WHERE id = p_examen_id;

  SELECT count(*) INTO v_pool_size
    FROM public.intrebari WHERE examen_id = p_examen_id;

  RETURN QUERY
  WITH org_students AS (
    SELECT p.id AS student_id, p.nume AS student_nume, p.email AS student_email
      FROM public.profiles p
     WHERE p.org_id = p_org_id
       AND (
         p.role = 'user'
         OR (p.role = 'org_admin' AND public.is_super_admin())
       )
       AND (
         p_search IS NULL
         OR p.nume  ILIKE '%' || p_search || '%'
         OR p.email ILIKE '%' || p_search || '%'
       )
       AND (
         EXISTS (
           SELECT 1 FROM public.acces_examene ae
            WHERE ae.user_id = p.id
              AND ae.examen_id = p_examen_id
         )
         OR EXISTS (
           SELECT 1 FROM public.istoric_raspunsuri ir
            WHERE ir.user_id = p.id
              AND ir.examen_id = p_examen_id
         )
         OR EXISTS (
           SELECT 1 FROM public.sesiuni_simulare s
            WHERE s.user_id = p.id
              AND s.examen_id = p_examen_id
         )
         OR EXISTS (
           SELECT 1 FROM public.sesiuni_practica pr
            WHERE pr.user_id = p.id
              AND pr.examen_id = p_examen_id
         )
       )
  ),
  sim_stats AS (
    SELECT
      s.user_id AS sim_user_id,
      count(*) FILTER (WHERE s.finalizat OR s.timed_out)            AS simulari_finalizate,
      avg(s.scor_procent) FILTER (WHERE s.finalizat OR s.timed_out) AS scor_mediu,
      100.0 * count(*) FILTER (
        WHERE (s.finalizat OR s.timed_out)
          AND s.raspunsuri_corecte >= v_prag
      )
      / NULLIF(count(*) FILTER (WHERE s.finalizat OR s.timed_out), 0)
                                                                    AS rata_trecere_pct,
      max(coalesce(s.finished_at, s.started_at))                    AS ultima_activitate
      FROM public.sesiuni_simulare s
     WHERE s.examen_id = p_examen_id
     GROUP BY s.user_id
  ),
  prep_stats AS (
    SELECT
      ir.user_id AS prep_user_id,
      count(DISTINCT ir.intrebare_id) AS corecte_unice
      FROM public.istoric_raspunsuri ir
     WHERE ir.examen_id = p_examen_id
       AND ir.corect = true
     GROUP BY ir.user_id
  ),
  time_union AS (
    SELECT s.user_id AS tu_user_id, s.durata_secunde AS tu_secs
      FROM public.sesiuni_simulare s
     WHERE s.examen_id = p_examen_id
    UNION ALL
    SELECT pr.user_id AS tu_user_id, pr.durata_secunde AS tu_secs
      FROM public.sesiuni_practica pr
     WHERE pr.examen_id = p_examen_id
  ),
  time_stats AS (
    SELECT tu.tu_user_id AS time_user_id,
           sum(tu.tu_secs)::bigint AS total_secs
      FROM time_union tu
     GROUP BY tu.tu_user_id
  ),
  participated_exams AS (
    SELECT DISTINCT s.user_id AS pe_user_id, s.examen_id AS pe_examen_id
      FROM public.sesiuni_simulare s
      JOIN public.examene e ON e.id = s.examen_id
     WHERE e.org_id = p_org_id
       AND (s.finalizat OR s.timed_out)
  ),
  access_exams AS (
    SELECT DISTINCT a.user_id AS ae_user_id, a.examen_id AS ae_examen_id
      FROM public.acces_examene a
      JOIN public.examene e ON e.id = a.examen_id
     WHERE e.org_id = p_org_id
       AND (a.data_expirare IS NULL OR a.data_expirare > now())
  ),
  exam_counts AS (
    SELECT
      os.student_id AS ec_user_id,
      (SELECT count(*) FROM participated_exams pe WHERE pe.pe_user_id = os.student_id)
        AS examene_participate,
      (SELECT count(*) FROM access_exams      ae WHERE ae.ae_user_id = os.student_id)
        AS examene_acces
      FROM org_students os
  ),
  combined AS (
    SELECT
      os.student_id                                                AS out_user_id,
      os.student_nume                                              AS out_nume,
      os.student_email                                             AS out_email,
      coalesce(ss.simulari_finalizate, 0)::int                     AS out_simulari_finalizate,
      round(ss.scor_mediu, 1)                                      AS out_scor_mediu,
      round(ss.rata_trecere_pct, 1)                                AS out_rata_trecere_pct,
      ss.ultima_activitate                                         AS out_ultima_activitate,
      CASE WHEN v_pool_size > 0
           THEN round(100.0 * coalesce(ps.corecte_unice, 0) / v_pool_size, 1)
           ELSE NULL END                                           AS out_nivel_pregatire_pct,
      ec.examene_participate::int                                  AS out_examene_participate,
      ec.examene_acces::int                                        AS out_examene_acces,
      coalesce(ts.total_secs, 0)::bigint                           AS out_timp_dedicat_secunde
    FROM org_students os
    LEFT JOIN sim_stats     ss   ON ss.sim_user_id   = os.student_id
    LEFT JOIN prep_stats    ps   ON ps.prep_user_id  = os.student_id
    LEFT JOIN time_stats    ts   ON ts.time_user_id  = os.student_id
    LEFT JOIN exam_counts   ec   ON ec.ec_user_id    = os.student_id
  )
  SELECT
    c.out_user_id,
    c.out_nume,
    c.out_email,
    c.out_simulari_finalizate,
    c.out_scor_mediu,
    c.out_rata_trecere_pct,
    c.out_ultima_activitate,
    c.out_nivel_pregatire_pct,
    c.out_examene_participate,
    c.out_examene_acces,
    c.out_timp_dedicat_secunde,
    (SELECT count(*) FROM combined)::bigint AS total_count
  FROM combined c
  ORDER BY
    CASE WHEN p_sort = 'nume_asc'                THEN c.out_nume                  END ASC  NULLS LAST,
    CASE WHEN p_sort = 'nume_desc'               THEN c.out_nume                  END DESC NULLS LAST,
    CASE WHEN p_sort = 'scor_desc'               THEN c.out_scor_mediu            END DESC NULLS LAST,
    CASE WHEN p_sort = 'scor_asc'                THEN c.out_scor_mediu            END ASC  NULLS LAST,
    CASE WHEN p_sort = 'simulari_desc'           THEN c.out_simulari_finalizate   END DESC NULLS LAST,
    CASE WHEN p_sort = 'timp_desc'               THEN c.out_timp_dedicat_secunde  END DESC NULLS LAST,
    CASE WHEN p_sort = 'ultima_activitate_desc'  THEN c.out_ultima_activitate     END DESC NULLS LAST,
    c.out_nume ASC
  LIMIT  greatest(1, least(coalesce(p_limit, 25), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_students_stats(uuid, bigint, text, text, int, int)
  TO authenticated;
