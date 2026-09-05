"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { ChevronDown } from "lucide-react"
import {
  fetchAccessibleExams,
  fetchPublicExamById,
  fetchQuestionsBySource,
  getAvailableQuestionCount,
  recordAnswerHistory,
  recordPracticeSession,
  recordSimulationSession,
  toggleBookmarkForQuestion,
  updateLearningStatus,
} from "@/lib/quiz/fetch-random-intrebari"
import { areAnswerSetsEqual, type ExamSummary, type PracticeSource, type QuizQuestion } from "@/lib/quiz/types"
import type { MistakeEntry } from "./mistake-review"
import { ExamPicker } from "@/components/quiz/ExamPicker"

const QuizResults = dynamic(() => import("./quiz-results").then((m) => m.QuizResults))
const MistakeReview = dynamic(() => import("./mistake-review").then((m) => m.MistakeReview))
const QuizHeader = dynamic(() => import("./quiz-header").then((m) => m.QuizHeader))
const QuestionCard = dynamic(() => import("./question-card").then((m) => m.QuestionCard))
const AnswerOptions = dynamic(() => import("./answer-options").then((m) => m.AnswerOptions))
const QuizNavigation = dynamic(() => import("./quiz-navigation").then((m) => m.QuizNavigation))

const FALLBACK_DURATION_SEC = 30 * 60
const FALLBACK_QUESTION_COUNT = 25
const FALLBACK_PASS_THRESHOLD = 18
const SELECTED_EXAM_STORAGE_KEY = "quiz.selectedExamId"

type QuizMode = "simulation" | "practice"
type QuizStatus = "setup" | "loading" | "quiz" | "results" | "mistakes" | "error"
type ExamOption = ExamSummary

type ResultStats = {
  mode: QuizMode
  correct: number
  wrong: number
  total: number
  elapsedMs: number
  timedOut: boolean
}

function formatClock(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}

