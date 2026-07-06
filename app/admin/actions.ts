"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { createClient } from "@supabase/supabase-js"
import ExcelJS from "exceljs"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  AdminAccessError,
  requireAdminContext,
  requireSuperAdminContext,
  type AdminContext,
} from "@/lib/auth/admin-context"
import { isAdminRole, normalizeRole, type AppRole } from "@/lib/auth/roles"
import {
  MAX_QUIZ_VARIANTS,
  MIN_QUIZ_VARIANTS,
  OPTION_IDS,
} from "@/lib/quiz/types"

function getAdminServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Lipsesc variabilele Supabase pentru acțiuni admin.")
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

type AdminServiceClient = ReturnType<typeof getAdminServiceClient>
type ActorSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

async function assertAdminActor(): Promise<AdminContext> {
  try {
    return await requireAdminContext()
  } catch (error) {
    if (error instanceof AdminAccessError) {
      throw new Error(error.message)
    }
    throw error
  }
}

async function assertSuperAdminActor(): Promise<AdminContext> {
  try {
    return await requireSuperAdminContext()
  } catch (error) {
    if (error instanceof AdminAccessError) {
      throw new Error(error.message)
    }
    throw error
  }
}

async function ensureExamInScope(
  adminSupabase: AdminServiceClient,
  context: AdminContext,
  examId: number
): Promise<{ id: number; org_id: string | null }> {
  const { data, error } = await adminSupabase
    .from("examene")
    .select("id, org_id")
    .eq("id", examId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message ?? "Examenul selectat nu există.")
  }

  if (context.scopedOrgId && data.org_id !== context.scopedOrgId) {
    throw new Error("Nu ai voie să modifici examene din alte organizații.")
  }

  return { id: Number(data.id), org_id: data.org_id ? String(data.org_id) : null }
}

async function ensureUserInScope(
  adminSupabase: AdminServiceClient,
  context: AdminContext,
  targetUserId: string
): Promise<{ id: string; org_id: string | null; role: AppRole }> {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("id, org_id, role")
    .eq("id", targetUserId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message ?? "Utilizatorul nu a fost găsit.")
  }

  const targetRole = normalizeRole(data.role)
  const targetOrgId = data.org_id ? String(data.org_id) : null

  if (context.scopedOrgId) {
    // org_admin sandbox: target MUST belong to the same org and CANNOT be
    // a super_admin (they are invisible to org admins entirely).
    if (targetOrgId !== context.scopedOrgId) {
      throw new Error("Nu ai voie să gestionezi utilizatori din alte organizații.")
    }
    if (targetRole === "super_admin") {
      throw new Error("Utilizatorul nu este disponibil.")
    }
  }

  return {
    id: String(data.id),
    org_id: targetOrgId,
    role: targetRole,
  }
}

/**
 * Verifică limitele organizației înainte de a crea o resursă nouă.
 * Aruncă o eroare clară dacă limita e atinsă.
 * Nu face nimic dacă org-ul e managed_manually (bypass complet).
 *
 * @param supabaseClient - clientul Supabase cu drepturi de service role
 * @param orgId - UUID-ul organizației
 * @param resource - 'useri' | 'admini' | 'examene' | 'tokeni'
 * @param resourceLabel - text pentru mesajul de eroare (ex: "utilizatori", "examene")
 * @param upgradeHint - tier sugerat pentru upgrade (ex: "Pro")
 */
async function assertOrgLimit(
  supabaseClient: AdminServiceClient,
  orgId: string,
  resource: "useri" | "admini" | "examene" | "tokeni",
  resourceLabel: string,
  upgradeHint: string = "Pro"
): Promise<void> {
  const { data, error } = await supabaseClient.rpc("check_org_limits", {
    p_org_id: orgId,
    p_resource: resource,
  })

  if (error) {
    console.error("[assertOrgLimit] RPC error:", error.message)
    throw new Error(
      "Nu s-a putut verifica limita organizației. Încearcă din nou sau contactează suportul."
    )
  }

  const result = data as {
    allowed: boolean
    current?: number
    max?: number
    remaining?: number
    managed_manually?: boolean
    error?: string
  }

  // Org managed manual → bypass complet
  if (result.managed_manually) return

  // Eroare de configurare (org_not_found, invalid_resource) → blocăm
  if (result.error) {
    console.error("[assertOrgLimit] Unexpected result:", result.error)
    throw new Error(
      "Eroare la verificarea limitelor organizației: " + result.error
    )
  }

  if (!result.allowed) {
    throw new Error(
      `Limita de ${resourceLabel} a fost atinsă (${result.current ?? "?"}/${result.max ?? "?"}).` +
        ` Treci la planul ${upgradeHint} pentru a adăuga mai mulți ${resourceLabel}.`
    )
  }
}

type ParsedExamQuestion = {
  intrebare_text: string
  /** Ordered variant texts (2..10). */
  variante: string[]
  /** Lower-case option ids whose Excel cell was filled. */
  raspunsuri_corecte: string[]
  /** First three variants mirrored into legacy columns for backwards
   *  compatibility with code paths that still read `varianta_a/b/c`. */
  varianta_a: string
  varianta_b: string
  varianta_c: string
  /** First correct answer mirrored into the legacy single-letter column. */
  raspuns_corect: string
}

type ParseExamResult = {
  questions: ParsedExamQuestion[]
  skippedRows: number
}

export type PreviewRow = {
  idx: number
  intrebare_text: string
  variante: string[]
  raspunsuri_corecte: string[]
  duplicate_in_db: boolean
  duplicate_in_batch: boolean
}

type PreviewSummary = {
  total: number
  new: number
  duplicate_in_db: number
  duplicate_in_batch: number
}

type DedupRpcRow = {
  idx: number
  content_hash: string
  duplicate_in_db: boolean
  duplicate_in_batch: boolean
}

type PreviewRowWithHash = PreviewRow & {
  content_hash: string
}

// Column B in the import spreadsheet starts the answer variants. The sheet
// is allowed to have up to `MAX_QUIZ_VARIANTS` variant columns (B..K).
const MIN_VARIANT_COL = 2

export type AdminStats = {
  totalUtilizatori: number
  totalExamene: number
  totalIntrebari: number
  utilizatoriActivi7Zile: number
}

export type AdminQuestionRow = {
  id: number
  intrebare_text: string
  /** Dynamic list of variant texts (length 2..10). */
  variante: string[]
  /** Lower-case option ids that are correct (length >= 1). */
  raspunsuri_corecte: string[]
  /** URL public imagine atașată întrebării. Null = fără imagine. */
  image_url: string | null
}

export type AdminExamRow = {
  id: number
  nume_examen: string
  org_id: string | null
  org_nume: string | null
  question_count: number
  prag_trecere: number
  intrebari_simulare: number
  variante_raspuns: number
  durata_minute: number
}

export type AdminOrganizationRow = {
  id: string
  nume: string
  slug: string
  created_at: string | null
  invite_links_enabled?: boolean
}

export type AdminUserRow = {
  id: string
  email: string | null
  nume: string | null
  role: AppRole
  org_id: string | null
  org_nume: string | null
}

export type ExamRulesPayload = {
  prag_trecere?: number
  intrebari_simulare?: number
  variante_raspuns?: number
  durata_minute?: number
  categorie?: string | null
}

type UpdateSingleQuestionPayload = {
  intrebare_text: string
  variante: string[]
  raspunsuri_corecte: string[]
  /** undefined = nu schimba, null = șterge imaginea, string = noua imagine. */
  image_url?: string | null
}

export async function updateUserActivity() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { updated: false, reason: "unauthenticated" as const }
  }

  const adminSupabase = getAdminServiceClient()
  const { error } = await adminSupabase
    .from("profiles")
    .update({ ultima_activitate: new Date().toISOString() })
    .eq("id", user.id)

  if (error) {
    throw new Error(error.message)
  }

  return { updated: true }
}

function cellValueToText(value: unknown) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Date) return value.toISOString()

  if (typeof value === "object") {
    const asRecord = value as Record<string, unknown>
    if (Array.isArray(asRecord.richText)) {
      return asRecord.richText
        .map((part) => {
          if (part && typeof part === "object" && "text" in (part as Record<string, unknown>)) {
            return String((part as Record<string, unknown>).text ?? "")
          }
          return ""
        })
        .join("")
    }
    if (asRecord.text != null) return String(asRecord.text)
    if (asRecord.result != null) return String(asRecord.result)
    if (asRecord.hyperlink != null && asRecord.text != null) return String(asRecord.text)
  }

  return String(value)
}

