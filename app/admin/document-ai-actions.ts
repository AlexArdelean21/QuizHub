"use server"

import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"

import { AdminAccessError, requireAdminContext } from "@/lib/auth/admin-context"
import { extractChunkFromClaude } from "@/lib/document-ai/claude-extraction"
import { calculeazaChunkuri, numaraPaginiTrimise } from "@/lib/document-ai/chunking"
import {
  extrageContinutChunk,
  parseazaDocument,
  DocumentParseError,
} from "@/lib/document-ai/document-parser"
import { calculeazaCreditX100, estimeazaCostX100 } from "@/lib/document-ai/pricing"
import {
  esteModExtractie,
  esteNivelModel,
  necesitaVerificare,
  MAX_FILE_SIZE_MB,
  MAX_NEGATIVE_CREDITE_X100,
  MAX_PAGES_PER_DOCUMENT,
  type IntrebareExtrasa,
  type ModExtractie,
  type NivelModel,
  type RezultatAnulare,
  type RezultatCreareSesiune,
  type RezultatFinalizare,
  type RezultatProcesareChunk,
  type RezultatUploadUrl,
  type StareCredite,
} from "@/lib/document-ai/types"
import { OPTION_IDS } from "@/lib/quiz/types"
import { createSupabaseAdminClient } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const BUCKET = "document-ai-uploads"

/**
 * Mesaj unic pentru „sesiunea nu există" și „sesiunea nu-ți aparține", ca să nu
 * se poată deduce existența sesiunilor altor organizații.
 */
const EROARE_SESIUNE = "Sesiunea de import nu a fost găsită."
const EROARE_GENERICA = "A apărut o eroare neașteptată."

class DocumentAiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DocumentAiError"
  }
}

function toEroare(error: unknown): string {
  if (error instanceof DocumentAiError) return error.message
  if (error instanceof AdminAccessError) return error.message
  if (error instanceof DocumentParseError) return error.message
  // Erorile necunoscute pot conține fragmente din document sau detalii de infrastructură.
  return EROARE_GENERICA
}

type ContextImport = {
  userId: string
  orgId: string
}

/**
 * Importul Document AI e rezervat rolului `org_admin`: operațiile de Storage merg
 * prin clientul actorului, iar politicile bucket-ului sunt scrise pentru acest rol.
 */
async function cereOrgAdmin(): Promise<ContextImport> {
  const context = await requireAdminContext()

  if (!context.isOrgAdmin || !context.orgId) {
    throw new DocumentAiError("Doar administratorii de organizație pot folosi importul AI.")
  }

  return { userId: context.userId, orgId: context.orgId }
}

async function cereImportActivat(
  admin: SupabaseClient,
  orgId: string
): Promise<void> {
  const { data, error } = await admin
    .from("organizatii")
    .select("ai_import_enabled, subscription_status")
    .eq("id", orgId)
    .maybeSingle()

  if (error || !data) {
    throw new DocumentAiError("Organizația nu a putut fi verificată.")
  }
  if (!data.ai_import_enabled) {
    throw new DocumentAiError(
      "Importul AI din documente nu este activat pentru organizația ta."
    )
  }
  if (data.subscription_status === "suspended") {
    throw new DocumentAiError("Abonamentul organizației este suspendat.")
  }
}

/** Crearea unui examen prin Document AI respectă aceeași limită de plan ca fluxul clasic. */
async function cereLimitaExamene(admin: SupabaseClient, orgId: string): Promise<void> {
  const { data, error } = await admin.rpc("check_org_limits", {
    p_org_id: orgId,
    p_resource: "examene",
  })

  if (error) {
    throw new DocumentAiError("Limita de examene nu a putut fi verificată.")
  }

  const rezultat = data as {
    allowed: boolean
    max?: number
    managed_manually?: boolean
  }

  if (rezultat.managed_manually) return
  if (!rezultat.allowed) {
    throw new DocumentAiError(
      `Ai atins limita de ${rezultat.max ?? 0} examene a planului curent.`
    )
  }
}

