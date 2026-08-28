import {
  MIME_DOCX,
  MIME_PDF,
  normalizeazaTextDocx,
  paginiSinteticePentruText,
} from "@/lib/document-ai/constants-shared"

/**
 * Numărul de pagini trebuie cunoscut înainte de upload, ca `verificaSiCreazaSesiune`
 * să poată verifica limita și estima costul. Valoarea trebuie să fie identică cu cea
 * calculată de server la procesare, altfel planul de chunk-uri nu se potrivește.
 *
 * PDF-ul e numărat cu `pdf-lib`, aceeași bibliotecă folosită de `document-parser.ts`,
 * ca cele două numărători să nu poată devia.
 */

export class PageCountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PageCountError"
  }
}

export function esteImagine(file: File): boolean {
  return file.type.toLowerCase().startsWith("image/")
}

export function esteDocument(file: File): boolean {
  const tip = file.type.toLowerCase()
  return tip === MIME_PDF || tip === MIME_DOCX
}

export async function numaraPaginiClient(files: File[]): Promise<number> {
  if (files.length === 0) {
    throw new PageCountError("Nu ai selectat niciun fișier.")
  }

  const imagini = files.filter(esteImagine)

  // Un set de imagini: fiecare imagine e o pagină, fără nicio parsare.
  if (imagini.length === files.length) {
    return files.length
  }

  if (files.length > 1) {
    throw new PageCountError(
      "Poți încărca fie un singur PDF sau DOCX, fie mai multe imagini — nu amestecate."
    )
  }

  const file = files[0]
  const tip = file.type.toLowerCase()

  if (tip === MIME_PDF) return numaraPaginiPdf(file)
  if (tip === MIME_DOCX) return numaraPaginiDocx(file)

  throw new PageCountError(
    "Tip de fișier neacceptat. Acceptăm PDF, DOCX, PNG și JPEG."
  )
}

async function numaraPaginiPdf(file: File): Promise<number> {
  const { PDFDocument } = await import("pdf-lib")

  try {
    const document = await PDFDocument.load(await file.arrayBuffer())
    const pagini = document.getPageCount()
    if (pagini < 1) {
      throw new PageCountError("PDF-ul nu conține nicio pagină.")
    }
    return pagini
  } catch (error) {
    if (error instanceof PageCountError) throw error
    throw new PageCountError(
      "PDF-ul nu a putut fi citit. Verifică dacă e protejat cu parolă sau deteriorat."
    )
  }
}

async function numaraPaginiDocx(file: File): Promise<number> {
  const modul = await import("mammoth/mammoth.browser")
  // Bundle CommonJS: în funcție de bundler ajunge fie ca export numit, fie sub `default`.
  const extractRawText = modul.extractRawText ?? modul.default?.extractRawText

  if (typeof extractRawText !== "function") {
    throw new PageCountError("Cititorul de DOCX nu a putut fi încărcat.")
  }

  let text: string
  try {
    const rezultat = await extractRawText({ arrayBuffer: await file.arrayBuffer() })
    text = normalizeazaTextDocx(rezultat.value)
  } catch {
    throw new PageCountError("Documentul DOCX nu a putut fi citit.")
  }

  if (!text) {
    throw new PageCountError("Documentul DOCX nu conține text.")
  }

  return paginiSinteticePentruText(text)
}
