import {
  MAX_QUIZ_VARIANTS,
  MIN_QUIZ_VARIANTS,
  OPTION_IDS,
} from "@/lib/quiz/types"

export type ParsedExamQuestion = {
  intrebare_text: string
  /** Ordered variant texts (2..10). */
  variante: string[]
  /** Lower-case option ids whose Excel cell was filled. */
  raspunsuri_corecte: string[]
  /** First three variants mirrored into legacy columns for backwards
   *  compatibility with code paths that still read `varianta_a/b/c`. */
  varianta_a: string
  varianta_b: string
  varianta_c: string
  /** First correct answer mirrored into the legacy single-letter column. */
  raspuns_corect: string
}

export type ParseExamResult = {
  questions: ParsedExamQuestion[]
  skippedRows: number
}

function cellValueToText(value: unknown) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Date) return value.toISOString()

  if (typeof value === "object") {
    const asRecord = value as Record<string, unknown>
    if (Array.isArray(asRecord.richText)) {
      return asRecord.richText
        .map((part) => {
          if (part && typeof part === "object" && "text" in (part as Record<string, unknown>)) {
            return String((part as Record<string, unknown>).text ?? "")
          }
          return ""
        })
        .join("")
    }
    if (asRecord.text != null) return String(asRecord.text)
    if (asRecord.result != null) return String(asRecord.result)
    if (asRecord.hyperlink != null && asRecord.text != null) return String(asRecord.text)
  }

  return String(value)
}

export function normalizeText(value: unknown) {
  return cellValueToText(value).replace(/\s+/g, " ").trim()
}

export function parseExamJson(jsonString: string): ParseExamResult {
  let raw: unknown
  try {
    raw = JSON.parse(jsonString)
  } catch {
    throw new Error("JSON invalid. Verifică formatul fișierului.")
  }

  const asRecord = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
  if (!asRecord || !Array.isArray(asRecord.questions)) {
    throw new Error('JSON-ul trebuie să conțină un câmp "questions" de tip array.')
  }

  const questions: ParsedExamQuestion[] = []
  let skippedRows = 0

  for (const item of asRecord.questions as unknown[]) {
    if (!item || typeof item !== "object") {
      skippedRows++
      continue
    }
    const q = item as Record<string, unknown>

    const intrebare_text = typeof q.question === "string" ? q.question.replace(/\s+/g, " ").trim() : ""
    if (!intrebare_text) {
      skippedRows++
      continue
    }

    const variante = Array.isArray(q.answers)
      ? (q.answers as unknown[]).map((a) => String(a ?? "").replace(/\s+/g, " ").trim())
      : []

    if (
      variante.length < MIN_QUIZ_VARIANTS ||
      variante.length > MAX_QUIZ_VARIANTS ||
      variante.some((v) => !v)
    ) {
      skippedRows++
      continue
    }

    const correctRaw = Array.isArray(q.correct) ? (q.correct as unknown[]) : []
    const raspunsuri_corecte = correctRaw
      .map((c) => Number(c))
      .filter((c) => Number.isFinite(c) && c >= 1 && c <= variante.length)
      .map((c) => OPTION_IDS[c - 1])

    if (raspunsuri_corecte.length === 0) {
      skippedRows++
      continue
    }

    questions.push({
      intrebare_text,
      variante,
      raspunsuri_corecte,
      varianta_a: variante[0] ?? "",
      varianta_b: variante[1] ?? "",
      varianta_c: variante[2] ?? "",
      raspuns_corect: raspunsuri_corecte[0],
    })
  }

  return { questions, skippedRows }
}

export function parsePlainTextToQuestions(text: string): {
  questions: Array<{
    question: string
    answers: string[]
    correct: number[]
  }>
} {
  const questions: Array<{ question: string; answers: string[]; correct: number[] }> = []

  // Split by numbered question patterns: "1.", "1)", "Q1.", etc.
  const blocks = text
    .split(/\n(?=\s*\d+[\.\)]|\s*[Qq]\d+[\.\)])/)
    .map((b) => b.trim())
    .filter(Boolean)

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue

    // First line is the question (remove leading number)
    const questionLine = lines[0].replace(/^\s*\d+[\.\)]\s*/, "").trim()
    if (!questionLine) continue

    const answers: string[] = []
    const correct: number[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      // Match: a) text *, a) text ✓, * a) text, etc.
      const match =
        line.match(/^[a-zA-Z\*\-]\s*[\.\)]\s*(.+)/) ??
        line.match(/^[\-\*\•]\s+(.+)/)
      if (!match) continue

      let answerText = match[1].trim()
      const isCorrect = /[\*✓✔]/.test(answerText) || /[\*✓✔]/.test(line.slice(0, 3))

      // Remove the correct marker from the answer text
      answerText = answerText.replace(/\s*[\*✓✔]\s*$/, "").trim()

      answers.push(answerText)
      if (isCorrect) {
        correct.push(answers.length) // 1-based index
      }
    }

    if (answers.length >= 2 && correct.length >= 1) {
      questions.push({ question: questionLine, answers, correct })
    }
  }

  return { questions }
}
