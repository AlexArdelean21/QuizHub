"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createSupabaseAdminClient } from "@/lib/supabase/admin"
import { MAX_QUIZ_VARIANTS, MIN_QUIZ_VARIANTS, OPTION_IDS } from "@/lib/quiz/types"
import {
  parseExamJson,
  type ParsedExamQuestion,
} from "@/lib/exams/parse"
import { parseExamWorkbook } from "@/lib/exams/parse-excel"

export type ActionResult = { success: true } | { success: false; error: string }
export type CreateExamResult =
  | { success: true; examId: number }
  | { success: false; error: string }
export type ImportResult =
  | {
      success: true
      inserted: number
      skipped: number
      /** Present only when the import shrank `intrebari_simulare` to fit the pool. */
      rulesAdjusted?: { intrebariSimulare: number; pragTrecere: number }
    }
  | { success: false; error: string }

export type PersonalExamRulesPayload = {
  prag_trecere: number
  intrebari_simulare: number
  durata_minute: number
}

export type PreviewRow = {
  idx: number
  intrebare_text: string
  variante: string[]
  raspunsuri_corecte: string[]
  duplicate_in_db: boolean
  duplicate_in_batch: boolean
}

export type PreviewSummary = {
  total: number
  new: number
  duplicate_in_db: number
  duplicate_in_batch: number
}

export type PreviewResult = {
  rows: PreviewRow[]
  summary: PreviewSummary
  skippedRows: number
}

/**
 * Row shape consumed by the personal question editor. Mirrors admin's
 * AdminQuestionRow field-for-field, but defined locally so the personal flow
 * never imports from app/admin/actions.ts.
 */
export type PersonalQuestionRow = {
  id: number
  intrebare_text: string
  variante: string[]
  raspunsuri_corecte: string[]
  image_url: string | null
}

export type UpdatePersonalQuestionPayload = {
  intrebare_text: string
  variante: string[]
  raspunsuri_corecte: string[]
  /** undefined = nu schimba, null = șterge imaginea, string = noua imagine. */
  image_url?: string | null
}

type DedupRpcRow = {
  idx: number
  content_hash: string
  duplicate_in_db: boolean
  duplicate_in_batch: boolean
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

const NOT_AUTHENTICATED = "Trebuie să fii autentificat."
const NO_ACCESS = "Nu ai acces la acest examen."
const NOT_FAVORITABLE = "Acest examen nu poate fi adăugat la favorite."

function toActionError(error: unknown): string {
  if (error instanceof Error) return error.message
  return "A apărut o eroare neașteptată."
}

/**
 * Authorization gate for every personal-exam write. All writes go through the
 * service-role client (RLS is being narrowed to SELECT only), so ownership is
 * enforced here — never trusting a client-supplied user/org id. The user id is
 * always re-derived from the server session.
 */
async function assertPersonalExamOwner(examId: number): Promise<{
  userId: string
  admin: AdminClient
}> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error(NOT_AUTHENTICATED)

  const admin = createSupabaseAdminClient()
  const { data: exam, error } = await admin
    .from("examene")
    .select("id, org_id, creator_user_id")
    .eq("id", examId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!exam) throw new Error("Examenul nu există.")

  // Same message for both cases so we never disclose that someone else's exam
  // exists.
  if (exam.org_id != null || String(exam.creator_user_id) !== user.id) {
    throw new Error(NO_ACCESS)
  }

  return { userId: user.id, admin }
}

/**
 * Ownership gate for a single question. Resolves the question's exam and reuses
 * the personal-exam ownership rule (org_id IS NULL + creator_user_id = user).
 * Used by every per-question write. Never trusts a client-supplied user id.
 */