function normalizeText(value: unknown) {
  return cellValueToText(value).replace(/\s+/g, " ").trim()
}

function hasFill(cell: ExcelJS.Cell) {
  const fill = cell.fill
  if (!fill) return false
  if (fill.type === "pattern") return Boolean(fill.pattern && fill.pattern !== "none")
  if (fill.type === "gradient") return true
  return false
}

function readVariantTexts(row: ExcelJS.Row): string[] {
  const collected: string[] = []
  let lastNonEmpty = -1
  for (let i = 0; i < MAX_QUIZ_VARIANTS; i++) {
    const cell = row.getCell(MIN_VARIANT_COL + i)
    const text = normalizeText(cell.value)
    collected.push(text)
    if (text) lastNonEmpty = i
  }
  return lastNonEmpty < 0 ? [] : collected.slice(0, lastNonEmpty + 1)
}

function detectCorrectAnswers(row: ExcelJS.Row, variantCount: number): string[] {
  const labels: string[] = []
  for (let i = 0; i < variantCount; i++) {
    const cell = row.getCell(MIN_VARIANT_COL + i)
    if (hasFill(cell)) labels.push(OPTION_IDS[i])
  }
  return labels
}

function parseExamJson(jsonString: string): ParseExamResult {
  let raw: unknown
  try {
    raw = JSON.parse(jsonString)
  } catch {
    throw new Error("JSON invalid. Verifică formatul fișierului.")
  }

  const asRecord = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
  if (!asRecord || !Array.isArray(asRecord.questions)) {
    throw new Error('JSON-ul trebuie să conțină un câmp "questions" de tip array.')
  }

  const questions: ParsedExamQuestion[] = []
  let skippedRows = 0

  for (const item of asRecord.questions as unknown[]) {
    if (!item || typeof item !== "object") {
      skippedRows++
      continue
    }
    const q = item as Record<string, unknown>

    const intrebare_text = typeof q.question === "string" ? q.question.replace(/\s+/g, " ").trim() : ""
    if (!intrebare_text) {
      skippedRows++
      continue
    }

    const variante = Array.isArray(q.answers)
      ? (q.answers as unknown[]).map((a) => String(a ?? "").replace(/\s+/g, " ").trim())
      : []

    if (
      variante.length < MIN_QUIZ_VARIANTS ||
      variante.length > MAX_QUIZ_VARIANTS ||
      variante.some((v) => !v)
    ) {
      skippedRows++
      continue
    }

    const correctRaw = Array.isArray(q.correct) ? (q.correct as unknown[]) : []
    const raspunsuri_corecte = correctRaw
      .map((c) => Number(c))
      .filter((c) => Number.isFinite(c) && c >= 1 && c <= variante.length)
      .map((c) => OPTION_IDS[c - 1])

    if (raspunsuri_corecte.length === 0) {
      skippedRows++
      continue
    }

    questions.push({
      intrebare_text,
      variante,
      raspunsuri_corecte,
      varianta_a: variante[0] ?? "",
      varianta_b: variante[1] ?? "",
      varianta_c: variante[2] ?? "",
      raspuns_corect: raspunsuri_corecte[0],
    })
  }

  return { questions, skippedRows }
}

async function parseExamWorkbook(buffer: Buffer): Promise<ParseExamResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)

  const questions: ParsedExamQuestion[] = []
  let skippedRows = 0

  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const intrebare_text = normalizeText(row.getCell(1).value)
      const variante = readVariantTexts(row)

      if (!intrebare_text && variante.length === 0) {
        return
      }

      // Reject rows that don't carry the minimum amount of information
      // needed to render a quiz question.
      if (
        !intrebare_text ||
        variante.length < MIN_QUIZ_VARIANTS ||
        variante.some((text) => !text)
      ) {
        skippedRows += 1
        return
      }

      const raspunsuri_corecte = detectCorrectAnswers(row, variante.length)
      if (raspunsuri_corecte.length === 0) {
        skippedRows += 1
        return
      }

      questions.push({
        intrebare_text,
        variante,
        raspunsuri_corecte,
        // Mirror the first three variants & first correct answer into
        // legacy columns. The DB trigger keeps these in sync going forward,
        // but writing them here too means any reader that hits the database
        // immediately (before the trigger-synced copies are visible to a
        // cache) still sees a consistent question.
        varianta_a: variante[0] ?? "",
        varianta_b: variante[1] ?? "",
        varianta_c: variante[2] ?? "",
        raspuns_corect: raspunsuri_corecte[0],
      })
    })
  }

  return { questions, skippedRows }
}

function getFileFromFormData(formData: FormData) {
  const rawFile = formData.get("file")
  if (!(rawFile instanceof File)) {
    throw new Error("Fișierul Excel lipsește.")
  }
  if (!rawFile.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Fișier invalid. Se acceptă doar .xlsx.")
  }
  return rawFile
}

function getOptionalFileFromFormData(formData: FormData) {
  const rawFile = formData.get("file")
  if (rawFile == null || rawFile === "") return null
  if (!(rawFile instanceof File)) {
    throw new Error("Fișierul încărcat este invalid.")
  }
  if (!rawFile.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Fișier invalid. Se acceptă doar .xlsx.")
  }
  return rawFile
}