async function crediteDisponibileX100(
  admin: SupabaseClient,
  orgId: string
): Promise<number> {
  const { data, error } = await admin.rpc("get_credite_disponibile_x100", {
    p_org_id: orgId,
  })

  if (error) {
    throw new DocumentAiError("Soldul de credite nu a putut fi citit.")
  }
  return Number(data ?? 0)
}

type SesiuneImport = {
  id: string
  org_id: string
  nume_fisier: string
  numar_pagini: number
  nivel_model: NivelModel
  mod_extractie: ModExtractie
  status: string
  credite_consumate_x100: number
}

async function incarcaSesiune(
  admin: SupabaseClient,
  sessionId: string,
  orgId: string,
  statusuriPermise: readonly string[] = ["in_progres"]
): Promise<SesiuneImport> {
  const { data, error } = await admin
    .from("document_ai_sesiuni_import")
    .select(
      "id, org_id, nume_fisier, numar_pagini, nivel_model, mod_extractie, status, credite_consumate_x100"
    )
    .eq("id", sessionId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (error || !data) {
    throw new DocumentAiError(EROARE_SESIUNE)
  }
  if (!statusuriPermise.includes(data.status)) {
    throw new DocumentAiError("Sesiunea de import nu mai este activă.")
  }

  return data as SesiuneImport
}

/** Numele de fișier ajunge într-un path de Storage; nu poate conține separatoare. */
function curataNumeFisier(nume: string): string {
  const curatat = nume
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-120)
  return curatat || "document"
}

function esteUuid(valoare: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valoare)
}

// ---------------------------------------------------------------------------
// 6.1 Verificare limite + creare sesiune
// ---------------------------------------------------------------------------

export async function verificaSiCreazaSesiune(params: {
  numeFisier: string
  numarPagini: number
  nivelModel: NivelModel
  modExtractie: ModExtractie
}): Promise<RezultatCreareSesiune> {
  try {
    const { userId, orgId } = await cereOrgAdmin()
    const admin = createSupabaseAdminClient()
    await cereImportActivat(admin, orgId)

    const numeFisier = curataNumeFisier(String(params.numeFisier ?? "").trim())
    const numarPagini = Number(params.numarPagini)

    if (!Number.isInteger(numarPagini) || numarPagini < 1) {
      throw new DocumentAiError("Numărul de pagini este invalid.")
    }
    if (numarPagini > MAX_PAGES_PER_DOCUMENT) {
      throw new DocumentAiError(
        `Documentul are ${numarPagini} pagini, iar limita este de ${MAX_PAGES_PER_DOCUMENT}.`
      )
    }
    if (!esteNivelModel(params.nivelModel)) {
      throw new DocumentAiError("Nivelul de model selectat este invalid.")
    }
    if (!esteModExtractie(params.modExtractie)) {
      throw new DocumentAiError("Modul de extragere selectat este invalid.")
    }

    const { data: sesiuneActiva, error: eroareSesiune } = await admin
      .from("document_ai_sesiuni_import")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "in_progres")
      .limit(1)
      .maybeSingle()

    if (eroareSesiune) {
      throw new DocumentAiError("Sesiunile de import nu au putut fi verificate.")
    }
    if (sesiuneActiva) {
      throw new DocumentAiError(
        "Ai deja un import în curs. Finalizează-l sau anulează-l înainte de a începe altul."
      )
    }

    // Paginile de overlap se trimit de două ori, deci se și facturează de două ori.
    const costEstimatX100 = estimeazaCostX100(
      numaraPaginiTrimise(numarPagini),
      params.nivelModel
    )
    const disponibilX100 = await crediteDisponibileX100(admin, orgId)

    if (costEstimatX100 > disponibilX100) {
      throw new DocumentAiError(
        `Credite insuficiente: importul necesită aproximativ ${(costEstimatX100 / 100).toFixed(2)} credite, ` +
          `iar soldul tău este de ${(disponibilX100 / 100).toFixed(2)}.`
      )
    }

    const { data: sesiune, error: eroareCreare } = await admin
      .from("document_ai_sesiuni_import")
      .insert({
        org_id: orgId,
        user_id: userId,
        nume_fisier: numeFisier,
        numar_pagini: numarPagini,
        nivel_model: params.nivelModel,
        mod_extractie: params.modExtractie,
        status: "in_progres",
      })
      .select("id")
      .single()

    if (eroareCreare || !sesiune) {
      throw new DocumentAiError("Sesiunea de import nu a putut fi creată.")
    }

    return {
      success: true,
      sessionId: String(sesiune.id),
      costEstimatX100,
      crediteDisponibileX100: disponibilX100,
    }
  } catch (error) {
    return { success: false, eroare: toEroare(error) }
  }
}

