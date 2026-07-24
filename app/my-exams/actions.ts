"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createSupabaseAdminClient } from "@/lib/supabase/admin"
import { MAX_QUIZ_VARIANTS, MIN_QUIZ_VARIANTS } from "@/lib/quiz/types"
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
  variante_raspuns: number
  durata_minute: number
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

const NOT_AUTHENTICATED = "Trebuie să fii autentificat."
const NO_ACCESS = "Nu ai acces la acest examen."

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
  const { count, error: countError } = await admin
    .from("examene")
    .select("id", { count: "exact", head: true })
    .eq("creator_user_id", user.id)
    .is("org_id", null)
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
    const varianteRaspuns = Math.max(
      MIN_QUIZ_VARIANTS,
      Math.min(MAX_QUIZ_VARIANTS, Math.floor(Number(payload.variante_raspuns)))
    )
    if (!Number.isFinite(varianteRaspuns)) {
      return { success: false, error: "Număr de variante invalid." }
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
        variante_raspuns: varianteRaspuns,
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