function parseOptionalExistingExamId(formData: FormData) {
  const raw = Number(formData.get("existingExamenId"))
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

async function assertImportRoleAndExamScope(
  actorSupabase: ActorSupabaseClient,
  context: AdminContext,
  examId: number | null
) {
  const role = normalizeRole(context.role)
  if (role !== "super_admin" && role !== "org_admin") {
    throw new Error("Nu ai dreptul să imporți întrebări în examene.")
  }

  if (examId == null) return null

  const { data: examRow, error: examError } = await actorSupabase
    .from("examene")
    .select("id, org_id")
    .eq("id", examId)
    .maybeSingle()

  if (examError || !examRow) {
    throw new Error(examError?.message ?? "Examenul selectat nu există sau nu este accesibil.")
  }

  const examOrgId = examRow.org_id ? String(examRow.org_id) : null
  if (role === "org_admin" && examOrgId !== context.orgId) {
    throw new Error("Nu ai voie să imporți întrebări în examene din alte organizații.")
  }

  return {
    id: Number(examRow.id),
    org_id: examOrgId,
  }
}

async function buildPreviewRowsWithDedupRpc(
  actorSupabase: ActorSupabaseClient,
  examId: number | null,
  questions: ParsedExamQuestion[]
): Promise<{ rows: PreviewRowWithHash[]; summary: PreviewSummary }> {
  const candidates = questions.map((question) => ({
    intrebare_text: question.intrebare_text,
    variante: question.variante,
  }))

  const { data, error } = await actorSupabase.rpc("preview_intrebari_dedup", {
    p_examen_id: examId,
    p_candidates: candidates,
  })

  if (error) {
    throw new Error(error.message)
  }

  const dedupByIndex = new Map<number, DedupRpcRow>()
  for (const row of (data ?? []) as DedupRpcRow[]) {
    dedupByIndex.set(Number(row.idx), {
      idx: Number(row.idx),
      content_hash: String(row.content_hash ?? ""),
      duplicate_in_db: Boolean(row.duplicate_in_db),
      duplicate_in_batch: Boolean(row.duplicate_in_batch),
    })
  }

  const previewRows: PreviewRowWithHash[] = questions.map((question, idx) => {
    const dedupRow = dedupByIndex.get(idx)
    return {
      idx,
      intrebare_text: question.intrebare_text,
      variante: [...question.variante],
      raspunsuri_corecte: [...question.raspunsuri_corecte],
      duplicate_in_db: dedupRow?.duplicate_in_db ?? false,
      duplicate_in_batch: dedupRow?.duplicate_in_batch ?? false,
      content_hash: dedupRow?.content_hash ?? "",
    }
  })

  const duplicateInDb = previewRows.filter((row) => row.duplicate_in_db).length
  const duplicateInBatch = previewRows.filter((row) => row.duplicate_in_batch).length
  const freshRows = previewRows.filter(
    (row) => !row.duplicate_in_db && !row.duplicate_in_batch
  ).length

  return {
    rows: previewRows,
    summary: {
      total: previewRows.length,
      new: freshRows,
      duplicate_in_db: duplicateInDb,
      duplicate_in_batch: duplicateInBatch,
    },
  }
}

function normalizeQuestionKey(text: string) {
  return normalizeText(text).toLowerCase()
}

async function getExistingQuestionKeysForExam(
  adminSupabase: AdminServiceClient,
  examId: number
) {
  if (!Number.isFinite(examId) || examId <= 0) {
    throw new Error("ID-ul examenului este invalid pentru verificarea duplicatelor.")
  }

  const { data, error } = await adminSupabase
    .from("intrebari")
    .select("intrebare_text")
    .eq("examen_id", examId)

  if (error) {
    throw new Error(error.message)
  }

  return new Set(
    (data ?? [])
      .map((row) => normalizeQuestionKey(String(row.intrebare_text ?? "")))
      .filter(Boolean)
  )
}

function buildScopedQuestionInsertRows(
  questions: ParsedExamQuestion[],
  examId: number,
  existingQuestionKeysInExam: Set<string>
) {
  const rowsToInsert: Array<{ examen_id: number } & ParsedExamQuestion> = []
  let duplicateCount = 0

  for (const row of questions) {
    const key = normalizeQuestionKey(row.intrebare_text)
    if (!key || existingQuestionKeysInExam.has(key)) {
      duplicateCount += 1
      continue
    }

    existingQuestionKeysInExam.add(key)
    rowsToInsert.push({
      examen_id: examId,
      ...row,
    })
  }

  return { rowsToInsert, duplicateCount }
}

async function insertQuestionsInBatches(
  adminSupabase: AdminServiceClient,
  rowsToInsert: Array<{ examen_id: number } & ParsedExamQuestion>,
  batchSize: number = 100
) {
  if (rowsToInsert.length === 0) return

  for (let offset = 0; offset < rowsToInsert.length; offset += batchSize) {
    const chunk = rowsToInsert.slice(offset, offset + batchSize)
    const { error } = await adminSupabase.from("intrebari").insert(chunk)
    if (error) {
      throw new Error(error.message)
    }
  }
}

async function loadAccessibleExamIds(
  adminSupabase: AdminServiceClient,
  context: AdminContext
): Promise<number[]> {
  let query = adminSupabase.from("examene").select("id")
  if (context.scopedOrgId) {
    query = query.eq("org_id", context.scopedOrgId)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0)
}

export async function getAdminStats(): Promise<AdminStats> {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const orgFilter = context.scopedOrgId

  const accessibleExamIds = await loadAccessibleExamIds(adminSupabase, context)

  // org_admin counts must never include super_admins or unassigned users.
  const buildUsersQuery = () => {
    let q = adminSupabase.from("profiles").select("id", { count: "exact", head: true })
    if (orgFilter) {
      q = q.eq("org_id", orgFilter).neq("role", "super_admin")
    }
    return q
  }
  const buildExamsQuery = () => {
    let q = adminSupabase.from("examene").select("id", { count: "exact", head: true })
    if (orgFilter) q = q.eq("org_id", orgFilter)
    return q
  }
  const buildQuestionsQuery = () => {
    const q = adminSupabase.from("intrebari").select("id", { count: "exact", head: true })
    if (orgFilter && accessibleExamIds.length === 0) {
      return q.eq("examen_id", -1)
    }
    if (orgFilter) {
      return q.in("examen_id", accessibleExamIds)
    }
    return q
  }
  const buildActiveUsersQuery = () => {
    let q = adminSupabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("ultima_activitate", "is", null)
      .gte("ultima_activitate", sevenDaysAgoIso)
    if (orgFilter) {
      q = q.eq("org_id", orgFilter).neq("role", "super_admin")
    }
    return q
  }

  const [usersResult, examsResult, questionsResult, activeUsersResult] = await Promise.all([
    buildUsersQuery(),
    buildExamsQuery(),
    buildQuestionsQuery(),
    buildActiveUsersQuery(),
  ])

  if (usersResult.error || examsResult.error || questionsResult.error || activeUsersResult.error) {
    throw new Error(
      usersResult.error?.message ||
        examsResult.error?.message ||
        questionsResult.error?.message ||
        activeUsersResult.error?.message ||
        "Nu s-au putut încărca statisticile admin."
    )
  }

  return {
    totalUtilizatori: usersResult.count ?? 0,
    totalExamene: examsResult.count ?? 0,
    totalIntrebari: questionsResult.count ?? 0,
    utilizatoriActivi7Zile: activeUsersResult.count ?? 0,
  }
}

function normalizeStoredVariante(raw: unknown, fallbackLegacy: {
  a?: string | null
  b?: string | null
  c?: string | null
}): string[] {
  let parsed: unknown = raw
  if (typeof parsed === "string") {
    const trimmed = parsed.trim()
    if (trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        parsed = null
      }
    } else {
      parsed = null
    }
  }
  if (Array.isArray(parsed)) {
    const cleaned = parsed
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0)
      .slice(0, MAX_QUIZ_VARIANTS)
    if (cleaned.length >= MIN_QUIZ_VARIANTS) return cleaned
  }
  const legacy = [fallbackLegacy.a, fallbackLegacy.b, fallbackLegacy.c]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0)
  return legacy
}

function normalizeStoredCorrectLabels(
  raw: unknown,
  legacy: string | null | undefined,
  allowedIds: Set<string>
): string[] {
  let parsed: unknown = raw
  if (typeof parsed === "string") {
    const trimmed = parsed.trim()
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        parsed = null
      }
    } else {
      parsed = null
    }
  }
  const out = new Set<string>()
  if (Array.isArray(parsed)) {
    for (const value of parsed) {
      const id = String(value ?? "").trim().toLowerCase()
      if (allowedIds.has(id)) out.add(id)
    }
  }
  if (out.size === 0) {
    const legacyId = String(legacy ?? "").trim().toLowerCase()
    if (allowedIds.has(legacyId)) out.add(legacyId)
  }
  return Array.from(out).sort()
}

export async function getQuestionsForExam(examId: number): Promise<AdminQuestionRow[]> {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()

  if (!Number.isFinite(examId) || examId <= 0) {
    throw new Error("Examen invalid.")
  }

  await ensureExamInScope(adminSupabase, context, examId)

  const { data, error } = await adminSupabase
    .from("intrebari")
    .select(
      "id, intrebare_text, variante, raspunsuri_corecte, varianta_a, varianta_b, varianta_c, raspuns_corect, image_url"
    )
    .eq("examen_id", examId)
    .order("id", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? [])
    .map((row) => {
      const variante = normalizeStoredVariante(row.variante, {
        a: row.varianta_a as string | null | undefined,
        b: row.varianta_b as string | null | undefined,
        c: row.varianta_c as string | null | undefined,
      })
      if (variante.length < MIN_QUIZ_VARIANTS) return null
      const allowedIds = new Set<string>(OPTION_IDS.slice(0, variante.length))
      const raspunsuri_corecte = normalizeStoredCorrectLabels(
        row.raspunsuri_corecte,
        row.raspuns_corect as string | null | undefined,
        allowedIds
      )
      if (raspunsuri_corecte.length === 0) return null
      return {
        id: Number(row.id),
        intrebare_text: String(row.intrebare_text ?? ""),
        variante,
        raspunsuri_corecte,
        image_url: row.image_url ? String(row.image_url) : null,
      }
    })
    .filter((row): row is AdminQuestionRow => row !== null)
}