// ---------------------------------------------------------------------------
// 6.2 URL semnat de upload
// ---------------------------------------------------------------------------

export async function getUploadUrlPentruSesiune(
  sessionId: string,
  filename: string
): Promise<RezultatUploadUrl> {
  try {
    const { orgId } = await cereOrgAdmin()

    if (!esteUuid(String(sessionId ?? ""))) {
      throw new DocumentAiError(EROARE_SESIUNE)
    }

    const admin = createSupabaseAdminClient()
    await cereImportActivat(admin, orgId)
    await incarcaSesiune(admin, sessionId, orgId)

    const path = `${orgId}/${sessionId}/${curataNumeFisier(String(filename ?? "").trim())}`

    // Clientul actorului: upload-ul rămâne sub politicile RLS ale bucket-ului.
    const actor = await createSupabaseServerClient()
    const { data, error } = await actor.storage.from(BUCKET).createSignedUploadUrl(path)

    if (error || !data) {
      throw new DocumentAiError("Linkul de încărcare nu a putut fi generat.")
    }

    return { success: true, uploadUrl: data.signedUrl, token: data.token, path: data.path }
  } catch (error) {
    return { success: false, eroare: toEroare(error) }
  }
}

// ---------------------------------------------------------------------------
// 6.3 Procesarea unui chunk
// ---------------------------------------------------------------------------

