export type OrganizationOption = {
  id: string
  nume: string
}

export type ExamOption = {
  id: number
  nume_examen: string
  intrebari_simulare?: number | null
}

export type StudentStatsRow = {
  user_id: string
  nume: string | null
  email: string | null
  simulari_finalizate: number
  scor_mediu: number | null
  rata_trecere_pct: number | null
  ultima_activitate: string | null
  nivel_pregatire_pct: number | null
  timp_dedicat_secunde: number
  total_count: number
}

export type StudentDetailHistoryPoint = {
  id: number
  started_at: string | null
  finished_at: string | null
  scor_procent: number | null
  raspunsuri_corecte: number | null
  total_intrebari: number | null
  durata_secunde: number | null
  timed_out: boolean | null
  a_trecut: boolean | null
}

export type StudentDetailStats = {
  user_id: string
  nume: string | null
  email: string | null
  org_id: string
  org_nume: string | null
  examen_nume: string | null
  prag_trecere: number
  intrebari_simulare: number
  simulari_finalizate: number
  scor_mediu: number | null
  rata_trecere_pct: number | null
  ultima_activitate: string | null
  nivel_pregatire_pct: number | null
  timp_total_secunde: number
  istoric_simulari: StudentDetailHistoryPoint[] | null
}