export async function updateSingleQuestion(id: number, data: UpdateSingleQuestionPayload) {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()

  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("ID-ul întrebării este invalid.")
  }

  const { data: questionRow, error: questionError } = await adminSupabase
    .from("intrebari")
    .select("examen_id")
    .eq("id", id)
    .maybeSingle()
  if (questionError || !questionRow) {
    throw new Error(questionError?.message ?? "Întrebarea nu există.")
  }
  await ensureExamInScope(adminSupabase, context, Number(questionRow.examen_id))

  const intrebareText = String(data.intrebare_text ?? "").trim()
  const variante = Array.isArray(data.variante)
    ? data.variante
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
        .slice(0, MAX_QUIZ_VARIANTS)
    : []

  // A question is valid with either text or an attached image (or both).
  const hasImage =
    typeof data.image_url === "string" && data.image_url.trim().length > 0
  if ((!intrebareText && !hasImage) || variante.length < MIN_QUIZ_VARIANTS) {
    throw new Error("Întrebarea trebuie să aibă text sau imagine și minim 2 variante completate.")
  }

  const allowedIds = new Set<string>(OPTION_IDS.slice(0, variante.length))
  const raspunsuri: string[] = []
  if (Array.isArray(data.raspunsuri_corecte)) {
    for (const value of data.raspunsuri_corecte) {
      const id = String(value ?? "").trim().toLowerCase()
      if (allowedIds.has(id) && !raspunsuri.includes(id)) raspunsuri.push(id)
    }
  }
  raspunsuri.sort()

  if (raspunsuri.length === 0) {
    throw new Error("Selectează cel puțin un răspuns corect.")
  }

  const update: Record<string, unknown> = {
    intrebare_text: intrebareText,
    variante,
    raspunsuri_corecte: raspunsuri,
    // Mirror first 3 variants + first correct answer to the legacy columns
    // for older consumers. The DB trigger would do this too, but writing it
    // here keeps PostgREST RETURNING payloads consistent for the UI.
    varianta_a: variante[0] ?? "",
    varianta_b: variante[1] ?? "",
    varianta_c: variante[2] ?? "",
    raspuns_corect: raspunsuri[0],
  }

  // undefined = nu schimba, null = șterge imaginea, string = noua imagine.
  if (data.image_url !== undefined) {
    update.image_url = data.image_url
  }

  const { error } = await adminSupabase.from("intrebari").update(update).eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/admin")
}

export async function deleteSingleQuestion(id: number) {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()

  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("ID-ul întrebării este invalid.")
  }

  const { data: questionRow, error: questionError } = await adminSupabase
    .from("intrebari")
    .select("examen_id")
    .eq("id", id)
    .maybeSingle()
  if (questionError || !questionRow) {
    throw new Error(questionError?.message ?? "Întrebarea nu există.")
  }
  await ensureExamInScope(adminSupabase, context, Number(questionRow.examen_id))

  const { error } = await adminSupabase.from("intrebari").delete().eq("id", id)
  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/admin")
}

export async function deleteUser(userId: string) {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()

  const target = await ensureUserInScope(adminSupabase, context, userId)
  if (target.id === context.userId) {
    throw new Error("Nu te poți șterge pe tine însuți.")
  }
  if (target.role === "super_admin" && !context.isSuperAdmin) {
    throw new Error("Doar super admin poate șterge un super admin.")
  }
  // Org admins cannot remove their peers — only super_admin can demote/remove org_admins.
  if (target.role === "org_admin" && !context.isSuperAdmin) {
    throw new Error("Doar super admin poate șterge un org admin.")
  }

  const { error: deleteAuthError } = await adminSupabase.auth.admin.deleteUser(userId)

  if (deleteAuthError) {
    const { error: profileDeleteError } = await adminSupabase
      .from("profiles")
      .delete()
      .eq("id", userId)

    if (profileDeleteError) {
      throw new Error(deleteAuthError.message)
    }

    const { error: retryDeleteAuthError } = await adminSupabase.auth.admin.deleteUser(userId)
    if (retryDeleteAuthError) {
      throw new Error(retryDeleteAuthError.message)
    }
  }

  revalidatePath("/admin")
}