export async function proceseazaChunkDocument(params: {
  sessionId: string
  storagePath: string
  chunkStart: number
  chunkEnd: number
  nivelModel: NivelModel
  modExtractie: ModExtractie
}): Promise<RezultatProcesareChunk> {
  const gol = { intrebari: [] as IntrebareExtrasa[], costX100: 0, crediteRamaseX100: 0 }

  try {
    const { orgId } = await cereOrgAdmin()
    const admin = createSupabaseAdminClient()
    await cereImportActivat(admin, orgId)

    if (!esteUuid(String(params.sessionId ?? ""))) {
      throw new DocumentAiError(EROARE_SESIUNE)
    }
    const sesiune = await incarcaSesiune(admin, params.sessionId, orgId)

    // Nivelul și modul sunt fixate la crearea sesiunii; parametrii clientului nu
    // pot schimba modelul facturat.
    const nivelModel = sesiune.nivel_model
    const modExtractie = sesiune.mod_extractie

    const storagePath = String(params.storagePath ?? "")
    if (!storagePath.startsWith(`${orgId}/${params.sessionId}/`) || storagePath.includes("..")) {
      throw new DocumentAiError(EROARE_SESIUNE)
    }

    const chunkStart = Number(params.chunkStart)
    const chunkEnd = Number(params.chunkEnd)
    if (
      !Number.isInteger(chunkStart) ||
      !Number.isInteger(chunkEnd) ||
      chunkStart < 1 ||
      chunkEnd < chunkStart ||
      chunkEnd > sesiune.numar_pagini
    ) {
      throw new DocumentAiError("Intervalul de pagini cerut este invalid.")
    }

    const actor = await createSupabaseServerClient()
    const { data: fisier, error: eroareDescarcare } = await actor.storage
      .from(BUCKET)
      .download(storagePath)

    if (eroareDescarcare || !fisier) {
      throw new DocumentAiError("Documentul încărcat nu a putut fi citit.")
    }
    if (fisier.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      throw new DocumentAiError(`Documentul depășește limita de ${MAX_FILE_SIZE_MB} MB.`)
    }

    const buffer = Buffer.from(await fisier.arrayBuffer())
    const document = await parseazaDocument(buffer, fisier.type || "application/pdf")
    const continut = await extrageContinutChunk(document, chunkStart, chunkEnd)

    const pageNumbers: number[] = []
    for (let pagina = chunkStart; pagina <= Math.min(chunkEnd, document.totalPagini); pagina++) {
      pageNumbers.push(pagina)
    }

    const rezultat = await extractChunkFromClaude({
      nivelModel,
      modExtractie,
      continut,
      pageNumbers,
    })

    // Chunk-urile eșuate tehnic nu se taxează; apelantul le poate reîncerca.
    if (rezultat.eroare) {
      return {
        success: false,
        ...gol,
        crediteRamaseX100: await crediteDisponibileX100(admin, orgId),
        oprit: false,
        eroare: rezultat.eroare,
      }
    }

    // Extragere reușită tehnic, dar fără întrebări → nu se taxează.
    const costX100 =
      rezultat.intrebari.length === 0
        ? 0
        : calculeazaCreditX100(
            rezultat.input_tokens,
            rezultat.output_tokens,
            nivelModel,
            {
              cacheCreationTokens: rezultat.cache_creation_input_tokens,
              cacheReadTokens: rezultat.cache_read_input_tokens,
            }
          )

    const deVerificat = rezultat.intrebari.filter(necesitaVerificare).length

    const { data: consum, error: eroareConsum } = await admin.rpc("consuma_credite_import", {
      p_sesiune_id: params.sessionId,
      p_org_id: orgId,
      p_cost_x100: costX100,
      p_intrebari: rezultat.intrebari.length,
      p_intrebari_verificare: deVerificat,
      p_prag_negativ_x100: MAX_NEGATIVE_CREDITE_X100,
    })

    if (eroareConsum) {
      throw new DocumentAiError("Consumul de credite nu a putut fi înregistrat.")
    }

    const raspunsConsum = consum as {
      aplicat: boolean
      motiv: string | null
      credite_ramase_x100: number
    }

    if (!raspunsConsum.aplicat) {
      if (raspunsConsum.motiv === "credite_insuficiente") {
        const mesaj = `Credite insuficiente, import oprit la pagina ${chunkStart}.`
        // Fără `finalizat_la`: întrebările extrase până aici rămân importabile,
        // iar sesiunea se închide abia la finalizare sau la anulare.
        await admin
          .from("document_ai_sesiuni_import")
          .update({ status: "partial", eroare_mesaj: mesaj })
          .eq("id", params.sessionId)
          .eq("org_id", orgId)

        return {
          success: false,
          ...gol,
          crediteRamaseX100: raspunsConsum.credite_ramase_x100,
          oprit: true,
          eroare: mesaj,
        }
      }
      throw new DocumentAiError(EROARE_SESIUNE)
    }

    return {
      success: true,
      intrebari: rezultat.intrebari,
      costX100,
      crediteRamaseX100: raspunsConsum.credite_ramase_x100,
      oprit: false,
    }
  } catch (error) {
    return { success: false, ...gol, oprit: false, eroare: toEroare(error) }
  }
}

// ---------------------------------------------------------------------------
// 6.4 Finalizare import
// ---------------------------------------------------------------------------