async function assertOwnsQuestion(questionId: number): Promise<{
  userId: string
  admin: AdminClient
  examenId: number
}> {
  if (!Number.isFinite(questionId) || questionId <= 0) {
    throw new Error("ID-ul întrebării este invalid.")
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error(NOT_AUTHENTICATED)

  const admin = createSupabaseAdminClient()

  const { data: question, error: questionError } = await admin
    .from("intrebari")
    .select("examen_id")
    .eq("id", questionId)
    .maybeSingle()
  if (questionError) throw new Error(questionError.message)
  if (!question) throw new Error("Întrebarea nu există.")

  const examenId = Number(question.examen_id)
  const { data: exam, error: examError } = await admin
    .from("examene")
    .select("id, org_id, creator_user_id")
    .eq("id", examenId)
    .maybeSingle()
  if (examError) throw new Error(examError.message)

  // Same message for missing and unauthorized so we never disclose that a
  // question in someone else's exam exists.
  if (!exam || exam.org_id != null || String(exam.creator_user_id) !== user.id) {
    throw new Error("Nu ai acces la această întrebare.")
  }

  return { userId: user.id, admin, examenId }
}

/**
 * `variante` normalizer copied from admin (never imported from admin/actions).
 * Falls back to the legacy varianta_a/b/c columns when the JSONB array is
 * missing or unusable.
 */
function normalizeStoredVariante(
  raw: unknown,
  fallbackLegacy: { a?: string | null; b?: string | null; c?: string | null }
): string[] {
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

/** Correct-labels normalizer copied from admin (never imported from admin). */
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

/**
 * Shared insert path for JSON/Excel imports. Enforces the per-exam question cap
 * BEFORE any write, then relies on the DB trigger to compute `content_hash`
 * (used for `onConflict` dedup) — never computed in TypeScript.
 */
async function insertPersonalQuestions(
  admin: AdminClient,
  userId: string,
  examId: number,
  questions: ParsedExamQuestion[]
): Promise<ImportResult> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("max_intrebari_examen_personal")
    .eq("id", userId)
    .maybeSingle()
  if (profileError || !profile) {
    return { success: false, error: "Nu s-a putut verifica limita de întrebări." }
  }
  const plafon = Number(profile.max_intrebari_examen_personal ?? 0)

  const { count, error: countError } = await admin
    .from("intrebari")
    .select("id", { count: "exact", head: true })
    .eq("examen_id", examId)
  if (countError) {
    return { success: false, error: "Nu s-a putut verifica numărul de întrebări." }
  }
  const existing = count ?? 0

  // Check the cap before touching the table — never insert then roll back.
  if (existing + questions.length > plafon) {
    throw new Error(`Ai atins limita de ${plafon} întrebări pentru acest examen.`)
  }

  const rowsToInsert = questions.map((question) => ({
    examen_id: examId,
    ...question,
  }))

  const { data, error } = await admin
    .from("intrebari")
    .upsert(rowsToInsert, { onConflict: "content_hash", ignoreDuplicates: true })
    .select("id")
  if (error) throw new Error(error.message)

  const inserted = data?.length ?? 0
  const skipped = Math.max(0, questions.length - inserted)

  const rulesAdjusted = await adjustRulesToPool(admin, examId)

  revalidatePath("/my-exams")
  revalidatePath("/")
  return rulesAdjusted
    ? { success: true, inserted, skipped, rulesAdjusted }
    : { success: true, inserted, skipped }
}

/**
 * Personal-exams only: after an import, if `intrebari_simulare` now exceeds the
 * real question pool, lower it to the pool size and scale `prag_trecere`
 * proportionally (keeping the pass ratio). Returns the applied values when an
 * adjustment happened, otherwise null.
 */
async function adjustRulesToPool(
  admin: AdminClient,
  examId: number
): Promise<{ intrebariSimulare: number; pragTrecere: number } | null> {
  const { data: exam, error: examError } = await admin
    .from("examene")
    .select("intrebari_simulare, prag_trecere")
    .eq("id", examId)
    .maybeSingle()
  if (examError || !exam) return null

  const { count, error: countError } = await admin
    .from("intrebari")
    .select("id", { count: "exact", head: true })
    .eq("examen_id", examId)
  if (countError) return null

  const pool = count ?? 0
  const oldSimulare = Number(exam.intrebari_simulare ?? 0)
  const oldPrag = Number(exam.prag_trecere ?? 0)

  if (oldSimulare <= pool || pool <= 0 || oldSimulare <= 0) return null

  const newSimulare = pool
  const newPrag = Math.max(1, Math.round((pool * oldPrag) / oldSimulare))

  const { error } = await admin
    .from("examene")
    .update({ intrebari_simulare: newSimulare, prag_trecere: newPrag })
    .eq("id", examId)
  if (error) return null

  return { intrebariSimulare: newSimulare, pragTrecere: newPrag }
}

export async function createPersonalExam(data: {
  nume_examen: string
}): Promise<CreateExamResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const examName = data.nume_examen.trim()
  if (!examName) {
    return { success: false, error: "Numele examenului este obligatoriu." }
  }

  const admin = createSupabaseAdminClient()

  // Fetch the user's personal-exam cap.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("max_examene_personale")
    .eq("id", user.id)
    .maybeSingle()
  if (profileError || !profile) {
    return { success: false, error: "Nu s-a putut verifica limita de examene." }
  }
  const maxPersonal = Number(profile.max_examene_personale ?? 0)

  // Count existing personal exams (scoped by creator, org_id IS NULL) server-side.
  // Public exams are excluded because they are also org-less — they must not
  // consume the personal quota. Mirrors the `enforce_personal_exam_limit`
  // trigger; a mismatch here would reject the insert before the trigger runs.
  const { count, error: countError } = await admin
    .from("examene")
    .select("id", { count: "exact", head: true })
    .eq("creator_user_id", user.id)
    .is("org_id", null)
    .eq("is_public", false)
  if (countError) {
    return { success: false, error: "Nu s-a putut verifica numărul de examene." }
  }

  // Fail loudly before attempting the insert (don't rely on a DB constraint).
  if ((count ?? 0) >= maxPersonal) {
    return { success: false, error: "Ai atins limita de examene proprii" }
  }

  const { data: created, error: insertError } = await admin
    .from("examene")
    .insert({ nume_examen: examName, org_id: null, creator_user_id: user.id })
    .select("id")
    .single()
  if (insertError || !created) {
    return { success: false, error: insertError?.message ?? "Nu s-a putut crea examenul." }
  }

  revalidatePath("/my-exams")
  revalidatePath("/profile")
  revalidatePath("/")
  return { success: true, examId: Number(created.id) }
}

