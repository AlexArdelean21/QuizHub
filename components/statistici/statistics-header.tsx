"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import type { ExamSummary } from "@/lib/quiz/types"
import { Badge } from "@/components/ui/badge"
import { ExamSelector } from "./exam-selector"

const SELECTED_EXAM_STORAGE_KEY = "quiz.selectedExamId"

type Props = {
  exams: ExamSummary[]
  selectedExam: ExamSummary
}

// Renders the static header card (title + exam selector) so the page can paint
// instantly while the heavier statistics queries stream in below via Suspense.
// `useRouter` + `localStorage` sync live here because the selector is the only
// interactive part of the header.
export function StatisticsHeader({ exams, selectedExam }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(SELECTED_EXAM_STORAGE_KEY, String(selectedExam.id))
  }, [selectedExam.id])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.has("examen")) return
    const stored = window.localStorage.getItem(SELECTED_EXAM_STORAGE_KEY)
    const storedId = stored ? Number(stored) : null
    if (
      storedId &&
      Number.isFinite(storedId) &&
      storedId !== selectedExam.id &&
      exams.some((e) => e.id === storedId)
    ) {
      router.replace(`/dashboard/statistici?examen=${storedId}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExamChange = (nextId: number) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SELECTED_EXAM_STORAGE_KEY, String(nextId))
    }
    router.push(`/dashboard/statistici?examen=${nextId}`)
  }

  return (
    <header className="relative z-[110] mb-8 flex flex-col gap-4 rounded-2xl border border-border/40 bg-card/55 p-6 shadow-xl shadow-primary/5 ring-1 ring-white/5 backdrop-blur-md isolate sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Statistici examen
        </p>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-3xl font-semibold leading-tight md:text-4xl">
          <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
            {selectedExam.name}
          </span>
          {selectedExam.isPersonal ? (
            <Badge variant="secondary" className="text-xs">Personal</Badge>
          ) : null}
        </h1>
      </div>

      <div className="sm:shrink-0 sm:self-end">
        <ExamSelector
          exams={exams}
          selectedId={selectedExam.id}
          onChange={handleExamChange}
        />
      </div>
    </header>
  )
}
