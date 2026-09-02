"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Play, Search, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toggleFavoriteExam } from "@/app/my-exams/actions"
import { inputClass, ruleBadge } from "@/components/my-exams/styles"

export type PublicExamItem = {
  id: number
  nume_examen: string
  categorie: string | null
  pragTrecere: number
  intrebariSimulare: number
  durataMinute: number
  isShowcase: boolean
  questionCount: number
  isFavorite: boolean
}

type BrowserMode = "favorites" | "explore"
type ToastState = { type: "success" | "error"; message: string } | null

const examCard =
  "flex h-full flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"

/** Lowercases and strips diacritics so "Legislație" matches "legislatie". */
function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

export function PublicExamsBrowser({
  exams,
  mode,
}: {
  exams: PublicExamItem[]
  mode: BrowserMode
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<ToastState>(null)
  const [search, setSearch] = useState("")
  // Optimistic favourite state, keyed by exam id. Server data is the default;
  // an entry here means the user clicked and we haven't reverted.
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const isFavorite = (exam: PublicExamItem): boolean =>
    favoriteOverrides[exam.id] ?? exam.isFavorite

  const visibleExams = useMemo(() => {
    const scoped =
      mode === "favorites"
        ? exams.filter((exam) => favoriteOverrides[exam.id] ?? exam.isFavorite)
        : exams
    if (mode !== "explore") return scoped
    const query = foldForSearch(search.trim())
    if (!query) return scoped
    return scoped.filter(
      (exam) =>
        foldForSearch(exam.nume_examen).includes(query) ||
        (exam.categorie !== null && foldForSearch(exam.categorie).includes(query))
    )
  }, [exams, favoriteOverrides, mode, search])

  const handleToggleFavorite = (exam: PublicExamItem) => {
    const next = !isFavorite(exam)
    setFavoriteOverrides((prev) => ({ ...prev, [exam.id]: next }))
    startTransition(async () => {
      const result = await toggleFavoriteExam(exam.id, next)
      if (!result.success) {
        setFavoriteOverrides((prev) => ({ ...prev, [exam.id]: !next }))
        setToast({ type: "error", message: result.error })
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-4">
      {mode === "explore" ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Caută după nume sau categorie"
            aria-label="Caută examene publice"
            className={`${inputClass} pl-9`}
          />
        </div>
      ) : null}

      {visibleExams.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200/80 bg-white px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {mode === "favorites"
            ? "Nu ai examene favorite. Explorează examenele publice și adaugă-le cu ★."
            : "Nu există examene publice disponibile momentan."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleExams.map((exam) => {
            const favorite = isFavorite(exam)
            const isEmpty = exam.questionCount === 0
            return (
              <article key={exam.id} className={examCard}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-tight text-slate-900 dark:text-white">
                      {exam.nume_examen}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {exam.questionCount} întrebări
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleToggleFavorite(exam)}
                        disabled={isPending}
                        aria-pressed={favorite}
                        aria-label={
                          favorite ? "Elimină din favorite" : "Adaugă la favorite"
                        }
                        className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:text-amber-500 disabled:opacity-50"
                      >
                        <Star
                          className={
                            favorite ? "size-4 fill-amber-400 text-amber-400" : "size-4"
                          }
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {favorite ? "Elimină din favorite" : "Adaugă la favorite"}
                    </TooltipContent>
                  </Tooltip>
                </div>

                {exam.categorie !== null || exam.isShowcase || isEmpty ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {exam.categorie !== null ? (
                      <Badge variant="secondary">{exam.categorie}</Badge>
                    ) : null}
                    {exam.isShowcase ? <Badge variant="outline">Recomandat</Badge> : null}
                    {isEmpty ? <Badge variant="secondary">În pregătire</Badge> : null}
                  </div>
                ) : null}

                {/* Simulation rules would contradict a pool of 0 questions. */}
                {isEmpty ? null : (
                  <div className="flex flex-wrap gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className={ruleBadge}>{exam.intrebariSimulare} întrebări</span>
                    <span className={ruleBadge}>{exam.durataMinute} min</span>
                    <span className={ruleBadge}>prag {exam.pragTrecere}</span>
                  </div>
                )}

                <div className="mt-auto flex justify-end pt-1">
                  {isEmpty ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-block">
                          <Button
                            type="button"
                            size="sm"
                            disabled
                            className="pointer-events-none bg-blue-600 text-white"
                          >
                            <Play className="size-3.5" />
                            Începe
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Acest examen nu are încă întrebări.</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => router.push(`/?examen=${exam.id}`)}
                      className="bg-blue-600 text-white hover:bg-blue-500"
                    >
                      <Play className="size-3.5" />
                      Începe
                    </Button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm font-medium shadow-sm transition-all ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300"
              : "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </section>
  )
}
