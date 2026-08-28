import { CREDIT_COST_USD, type NivelModel } from "@/lib/document-ai/types"

/** Preț de listă Claude API, USD per milion de tokeni. */
const PRICING_PER_MTOK: Record<NivelModel, { input: number; output: number }> = {
  standard: { input: 1.0, output: 5.0 },
  precizie_ridicata: { input: 3.0, output: 15.0 },
  maxim: { input: 5.0, output: 25.0 },
}

/** Scrierea în cache-ul de prompt costă 1.25x prețul de input. */
const MULTIPLICATOR_SCRIERE_CACHE = 1.25
/** Citirea din cache-ul de prompt costă 0.1x prețul de input. */
const MULTIPLICATOR_CITIRE_CACHE = 0.1

/**
 * Costul real al unui apel, în sutimi de credit.
 *
 * Tokenii de cache sunt raportați de API separat de `input_tokens`; ignorarea lor
 * ar subevalua scrierile de cache și ar supraevalua citirile.
 */
export function calculeazaCreditX100(
  inputTokens: number,
  outputTokens: number,
  nivelModel: NivelModel,
  cache?: { cacheCreationTokens?: number; cacheReadTokens?: number }
): number {
  const { input, output } = PRICING_PER_MTOK[nivelModel]

  const cacheCreation = Math.max(cache?.cacheCreationTokens ?? 0, 0)
  const cacheRead = Math.max(cache?.cacheReadTokens ?? 0, 0)

  const costUsd =
    (Math.max(inputTokens, 0) / 1_000_000) * input +
    (cacheCreation / 1_000_000) * input * MULTIPLICATOR_SCRIERE_CACHE +
    (cacheRead / 1_000_000) * input * MULTIPLICATOR_CITIRE_CACHE +
    (Math.max(outputTokens, 0) / 1_000_000) * output

  return Math.round((costUsd / CREDIT_COST_USD) * 100)
}

/**
 * Consum mediu observat per pagină trimisă către model. O pagină PDF ajunge la
 * Claude ca imagine, deci inputul e dominat de dimensiunea paginii, nu de model.
 */
const TOKENI_INPUT_PER_PAGINA = 2_500
const TOKENI_OUTPUT_PER_PAGINA = 700

/** Marjă de siguranță aplicată estimării pre-upload. */
export const MARJA_SIGURANTA_ESTIMARE = 1.4

/**
 * Estimare conservatoare a costului unui import, în sutimi de credit.
 *
 * `paginiTrimise` trebuie să includă suprapunerea dintre chunk-uri: paginile de
 * overlap sunt facturate de două ori pentru că sunt trimise în două apeluri.
 */
export function estimeazaCostX100(paginiTrimise: number, nivelModel: NivelModel): number {
  const pagini = Math.max(paginiTrimise, 0)
  const brut = calculeazaCreditX100(
    pagini * TOKENI_INPUT_PER_PAGINA,
    pagini * TOKENI_OUTPUT_PER_PAGINA,
    nivelModel
  )
  return Math.ceil(brut * MARJA_SIGURANTA_ESTIMARE)
}

/** Sutimi de credit → text afișabil, ex. 137 → "1.37". */
export function formateazaCredite(x100: number): string {
  return (x100 / 100).toFixed(2)
}