export async function grantExamAccess(
  userId: string,
  examId: number,
  days: number = 30
) {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()

  await ensureExamInScope(adminSupabase, context, examId)
  await ensureUserInScope(adminSupabase, context, userId)

  const expireDate = new Date()
  expireDate.setDate(expireDate.getDate() + days)
  const isoDate = expireDate.toISOString()

  const { data: existing, error: existingError } = await adminSupabase
    .from("acces_examene")
    .select("user_id")
    .eq("user_id", userId)
    .eq("examen_id", examId)
    .maybeSingle()

  if (existingError) {
    throw new Error(existingError.message)
  }

  if (existing) {
    const { error: updateError } = await adminSupabase
      .from("acces_examene")
      .update({
        data_expirare: isoDate,
      })
      .eq("user_id", userId)
      .eq("examen_id", examId)

    if (updateError) {
      throw new Error(updateError.message)
    }
  } else {
    const { error: insertError } = await adminSupabase.from("acces_examene").insert({
      user_id: userId,
      examen_id: examId,
      data_expirare: isoDate,
    })

    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  revalidatePath("/admin")
}

export async function previewExamImportJson(formData: FormData) {
  const context = await assertAdminActor()
  const actorSupabase = await createSupabaseServerClient()
  const jsonContent = String(formData.get("jsonContent") ?? "").trim()
  if (!jsonContent) throw new Error("Conținutul JSON lipsește.")
  const parsed = parseExamJson(jsonContent)
  const existingExamId = parseOptionalExistingExamId(formData)

  if (existingExamId != null) {
    await assertImportRoleAndExamScope(actorSupabase, context, existingExamId)
  }

  const dedupPreview = await buildPreviewRowsWithDedupRpc(
    actorSupabase,
    existingExamId,
    parsed.questions
  )
  const previewRows: PreviewRow[] = dedupPreview.rows.map((row) => ({
    idx: row.idx,
    intrebare_text: row.intrebare_text,
    variante: row.variante,
    raspunsuri_corecte: row.raspunsuri_corecte,
    duplicate_in_db: row.duplicate_in_db,
    duplicate_in_batch: row.duplicate_in_batch,
  }))

  return {
    questionCount: parsed.questions.length,
    skippedRows: parsed.skippedRows,
    rows: previewRows,
    summary: dedupPreview.summary,
  }
}

export async function importExamFromJson(formData: FormData) {
  const context = await assertAdminActor()
  const actorSupabase = await createSupabaseServerClient()

  const existingExamenIdRaw = parseOptionalExistingExamId(formData)
  const hasExistingExamenId = existingExamenIdRaw != null
  const examName = String(formData.get("examName") ?? "").trim()
  const explicitOrgId = String(formData.get("orgId") ?? "").trim() || null

  const jsonContent = String(formData.get("jsonContent") ?? "").trim()
  if (!jsonContent) throw new Error("Conținutul JSON lipsește.")
  const parsed = parseExamJson(jsonContent)

  if (parsed.questions.length === 0) {
    throw new Error("Nu am detectat întrebări valide în JSON-ul furnizat.")
  }

  let examenId: number
  let createdNewExam = false

  if (hasExistingExamenId) {
    const inScopeExam = await assertImportRoleAndExamScope(
      actorSupabase,
      context,
      existingExamenIdRaw
    )
    if (!inScopeExam) throw new Error("Examenul selectat nu există.")
    examenId = inScopeExam.id
  } else {
    await assertImportRoleAndExamScope(actorSupabase, context, null)
    if (!examName) throw new Error("Numele examenului este obligatoriu.")

    let targetOrgId: string | null = context.scopedOrgId
    if (context.isSuperAdmin) targetOrgId = explicitOrgId ?? null
    if (!targetOrgId && !context.isSuperAdmin) {
      throw new Error("Contul tău nu este asociat unei organizații.")
    }

    // Enforcement: verifică limita de examene înainte de creare
    // super_admin cu org explicită → verifică limita acelei org
    // super_admin fără org → bypass (creează examen global, fără org_id)
    // org_admin → verifică întotdeauna (targetOrgId e mereu setat)
    if (targetOrgId) {
      const adminSupabase = getAdminServiceClient()
      await assertOrgLimit(adminSupabase, targetOrgId, "examene", "examene", "Pro")
    }

    const { data: createdExam, error: createExamError } = await actorSupabase
      .from("examene")
      .insert({ nume_examen: examName, org_id: targetOrgId })
      .select("id")
      .single()

    if (createExamError || !createdExam) {
      throw new Error(createExamError?.message ?? "Nu s-a putut crea examenul.")
    }

    createdNewExam = true
    examenId = Number(createdExam.id)
  }

  let dedupPreview: Awaited<ReturnType<typeof buildPreviewRowsWithDedupRpc>>
  try {
    dedupPreview = await buildPreviewRowsWithDedupRpc(actorSupabase, examenId, parsed.questions)
  } catch (error) {
    if (createdNewExam) await actorSupabase.from("examene").delete().eq("id", examenId)
    throw error
  }

  const firstIndexByHash = new Map<string, number>()
  const rowsToInsert: Array<{ examen_id: number } & ParsedExamQuestion> = []
  let skippedDuplicatesBatch = 0

  for (const row of dedupPreview.rows) {
    const hash = row.content_hash
    const question = parsed.questions[row.idx]
    if (!question) continue

    if (!hash) {
      rowsToInsert.push({ examen_id: examenId, ...question })
      continue
    }

    if (firstIndexByHash.has(hash)) {
      skippedDuplicatesBatch += 1
      continue
    }

    firstIndexByHash.set(hash, row.idx)
    rowsToInsert.push({ examen_id: examenId, ...question })
  }

  let insertedCount = 0

  if (rowsToInsert.length > 0) {
    try {
      const { data, error } = await actorSupabase
        .from("intrebari")
        .upsert(rowsToInsert, { onConflict: "content_hash", ignoreDuplicates: true })
        .select("id")

      if (error) throw new Error(error.message)
      insertedCount = data?.length ?? 0
    } catch (error) {
      if (createdNewExam) await actorSupabase.from("examene").delete().eq("id", examenId)
      throw error
    }
  }

  const skippedDuplicatesDb = Math.max(0, rowsToInsert.length - insertedCount)
  const duplicateCount = skippedDuplicatesBatch + skippedDuplicatesDb

  revalidatePath("/admin")

  return {
    examenId,
    inserted: insertedCount,
    skipped_duplicates_db: skippedDuplicatesDb,
    skipped_duplicates_batch: skippedDuplicatesBatch,
    skipped: duplicateCount,
    insertedCount,
    skippedRows: parsed.skippedRows,
    duplicateCount,
    createdNewExam,
  }
}

export async function previewExamImport(formData: FormData) {
  const context = await assertAdminActor()
  const actorSupabase = await createSupabaseServerClient()
  const file = getFileFromFormData(formData)
  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = await parseExamWorkbook(buffer)
  const existingExamId = parseOptionalExistingExamId(formData)

  if (existingExamId != null) {
    await assertImportRoleAndExamScope(actorSupabase, context, existingExamId)
  }

  const dedupPreview = await buildPreviewRowsWithDedupRpc(
    actorSupabase,
    existingExamId,
    parsed.questions
  )
  const previewRows: PreviewRow[] = dedupPreview.rows.map((row) => ({
    idx: row.idx,
    intrebare_text: row.intrebare_text,
    variante: row.variante,
    raspunsuri_corecte: row.raspunsuri_corecte,
    duplicate_in_db: row.duplicate_in_db,
    duplicate_in_batch: row.duplicate_in_batch,
  }))

  return {
    questionCount: parsed.questions.length,
    skippedRows: parsed.skippedRows,
    rows: previewRows,
    summary: dedupPreview.summary,
  }
}

export async function importExamFromExcel(formData: FormData) {
  const context = await assertAdminActor()
  const actorSupabase = await createSupabaseServerClient()

  const existingExamenIdRaw = parseOptionalExistingExamId(formData)
  const hasExistingExamenId = existingExamenIdRaw != null
  const examName = String(formData.get("examName") ?? "").trim()
  const explicitOrgId = String(formData.get("orgId") ?? "").trim() || null

  const file = getFileFromFormData(formData)
  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = await parseExamWorkbook(buffer)

  if (parsed.questions.length === 0) {
    throw new Error("Nu am detectat întrebări valide în fișierul selectat.")
  }

  let examenId: number
  let createdNewExam = false

  if (hasExistingExamenId) {
    const inScopeExam = await assertImportRoleAndExamScope(
      actorSupabase,
      context,
      existingExamenIdRaw
    )
    if (!inScopeExam) {
      throw new Error("Examenul selectat nu există.")
    }
    examenId = inScopeExam.id
  } else {
    await assertImportRoleAndExamScope(actorSupabase, context, null)

    if (!examName) {
      throw new Error("Numele examenului este obligatoriu.")
    }

    let targetOrgId: string | null = context.scopedOrgId
    if (context.isSuperAdmin) {
      targetOrgId = explicitOrgId ?? null
    }

    if (!targetOrgId && !context.isSuperAdmin) {
      throw new Error("Contul tău nu este asociat unei organizații.")
    }

    // Enforcement: verifică limita de examene înainte de creare
    // super_admin cu org explicită → verifică limita acelei org
    // super_admin fără org → bypass (creează examen global, fără org_id)
    // org_admin → verifică întotdeauna (targetOrgId e mereu setat)
    if (targetOrgId) {
      const adminSupabase = getAdminServiceClient()
      await assertOrgLimit(adminSupabase, targetOrgId, "examene", "examene", "Pro")
    }

    const { data: createdExam, error: createExamError } = await actorSupabase
      .from("examene")
      .insert({ nume_examen: examName, org_id: targetOrgId })
      .select("id")
      .single()

    if (createExamError || !createdExam) {
      throw new Error(createExamError?.message ?? "Nu s-a putut crea examenul.")
    }

    createdNewExam = true
    examenId = Number(createdExam.id)
  }

  let dedupPreview: Awaited<ReturnType<typeof buildPreviewRowsWithDedupRpc>>
  try {
    dedupPreview = await buildPreviewRowsWithDedupRpc(actorSupabase, examenId, parsed.questions)
  } catch (error) {
    if (createdNewExam) {
      await actorSupabase.from("examene").delete().eq("id", examenId)
    }
    throw error
  }

  const firstIndexByHash = new Map<string, number>()
  const rowsToInsert: Array<{ examen_id: number } & ParsedExamQuestion> = []
  let skippedDuplicatesBatch = 0

  for (const row of dedupPreview.rows) {
    const hash = row.content_hash
    const question = parsed.questions[row.idx]
    if (!question) continue

    if (!hash) {
      rowsToInsert.push({
        examen_id: examenId,
        ...question,
      })
      continue
    }

    if (firstIndexByHash.has(hash)) {
      skippedDuplicatesBatch += 1
      continue
    }

    firstIndexByHash.set(hash, row.idx)
    rowsToInsert.push({
      examen_id: examenId,
      ...question,
    })
  }

  let insertedCount = 0

  if (rowsToInsert.length > 0) {
    try {
      const { data, error } = await actorSupabase
        .from("intrebari")
        .upsert(rowsToInsert, {
          onConflict: "content_hash",
          ignoreDuplicates: true,
        })
        .select("id")

      if (error) {
        throw new Error(error.message)
      }

      insertedCount = data?.length ?? 0
    } catch (error) {
      if (createdNewExam) {
        await actorSupabase.from("examene").delete().eq("id", examenId)
      }
      throw error
    }
  }

  const skippedDuplicatesDb = Math.max(0, rowsToInsert.length - insertedCount)
  const duplicateCount = skippedDuplicatesBatch + skippedDuplicatesDb

  revalidatePath("/admin")

  return {
    examenId,
    inserted: insertedCount,
    skipped_duplicates_db: skippedDuplicatesDb,
    skipped_duplicates_batch: skippedDuplicatesBatch,
    skipped: duplicateCount,
    insertedCount,
    skippedRows: parsed.skippedRows,
    duplicateCount,
    createdNewExam,
  }
}

export async function updateExam(formData: FormData) {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()

  const examId = Number(formData.get("examId"))
  if (!Number.isFinite(examId) || examId <= 0) {
    throw new Error("ID-ul examenului este invalid.")
  }

  await ensureExamInScope(adminSupabase, context, examId)

  const { data: existingExam, error: existingExamError } = await adminSupabase
    .from("examene")
    .select("id, nume_examen")
    .eq("id", examId)
    .maybeSingle()

  if (existingExamError || !existingExam) {
    throw new Error(existingExamError?.message ?? "Examenul selectat nu există.")
  }

  const nextExamName = String(formData.get("examName") ?? "").trim()
  const file = getOptionalFileFromFormData(formData)

  if (!nextExamName && !file) {
    throw new Error("Nu există modificări de salvat.")
  }

  if (nextExamName && nextExamName !== String(existingExam.nume_examen ?? "").trim()) {
    const { error: updateNameError } = await adminSupabase
      .from("examene")
      .update({ nume_examen: nextExamName })
      .eq("id", examId)

    if (updateNameError) {
      throw new Error("Nu s-a putut actualiza numele examenului.")
    }
  }

  let insertedCount = 0
  let duplicateCount = 0
  let skippedRows = 0

  if (file) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseExamWorkbook(buffer)
    skippedRows = parsed.skippedRows

    let knownQuestionKeys: Set<string>
    try {
      knownQuestionKeys = await getExistingQuestionKeysForExam(adminSupabase, examId)
    } catch {
      throw new Error("Nu s-au putut încărca întrebările existente pentru verificarea duplicatelor.")
    }

    const questionInsertResult = buildScopedQuestionInsertRows(
      parsed.questions,
      examId,
      knownQuestionKeys
    )
    const rowsToInsert = questionInsertResult.rowsToInsert
    duplicateCount = questionInsertResult.duplicateCount

    if (rowsToInsert.length > 0) {
      try {
        await insertQuestionsInBatches(adminSupabase, rowsToInsert, 100)
      } catch {
        throw new Error("Nu s-au putut salva întrebările noi din fișier.")
      }
      insertedCount = rowsToInsert.length
    }
  }

  revalidatePath("/admin")

  return {
    examId,
    updatedName: nextExamName || String(existingExam.nume_examen ?? ""),
    insertedCount,
    duplicateCount,
    skippedRows,
  }
}

