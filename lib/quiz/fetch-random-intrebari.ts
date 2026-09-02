import type { SupabaseClient } from "@supabase/supabase-js"
import { isAdminRole, isSuperAdminRole, normalizeRole } from "@/lib/auth/roles"
import {
  MAX_QUIZ_VARIANTS,
  MIN_QUIZ_VARIANTS,
  OPTION_IDS,
  OPTION_LABELS,
  type AnswerId,
  type ExamCategory,
  type ExamSummary,
  type IntrebareRow,
  type PracticeSource,
  type QuizOption,
  type QuizQuestion,
} from "./types"

export type { ExamCategory } from "./types"

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
}

function shuffleOptions(options: QuizOption[]): QuizOption[] {
  const shuffled = [...options]
  shuffleInPlace(shuffled)
  // Reassign display labels (A, B, C…) to match new visual positions.
  // The id values stay unchanged so correctAnswers lookups are unaffected.
  return shuffled.map((opt, i) => ({ ...opt, label: OPTION_LABELS[i] }))
}

function coerceVariantArray(value: unknown): string[] | null {
  if (value == null) return null
  let candidate: unknown = value
  // Supabase clients should already return parsed JSONB, but be defensive
  // against drivers (or older REST proxies) that hand it back as a string.
  if (typeof candidate === "string") {
    const trimmed = candidate.trim()
    if (!trimmed.startsWith("[")) return null
    try {
      candidate = JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  if (!Array.isArray(candidate)) return null
  return candidate.map((item) => String(item ?? "").trim())
}

function buildOptionsFromVariante(value: unknown): QuizOption[] | null {
  const raw = coerceVariantArray(value)
  if (!raw) return null
  const cleaned: QuizOption[] = []
  for (let i = 0; i < raw.length && i < MAX_QUIZ_VARIANTS; i++) {
    const text = raw[i]
    if (!text) continue
    cleaned.push({ id: OPTION_IDS[i], label: OPTION_LABELS[i], text })
  }
  return cleaned.length >= MIN_QUIZ_VARIANTS ? cleaned : null
}

function buildOptionsFromLegacy(row: IntrebareRow): QuizOption[] {
  const out: QuizOption[] = []
  const a = String(row.varianta_a ?? "").trim()
  const b = String(row.varianta_b ?? "").trim()
  const c = String(row.varianta_c ?? "").trim()
  if (a) out.push({ id: "a", label: "A", text: a })
  if (b) out.push({ id: "b", label: "B", text: b })
  if (c) out.push({ id: "c", label: "C", text: c })
  return out
}

function normalizeCorrectAnswers(value: unknown, allowedIds: Set<string>): AnswerId[] {
  const out = new Set<AnswerId>()
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().startsWith("[")
      ? (() => {
          try {
            return JSON.parse(value)
          } catch {
            return null
          }
        })()
      : null
  if (Array.isArray(items)) {
    for (const item of items) {
      const id = String(item ?? "").trim().toLowerCase()
      if (allowedIds.has(id)) out.add(id as AnswerId)
    }
  }
  return Array.from(out).sort()
}

export function mapIntrebareRowToQuestion(row: IntrebareRow): QuizQuestion | null {
  const examenId = Number(row.examen_id ?? 0)
  if (!Number.isFinite(examenId) || examenId <= 0) return null

  const options = buildOptionsFromVariante(row.variante) ?? buildOptionsFromLegacy(row)
  if (options.length < MIN_QUIZ_VARIANTS) return null

  const allowedIds = new Set<string>(options.map((option) => option.id))
  let correctAnswers = normalizeCorrectAnswers(row.raspunsuri_corecte, allowedIds)

  if (correctAnswers.length === 0) {
    // Legacy fallback: a single-character `raspuns_corect` column.
    const legacy = String(row.raspuns_corect ?? "").trim().toLowerCase()
    if (allowedIds.has(legacy)) correctAnswers = [legacy as AnswerId]
  }
  if (correctAnswers.length === 0) return null

  return {
    id: String(row.id),
    examenId,
    text: String(row.intrebare_text ?? "").trim(),
    correctAnswers,
    options: shuffleOptions(options),
    imageUrl: row.image_url ? String(row.image_url) : null,
  }
}

function shuffleInPlaceAndLimit(items: QuizQuestion[], count: number) {
  shuffleInPlace(items)
  return items.slice(0, Math.min(count, items.length))
}

function isValidExamId(examenId: number) {
  return Number.isFinite(examenId) && examenId > 0
}

async function fetchQuestionIdsForSource(
  supabase: SupabaseClient,
  userId: string,
  examenId: number,
  source: PracticeSource
): Promise<string[]> {
  if (!userId || !isValidExamId(examenId)) return []

  if (source === "bookmarked") {
    const { data, error } = await supabase
      .from("bookmarks")
      .select("intrebare_id")
      .eq("user_id", userId)
      .eq("examen_id", examenId)

    if (error) throw new Error(error.message)
    return (data ?? []).map((item) => String(item.intrebare_id))
  }

  const { data, error } = await supabase
    .from("status_invatare")
    .select("intrebare_id")
    .eq("user_id", userId)
    .eq("examen_id", examenId)
    .eq("este_gresita", true)

  if (error) throw new Error(error.message)
  return (data ?? []).map((item) => String(item.intrebare_id))
}

// "Doar întrebări noi" — questions the user has never attempted. Backed by a
// LEFT JOIN RPC (`user_unattempted_intrebari`) so the filter is applied in a
// single round-trip rather than fetching the whole pool client-side.
async function fetchNewIntrebariRows(
  supabase: SupabaseClient,
  userId: string,
  examenId: number
): Promise<IntrebareRow[]> {
  if (!userId || !isValidExamId(examenId)) return []
  const { data, error } = await supabase.rpc("user_unattempted_intrebari", {
    p_user_id: userId,
    p_examen_id: examenId,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as IntrebareRow[]
}

async function fetchNewIntrebariCount(
  supabase: SupabaseClient,
  userId: string,
  examenId: number
): Promise<number> {
  if (!userId || !isValidExamId(examenId)) return 0
  const { data, error } = await supabase.rpc("user_unattempted_intrebari_count", {
    p_user_id: userId,
    p_examen_id: examenId,
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function fetchNewQuestions(
  supabase: SupabaseClient,
  params: { examenId: number; userId: string; count?: number }
): Promise<QuizQuestion[]> {
  const { examenId, userId, count } = params
  const rows = await fetchNewIntrebariRows(supabase, userId, examenId)
  const mapped = rows
    .map(mapIntrebareRowToQuestion)
    .filter((item): item is QuizQuestion => Boolean(item && (item.text || item.imageUrl)))
  if (typeof count !== "number" || count <= 0) {
    shuffleInPlace(mapped)
    return mapped
  }
  return shuffleInPlaceAndLimit(mapped, count)
}

export async function getAvailableQuestionCount(
  supabase: SupabaseClient,
  params: { examenId: number; source: PracticeSource; userId: string }
): Promise<number> {
  const { examenId, source, userId } = params
  if (!isValidExamId(examenId)) return 0
  if (source !== "all" && !userId) return 0
  if (source === "all") {
    const { count, error } = await supabase
      .from("intrebari")
      .select("id", { count: "exact", head: true })
      .eq("examen_id", examenId)
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  if (source === "new") {
    return fetchNewIntrebariCount(supabase, userId, examenId)
  }

  const ids = await fetchQuestionIdsForSource(supabase, userId, examenId, source)
  return ids.length
}

export async function fetchQuestionsBySource(
  supabase: SupabaseClient,
  params: {
    count: number
    examenId: number
    source: PracticeSource
    userId: string
  }
): Promise<QuizQuestion[]> {
  const { count, examenId, source, userId } = params
  if (count <= 0) return []
  if (!isValidExamId(examenId)) return []
  if (source !== "all" && !userId) return []

  if (source === "all") {
    const { data, error } = await supabase
      .from("intrebari")
      .select("*")
      .eq("examen_id", examenId)
    if (error) throw new Error(error.message)
    const mapped = ((data ?? []) as IntrebareRow[])
      .map(mapIntrebareRowToQuestion)
      .filter((item): item is QuizQuestion => Boolean(item && (item.text || item.imageUrl)))
    return shuffleInPlaceAndLimit(mapped, count)
  }

  if (source === "new") {
    return fetchNewQuestions(supabase, { examenId, userId, count })
  }

  const ids = await fetchQuestionIdsForSource(supabase, userId, examenId, source)
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from("intrebari")
    .select("*")
    .eq("examen_id", examenId)
    .in("id", ids)

  if (error) throw new Error(error.message)
  const mapped = ((data ?? []) as IntrebareRow[])
    .map(mapIntrebareRowToQuestion)
    .filter((item): item is QuizQuestion => Boolean(item && (item.text || item.imageUrl)))
  return shuffleInPlaceAndLimit(mapped, count)
}

function isValidId(value: unknown): value is number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

/** Visibility ordering used by the exam selector: org first, public last. */
const CATEGORY_RANK: Record<ExamCategory, number> = {
  org: 0,
  personal: 1,
  public: 2,
}

// Checked most-specific first: a public exam always has org_id IS NULL, so the
// `is_public` test has to win over the ownership test.
function deriveCategory(row: { is_public?: unknown; org_id?: unknown }): ExamCategory {
  if (row.is_public === true) return "public"
  if (row.org_id != null) return "org"
  return "personal"
}

function mapExamSummary(row: {
  id: unknown
  nume_examen?: unknown
  prag_trecere?: unknown
  intrebari_simulare?: unknown
  variante_raspuns?: unknown
  durata_minute?: unknown
  timp_alocat_minute?: unknown
  org_id?: unknown
  is_public?: unknown
  is_org_wide?: unknown
}): ExamSummary | null {
  const id = Number(row.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const fallbackDuration = Number(row.timp_alocat_minute)
  const durata = Number(row.durata_minute)
  const category = deriveCategory(row)
  return {
    id,
    name: String(row.nume_examen ?? `Examen ${id}`),
    pragTrecere: Number(row.prag_trecere) > 0 ? Number(row.prag_trecere) : 18,
    intrebariSimulare: Number(row.intrebari_simulare) > 0 ? Number(row.intrebari_simulare) : 25,
    varianteRaspuns: Number(row.variante_raspuns) > 0 ? Number(row.variante_raspuns) : 3,
    durataMinute: Number.isFinite(durata) && durata > 0
      ? durata
      : Number.isFinite(fallbackDuration) && fallbackDuration > 0
        ? fallbackDuration
        : 30,
    category,
    isPersonal: category === "personal",
  }
}

// Personal exams have no owning organization. This query matches the partial
// index `examene_creator_user_id_idx ON examene (creator_user_id) WHERE org_id IS NULL`
// from migration 20260707130000.
async function fetchPersonalExams(
  supabase: SupabaseClient,
  userId: string,
  selectColumns: string
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from("examene")
    .select(selectColumns)
    .is("org_id", null)
    .eq("creator_user_id", userId)
    .order("id", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Array<Record<string, unknown>>
}

const EXAM_SELECT_COLUMNS =
  "id, nume_examen, prag_trecere, intrebari_simulare, variante_raspuns, durata_minute, timp_alocat_minute, org_id, creator_user_id, is_public, is_org_wide"

/**
 * Public exams the user has favourited, plus the showcase exam that is offered
 * to everyone. Two round-trips at most: the favourite ids, then a single
 * filtered fetch — never one query per favourite.
 */
async function fetchFavoriteAndShowcaseExams(
  supabase: SupabaseClient,
  userId: string,
  selectColumns: string
): Promise<Array<Record<string, unknown>>> {
  const { data: favoriteRows, error: favoriteError } = await supabase
    .from("examene_favorite")
    .select("examen_id")
    .eq("user_id", userId)
  if (favoriteError) throw new Error(favoriteError.message)

  const favoriteIds = [
    ...new Set((favoriteRows ?? []).map((row) => Number(row.examen_id)).filter(isValidId)),
  ]

  const base = supabase
    .from("examene")
    .select(selectColumns)
    .eq("is_public", true)
    .order("id", { ascending: true })

  // Interpolating the ids is safe: each one passed `isValidId`, so it is a
  // finite positive number and cannot carry filter syntax.
  const query =
    favoriteIds.length > 0
      ? base.or(`is_showcase.eq.true,id.in.(${favoriteIds.join(",")})`)
      : base.eq("is_showcase", true)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Array<Record<string, unknown>>
}

export async function fetchAccessibleExams(
  supabase: SupabaseClient,
  userId: string
): Promise<ExamSummary[]> {
  if (!userId) return []

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", userId)
    .maybeSingle()

  if (profileError) throw new Error(profileError.message)
  const role = normalizeRole(profile?.role)
  const orgId = profile?.org_id ? String(profile.org_id) : null

  const selectColumns = EXAM_SELECT_COLUMNS

  const orderById = { ascending: true } as const

  const safeMap = (rows: Array<Record<string, unknown>>): ExamSummary[] =>
    rows
      .map((row) => mapExamSummary(row as Parameters<typeof mapExamSummary>[0]))
      .filter((value): value is ExamSummary => value !== null)
      // Deduplicate just in case the same exam appears twice via JOIN/in().
      .reduce<ExamSummary[]>((acc, current) => {
        if (!acc.some((exam) => exam.id === current.id)) acc.push(current)
        return acc
      }, [])
      .sort(
        (a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.id - b.id
      )

  if (isSuperAdminRole(role)) {
    const { data, error } = await supabase
      .from("examene")
      .select(selectColumns)
      .order("id", orderById)
    if (error) throw new Error(error.message)
    return safeMap(((data ?? []) as Array<Record<string, unknown>>))
  }

  if (isAdminRole(role)) {
    let orgQuery = supabase.from("examene").select(selectColumns).order("id", orderById)
    if (orgId) orgQuery = orgQuery.eq("org_id", orgId)
    const [orgResult, personalRows, favoriteRows] = await Promise.all([
      orgQuery,
      fetchPersonalExams(supabase, userId, selectColumns),
      fetchFavoriteAndShowcaseExams(supabase, userId, selectColumns),
    ])
    if (orgResult.error) throw new Error(orgResult.error.message)
    const orgRows = (orgResult.data ?? []) as Array<Record<string, unknown>>
    return safeMap([...orgRows, ...personalRows, ...favoriteRows])
  }

  // Regular user — restricted to non-expired entries from `acces_examene`.
  const nowIso = new Date().toISOString()
  const { data: accessRows, error: accessError } = await supabase
    .from("acces_examene")
    .select("examen_id")
    .eq("user_id", userId)
    .gt("data_expirare", nowIso)

  if (accessError) throw new Error(accessError.message)
  const accessIds = [
    ...new Set((accessRows ?? []).map((row) => Number(row.examen_id)).filter(isValidId)),
  ]

  const fetchAccessExams = async (): Promise<Array<Record<string, unknown>>> => {
    // Skip the query entirely for an empty list; `.in()` with [] is a wasted round-trip.
    if (accessIds.length === 0) return []
    const { data, error } = await supabase
      .from("examene")
      .select(selectColumns)
      .in("id", accessIds)
      .order("id", orderById)
    if (error) throw new Error(error.message)
    return (data ?? []) as Array<Record<string, unknown>>
  }

  // Org-wide exams need no `acces_examene` grant: every member of the owning
  // organization sees them.
  const fetchOrgWideExams = async (): Promise<Array<Record<string, unknown>>> => {
    if (!orgId) return []
    const { data, error } = await supabase
      .from("examene")
      .select(selectColumns)
      .eq("org_id", orgId)
      .eq("is_org_wide", true)
      .order("id", orderById)
    if (error) throw new Error(error.message)
    return (data ?? []) as Array<Record<string, unknown>>
  }

  const [accessExamRows, personalRows, orgWideRows, favoriteRows] = await Promise.all([
    fetchAccessExams(),
    fetchPersonalExams(supabase, userId, selectColumns),
    fetchOrgWideExams(),
    fetchFavoriteAndShowcaseExams(supabase, userId, selectColumns),
  ])
  return safeMap([...accessExamRows, ...personalRows, ...orgWideRows, ...favoriteRows])
}

/**
 * Resolves a single public exam by id, for the `?examen=<id>` deep link into a
 * catalogue exam the user hasn't favourited (so it is absent from
 * `fetchAccessibleExams`). Returns null when the exam doesn't exist or isn't
 * public.
 *
 * `is_public` is filtered explicitly and never left to RLS: an org exam the
 * caller happens to be able to read must not become selectable without an
 * `acces_examene` grant.
 */
export async function fetchPublicExamById(
  supabase: SupabaseClient,
  examId: number
): Promise<ExamSummary | null> {
  if (!Number.isInteger(examId) || !isValidId(examId)) return null

  const { data, error } = await supabase
    .from("examene")
    .select(EXAM_SELECT_COLUMNS)
    .eq("id", examId)
    .eq("is_public", true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  return mapExamSummary(data as Parameters<typeof mapExamSummary>[0])
}

const PUBLIC_EXAM_SELECT_COLUMNS =
  "id, nume_examen, prag_trecere, intrebari_simulare, variante_raspuns, durata_minute, timp_alocat_minute, org_id, creator_user_id, is_public, is_org_wide, categorie"

/**
 * The public catalogue, readable by anyone through the `examene_public_select`
 * RLS policy. Grouped by `categorie` (uncategorized last), then alphabetically.
 */
export async function fetchPublicExams(
  supabase: SupabaseClient
): Promise<ExamSummary[]> {
  const { data, error } = await supabase
    .from("examene")
    .select(PUBLIC_EXAM_SELECT_COLUMNS)
    .eq("is_public", true)
    .order("categorie", { ascending: true, nullsFirst: false })
    .order("nume_examen", { ascending: true })

  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .map((row) => mapExamSummary(row as Parameters<typeof mapExamSummary>[0]))
    .filter((value): value is ExamSummary => value !== null)
}

export async function fetchDistinctExamIds(
  supabase: SupabaseClient,
  userId: string
): Promise<number[]> {
  const exams = await fetchAccessibleExams(supabase, userId)
  return exams.map((exam) => exam.id)
}

export async function toggleBookmarkForQuestion(
  supabase: SupabaseClient,
  params: { userId: string; examenId: number; intrebareId: string; shouldBookmark: boolean }
) {
  const { userId, examenId, intrebareId, shouldBookmark } = params
  if (!userId || !isValidExamId(examenId) || !intrebareId) return
  if (shouldBookmark) {
    const { error } = await supabase.from("bookmarks").upsert(
      {
        user_id: userId,
        examen_id: examenId,
        intrebare_id: intrebareId,
      },
      { onConflict: "user_id,intrebare_id,examen_id" }
    )
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("examen_id", examenId)
    .eq("intrebare_id", intrebareId)
  if (error) throw new Error(error.message)
}

export async function recordAnswerHistory(
  supabase: SupabaseClient,
  params: {
    userId: string
    examenId: number
    intrebareId: string
    isCorrect: boolean
    mode: "simulation" | "practice"
  }
) {
  const { userId, examenId, intrebareId, isCorrect, mode } = params
  if (!userId || !isValidExamId(examenId) || !intrebareId) return
  const intrebareIdNum = Number(intrebareId)
  if (!Number.isFinite(intrebareIdNum) || intrebareIdNum <= 0) return

  // We append a row per attempt rather than upserting so the table doubles as
  // a time series. Statistics derive "last attempt" with DISTINCT ON / window
  // functions on (user_id, intrebare_id) ordered by data_raspuns DESC.
  const { error } = await supabase.from("istoric_raspunsuri").insert({
    user_id: userId,
    examen_id: examenId,
    intrebare_id: intrebareIdNum,
    corect: isCorrect,
    mod: mode === "simulation" ? "simulare" : "practica",
  })
  if (error) throw new Error(error.message)
}

export async function recordSimulationSession(
  supabase: SupabaseClient,
  params: {
    userId: string
    examenId: number
    startedAt: Date
    finishedAt: Date
    correctCount: number
    totalQuestions: number
    timedOut: boolean
  }
) {
  const { userId, examenId, startedAt, finishedAt, correctCount, totalQuestions, timedOut } = params
  if (!userId || !isValidExamId(examenId)) return

  const safeTotal = Math.max(0, totalQuestions)
  const safeCorrect = Math.max(0, Math.min(correctCount, safeTotal))
  const durataSec = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
  const scorProcent = safeTotal > 0 ? Math.round((safeCorrect / safeTotal) * 10000) / 100 : 0

  const { error } = await supabase.from("sesiuni_simulare").insert({
    user_id: userId,
    examen_id: examenId,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    durata_secunde: durataSec,
    raspunsuri_corecte: safeCorrect,
    total_intrebari: safeTotal,
    scor_procent: scorProcent,
    finalizat: true,
    timed_out: timedOut,
  })
  if (error) throw new Error(error.message)
}

export async function recordPracticeSession(
  supabase: SupabaseClient,
  params: {
    userId: string
    examenId: number
    startedAt: Date
    finishedAt: Date
    correctCount: number
    totalQuestions: number
  }
) {
  const { userId, examenId, startedAt, finishedAt, correctCount, totalQuestions } = params
  if (!userId || !isValidExamId(examenId)) return

  const safeTotal = Math.max(0, totalQuestions)
  const safeCorrect = Math.max(0, Math.min(correctCount, safeTotal))
  const durataSec = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))

  const { error } = await supabase.from("sesiuni_practica").insert({
    user_id: userId,
    examen_id: examenId,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    durata_secunde: durataSec,
    raspunsuri_corecte: safeCorrect,
    total_intrebari: safeTotal,
    finalizat: true,
  })
  if (error) throw new Error(error.message)
}

export async function updateLearningStatus(
  supabase: SupabaseClient,
  params: { userId: string; examenId: number; intrebareId: string; isCorrect: boolean }
) {
  const { userId, examenId, intrebareId, isCorrect } = params
  if (!userId || !isValidExamId(examenId) || !intrebareId) return

  if (!isCorrect) {
    // Keep only wrong answers in the "wrong questions" pool.
    const { error } = await supabase.from("status_invatare").upsert(
      {
        user_id: userId,
        examen_id: examenId,
        intrebare_id: intrebareId,
        este_gresita: true,
        raspunsuri_corecte_consecutive: 0,
      },
      { onConflict: "user_id,intrebare_id,examen_id" }
    )
    if (error) throw new Error(error.message)
    return
  }

  // A correct answer means the user has learned the question:
  // remove it from the wrong pool if it exists.
  const { error } = await supabase
    .from("status_invatare")
    .delete()
    .eq("user_id", userId)
    .eq("examen_id", examenId)
    .eq("intrebare_id", intrebareId)

  if (error) throw new Error(error.message)
}

/**
 * Încarcă întrebări din `intrebari`, amestecă aleatoriu și returnează până la `count`.
 * Pentru tabele foarte mari, preferă un RPC SQL `ORDER BY random() LIMIT n`.
 */
export async function fetchRandomIntrebari(
  supabase: SupabaseClient,
  count = 20
): Promise<QuizQuestion[]> {
  console.log("Incep fetch-ul...")
  console.log("URL găsit:", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL))
  console.log("Cheie ANON găsită:", Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))

  const { data, error } = await supabase
    .from("intrebari")
    .select("*")
    .eq("examen_id", 1)

  if (error) {
    console.error("Eroare Supabase:", error.message)
    throw new Error(error.message)
  }

  if (!data || data.length === 0) {
    return []
  }

  const rows = data as IntrebareRow[]
  const questions: QuizQuestion[] = []

  for (const row of rows) {
    const q = mapIntrebareRowToQuestion(row)
    if (q && (q.text || q.imageUrl)) questions.push(q)
  }

  return shuffleInPlaceAndLimit(questions, count)
}
