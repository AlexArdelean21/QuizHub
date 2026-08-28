export type NivelModel = "standard" | "precizie_ridicata" | "maxim"
export type ModExtractie = "mod_a" | "mod_b"
export type StatusSesiune = "in_progres" | "succes" | "partial" | "esuat" | "anulat"

export type NivelIncredere = "high" | "medium" | "low"
export type TaieturaPagina = "inceput" | "sfarsit"

export interface IntrebareExtrasa {
  /** Generat la extragere, pentru a urmări întrebarea în preview înainte de importul real. */
  id_temporar: string
  intrebare: string
  variante: string[]
  /** Indecși în `variante`; `[]` dacă răspunsul nu a putut fi determinat. */
  raspuns_corect: number[]
  confidence: NivelIncredere
  necesita_imagine_pentru_raspuns: boolean
  taietura_pagina: TaieturaPagina | null
  structura_neclara: boolean
  /** Numărul de pagină absolut din documentul original. */
  pagina_sursa: number
  /** Populat după merge, din extragerea mecanică a imaginilor embedded. */
  imagini_sugerate?: { path: string; url: string }[]
}

export interface RezultatChunk {
  intrebari: IntrebareExtrasa[]
  input_tokens: number
  output_tokens: number
  /** Tokeni scriși în cache-ul de prompt (tarifați cu 1.25x prețul de input). */
  cache_creation_input_tokens: number
  /** Tokeni citiți din cache-ul de prompt (tarifați cu 0.1x prețul de input). */
  cache_read_input_tokens: number
  eroare: string | null
}

export const MODEL_CONFIG: Record<NivelModel, { model: string; multiplier: number }> = {
  standard: { model: "claude-haiku-4-5-20251001", multiplier: 1 },
  precizie_ridicata: { model: "claude-sonnet-5", multiplier: 3 },
  maxim: { model: "claude-opus-5", multiplier: 5 },
}

export const CREDIT_COST_USD = 0.06
export const CHUNK_SIZE_PAGES = 18
export const CHUNK_OVERLAP_PAGES = 1
export const MAX_PAGES_PER_DOCUMENT = 80
export const MAX_FILE_SIZE_MB = 15
/** Descoperire maximă tolerată: -2 credite. */
export const MAX_NEGATIVE_CREDITE_X100 = -200

export const NIVELE_MODEL: readonly NivelModel[] = ["standard", "precizie_ridicata", "maxim"]
export const MODURI_EXTRACTIE: readonly ModExtractie[] = ["mod_a", "mod_b"]

export function esteNivelModel(value: unknown): value is NivelModel {
  return typeof value === "string" && (NIVELE_MODEL as readonly string[]).includes(value)
}

export function esteModExtractie(value: unknown): value is ModExtractie {
  return typeof value === "string" && (MODURI_EXTRACTIE as readonly string[]).includes(value)
}

/**
 * O întrebare are nevoie de verificare umană dacă răspunsul nu e sigur, dacă pare
 * tăiată la marginea paginii, dacă structura e ambiguă sau dacă depinde de o imagine.
 */
export function necesitaVerificare(intrebare: IntrebareExtrasa): boolean {
  return (
    intrebare.confidence !== "high" ||
    intrebare.structura_neclara ||
    intrebare.necesita_imagine_pentru_raspuns ||
    intrebare.taietura_pagina !== null ||
    intrebare.raspuns_corect.length === 0
  )
}

// --- Formele returnate de Server Actions -----------------------------------

export type RezultatCreareSesiune = {
  success: boolean
  sessionId?: string
  /** Estimare conservatoare afișată în UI înainte de procesare. */
  costEstimatX100?: number
  crediteDisponibileX100?: number
  eroare?: string
}

export type RezultatUploadUrl = {
  success: boolean
  uploadUrl?: string
  /** Necesar pentru `supabase.storage.from(...).uploadToSignedUrl(path, token, file)`. */
  token?: string
  path?: string
  eroare?: string
}

export type RezultatProcesareChunk = {
  success: boolean
  intrebari: IntrebareExtrasa[]
  /** Sutimile de credit facturate efectiv pentru acest chunk. */
  costX100: number
  crediteRamaseX100: number
  /** `true` când importul trebuie oprit complet (credite epuizate). */
  oprit: boolean
  eroare?: string
}

export type RezultatFinalizare = {
  success: boolean
  numarImportate: number
  numarDuplicate?: number
  numarFaraRaspuns?: number
  /** Examenul în care s-a importat; nou creat dacă s-a folosit `numeExamenNou`. */
  examenId?: number
  eroare?: string
}

export type RezultatAnulare = {
  success: boolean
  crediteRestituiteX100?: number
  eroare?: string
}

export type StareCredite = {
  success: boolean
  /** Widget-ul și butonul „Examen nou" se ascund singure când e `false`. */
  aiImportEnabled?: boolean
  disponibileX100?: number
  lunareX100?: number
  consumateX100?: number
  acumulateX100?: number
  extraX100?: number
  resetLa?: string | null
  eroare?: string
}

/** Tipuri MIME acceptate la upload. DOCX-ul e convertit în text înainte de trimitere. */
export const MIME_TYPES_ACCEPTATE = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const

export type MimeTypeAcceptat = (typeof MIME_TYPES_ACCEPTATE)[number]

export function esteMimeTypeAcceptat(value: string): value is MimeTypeAcceptat {
  return (MIME_TYPES_ACCEPTATE as readonly string[]).includes(value)
}