export async function updateExamRules(examId: number, rules: ExamRulesPayload) {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()

  if (!Number.isFinite(examId) || examId <= 0) {
    throw new Error("ID-ul examenului este invalid.")
  }
  await ensureExamInScope(adminSupabase, context, examId)

  const update: Record<string, number | string | null> = {}

  if (rules.prag_trecere != null) {
    const value = Math.max(1, Math.floor(Number(rules.prag_trecere)))
    if (!Number.isFinite(value)) throw new Error("Prag de trecere invalid.")
    update.prag_trecere = value
  }
  if (rules.intrebari_simulare != null) {
    const value = Math.max(1, Math.floor(Number(rules.intrebari_simulare)))
    if (!Number.isFinite(value)) throw new Error("Număr de întrebări invalid.")
    update.intrebari_simulare = value
  }
  if (rules.variante_raspuns != null) {
    // Treated as a "max default" — the quiz interface itself always honors
    // the actual variant count stored on each question's JSONB column.
    const value = Math.max(MIN_QUIZ_VARIANTS, Math.min(MAX_QUIZ_VARIANTS, Math.floor(Number(rules.variante_raspuns))))
    if (!Number.isFinite(value)) throw new Error("Număr de variante invalid.")
    update.variante_raspuns = value
  }
  if (rules.durata_minute != null) {
    const value = Math.max(1, Math.floor(Number(rules.durata_minute)))
    if (!Number.isFinite(value)) throw new Error("Durata invalidă.")
    update.durata_minute = value
  }
  if (rules.categorie !== undefined) {
    update.categorie = rules.categorie ? String(rules.categorie).trim() : null
  }

  if (Object.keys(update).length === 0) {
    return { examId }
  }

  const { error } = await adminSupabase.from("examene").update(update).eq("id", examId)
  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/admin")
  return { examId }
}

export async function deleteExam(examId: number) {
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()
  await ensureExamInScope(adminSupabase, context, examId)

  const { error } = await adminSupabase
    .from("examene")
    .delete()
    .eq("id", examId)

  if (error) {
    console.error("Supabase delete error:", error)
    throw new Error("Eroare internă la ștergerea examenului.")
  }

  revalidatePath("/admin")
  return { success: true }
}

export async function listOrganizations(): Promise<AdminOrganizationRow[]> {
  await assertSuperAdminActor()
  const adminSupabase = getAdminServiceClient()
  const { data, error } = await adminSupabase
    .from("organizatii")
    .select("id, nume, slug, created_at")
    .order("nume", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: String(row.id),
    nume: String(row.nume ?? ""),
    slug: String(row.slug ?? ""),
    created_at: row.created_at ? String(row.created_at) : null,
  }))
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export async function createOrganization(input: { nume: string; slug?: string }) {
  await assertSuperAdminActor()
  const adminSupabase = getAdminServiceClient()
  const nume = String(input.nume ?? "").trim()
  if (!nume) {
    throw new Error("Numele organizației este obligatoriu.")
  }
  const slug = normalizeSlug(input.slug?.trim() || nume)
  if (!slug) {
    throw new Error("Slug-ul nu poate fi gol.")
  }

  const { data, error } = await adminSupabase
    .from("organizatii")
    .insert({ nume, slug })
    .select("id, nume, slug, created_at")
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? "Nu s-a putut crea organizația.")
  }

  revalidatePath("/admin/global")
  return {
    id: String(data.id),
    nume: String(data.nume ?? ""),
    slug: String(data.slug ?? ""),
    created_at: data.created_at ? String(data.created_at) : null,
  }
}

export async function updateOrganization(input: {
  id: string
  nume?: string
  slug?: string
}) {
  await assertSuperAdminActor()
  const adminSupabase = getAdminServiceClient()
  const id = String(input.id ?? "")
  if (!id) throw new Error("ID-ul organizației lipsește.")
  const update: Record<string, string> = {}
  if (input.nume != null) {
    const nume = String(input.nume).trim()
    if (!nume) throw new Error("Numele organizației este obligatoriu.")
    update.nume = nume
  }
  if (input.slug != null) {
    const slug = normalizeSlug(String(input.slug))
    if (!slug) throw new Error("Slug-ul nu poate fi gol.")
    update.slug = slug
  }
  if (Object.keys(update).length === 0) return { id }
  const { error } = await adminSupabase.from("organizatii").update(update).eq("id", id)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/global")
  return { id }
}

