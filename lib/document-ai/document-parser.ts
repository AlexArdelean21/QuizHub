import "server-only"

import { PDFDocument } from "pdf-lib"

import {
  CARACTERE_PER_PAGINA_SINTETICA,
  MIME_DOCX,
  MIME_PDF,
  normalizeazaTextDocx,
  paginiSinteticePentruText,
} from "@/lib/document-ai/constants-shared"

export { CARACTERE_PER_PAGINA_SINTETICA, MIME_DOCX, MIME_PDF }

export type TipDocument = "pdf" | "imagini" | "text"

export type MediaTypeImagine = "image/png" | "image/jpeg" | "image/webp" | "image/gif"

export type ImagineExtrasa = {
  pagina: number
  buffer: Buffer
  filename: string
}

export type DocumentParsat = {
  tip: TipDocument
  totalPagini: number
  /** PDF-ul original, păstrat pentru tăierea chunk-urilor. `null` pentru celelalte tipuri. */
  pdf: Buffer | null
  /**
   * Câte un buffer per pagină, pentru documentele care sunt deja imagini.
   * Gol pentru PDF: paginile PDF se trimit nativ, fără rasterizare.
   */
  paginiCaImagini: Buffer[]
  mediaTypeImagini: MediaTypeImagine[]
  /** Textul integral, pentru DOCX. `null` altfel. */
  text: string | null
  /** Imaginile embedded, cu pagina pe care apar. */
  imaginiExtrase: ImagineExtrasa[]
}

/** Conținutul unui chunk, în forma în care se trimite către Claude. */
export type ContinutChunk =
  | { tip: "pdf"; pdf: Buffer }
  | { tip: "imagini"; imagini: { buffer: Buffer; mediaType: MediaTypeImagine }[] }
  | { tip: "text"; text: string }

const MEDIA_TYPES_IMAGINE: Record<string, MediaTypeImagine> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
}

export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DocumentParseError"
  }
}

export async function parseazaDocument(
  fileBuffer: Buffer,
  mimeType: string
): Promise<DocumentParsat> {
  const mime = mimeType.toLowerCase().split(";")[0].trim()

  if (mime === MIME_PDF) return parseazaPdf(fileBuffer)
  if (mime === MIME_DOCX) return parseazaDocx(fileBuffer)

  const mediaType = MEDIA_TYPES_IMAGINE[mime]
  if (mediaType) return parseazaImagine(fileBuffer, mediaType)

  throw new DocumentParseError(
    "Tip de fișier neacceptat. Acceptăm PDF, DOCX, PNG, JPEG, WEBP și GIF."
  )
}

async function parseazaPdf(fileBuffer: Buffer): Promise<DocumentParsat> {
  let pdfDoc: PDFDocument
  try {
    pdfDoc = await PDFDocument.load(fileBuffer)
  } catch {
    // Cauza uzuală e criptarea sau parola; ambele produc același mesaj pentru utilizator.
    throw new DocumentParseError(
      "PDF-ul nu a putut fi citit. Verifică dacă e protejat cu parolă sau deteriorat."
    )
  }

  const totalPagini = pdfDoc.getPageCount()
  if (totalPagini < 1) {
    throw new DocumentParseError("PDF-ul nu conține nicio pagină.")
  }

  return {
    tip: "pdf",
    totalPagini,
    pdf: fileBuffer,
    paginiCaImagini: [],
    mediaTypeImagini: [],
    text: null,
    // pdf-lib nu expune imaginile embedded; pentru PDF nu propunem imagini automat.
    imaginiExtrase: [],
  }
}

async function parseazaDocx(fileBuffer: Buffer): Promise<DocumentParsat> {
  const mammoth = await import("mammoth")

  let text: string
  try {
    const rezultat = await mammoth.extractRawText({ buffer: fileBuffer })
    text = normalizeazaTextDocx(rezultat.value)
  } catch {
    throw new DocumentParseError("Documentul DOCX nu a putut fi citit.")
  }

  if (!text) {
    throw new DocumentParseError("Documentul DOCX nu conține text.")
  }

  const totalPagini = paginiSinteticePentruText(text)

  return {
    tip: "text",
    totalPagini,
    pdf: null,
    paginiCaImagini: [],
    mediaTypeImagini: [],
    text,
    imaginiExtrase: await extrageImaginiDocx(fileBuffer, mammoth),
  }
}

type MammothModule = typeof import("mammoth")