function formatElapsed(ms: number) {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, "0")}s`
}

export function QuizInterface({ banner }: { banner?: ReactNode }) {
  const supabase = getSupabaseBrowserClient()
  // Deep link from the exam library: /?examen=<id>.
  const requestedExamParam = useSearchParams().get("examen")
  const [status, setStatus] = useState<QuizStatus>("setup")
  const [mode, setMode] = useState<QuizMode>("simulation")
  const [practiceSource, setPracticeSource] = useState<PracticeSource>("all")
  const [isPracticeSourceOpen, setIsPracticeSourceOpen] = useState(false)
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null)
  const [examOptions, setExamOptions] = useState<ExamOption[]>([])
  const [availablePracticeCount, setAvailablePracticeCount] = useState(0)
  const [questionCount, setQuestionCount] = useState(FALLBACK_QUESTION_COUNT)
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState(false)
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([])
  const [bookmarkedQuestions, setBookmarkedQuestions] = useState<Set<string>>(() => new Set())
  // Stores the full selection (array of option ids) for each answered question.
  // Multi-correct questions naturally produce arrays with multiple entries;
  // single-correct ones produce a single-element array.
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  // Practice-mode only: question ids the user has already committed. Once a
  // question is in this set, options become read-only and immediate feedback
  // is rendered (mirrors the previous single-answer auto-lock behavior).
  const [practiceLocked, setPracticeLocked] = useState<Set<string>>(() => new Set())
  const [timeRemaining, setTimeRemaining] = useState(FALLBACK_DURATION_SEC)
  // Practice-mode consecutive-correct streak. Resets on a wrong answer or exit.
  const [streak, setStreak] = useState(0)
  const [streakBump, setStreakBump] = useState(false)
  const [resultStats, setResultStats] = useState<ResultStats | null>(null)
  const [isExitModalOpen, setIsExitModalOpen] = useState(false)
  // Every question the user got wrong during the current session. In practice
  // it's populated on commit (single-answer auto-lock or "Verifică"); in
  // simulation it's built in one sweep by `finalizeQuiz`. Either way it backs
  // the "Vezi greșelile" review screen.
  const [wrongQuestions, setWrongQuestions] = useState<MistakeEntry[]>([])

  const selectedExam = useMemo(
    () => examOptions.find((option) => option.id === selectedExamId) ?? null,
    [examOptions, selectedExamId]
  )
  const examDurationSec = selectedExam ? selectedExam.durataMinute * 60 : FALLBACK_DURATION_SEC
  const examSimulationCount = selectedExam?.intrebariSimulare ?? FALLBACK_QUESTION_COUNT
  const examPassThreshold = selectedExam?.pragTrecere ?? FALLBACK_PASS_THRESHOLD

  const questionsRef = useRef(questions)
  const answersRef = useRef(answers)
  const modeRef = useRef(mode)
  const userIdRef = useRef<string | null>(userId)
  const selectedExamIdRef = useRef<number | null>(selectedExamId)
  const startedAtRef = useRef<number>(0)
  const finishedRef = useRef(false)
  // Question ids for which a simulation answer has already been written to
  // `istoric_raspunsuri`. Used to guarantee one row per question per
  // simulation, regardless of whether the answer was logged on "Next" or
  // when the timer / finalize swept up any leftovers.
  const recordedSimulationRef = useRef<Set<string>>(new Set())
  const practiceSourceDropdownRef = useRef<HTMLDivElement | null>(null)
  // Exam reached through `?examen=<id>` that isn't part of the user's own list.
  // Selecting it must not be written to localStorage.
  const transientExamIdRef = useRef<number | null>(null)

  questionsRef.current = questions
  answersRef.current = answers
  modeRef.current = mode

  // userId and selectedExamId are only read from refs inside async callbacks
  // (finalizeQuiz, handleSelectAnswer), so syncing in an effect is enough and
  // avoids writing to refs during render.
  useEffect(() => {
    userIdRef.current = userId
    selectedExamIdRef.current = selectedExamId
  }, [userId, selectedExamId])

  const isPracticeMode = mode === "practice"
  const sourceLabelMap: Record<PracticeSource, string> = {
    all: "toate",
    bookmarked: "salvate",
    wrong: "greșite anterior",
    new: "noi",
  }
  const sourceOptionLabel: Record<PracticeSource, string> = {
    all: "Toate",
    bookmarked: "Salvate",
    wrong: "Greșite anterior",
    new: "Doar întrebări noi",
  }

  const finalizeQuiz = useCallback((opts: { timedOut: boolean }) => {
    if (finishedRef.current) return
    finishedRef.current = true
    const qs = questionsRef.current
    const ans = answersRef.current
    const currentMode = modeRef.current

    // Sweep any simulation answers that weren't already recorded (e.g. the
    // last question advanced via Finish, or a timer-driven finalize). This
    // mirrors the previous behavior where each click in simulation mode
    // produced an `istoric_raspunsuri` row, but de-duplicated to one per
    // question.
    if (currentMode === "simulation" && userIdRef.current && selectedExamIdRef.current != null) {
      const sweepUserId = userIdRef.current
      const sweepExamId = selectedExamIdRef.current
      for (const q of qs) {
        const selection = ans[q.id]
        if (!selection || selection.length === 0) continue
        if (recordedSimulationRef.current.has(q.id)) continue
        recordedSimulationRef.current.add(q.id)
        const isCorrect = areAnswerSetsEqual(selection, q.correctAnswers)
        void updateLearningStatus(supabase, {
          userId: sweepUserId,
          examenId: sweepExamId,
          intrebareId: q.id,
          isCorrect,
        })
        void recordAnswerHistory(supabase, {
          userId: sweepUserId,
          examenId: sweepExamId,
          intrebareId: q.id,
          isCorrect,
          mode: "simulation",
        }).catch((error) => {
          console.error("Failed to record answer history:", error)
        })
      }
    }

    const correct = qs.reduce(
      (acc, q) => acc + (areAnswerSetsEqual(ans[q.id] ?? [], q.correctAnswers) ? 1 : 0),
      0
    )
    const wrong = Math.max(0, qs.length - correct)

    // Practice mode accumulates mistakes incrementally on each commit, but a
    // simulation only reveals anything at the end — so build the review list
    // here from the final answer map. Unanswered questions count as mistakes
    // and render as "Niciun răspuns selectat".
    if (currentMode === "simulation") {
      setWrongQuestions(
        qs
          .filter((q) => !areAnswerSetsEqual(ans[q.id] ?? [], q.correctAnswers))
          .map((q) => ({ question: q, userSelection: (ans[q.id] ?? []).slice() }))
      )
    }

    const finishedAt = Date.now()
    const elapsedMs = finishedAt - startedAtRef.current
    setResultStats({ mode: currentMode, correct, wrong, total: qs.length, elapsedMs, timedOut: opts.timedOut })
    setStatus("results")

    // Persist finished simulations → evolution chart / sim-only counters.
    if (currentMode === "simulation" && userIdRef.current && selectedExamIdRef.current != null && qs.length > 0) {
      void recordSimulationSession(supabase, {
        userId: userIdRef.current,
        examenId: selectedExamIdRef.current,
        startedAt: new Date(startedAtRef.current),
        finishedAt: new Date(finishedAt),
        correctCount: correct,
        totalQuestions: qs.length,
        timedOut: opts.timedOut,
      }).catch((error) => {
        console.error("Failed to record simulation session:", error)
      })
    }

    // Practice sessions → contribute to global study time stats only.
    if (currentMode === "practice" && userIdRef.current && selectedExamIdRef.current != null && qs.length > 0) {
      void recordPracticeSession(supabase, {
        userId: userIdRef.current,
        examenId: selectedExamIdRef.current,
        startedAt: new Date(startedAtRef.current),
        finishedAt: new Date(finishedAt),
        correctCount: correct,
        totalQuestions: qs.length,
      }).catch((error) => {
        console.error("Failed to record practice session:", error)
      })
    }
  }, [supabase])

  const refreshAvailablePracticeCount = useCallback(async (nextSource: PracticeSource, nextExamId: number, nextUserId: string | null) => {
    if (!nextUserId) {
      setAvailablePracticeCount(0)
      setAvailabilityMessage("Nu ai sesiune activă.")
      return
    }
    setIsAvailabilityLoading(true)
    try {
      const count = await getAvailableQuestionCount(supabase, { examenId: nextExamId, source: nextSource, userId: nextUserId })
      setAvailablePracticeCount(count)
      setAvailabilityMessage(count === 0 ? `Nu ai întrebări ${sourceLabelMap[nextSource]} în acest pool` : null)
    } catch (e) {
      setAvailabilityMessage(e instanceof Error ? e.message : "Nu s-a putut calcula numărul de întrebări.")
    } finally {
      setIsAvailabilityLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const bootstrap = async () => {
      const { data: userData } = await supabase.auth.getUser()
      const activeUserId = userData.user?.id ?? null
      setUserId(activeUserId)
      if (!activeUserId) {
        setExamOptions([])
        setSelectedExamId(null)
        setAvailabilityMessage("Nu ai acces la niciun examen momentan. Contactează administratorul.")
        return
      }

      const exams = await fetchAccessibleExams(supabase, activeUserId)

      const requestedExamId = Number(requestedExamParam)
      const isRequestedIdValid = Number.isInteger(requestedExamId) && requestedExamId > 0
      const isRequestedAccessible =
        isRequestedIdValid && exams.some((option) => option.id === requestedExamId)

      // A deep link to a public exam the user hasn't favourited is absent from
      // the accessible list, so resolve it with one targeted lookup. Any
      // failure falls through to the usual selection, silently.
      let deepLinkExam: ExamOption | null = null
      if (isRequestedIdValid && !isRequestedAccessible) {
        try {
          deepLinkExam = await fetchPublicExamById(supabase, requestedExamId)
        } catch (error) {
          console.error("Failed to resolve the deep-linked exam:", error)
        }
      }

      const options = deepLinkExam ? [...exams, deepLinkExam] : exams

      if (options.length === 0) {
        setExamOptions([])
        setSelectedExamId(null)
        setAvailabilityMessage("Nu ai acces la niciun examen momentan. Contactează administratorul.")
        setAvailablePracticeCount(0)
        return
      }

      setExamOptions(options)

      if (deepLinkExam) {
        // A one-off visit: kept out of localStorage so it doesn't resurrect
        // itself on every later load. Favourites persist as usual.
        transientExamIdRef.current = deepLinkExam.id
        setSelectedExamId(deepLinkExam.id)
        await refreshAvailablePracticeCount(practiceSource, deepLinkExam.id, activeUserId)
        return
      }

      const persistedExamId = Number(window.localStorage.getItem(SELECTED_EXAM_STORAGE_KEY))
      const hasPersistedExam =
        Number.isFinite(persistedExamId) &&
        persistedExamId > 0 &&
        options.some((option) => option.id === persistedExamId)

      const nextExamId = isRequestedAccessible
        ? requestedExamId
        : hasPersistedExam
          ? persistedExamId
          : options[0].id

      setSelectedExamId(nextExamId)
      window.localStorage.setItem(SELECTED_EXAM_STORAGE_KEY, String(nextExamId))
      await refreshAvailablePracticeCount(practiceSource, nextExamId, activeUserId)
    }
    void bootstrap().catch((error) => {
      console.error("Failed to load available exams:", error)
      setAvailabilityMessage("Nu ai acces la niciun examen momentan. Contactează administratorul.")
      setExamOptions([])
      setAvailablePracticeCount(0)
    })
  }, [supabase, refreshAvailablePracticeCount, requestedExamParam])

  useEffect(() => {
    if (selectedExamId == null) return
    if (selectedExamId === transientExamIdRef.current) return
    window.localStorage.setItem(SELECTED_EXAM_STORAGE_KEY, String(selectedExamId))
  }, [selectedExamId])

  useEffect(() => {
    if (!isPracticeMode || examOptions.length === 0 || selectedExamId == null) return
    void refreshAvailablePracticeCount(practiceSource, selectedExamId, userId)
  }, [
    isPracticeMode,
    practiceSource,
    selectedExamId,
    userId,
    refreshAvailablePracticeCount,
    examOptions.length,
  ])

  useEffect(() => {
    if (!isPracticeMode) return
    const dynamicMax = Math.max(0, availablePracticeCount)
    if (dynamicMax === 0) {
      setQuestionCount(0)
      return
    }
    setQuestionCount(Math.min(examSimulationCount, dynamicMax))
  }, [isPracticeMode, availablePracticeCount, examSimulationCount])

  const loadQuiz = useCallback(async (selectedMode: QuizMode, selectedCount: number, examenId: number, source: PracticeSource, currentUserId: string | null, durationSec: number) => {
    finishedRef.current = false
    modeRef.current = selectedMode
    recordedSimulationRef.current = new Set()
    setMode(selectedMode)
    setErrorMessage(null)
    setStatus("loading")
    setResultStats(null)
    setQuestions([])
    setCurrentIndex(0)
    setSelectedAnswers([])
    setBookmarkedQuestions(new Set())
    setAnswers({})
    setPracticeLocked(new Set())
    setWrongQuestions([])
    setStreak(0)
    setStreakBump(false)
    setTimeRemaining(durationSec)
    try {
      const qs = await fetchQuestionsBySource(supabase, { count: selectedCount, examenId, source: selectedMode === "practice" ? source : "all", userId: currentUserId ?? "" })
      if (qs.length === 0) {
        setErrorMessage(selectedMode === "practice" ? "Nu există întrebări disponibile pentru filtrul selectat." : "Nu s-au găsit întrebări în tabel")
        setStatus("error")
        return
      }
      if (currentUserId) {
        const ids = qs.map((q) => q.id)
        const { data: bookmarkRows } = await supabase.from("bookmarks").select("intrebare_id").eq("user_id", currentUserId).eq("examen_id", examenId).in("intrebare_id", ids)
        setBookmarkedQuestions(new Set((bookmarkRows ?? []).map((item) => String(item.intrebare_id))))
      }
      setQuestions(qs)
      startedAtRef.current = Date.now()
      setStatus("quiz")
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Nu s-au putut încărca întrebările.")
      setStatus("error")
    }
  }, [supabase])

  // The countdown only applies to exam simulations. Practice mode is untimed,
  // so we never tick down or auto-finalize on timeout.
  useEffect(() => {
    if (status !== "quiz" || isPracticeMode) return
    const id = window.setInterval(() => setTimeRemaining((prev) => (prev <= 0 ? 0 : prev - 1)), 1000)
    return () => window.clearInterval(id)
  }, [status, isPracticeMode])

  useEffect(() => {
    if (status !== "quiz" || isPracticeMode || timeRemaining > 0) return
    finalizeQuiz({ timedOut: true })
  }, [status, isPracticeMode, timeRemaining, finalizeQuiz])

  const currentQuestion = questions[currentIndex]
  const totalQuestions = questions.length
  const isLastQuestion = totalQuestions > 0 && currentIndex === totalQuestions - 1
  const isMultipleChoice = (currentQuestion?.correctAnswers.length ?? 0) > 1
  const isCurrentQuestionLockedForPractice =
    isPracticeMode && currentQuestion != null && practiceLocked.has(currentQuestion.id)
  const hasAnyCurrentSelection = selectedAnswers.length > 0

  useEffect(() => {
    if (!currentQuestion) return setSelectedAnswers([])
    setSelectedAnswers(answers[currentQuestion.id] ?? [])
  }, [currentIndex, currentQuestion, answers])

  const commitPracticeAnswer = useCallback(
    (question: QuizQuestion, finalSelection: string[]) => {
      if (!userId || selectedExamId == null) return
      const isCorrect = areAnswerSetsEqual(finalSelection, question.correctAnswers)
      if (isCorrect) {
        setStreak((prev) => prev + 1)
        setStreakBump(true)
        setTimeout(() => setStreakBump(false), 350)
      } else {
        setStreak(0)
      }
      if (!isCorrect) {
        // Snapshot the question + the user's exact selection so the review
        // screen can replay both sides (their pick vs. the right answer).
        // Replace any earlier entry for the same question id — a re-attempt
        // inside the same session shouldn't show twice.
        setWrongQuestions((prev) => {
          const filtered = prev.filter((entry) => entry.question.id !== question.id)
          return [...filtered, { question, userSelection: finalSelection.slice() }]
        })
      } else {
        setWrongQuestions((prev) =>
          prev.some((entry) => entry.question.id === question.id)
            ? prev.filter((entry) => entry.question.id !== question.id)
            : prev
        )
      }
      void updateLearningStatus(supabase, {
        userId,
        examenId: selectedExamId,
        intrebareId: question.id,
        isCorrect,
      })
      // Append every commit to the answer history so the statistics page can
      // compute mastery + per-question last attempt. Failures are non-fatal:
      // the quiz UX must keep working even if the log write fails.
      void recordAnswerHistory(supabase, {
        userId,
        examenId: selectedExamId,
        intrebareId: question.id,
        isCorrect,
        mode: "practice",
      }).catch((error) => {
        console.error("Failed to record answer history:", error)
      })
    },
    [supabase, userId, selectedExamId]
  )

  const handleToggleAnswer = (answerId: string) => {
    if (!currentQuestion || status !== "quiz") return
    if (isCurrentQuestionLockedForPractice) return

    const correctCount = currentQuestion.correctAnswers.length
    const allowsMultiple = correctCount > 1

    const nextSelection = allowsMultiple
      ? selectedAnswers.includes(answerId)
        ? selectedAnswers.filter((id) => id !== answerId)
        : [...selectedAnswers, answerId]
      : [answerId]

    setSelectedAnswers(nextSelection)
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: nextSelection }))

    // Single-correct + practice mode keeps the original "instant commit"
    // UX: tap an option, see feedback, advance. Multi-correct practice
    // requires an explicit "Verifică" press so the user can pick every
    // valid answer before locking the question.
    if (isPracticeMode && !allowsMultiple) {
      setPracticeLocked((prev) => {
        const next = new Set(prev)
        next.add(currentQuestion.id)
        return next
      })
      commitPracticeAnswer(currentQuestion, nextSelection)
    }
  }

  const handleVerifyPracticeAnswer = () => {
    if (!currentQuestion || !isPracticeMode) return
    if (isCurrentQuestionLockedForPractice) return
    if (selectedAnswers.length === 0) return
    setPracticeLocked((prev) => {
      const next = new Set(prev)
      next.add(currentQuestion.id)
      return next
    })
    commitPracticeAnswer(currentQuestion, selectedAnswers)
  }

  const handleToggleBookmark = () => {
    if (!currentQuestion || !userId || selectedExamId == null) return
    const shouldBookmark = !bookmarkedQuestions.has(currentQuestion.id)
    setBookmarkedQuestions((prev) => {
      const next = new Set(prev)
      if (shouldBookmark) next.add(currentQuestion.id)
      else next.delete(currentQuestion.id)
      return next
    })
    void toggleBookmarkForQuestion(supabase, { userId, examenId: selectedExamId, intrebareId: currentQuestion.id, shouldBookmark })
  }

  const recordSimulationAttempt = useCallback(
    (question: QuizQuestion, finalSelection: string[]) => {
      if (!userId || selectedExamId == null) return
      if (recordedSimulationRef.current.has(question.id)) return
      recordedSimulationRef.current.add(question.id)
      const isCorrect = areAnswerSetsEqual(finalSelection, question.correctAnswers)
      void updateLearningStatus(supabase, {
        userId,
        examenId: selectedExamId,
        intrebareId: question.id,
        isCorrect,
      })
      void recordAnswerHistory(supabase, {
        userId,
        examenId: selectedExamId,
        intrebareId: question.id,
        isCorrect,
        mode: "simulation",
      }).catch((error) => {
        console.error("Failed to record answer history:", error)
      })
    },
    [supabase, userId, selectedExamId]
  )

  const handleNext = () => {
    if (!currentQuestion || status !== "quiz") return

    // In simulation mode the user can freely toggle options; we therefore
    // only persist the answer once they commit to it by moving on.
    if (!isPracticeMode && selectedAnswers.length > 0) {
      recordSimulationAttempt(currentQuestion, selectedAnswers)
    }

    if (isLastQuestion) finalizeQuiz({ timedOut: false })
    else setCurrentIndex((i) => i + 1)
  }

  const handleStartQuiz = () => {
    if (examOptions.length === 0) {
      setAvailabilityMessage("Nu ai acces la niciun examen momentan. Contactează administratorul.")
      return
    }
    if (selectedExamId == null) {
      setAvailabilityMessage("Selectează un examen înainte să pornești quiz-ul.")
      return
    }
    if (isPracticeMode && availablePracticeCount === 0) return
    const selectedCount = mode === "simulation" ? examSimulationCount : Math.min(Math.max(1, availablePracticeCount), Math.max(1, questionCount))
    void loadQuiz(mode, selectedCount, selectedExamId, practiceSource, userId, examDurationSec)
  }

  const handleExamChange = useCallback((examId: number) => {
    setSelectedExamId(examId)
  }, [])

  const resetToSetup = () => {
    finishedRef.current = false
    recordedSimulationRef.current = new Set()
    setQuestions([])
    setCurrentIndex(0)
    setSelectedAnswers([])
    setBookmarkedQuestions(new Set())
    setAnswers({})
    setPracticeLocked(new Set())
    setWrongQuestions([])
    setStreak(0)
    setStreakBump(false)
    setTimeRemaining(examDurationSec)
    setResultStats(null)
    setErrorMessage(null)
    setStatus("setup")
  }

  const handleExitQuiz = () => {
    resetToSetup()
    setIsExitModalOpen(false)
  }

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("quiz-active-change", { detail: status === "quiz" }))
  }, [status])

  useEffect(() => {
    const openExitModal = () => {
      if (status === "quiz") setIsExitModalOpen(true)
    }
    window.addEventListener("quiz-exit-request", openExitModal)
    return () => window.removeEventListener("quiz-exit-request", openExitModal)
  }, [status])

  useEffect(() => {
    if (!isPracticeSourceOpen) return

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (!practiceSourceDropdownRef.current?.contains(target)) {
        setIsPracticeSourceOpen(false)
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [isPracticeSourceOpen])

  if (status === "loading") return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Se încarcă întrebările…</div>

  if (status === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <p className="max-w-md text-center text-sm text-destructive">{errorMessage}</p>
        <button type="button" onClick={handleStartQuiz} className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Încearcă din nou</button>
      </div>
    )
  }

  if (status === "mistakes" && resultStats) {
    return (
      <MistakeReview
        mistakes={wrongQuestions}
        onBack={() => setStatus("results")}
        onRestart={resetToSetup}
      />
    )
  }

  if (status === "results" && resultStats) {
    const canViewMistakes = wrongQuestions.length > 0
    return (
      <QuizResults
        mode={resultStats.mode}
        correctCount={resultStats.correct}
        totalQuestions={resultStats.total}
        passThreshold={examPassThreshold}
        elapsedLabel={formatElapsed(resultStats.elapsedMs)}
        finishedByTimeout={resultStats.timedOut}
        onRestart={resetToSetup}
        onViewMistakes={canViewMistakes ? () => setStatus("mistakes") : undefined}
        mistakeCount={wrongQuestions.length}
      />
    )
  }

  if (status === "setup") {
    const dynamicMax = Math.max(0, availablePracticeCount)
    const sliderMax = Math.max(1, dynamicMax)
    const sliderValue = Math.max(1, Math.min(questionCount, sliderMax))
    const noExamAccess = examOptions.length === 0
    return (
      <div className="min-h-screen bg-background bg-mesh noise-overlay">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
          {/* Only on the setup screen — an in-progress quiz must not be pushed
              around by a dashboard-level notice. */}
          {banner}
          <div className="card-surface w-full quiz-question-animate">
            <div className="px-6 pt-6 pb-2 md:px-8 md:pt-8">
              <p className="section-label">Setup</p>
              <h1 className="text-2xl font-semibold text-foreground md:text-3xl" data-testid="quiz-setup-title">Alege modul de quiz</h1>
            </div>
            <div className="flex flex-col gap-6 px-6 pb-6 pt-2 md:px-8 md:pb-8">
              <div className="rounded-xl border border-border bg-secondary/30 p-5">
                <p className="text-sm font-medium text-foreground">Examen</p>
                <div className="mt-2">
                  <ExamPicker
                    options={examOptions}
                    value={selectedExamId}
                    onChange={handleExamChange}
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <button type="button" data-testid="quiz-mode-simulation" onClick={() => setMode("simulation")} className={`card-hover rounded-xl border-2 p-5 text-left transition-all duration-200 ${mode === "simulation" ? "border-primary bg-primary/5" : "border-border bg-secondary/30 hover:border-primary/40"}`}>
                  <p className="text-lg font-semibold text-foreground">Simulare Examen</p>
                  {selectedExam ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedExam.intrebariSimulare} întrebări · {selectedExam.durataMinute} min · trecere ≥ {selectedExam.pragTrecere}
                    </p>
                  ) : null}
                </button>
                <button type="button" data-testid="quiz-mode-practice" onClick={() => setMode("practice")} className={`card-hover rounded-xl border-2 p-5 text-left transition-all duration-200 ${mode === "practice" ? "border-primary bg-primary/5" : "border-border bg-secondary/30 hover:border-primary/40"}`}>
                  <p className="text-lg font-semibold text-foreground">Mod Practică</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Antrenament fără limită de timp.
                  </p>
                </button>
              </div>
              {mode === "practice" && (
                <div className="rounded-xl border border-border bg-secondary/30 p-5">
                  <label htmlFor="practice-source" className="text-sm font-medium text-foreground">Sursă întrebări</label>
                  <div className="relative mt-2" ref={practiceSourceDropdownRef}>
                    <button
                      id="practice-source"
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={isPracticeSourceOpen}
                      onClick={() => setIsPracticeSourceOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:hover:border-slate-700"
                    >
                      <span>{sourceOptionLabel[practiceSource]}</span>
                      <ChevronDown
                        className={`size-4 text-slate-500 transition-transform dark:text-slate-400 ${isPracticeSourceOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {isPracticeSourceOpen && (
                      <div
                        role="listbox"
                        aria-labelledby="practice-source"
                        className="absolute z-[70] mt-1 w-full min-w-[14rem] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
                      >
                        {([
                          { value: "all", label: "Toate" },
                          { value: "bookmarked", label: "Salvate" },
                          { value: "wrong", label: "Greșite anterior" },
                          { value: "new", label: "Doar întrebări noi" },
                        ] as const).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setPracticeSource(option.value)
                              setIsPracticeSourceOpen(false)
                            }}
                            className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                              practiceSource === option.value
                                ? "bg-blue-50 text-blue-700 dark:bg-slate-800 dark:text-blue-300"
                                : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="mt-4 text-sm font-medium text-foreground">Număr întrebări: {dynamicMax === 0 ? 0 : sliderValue}</p>
                  <input type="range" min={1} max={sliderMax} value={dynamicMax === 0 ? 1 : sliderValue} onChange={(e) => setQuestionCount(Number(e.target.value))} className="mt-2 w-full accent-primary" disabled={availablePracticeCount === 0 || isAvailabilityLoading} />
                  <p className="mt-2 text-xs text-muted-foreground">Disponibile: {availablePracticeCount} întrebări</p>
                  {availabilityMessage && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{availabilityMessage}</p>}
                </div>
              )}
              <Button type="button" data-testid="quiz-start" onClick={handleStartQuiz} disabled={noExamAccess || (isPracticeMode && availablePracticeCount === 0) || isAvailabilityLoading} className="btn-primary w-full rounded-xl px-6 py-3.5 text-base disabled:opacity-60">
                {isAvailabilityLoading ? "Se verifică întrebările..." : "Începe quiz-ul"}
              </Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (!currentQuestion) return null

  return (
    <div className="min-h-screen bg-background">
      <QuizHeader
        currentQuestion={currentIndex + 1}
        totalQuestions={totalQuestions}
        timeRemaining={formatClock(timeRemaining)}
        // Untimed practice mode shows no timer (and never pulses); the raw
        // seconds are only forwarded for the simulation urgency check.
        hasTimer={!isPracticeMode}
        secondsLeft={isPracticeMode ? undefined : timeRemaining}
        streak={streak}
        streakBump={streakBump}
      />
      <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div key={currentQuestion.id} className="flex w-full flex-col gap-8 md:gap-10 quiz-question-animate">
          <QuestionCard
            questionNumber={currentIndex + 1}
            questionText={currentQuestion.text}
            isBookmarked={bookmarkedQuestions.has(currentQuestion.id)}
            onToggleBookmark={handleToggleBookmark}
            isMultipleChoice={isMultipleChoice}
            imageUrl={currentQuestion.imageUrl ?? null}
          />
          <AnswerOptions
            options={currentQuestion.options}
            selectedAnswers={selectedAnswers}
            correctAnswers={currentQuestion.correctAnswers}
            showImmediateFeedback={isCurrentQuestionLockedForPractice}
            isLocked={isCurrentQuestionLockedForPractice}
            multiple={isMultipleChoice}
            onToggleAnswer={handleToggleAnswer}
          />
          {(mode === "simulation" || hasAnyCurrentSelection) && (
            <QuizNavigation
              onNext={handleNext}
              isLastQuestion={isLastQuestion}
              hasSelectedAnswer={
                isPracticeMode
                  ? // In practice, advancing requires the question to be
                    // committed first (instant for single, via "Verifică"
                    // for multi). For simulation, any selection is enough.
                    isCurrentQuestionLockedForPractice
                  : hasAnyCurrentSelection
              }
              onVerify={handleVerifyPracticeAnswer}
              showVerify={
                isPracticeMode && isMultipleChoice && !isCurrentQuestionLockedForPractice
              }
              verifyDisabled={!hasAnyCurrentSelection}
            />
          )}
        </div>
      </main>
      {isExitModalOpen && (
        <div data-testid="exit-modal" className="fixed inset-0 z-[80] flex items-center justify-center p-4 modal-backdrop-animate">
          <button type="button" aria-label="Închide" onClick={() => setIsExitModalOpen(false)} className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
          <div className="card-surface relative z-10 w-full max-w-sm p-6 shadow-2xl modal-card-animate">
            <h2 className="text-lg font-semibold text-foreground">Confirmare ieșire</h2>
            <p className="mt-2 text-sm text-muted-foreground">Ești sigur că vrei să părăsești quiz-ul? Progresul actual va fi pierdut.</p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button type="button" data-testid="exit-modal-stay" onClick={() => setIsExitModalOpen(false)} className="btn-primary px-5 py-2.5 text-sm">Rămân</button>
              <button type="button" data-testid="exit-modal-confirm" onClick={handleExitQuiz} className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-2.5 text-sm font-medium text-rose-600 transition hover:bg-rose-500/20 dark:text-rose-400">Renunță</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