export async function deleteOrganization(id: string) {
  await assertSuperAdminActor()
  const adminSupabase = getAdminServiceClient()
  const orgId = String(id ?? "")
  if (!orgId) throw new Error("ID-ul organizației lipsește.")

  const [examsRefs, profileRefs] = await Promise.all([
    adminSupabase.from("examene").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    adminSupabase.from("profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ])
  if (examsRefs.error || profileRefs.error) {
    throw new Error(
      examsRefs.error?.message ||
        profileRefs.error?.message ||
        "Nu s-a putut verifica organizația."
    )
  }
  if ((examsRefs.count ?? 0) > 0 || (profileRefs.count ?? 0) > 0) {
    throw new Error(
      "Organizația are utilizatori sau examene asociate. Elimină-i întâi pentru a o putea șterge."
    )
  }

  const { error } = await adminSupabase.from("organizatii").delete().eq("id", orgId)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/global")
  return { success: true }
}

export async function assignUserToOrganization(input: {
  userId: string
  orgId: string | null
}) {
  await assertSuperAdminActor()
  const adminSupabase = getAdminServiceClient()
  const userId = String(input.userId ?? "")
  if (!userId) throw new Error("ID utilizator lipsește.")
  const orgId = input.orgId ? String(input.orgId) : null
  const { error } = await adminSupabase
    .from("profiles")
    .update({ org_id: orgId })
    .eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/global")
  revalidatePath("/admin")
  return { userId, orgId }
}

export async function updateUserRole(input: { userId: string; role: AppRole }) {
  // Permite atât super_admin cât și org_admin să apeleze această funcție.
  // org_admin are restricții suplimentare definite mai jos.
  const context = await assertAdminActor()
  const adminSupabase = getAdminServiceClient()
  const userId = String(input.userId ?? "")
  const role = normalizeRole(input.role)
  if (!userId) throw new Error("ID utilizator lipsește.")
  if (!isAdminRole(role) && role !== "user") {
    throw new Error("Rol invalid.")
  }

  // ensureUserInScope verifică automat că org_admin nu poate acționa în afara
  // propriei org și nu poate vedea super_admini (sandbox existent).
  const target = await ensureUserInScope(adminSupabase, context, userId)

  if (target.id === context.userId) {
    throw new Error("Nu îți poți modifica propriul rol.")
  }

  // Restricții pentru org_admin:
  if (!context.isSuperAdmin) {
    // org_admin nu poate promova la super_admin
    if (role === "super_admin") {
      throw new Error("Nu ai permisiunea să atribui rolul de Super Admin.")
    }
    // org_admin nu poate retrograda alt org_admin (doar super_admin poate)
    if (target.role === "org_admin" && role !== "org_admin") {
      throw new Error("Nu ai permisiunea să modifici rolul unui administrator.")
    }
    // org_admin trebuie să aibă un scopedOrgId valid
    if (!context.scopedOrgId) {
      throw new Error("Contul tău nu este asociat unei organizații.")
    }
  }

  if (role === "org_admin" && !target.org_id) {
    throw new Error("Atribuie întâi o organizație utilizatorului.")
  }

  // Enforcement: verifică limita de admini înainte de promovare.
  // Se aplică atât pentru super_admin cât și pentru org_admin.
  if (role === "org_admin" && target.org_id) {
    await assertOrgLimit(adminSupabase, target.org_id, "admini", "administratori", "Pro")
  }

  const { error } = await adminSupabase.from("profiles").update({ role }).eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/global")
  revalidatePath("/admin")
  return { userId, role }
}

export async function generateInviteToken(orgId: string): Promise<{
  token: string
  expires_at: string
  invite_url: string
}> {
  const context = await assertAdminActor()
  // super_admin may generate for any org; org_admin only for their own org.
  if (!context.isSuperAdmin && context.scopedOrgId !== orgId) {
    throw new Error("Nu ai dreptul să generezi linkuri pentru această organizație.")
  }
  const actorSupabase = await createSupabaseServerClient()

  // Verify invite_links_enabled for this org
  const { data: org, error: orgError } = await actorSupabase
    .from("organizatii")
    .select("id, invite_links_enabled")
    .eq("id", orgId)
    .maybeSingle()

  if (orgError || !org) throw new Error("Organizația nu a fost găsită.")
  if (!org.invite_links_enabled) {
    throw new Error("Invite links nu sunt activate pentru această organizație.")
  }

  // Enforcement: verifică limita de useri înainte de a genera un token de invitație
  const adminSupabase = getAdminServiceClient()
  await assertOrgLimit(adminSupabase, orgId, "useri", "utilizatori", "Pro")

  // Generate cryptographically random token (32 bytes → 64 hex chars)
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  const { error: insertError } = await actorSupabase
    .from("invite_tokens")
    .insert({
      org_id: orgId,
      created_by: context.userId,
      token,
      expires_at: expiresAt,
    })

  if (insertError) throw new Error(insertError.message)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://quizhub.ro"
  return {
    token,
    expires_at: expiresAt,
    invite_url: `${appUrl}/join?token=${token}`,
  }
}

export type InviteTokenRow = {
  id: string
  token: string
  expires_at: string
  used_at: string | null
  used_by_email: string | null
  created_at: string
  status: "active" | "expired" | "used"
}

export async function getInviteTokens(orgId: string): Promise<InviteTokenRow[]> {
  const context = await assertAdminActor()
  // super_admin may read any org; org_admin only their own. Silent empty
  // result for out-of-scope requests instead of throwing.
  if (!context.isSuperAdmin && context.scopedOrgId !== orgId) return []
  const actorSupabase = await createSupabaseServerClient()

  const { data, error } = await actorSupabase
    .from("invite_tokens")
    .select("id, token, expires_at, used_at, used_by, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  const now = new Date()
  return (data ?? []).map((row) => {
    let status: "active" | "expired" | "used"
    if (row.used_at) status = "used"
    else if (new Date(row.expires_at) < now) status = "expired"
    else status = "active"

    return {
      id: String(row.id),
      token: String(row.token),
      expires_at: String(row.expires_at),
      used_at: row.used_at ? String(row.used_at) : null,
      used_by_email: null, // enriched client-side if needed
      created_at: String(row.created_at),
      status,
    }
  })
}

export async function revokeInviteToken(tokenId: string): Promise<void> {
  const context = await assertAdminActor()
  const actorSupabase = await createSupabaseServerClient()

  // First, fetch the token to verify org scope
  const { data: tokenRow, error: fetchError } = await actorSupabase
    .from("invite_tokens")
    .select("id, org_id")
    .eq("id", tokenId)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!tokenRow) throw new Error("Tokenul nu a fost găsit.")

  const tokenOrgId = String(tokenRow.org_id)

  // Authorization:
  //   - super_admin can revoke any token
  //   - org_admin can revoke only tokens in their own org
  if (!context.isSuperAdmin) {
    if (!context.scopedOrgId || context.scopedOrgId !== tokenOrgId) {
      throw new Error("Nu ai dreptul să revoci acest link.")
    }
  }

  // Revoke = set expires_at to the past. RLS already enforces org scoping
  // on UPDATE; the explicit check above is defense in depth.
  const { error: updateError } = await actorSupabase
    .from("invite_tokens")
    .update({ expires_at: new Date(0).toISOString() })
    .eq("id", tokenId)

  if (updateError) throw new Error(updateError.message)
}

export async function toggleOrgInviteLinks(
  orgId: string,
  enabled: boolean
): Promise<void> {
  const context = await assertAdminActor()
  if (!context.isSuperAdmin) {
    throw new Error("Doar super admin poate modifica această setare.")
  }
  const actorSupabase = await createSupabaseServerClient()
  const { error } = await actorSupabase
    .from("organizatii")
    .update({ invite_links_enabled: enabled })
    .eq("id", orgId)
  if (error) throw new Error(error.message)
}

export async function getMyShareStatsEnabled(): Promise<boolean> {
  const actorSupabase = await createSupabaseServerClient()
  const { data, error } = await actorSupabase.rpc("get_my_share_stats")
  if (error) {
    console.error("[getMyShareStatsEnabled]", error)
    return false
  }
  return Boolean(data)
}

export async function setMyShareStatsEnabled(enabled: boolean): Promise<void> {
  const actorSupabase = await createSupabaseServerClient()
  const { error } = await actorSupabase.rpc("toggle_share_stats", { enabled })
  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/admin/elevi")
}

// ---------------------------------------------------------------------------
// Tiers & organization plan management (super_admin only)
//
// These actions power /admin/tiers. Every mutation runs through the service
// role client (RLS bypass) but is gated behind `assertSuperAdminActor()` so an
// org_admin can never reach the writes. They return a plain `{ error }` shape
// instead of throwing so the client can render inline toasts without a boundary.
// ---------------------------------------------------------------------------

type ActionResult = { error: string | null }

type PlanTierUpdate = {
  max_admini?: number
  max_useri?: number
  max_examene?: number
  tokeni_lunari?: number
  pret_luna?: number
  pret_an?: number
  este_activ?: boolean
}

type OrgLimitsUpdate = {
  max_admini?: number
  max_useri?: number
  max_examene?: number
  tokeni_lunari?: number
  ai_import_enabled?: boolean
}

type OrgSubscriptionStatus = "active" | "past_due" | "suspended" | "canceled"

const ORG_SUBSCRIPTION_STATUSES: OrgSubscriptionStatus[] = [
  "active",
  "past_due",
  "suspended",
  "canceled",
]

function toActionError(error: unknown): ActionResult {
  if (error instanceof AdminAccessError) return { error: error.message }
  if (error instanceof Error) return { error: error.message }
  return { error: "A apărut o eroare neașteptată." }
}

/** Positive integer validation for limit fields (must be > 0). */
function readPositiveInt(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} trebuie să fie un număr întreg pozitiv.`)
  }
  return n
}

/** Non-negative money validation for price fields (must be >= 0). */
function readNonNegativeNumber(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} nu poate fi negativ.`)
  }
  return n
}