async function extrageImaginiDocx(
  fileBuffer: Buffer,
  mammoth: MammothModule
): Promise<ImagineExtrasa[]> {
  const imagini: ImagineExtrasa[] = []

  try {
    await mammoth.convertToHtml(
      { buffer: fileBuffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const buffer = await image.read()
          const contentType = image.contentType ?? "image/png"
          const extensie = contentType.split("/")[1] ?? "png"
          imagini.push({
            // DOCX nu expune pagina reală; toate imaginile se atribuie primei pagini.
            pagina: 1,
            buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
            filename: `imagine-${imagini.length + 1}.${extensie}`,
          })
          return { src: "" }
        }),
      }
    )
  } catch {
    // Imaginile sunt opționale; textul rămâne utilizabil fără ele.
    return []
  }

  return imagini
}

function parseazaImagine(fileBuffer: Buffer, mediaType: MediaTypeImagine): DocumentParsat {
  return {
    tip: "imagini",
    totalPagini: 1,
    pdf: null,
    paginiCaImagini: [fileBuffer],
    mediaTypeImagini: [mediaType],
    text: null,
    imaginiExtrase: [{ pagina: 1, buffer: fileBuffer, filename: "pagina-1" }],
  }
}

/**
 * Combină mai multe fișiere imagine într-un singur document logic, fiecare imagine
 * devenind o pagină. Folosit când utilizatorul încarcă un set de poze.
 */
export function combinaImaginiCaDocument(
  imagini: { buffer: Buffer; mimeType: string }[]
): DocumentParsat {
  const buffere: Buffer[] = []
  const mediaTypes: MediaTypeImagine[] = []
  const extrase: ImagineExtrasa[] = []

  imagini.forEach((imagine, index) => {
    const mediaType = MEDIA_TYPES_IMAGINE[imagine.mimeType.toLowerCase()]
    if (!mediaType) {
      throw new DocumentParseError(`Imaginea ${index + 1} are un format neacceptat.`)
    }
    buffere.push(imagine.buffer)
    mediaTypes.push(mediaType)
    extrase.push({ pagina: index + 1, buffer: imagine.buffer, filename: `pagina-${index + 1}` })
  })

  if (buffere.length === 0) {
    throw new DocumentParseError("Nu a fost încărcată nicio imagine.")
  }

  return {
    tip: "imagini",
    totalPagini: buffere.length,
    pdf: null,
    paginiCaImagini: buffere,
    mediaTypeImagini: mediaTypes,
    text: null,
    imaginiExtrase: extrase,
  }
}

/**
 * Decupează paginile `start`..`end` (1-indexate, inclusiv) în forma trimisă modelului.
 * Pentru PDF produce un PDF nou care conține doar acele pagini.
 */
export async function extrageContinutChunk(
  document: DocumentParsat,
  start: number,
  end: number
): Promise<ContinutChunk> {
  const primaPagina = Math.max(1, Math.floor(start))
  const ultimaPagina = Math.min(document.totalPagini, Math.floor(end))

  if (ultimaPagina < primaPagina) {
    throw new DocumentParseError("Intervalul de pagini cerut este invalid.")
  }

  if (document.tip === "pdf") {
    if (!document.pdf) {
      throw new DocumentParseError("Documentul PDF nu mai este disponibil.")
    }
    return { tip: "pdf", pdf: await taiePdf(document.pdf, primaPagina, ultimaPagina) }
  }

  if (document.tip === "imagini") {
    const imagini = document.paginiCaImagini
      .slice(primaPagina - 1, ultimaPagina)
      .map((buffer, index) => ({
        buffer,
        mediaType: document.mediaTypeImagini[primaPagina - 1 + index] ?? "image/png",
      }))
    return { tip: "imagini", imagini }
  }

  const text = document.text ?? ""
  const de_la = (primaPagina - 1) * CARACTERE_PER_PAGINA_SINTETICA
  const pana_la = ultimaPagina * CARACTERE_PER_PAGINA_SINTETICA
  return { tip: "text", text: text.slice(de_la, pana_la) }
}

async function taiePdf(pdfBuffer: Buffer, start: number, end: number): Promise<Buffer> {
  const sursa = await PDFDocument.load(pdfBuffer)
  const destinatie = await PDFDocument.create()

  const indici: number[] = []
  for (let pagina = start; pagina <= end; pagina++) indici.push(pagina - 1)

  const paginiCopiate = await destinatie.copyPages(sursa, indici)
  for (const pagina of paginiCopiate) destinatie.addPage(pagina)

  return Buffer.from(await destinatie.save())
}