export async function finalizeazaImport(params: {
  sessionId: string
  intrebariSelectate: IntrebareExtrasa[]
  /** Import într-un examen existent. Exclusiv cu `numeExamenNou`. */
  examenId?: string
  /** Creează examenul la finalizare. Exclusiv cu `examenId`. */
  numeExamenNou?: string
}): Promise<RezultatFinalizare> {
  try {
    const { orgId } = await cereOrgAdmin()
    const admin = createSupabaseAdminClient()
    await cereImportActivat(admin, orgId)

    if (!esteUuid(String(params.sessionId ?? ""))) {
      throw new DocumentAiError(EROARE_SESIUNE)
    }
    // `partial` e acceptat: o sesiune oprită de epuizarea creditelor păstrează
    // întrebările deja extrase și plătite, care trebuie să poată fi importate.
    const sesiune = await incarcaSesiune(admin, params.sessionId, orgId, [
      "in_progres",
      "partial",
    ])

    const examenIdBrut = String(params.examenId ?? "").trim()
    const numeExamenNou = String(params.numeExamenNou ?? "").trim()

    if (Boolean(examenIdBrut) === Boolean(numeExamenNou)) {
      throw new DocumentAiError(
        "Trebuie specificat fie un examen existent, fie un nume pentru examen nou."
      )
    }

    const selectate = Array.isArray(params.intrebariSelectate) ? params.intrebariSelectate : []
    if (selectate.length === 0) {
      throw new DocumentAiError("Nu ai selectat nicio întrebare pentru import.")
    }

    // Validarea rulează înaintea creării examenului: altfel un import respins ar
    // lăsa în urmă un examen gol.
    const valide: IntrebareExtrasa[] = []
    let numarFaraRaspuns = 0

    for (const intrebare of selectate) {
      const text = String(intrebare?.intrebare ?? "").replace(/\s+/g, " ").trim()
      const variante = Array.isArray(intrebare?.variante)
        ? intrebare.variante.map((v) => String(v ?? "").replace(/\s+/g, " ").trim())
        : []
      const corecte = Array.isArray(intrebare?.raspuns_corect)
        ? intrebare.raspuns_corect.filter(
            (i) => Number.isInteger(i) && i >= 0 && i < variante.length
          )
        : []

      if (!text || variante.length < 2 || variante.length > 10 || variante.some((v) => !v)) {
        numarFaraRaspuns++
        continue
      }
      if (corecte.length === 0) {
        numarFaraRaspuns++
        continue
      }

      valide.push({ ...intrebare, intrebare: text, variante, raspuns_corect: corecte })
    }

    if (valide.length === 0) {
      throw new DocumentAiError(
        "Nicio întrebare selectată nu are un răspuns corect stabilit."
      )
    }

    const actor = await createSupabaseServerClient()
    let examenId: number
    let examenCreatAcum = false

    if (examenIdBrut) {
      examenId = Number(examenIdBrut)
      if (!Number.isInteger(examenId) || examenId < 1) {
        throw new DocumentAiError("Examenul selectat este invalid.")
      }

      const { data: examen, error: eroareExamen } = await admin
        .from("examene")
        .select("id, org_id")
        .eq("id", examenId)
        .maybeSingle()

      if (eroareExamen || !examen || examen.org_id !== orgId) {
        throw new DocumentAiError("Examenul selectat nu a fost găsit.")
      }
    } else {
      await cereLimitaExamene(admin, orgId)

      const { data: examenCreat, error: eroareCreare } = await actor
        .from("examene")
        .insert({ nume_examen: numeExamenNou, org_id: orgId })
        .select("id")
        .single()

      if (eroareCreare || !examenCreat) {
        throw new DocumentAiError("Examenul nu a putut fi creat.")
      }

      examenId = Number(examenCreat.id)
      examenCreatAcum = true
    }

    let numarImportate = 0
    let numarDuplicate = 0

    try {
      const { data: dedup, error: eroareDedup } = await actor.rpc("preview_intrebari_dedup", {
        p_examen_id: examenId,
        p_candidates: valide.map((intrebare) => ({
          intrebare_text: intrebare.intrebare,
          variante: intrebare.variante,
        })),
      })

      if (eroareDedup) {
        throw new DocumentAiError("Verificarea duplicatelor a eșuat.")
      }

      const verdicte = (dedup ?? []) as {
        idx: number
        content_hash: string
        duplicate_in_db: boolean
        duplicate_in_batch: boolean
      }[]

      // RPC-ul marchează toate aparițiile unui duplicat din lot; păstrăm prima.
      const hashuriVazute = new Set<string>()
      const deInserat: IntrebareExtrasa[] = []

      for (const verdict of [...verdicte].sort((a, b) => a.idx - b.idx)) {
        const intrebare = valide[verdict.idx]
        if (!intrebare) continue

        if (verdict.duplicate_in_db || hashuriVazute.has(verdict.content_hash)) {
          numarDuplicate++
          continue
        }
        hashuriVazute.add(verdict.content_hash)
        deInserat.push(intrebare)
      }

      if (deInserat.length > 0) {
        const randuri = deInserat.map((intrebare) => ({
          examen_id: examenId,
          intrebare_text: intrebare.intrebare,
          variante: intrebare.variante,
          raspunsuri_corecte: intrebare.raspuns_corect.map((index) => OPTION_IDS[index]),
          varianta_a: intrebare.variante[0] ?? "",
          varianta_b: intrebare.variante[1] ?? "",
          varianta_c: intrebare.variante[2] ?? "",
          raspuns_corect: OPTION_IDS[intrebare.raspuns_corect[0]],
        }))

        const { data: inserate, error: eroareInserare } = await actor
          .from("intrebari")
          .upsert(randuri, { onConflict: "content_hash", ignoreDuplicates: true })
          .select("id")

        if (eroareInserare) {
          throw new DocumentAiError("Întrebările nu au putut fi salvate în examen.")
        }

        numarImportate = inserate?.length ?? 0
        numarDuplicate += deInserat.length - numarImportate
      }
    } catch (error) {
      // Nu lăsa în urmă un examen gol dacă importul a eșuat după crearea lui.
      if (examenCreatAcum) {
        await actor.from("examene").delete().eq("id", examenId)
      }
      throw error
    }

    // `partial` dacă procesarea s-a oprit devreme sau dacă s-au pierdut întrebări pe drum.
    const statusFinal =
      sesiune.status === "partial" || numarFaraRaspuns > 0 ? "partial" : "succes"

    await admin
      .from("document_ai_sesiuni_import")
      .update({ status: statusFinal, finalizat_la: new Date().toISOString() })
      .eq("id", params.sessionId)
      .eq("org_id", orgId)

    await stergeFisiereSesiune(admin, orgId, params.sessionId)

    revalidatePath("/admin")

    return { success: true, numarImportate, numarDuplicate, numarFaraRaspuns, examenId }
  } catch (error) {
    return { success: false, numarImportate: 0, eroare: toEroare(error) }
  }
}