export async function updatePlanTier(
  tierId: number,
  data: PlanTierUpdate
): Promise<ActionResult> {
  try {
    await assertSuperAdminActor()
    const adminSupabase = getAdminServiceClient()

    if (!Number.isFinite(tierId) || tierId <= 0) {
      return { error: "Tier invalid." }
    }

    const update: Record<string, number | boolean> = {}
    const maxAdmini = readPositiveInt(data.max_admini, "Numărul de admini")
    if (maxAdmini !== undefined) update.max_admini = maxAdmini
    const maxUseri = readPositiveInt(data.max_useri, "Numărul de useri")
    if (maxUseri !== undefined) update.max_useri = maxUseri
    const maxExamene = readPositiveInt(data.max_examene, "Numărul de examene")
    if (maxExamene !== undefined) update.max_examene = maxExamene
    const tokeni = readPositiveInt(data.tokeni_lunari, "Tokenii lunari")
    if (tokeni !== undefined) update.tokeni_lunari = tokeni
    const pretLuna = readNonNegativeNumber(data.pret_luna, "Prețul lunar")
    if (pretLuna !== undefined) update.pret_luna = pretLuna
    const pretAn = readNonNegativeNumber(data.pret_an, "Prețul anual")
    if (pretAn !== undefined) update.pret_an = pretAn
    if (data.este_activ !== undefined) update.este_activ = Boolean(data.este_activ)

    if (Object.keys(update).length === 0) {
      return { error: "Nu există modificări de salvat." }
    }

    const { error } = await adminSupabase.from("plan_tiers").update(update).eq("id", tierId)
    if (error) return { error: error.message }

    revalidatePath("/admin/tiers")
    return { error: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateOrgTier(orgId: string, tierId: number): Promise<ActionResult> {
  try {
    await assertSuperAdminActor()
    const adminSupabase = getAdminServiceClient()

    const id = String(orgId ?? "")
    if (!id) return { error: "ID-ul organizației lipsește." }
    if (!Number.isFinite(tierId) || tierId <= 0) return { error: "Tier invalid." }

    const { data: org, error: orgError } = await adminSupabase
      .from("organizatii")
      .select("is_managed_manually")
      .eq("id", id)
      .maybeSingle()
    if (orgError) return { error: orgError.message }
    if (!org) return { error: "Organizația nu există." }

    const update: Record<string, unknown> = { tier_id: tierId }

    // Organizations still governed by the tier system inherit the tier's
    // limits immediately. Manually managed orgs keep their custom overrides.
    if (!org.is_managed_manually) {
      const { data: tier, error: tierError } = await adminSupabase
        .from("plan_tiers")
        .select("max_admini, max_useri, max_examene, tokeni_lunari")
        .eq("id", tierId)
        .maybeSingle()
      if (tierError) return { error: tierError.message }
      if (!tier) return { error: "Tier-ul selectat nu există." }
      update.max_admini = tier.max_admini
      update.max_useri = tier.max_useri
      update.max_examene = tier.max_examene
      update.tokeni_lunari = tier.tokeni_lunari
    }

    const { error } = await adminSupabase.from("organizatii").update(update).eq("id", id)
    if (error) return { error: error.message }

    revalidatePath("/admin/tiers")
    return { error: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateOrgStatus(
  orgId: string,
  status: OrgSubscriptionStatus
): Promise<ActionResult> {
  try {
    await assertSuperAdminActor()
    const adminSupabase = getAdminServiceClient()

    const id = String(orgId ?? "")
    if (!id) return { error: "ID-ul organizației lipsește." }
    if (!ORG_SUBSCRIPTION_STATUSES.includes(status)) {
      return { error: "Status invalid." }
    }

    const { data: org, error: orgError } = await adminSupabase
      .from("organizatii")
      .select("past_due_at, suspended_at")
      .eq("id", id)
      .maybeSingle()
    if (orgError) return { error: orgError.message }
    if (!org) return { error: "Organizația nu există." }

    const nowIso = new Date().toISOString()
    const update: Record<string, unknown> = { subscription_status: status }

    if (status === "past_due" && !org.past_due_at) {
      update.past_due_at = nowIso
    } else if (status === "suspended" && !org.suspended_at) {
      update.suspended_at = nowIso
    } else if (status === "active") {
      update.past_due_at = null
      update.suspended_at = null
    }

    const { error } = await adminSupabase.from("organizatii").update(update).eq("id", id)
    if (error) return { error: error.message }

    revalidatePath("/admin/tiers")
    return { error: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateOrgLimits(
  orgId: string,
  data: OrgLimitsUpdate
): Promise<ActionResult> {
  try {
    await assertSuperAdminActor()
    const adminSupabase = getAdminServiceClient()

    const id = String(orgId ?? "")
    if (!id) return { error: "ID-ul organizației lipsește." }

    const { data: org, error: orgError } = await adminSupabase
      .from("organizatii")
      .select("is_managed_manually")
      .eq("id", id)
      .maybeSingle()
    if (orgError) return { error: orgError.message }
    if (!org) return { error: "Organizația nu există." }
    if (!org.is_managed_manually) {
      return { error: "Organizația nu e în mod manual." }
    }

    const update: Record<string, number | boolean> = {}
    const maxAdmini = readPositiveInt(data.max_admini, "Numărul de admini")
    if (maxAdmini !== undefined) update.max_admini = maxAdmini
    const maxUseri = readPositiveInt(data.max_useri, "Numărul de useri")
    if (maxUseri !== undefined) update.max_useri = maxUseri
    const maxExamene = readPositiveInt(data.max_examene, "Numărul de examene")
    if (maxExamene !== undefined) update.max_examene = maxExamene
    const tokeni = readPositiveInt(data.tokeni_lunari, "Tokenii lunari")
    if (tokeni !== undefined) update.tokeni_lunari = tokeni
    if (data.ai_import_enabled !== undefined) {
      update.ai_import_enabled = Boolean(data.ai_import_enabled)
    }

    if (Object.keys(update).length === 0) {
      return { error: "Nu există modificări de salvat." }
    }

    const { error } = await adminSupabase.from("organizatii").update(update).eq("id", id)
    if (error) return { error: error.message }

    revalidatePath("/admin/tiers")
    return { error: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateOrgAiImport(
  orgId: string,
  enabled: boolean
): Promise<ActionResult> {
  try {
    await assertSuperAdminActor()
    const adminSupabase = getAdminServiceClient()

    const id = String(orgId ?? "")
    if (!id) return { error: "ID-ul organizației lipsește." }

    const { error } = await adminSupabase
      .from("organizatii")
      .update({ ai_import_enabled: Boolean(enabled) })
      .eq("id", id)
    if (error) return { error: error.message }

    revalidatePath("/admin/tiers")
    return { error: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateOrgManualMode(
  orgId: string,
  isManual: boolean
): Promise<ActionResult> {
  try {
    await assertSuperAdminActor()
    const adminSupabase = getAdminServiceClient()

    const id = String(orgId ?? "")
    if (!id) return { error: "ID-ul organizației lipsește." }

    const update: Record<string, unknown> = { is_managed_manually: Boolean(isManual) }

    // Returning to tier-managed mode wipes any manual overrides by re-applying
    // the current tier's limits. Orgs without a tier keep their existing values.
    if (!isManual) {
      const { data: org, error: orgError } = await adminSupabase
        .from("organizatii")
        .select("tier_id")
        .eq("id", id)
        .maybeSingle()
      if (orgError) return { error: orgError.message }
      if (!org) return { error: "Organizația nu există." }

      if (org.tier_id != null) {
        const { data: tier, error: tierError } = await adminSupabase
          .from("plan_tiers")
          .select("max_admini, max_useri, max_examene, tokeni_lunari")
          .eq("id", org.tier_id)
          .maybeSingle()
        if (tierError) return { error: tierError.message }
        if (tier) {
          update.max_admini = tier.max_admini
          update.max_useri = tier.max_useri
          update.max_examene = tier.max_examene
          update.tokeni_lunari = tier.tokeni_lunari
        }
      }
    }

    const { error } = await adminSupabase.from("organizatii").update(update).eq("id", id)
    if (error) return { error: error.message }

    revalidatePath("/admin/tiers")
    return { error: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function resetOrgTokens(orgId: string): Promise<ActionResult> {
  try {
    await assertSuperAdminActor()
    const adminSupabase = getAdminServiceClient()

    const id = String(orgId ?? "")
    if (!id) return { error: "ID-ul organizației lipsește." }

    const { error } = await adminSupabase
      .from("organizatii")
      .update({ tokeni_consumati_luna: 0 })
      .eq("id", id)
    if (error) return { error: error.message }

    revalidatePath("/admin/tiers")
    return { error: null }
  } catch (error) {
    return toActionError(error)
  }
}
