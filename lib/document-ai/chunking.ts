import { CHUNK_OVERLAP_PAGES, CHUNK_SIZE_PAGES } from "@/lib/document-ai/types"

export type Chunk = { start: number; end: number }

/**
 * Împarte documentul în blocuri de `CHUNK_SIZE_PAGES` pagini noi, fiecare bloc
 * (mai puțin primul) fiind extins înapoi cu `CHUNK_OVERLAP_PAGES` pagini. Overlap-ul
 * dă modelului contextul necesar pentru întrebările tăiate la granița dintre pagini.
 *
 * 78 de pagini → [1-18], [18-36], [36-54], [54-72], [72-78]
 */
export function calculeazaChunkuri(totalPagini: number): Chunk[] {
  if (!Number.isFinite(totalPagini) || totalPagini < 1) return []

  const total = Math.floor(totalPagini)
  const chunkuri: Chunk[] = []

  for (let blocStart = 1; blocStart <= total; blocStart += CHUNK_SIZE_PAGES) {
    const blocEnd = Math.min(blocStart + CHUNK_SIZE_PAGES - 1, total)
    const start = blocStart === 1 ? 1 : Math.max(1, blocStart - CHUNK_OVERLAP_PAGES)
    chunkuri.push({ start, end: blocEnd })
  }

  return chunkuri
}

/**
 * Numărul total de pagini trimise către model, suprapunerile incluse. Baza
 * estimării de cost, pentru că paginile de overlap sunt facturate de două ori.
 */
export function numaraPaginiTrimise(totalPagini: number): number {
  return calculeazaChunkuri(totalPagini).reduce(
    (suma, chunk) => suma + (chunk.end - chunk.start + 1),
    0
  )
}

/**
 * Elimină întrebările apărute de două ori din cauza overlap-ului dintre chunk-uri.
 * Deduplicarea finală, față de baza de date, o face RPC-ul `preview_intrebari_dedup`;
 * aceasta e doar curățarea locală a preview-ului.
 */
export function cheieDeduplicareLocala(intrebare: string, variante: string[]): string {
  const normalizeaza = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase()
  return [normalizeaza(intrebare), ...variante.map(normalizeaza).sort()].join("||")
}