// ---------------------------------------------------------------------------
// 6.5 Anulare import
// ---------------------------------------------------------------------------

export async function anuleazaImport(sessionId: string): Promise<RezultatAnulare> {
  try {
    const { orgId } = await cereOrgAdmin()

    if (!esteUuid(String(sessionId ?? ""))) {
      throw new DocumentAiError(EROARE_SESIUNE)
    }

    const admin = createSupabaseAdminClient()

    const { data, error } = await admin.rpc("anuleaza_sesiune_import", {
      p_sesiune_id: sessionId,
      p_org_id: orgId,
    })

    if (error) {
      throw new DocumentAiError("Importul nu a putut fi anulat.")
    }

    const raspuns = data as { gasit: boolean; restituit_x100: number }
    if (!raspuns.gasit) {
      throw new DocumentAiError(EROARE_SESIUNE)
    }

    await stergeFisiereSesiune(admin, orgId, sessionId)

    revalidatePath("/admin")

    return { success: true, crediteRestituiteX100: raspuns.restituit_x100 }
  } catch (error) {
    return { success: false, eroare: toEroare(error) }
  }
}

// ---------------------------------------------------------------------------
// Sold de credite, pentru afișare în UI
// ---------------------------------------------------------------------------

export async function getStareCredite(): Promise<StareCredite> {
  try {
    const { orgId } = await cereOrgAdmin()
    const admin = createSupabaseAdminClient()

    // Apelat înainte de citire: aplică resetul lunar restant.
    const disponibileX100 = await crediteDisponibileX100(admin, orgId)

    const { data, error } = await admin
      .from("organizatii")
      .select(
        "ai_import_enabled, credite_import_lunare, credite_import_consumate_x100, credite_import_acumulate_x100, credite_import_extra_x100, credite_import_reset_la"
      )
      .eq("id", orgId)
      .maybeSingle()

    if (error || !data) {
      throw new DocumentAiError("Soldul de credite nu a putut fi citit.")
    }

    return {
      success: true,
      aiImportEnabled: data.ai_import_enabled === true,
      disponibileX100,
      lunareX100: data.credite_import_lunare * 100,
      consumateX100: data.credite_import_consumate_x100,
      acumulateX100: data.credite_import_acumulate_x100,
      extraX100: data.credite_import_extra_x100,
      resetLa: data.credite_import_reset_la,
    }
  } catch (error) {
    return { success: false, eroare: toEroare(error) }
  }
}

