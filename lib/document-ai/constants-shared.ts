/**
 * Constante folosite identic pe server și pe client.
 *
 * `document-parser.ts` are `import "server-only"`, deci nu poate fi importat din
 * componente client. Numărarea paginilor înainte de upload se face însă în browser
 * și trebuie să dea exact aceleași valori ca parsarea de pe server, altfel planul
 * de chunk-uri nu s-ar potrivi cu documentul.
 */

/** DOCX nu are pagini fixe: textul se împarte în „pagini" sintetice de mărime constantă. */
export const CARACTERE_PER_PAGINA_SINTETICA = 2_800

export const MIME_PDF = "application/pdf"
export const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/**
 * Normalizarea aplicată textului DOCX înainte de numărarea paginilor. Trebuie să
 * fie identică pe ambele capete: `extractRawText` → aceeași normalizare → aceeași
 * lungime → același număr de pagini.
 */
export function normalizeazaTextDocx(text: string): string {
  return text.replace(/\r\n/g, "\n").trim()
}

/** Numărul de pagini sintetice pentru un text DOCX deja normalizat. */
export function paginiSinteticePentruText(text: string): number {
  return Math.max(1, Math.ceil(text.length / CARACTERE_PER_PAGINA_SINTETICA))
}
