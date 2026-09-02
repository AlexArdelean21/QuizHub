export const MAX_QUIZ_VARIANTS = 10
export const MIN_QUIZ_VARIANTS = 2

// "a" .. "j" (up to 10 variants per question).
export const OPTION_IDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const
export const OPTION_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const

export type AnswerId = (typeof OPTION_IDS)[number]

export type QuizOption = {
  id: AnswerId
  label: string
  text: string
}

export type QuizQuestion = {
  id: string
  examenId: number
  text: string
  options: QuizOption[]
  /** Sorted list of every correct option id for this question. */
  correctAnswers: AnswerId[]
  /** URL public imagine atașată întrebării. Null = fără imagine. */
  imageUrl?: string | null
}

/**
 * Row shape from `intrebari` as returned by Supabase. The legacy
 * `varianta_a/b/c` and `raspuns_corect` columns are kept for backwards
 * compatibility, but new code should rely on `variante` (jsonb array) and
 * `raspunsuri_corecte` (text[]) as the source of truth.
 */
export type IntrebareRow = {
  id: string | number
  examen_id?: number | null
  intrebare_text: string
  varianta_a?: string | null
  varianta_b?: string | null
  varianta_c?: string | null
  raspuns_corect?: string | null
  variante?: unknown
  raspunsuri_corecte?: unknown
  image_url?: string | null
}

export type PracticeSource = "all" | "bookmarked" | "wrong" | "new"

/**
 * Where an exam comes from: an organization (`examene.org_id IS NOT NULL`),
 * the user's own library, or the public catalogue (`examene.is_public`).
 */
export type ExamCategory = "org" | "personal" | "public"

export type ExamSummary = {
  id: number
  name: string
  pragTrecere: number
  intrebariSimulare: number
  /** Max number of variants admins can configure as a default in the rules. */
  varianteRaspuns: number
  durataMinute: number
  category: ExamCategory
  /**
   * @deprecated Use `category === "personal"`. Public exams also have
   * `org_id IS NULL`, so this flag can no longer distinguish them on its own.
   */
  isPersonal: boolean
}

/** Returns true when two answer-id sets are equivalent (order-independent). */
export function areAnswerSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const seen = new Set(a.map((id) => id.toLowerCase()))
  for (const id of b) {
    if (!seen.has(id.toLowerCase())) return false
  }
  return true
}