/**
 * Sesiunea rămasă `in_progres` după ce un tab a fost închis în timpul procesării.
 * Fără ea, orice import nou e respins până rulează cronul de curățare, iar userul
 * nu are cum să iasă din blocaj din interfață.
 */
export async function getSesiuneActiva(): Promise<{
  success: boolean
  sesiune?: { id: string; numeFisier: string; creatLa: string; status: string }
  eroare?: string
}> {
  try {
    const { orgId } = await cereOrgAdmin()
    const admin = createSupabaseAdminClient()
    await cereImportActivat(admin, orgId)

    const { data, error } = await admin
      .from("document_ai_sesiuni_import")
      .select("id, nume_fisier, creat_la, status")
      .eq("org_id", orgId)
      .eq("status", "in_progres")
      .order("creat_la", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new DocumentAiError("Sesiunile de import nu au putut fi verificate.")
    }
    if (!data) return { success: true }

    return {
      success: true,
      sesiune: {
        id: String(data.id),
        numeFisier: String(data.nume_fisier ?? ""),
        creatLa: String(data.creat_la),
        status: String(data.status),
      },
    }
  } catch (error) {
    return { success: false, eroare: toEroare(error) }
  }
}

/** Planul de chunk-uri pentru un document, ca frontend-ul să știe câți pași are. */
export async function getPlanChunkuri(
  numarPagini: number
): Promise<{ success: boolean; chunkuri: { start: number; end: number }[]; eroare?: string }> {
  try {
    await cereOrgAdmin()

    const pagini = Number(numarPagini)
    if (!Number.isInteger(pagini) || pagini < 1 || pagini > MAX_PAGES_PER_DOCUMENT) {
      throw new DocumentAiError("Numărul de pagini este invalid.")
    }

    return { success: true, chunkuri: calculeazaChunkuri(pagini) }
  } catch (error) {
    return { success: false, chunkuri: [], eroare: toEroare(error) }
  }
}

// ---------------------------------------------------------------------------

async function stergeFisiereSesiune(
  admin: SupabaseClient,
  orgId: string,
  sessionId: string
): Promise<void> {
  const prefix = `${orgId}/${sessionId}`

  const { data: fisiere, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (error || !fisiere || fisiere.length === 0) return

  await admin.storage.from(BUCKET).remove(fisiere.map((fisier) => `${prefix}/${fisier.name}`))
}