export async function renamePersonalExam(
  examId: number,
  numeExamen: string
): Promise<ActionResult> {
  try {
    const { admin } = await assertPersonalExamOwner(examId)

    const trimmed = numeExamen.trim()
    if (trimmed.length < 1 || trimmed.length > 120) {
      return {
        success: false,
        error: "Numele examenului trebuie să aibă între 1 și 120 de caractere.",
      }
    }

    const { error } = await admin
      .from("examene")
      .update({ nume_examen: trimmed })
      .eq("id", examId)
    if (error) return { success: false, error: error.message }

    revalidatePath("/my-exams")
    revalidatePath("/")
    return { success: true }
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

export async function deletePersonalExam(examId: number): Promise<ActionResult> {
  try {
    const { admin } = await assertPersonalExamOwner(examId)

    // A single DELETE on `examene`; the FK ON DELETE CASCADE removes the
    // exam's questions automatically — do not delete from `intrebari` manually.
    const { error } = await admin.from("examene").delete().eq("id", examId)
    if (error) return { success: false, error: error.message }

    revalidatePath("/my-exams")
    revalidatePath("/")
    return { success: true }
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

export async function updatePersonalExamRules(
  examId: number,
  payload: PersonalExamRulesPayload
): Promise<ActionResult> {
  try {
    const { admin } = await assertPersonalExamOwner(examId)

    // Mirrors the limits & messages from updateExamRules (app/admin/actions.ts).
    const pragTrecere = Math.max(1, Math.floor(Number(payload.prag_trecere)))
    if (!Number.isFinite(pragTrecere)) {
      return { success: false, error: "Prag de trecere invalid." }
    }
    const intrebariSimulare = Math.max(1, Math.floor(Number(payload.intrebari_simulare)))
    if (!Number.isFinite(intrebariSimulare)) {
      return { success: false, error: "Număr de întrebări invalid." }
    }
    const durataMinute = Math.max(1, Math.floor(Number(payload.durata_minute)))
    if (!Number.isFinite(durataMinute)) {
      return { success: false, error: "Durata invalidă." }
    }

    // Extra checks the admin flow doesn't do: the simulation size can't exceed
    // the exam's real question pool, and the pass threshold can't exceed it.
    const { count, error: countError } = await admin
      .from("intrebari")
      .select("id", { count: "exact", head: true })
      .eq("examen_id", examId)
    if (countError) {
      return { success: false, error: "Nu s-a putut verifica numărul de întrebări." }
    }
    const questionCount = count ?? 0

    if (intrebariSimulare > questionCount) {
      return {
        success: false,
        error: "Numărul de întrebări din simulare nu poate depăși numărul de întrebări din examen.",
      }
    }
    if (pragTrecere > intrebariSimulare) {
      return {
        success: false,
        error: "Pragul de trecere nu poate depăși numărul de întrebări din simulare.",
      }
    }

    const { error } = await admin
      .from("examene")
      .update({
        prag_trecere: pragTrecere,
        intrebari_simulare: intrebariSimulare,
        durata_minute: durataMinute,
      })
      .eq("id", examId)
    if (error) return { success: false, error: error.message }

    revalidatePath("/my-exams")
    return { success: true }
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

export async function importPersonalExamFromJson(
  examId: number,
  jsonText: string
): Promise<ImportResult> {
  try {
    const { userId, admin } = await assertPersonalExamOwner(examId)

    const parsed = parseExamJson(jsonText)
    if (parsed.questions.length === 0) {
      return { success: false, error: "Nu am detectat întrebări valide în JSON-ul furnizat." }
    }

    return await insertPersonalQuestions(admin, userId, examId, parsed.questions)
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

/**
 * Excel preview for personal exams. Mirrors the shape of the admin preview
 * (rows + summary + skippedRows) so the client can reuse the same UI, but never
 * touches the admin action (which is gated by assertAdminActor).
 *
 * - With an `examId`: ownership is asserted and candidates are deduped against
 *   that exam's existing questions.
 * - Without an `examId` (create-time preview): the exam doesn't exist yet, so
 *   there is no DB dedup — rows come back as "Nou", with in-file duplicates
 *   still flagged by the RPC.
 */
export async function previewPersonalExcelImport(
  formData: FormData
): Promise<PreviewResult> {
  const rawExamId = formData.get("examId")
  let examId: number | null = null
  let admin: AdminClient

  if (typeof rawExamId === "string" && rawExamId.trim() !== "") {
    const parsedId = Number(rawExamId)
    if (!Number.isFinite(parsedId)) {
      throw new Error("Identificator de examen invalid.")
    }
    examId = parsedId
    const ownership = await assertPersonalExamOwner(examId)
    admin = ownership.admin
  } else {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error(NOT_AUTHENTICATED)
    admin = createSupabaseAdminClient()
  }

  const rawFile = formData.get("file")
  if (!(rawFile instanceof File)) {
    throw new Error("Fișierul Excel lipsește.")
  }
  const buffer = Buffer.from(await rawFile.arrayBuffer())
  const parsed = await parseExamWorkbook(buffer)

  const candidates = parsed.questions.map((question) => ({
    intrebare_text: question.intrebare_text,
    variante: question.variante,
  }))

  const { data, error } = await admin.rpc("preview_intrebari_dedup", {
    p_examen_id: examId,
    p_candidates: candidates,
  })
  if (error) throw new Error(error.message)

  const dedupByIndex = new Map<number, DedupRpcRow>()
  for (const row of (data ?? []) as DedupRpcRow[]) {
    dedupByIndex.set(Number(row.idx), {
      idx: Number(row.idx),
      content_hash: String(row.content_hash ?? ""),
      duplicate_in_db: Boolean(row.duplicate_in_db),
      duplicate_in_batch: Boolean(row.duplicate_in_batch),
    })
  }

  const rows: PreviewRow[] = parsed.questions.map((question, idx) => {
    const dedup = dedupByIndex.get(idx)
    return {
      idx,
      intrebare_text: question.intrebare_text,
      variante: [...question.variante],
      raspunsuri_corecte: [...question.raspunsuri_corecte],
      duplicate_in_db: dedup?.duplicate_in_db ?? false,
      duplicate_in_batch: dedup?.duplicate_in_batch ?? false,
    }
  })

  const duplicateInDb = rows.filter((row) => row.duplicate_in_db).length
  const duplicateInBatch = rows.filter((row) => row.duplicate_in_batch).length
  const fresh = rows.filter((row) => !row.duplicate_in_db && !row.duplicate_in_batch).length

  return {
    rows,
    summary: {
      total: rows.length,
      new: fresh,
      duplicate_in_db: duplicateInDb,
      duplicate_in_batch: duplicateInBatch,
    },
    skippedRows: parsed.skippedRows,
  }
}

export async function importPersonalExamFromExcel(
  examId: number,
  formData: FormData
): Promise<ImportResult> {
  try {
    const { userId, admin } = await assertPersonalExamOwner(examId)

    const rawFile = formData.get("file")
    if (!(rawFile instanceof File)) {
      return { success: false, error: "Fișierul Excel lipsește." }
    }
    const buffer = Buffer.from(await rawFile.arrayBuffer())
    const parsed = await parseExamWorkbook(buffer)
    if (parsed.questions.length === 0) {
      return { success: false, error: "Nu am detectat întrebări valide în fișierul selectat." }
    }

    return await insertPersonalQuestions(admin, userId, examId, parsed.questions)
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

export async function getPersonalExamQuestions(
  examId: number
): Promise<PersonalQuestionRow[]> {
  const { admin } = await assertPersonalExamOwner(examId)

  const { data, error } = await admin
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
    .filter((row): row is PersonalQuestionRow => row !== null)
}

export async function updatePersonalQuestion(
  questionId: number,
  data: UpdatePersonalQuestionPayload
): Promise<ActionResult> {
  try {
    const { admin } = await assertOwnsQuestion(questionId)

    const intrebareText = String(data.intrebare_text ?? "").trim()
    const variante = Array.isArray(data.variante)
      ? data.variante
          .map((value) => String(value ?? "").trim())
          .filter((value) => value.length > 0)
          .slice(0, MAX_QUIZ_VARIANTS)
      : []

    const hasImage =
      typeof data.image_url === "string" && data.image_url.trim().length > 0
    if ((!intrebareText && !hasImage) || variante.length < MIN_QUIZ_VARIANTS) {
      return {
        success: false,
        error: "Întrebarea trebuie să aibă text sau imagine și minim 2 variante completate.",
      }
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
      return { success: false, error: "Selectează cel puțin un răspuns corect." }
    }

    const update: Record<string, unknown> = {
      intrebare_text: intrebareText,
      variante,
      raspunsuri_corecte: raspunsuri,
      varianta_a: variante[0] ?? "",
      varianta_b: variante[1] ?? "",
      varianta_c: variante[2] ?? "",
      raspuns_corect: raspunsuri[0],
    }

    if (data.image_url !== undefined) {
      update.image_url = data.image_url
    }

    const { error } = await admin.from("intrebari").update(update).eq("id", questionId)
    if (error) {
      return { success: false, error: error.message }
    }

    revalidatePath("/my-exams")
    revalidatePath("/")
    return { success: true }
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

const ACCEPTED_QUESTION_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])
const MAX_QUESTION_IMAGE_BYTES = 5 * 1024 * 1024

export async function uploadPersonalQuestionImage(
  questionId: number,
  formData: FormData
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  try {
    const { admin, examenId } = await assertOwnsQuestion(questionId)

    const file = formData.get("file")
    if (!(file instanceof File)) {
      return { success: false, error: "Fișierul lipsește." }
    }

    if (file.size > MAX_QUESTION_IMAGE_BYTES) {
      return { success: false, error: "Imaginea depășește 5MB." }
    }
    if (!ACCEPTED_QUESTION_IMAGE_TYPES.has(file.type)) {
      return { success: false, error: "Format de imagine neacceptat." }
    }

    const ext = file.name.split(".").pop() ?? "jpg"
    const path = `${examenId}/${questionId}/${Date.now()}.${ext}`

    const { error: uploadError } = await admin.storage
      .from("question-images")
      .upload(path, file, { upsert: true })
    if (uploadError) {
      return { success: false, error: uploadError.message }
    }

    const { data: urlData } = admin.storage.from("question-images").getPublicUrl(path)
    return { success: true, url: urlData.publicUrl }
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

export async function deletePersonalQuestion(questionId: number): Promise<ActionResult> {
  try {
    const { admin, examenId } = await assertOwnsQuestion(questionId)

    const { error } = await admin.from("intrebari").delete().eq("id", questionId)
    if (error) {
      return { success: false, error: error.message }
    }

    await adjustRulesToPool(admin, examenId)

    revalidatePath("/my-exams")
    revalidatePath("/")
    return { success: true }
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}

/**
 * Adds/removes a public exam from the caller's favourites. Deliberately runs on
 * the user's session client, not the service role: the RLS policies on
 * `examene_favorite` are the authorization layer (the INSERT check already
 * rejects exams that aren't public), so the admin client would bypass the very
 * guard we rely on.
 */
export async function toggleFavoriteExam(
  examId: number,
  shouldFavorite: boolean
): Promise<ActionResult> {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: NOT_AUTHENTICATED }

    if (!Number.isFinite(examId) || examId <= 0) {
      return { success: false, error: "Identificator de examen invalid." }
    }

    if (shouldFavorite) {
      // Upsert instead of insert so a double click is idempotent rather than a
      // primary-key conflict.
      const { error } = await supabase.from("examene_favorite").upsert(
        { user_id: user.id, examen_id: examId },
        { onConflict: "user_id,examen_id", ignoreDuplicates: true }
      )
      // An error here is almost always the RLS check on a non-public exam;
      // answer with a generic message instead of leaking the DB error.
      if (error) return { success: false, error: NOT_FAVORITABLE }
    } else {
      const { error } = await supabase
        .from("examene_favorite")
        .delete()
        .eq("user_id", user.id)
        .eq("examen_id", examId)
      if (error) return { success: false, error: "Nu s-a putut elimina examenul din favorite." }
    }

    revalidatePath("/my-exams")
    revalidatePath("/")
    return { success: true }
  } catch (error) {
    return { success: false, error: toActionError(error) }
  }
}
