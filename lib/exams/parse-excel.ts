import ExcelJS from "exceljs"
import {
  MAX_QUIZ_VARIANTS,
  MIN_QUIZ_VARIANTS,
  OPTION_IDS,
} from "@/lib/quiz/types"
import {
  normalizeText,
  type ParsedExamQuestion,
  type ParseExamResult,
} from "@/lib/exams/parse"

// Column B in the import spreadsheet starts the answer variants. The sheet
// is allowed to have up to `MAX_QUIZ_VARIANTS` variant columns (B..K).
const MIN_VARIANT_COL = 2

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

export async function parseExamWorkbook(buffer: Buffer): Promise<ParseExamResult> {
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
