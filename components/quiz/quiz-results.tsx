"use client"

import { useEffect, useRef } from "react"
import confetti from "canvas-confetti"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { PRIMARY_CTA_CLASS } from "@/lib/utils"

type QuizResultsProps = {
  mode: "simulation" | "practice"
  correctCount: number
  totalQuestions: number
  passThreshold?: number
  elapsedLabel: string
  finishedByTimeout: boolean
  onRestart: () => void
  /**
   * When provided alongside a non-zero `mistakeCount`, renders the
   * "Vezi greșelile" CTA that opens the mistake review. Available in both
   * practice and simulation mode.
   */
  onViewMistakes?: () => void
  mistakeCount?: number
}

export function QuizResults({
  mode,
  correctCount,
  totalQuestions,
  passThreshold = 18,
  elapsedLabel,
  finishedByTimeout,
  onRestart,
  onViewMistakes,
  mistakeCount = 0,
}: QuizResultsProps) {
  const wrongCount = totalQuestions - correctCount
  const isPassed = correctCount >= passThreshold
  // Celebrate only a passed simulation — practice sessions have no pass/fail.
  const passed = mode === "simulation" && isPassed
  const hasFiredRef = useRef(false)

  useEffect(() => {
    if (!passed || hasFiredRef.current) return
    hasFiredRef.current = true

    // Multi-burst confetti for celebration
    const duration = 2500
    const animationEnd = Date.now() + duration
    const colors = ["#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b"]

    // Initial big burst
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors,
    })

    // Side bursts after delay
    const sideTimeout = setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors,
      })
      confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors,
      })
    }, 250)

    // Final sprinkle
    const interval = setInterval(() => {
      if (Date.now() > animationEnd) {
        clearInterval(interval)
        return
      }
      confetti({
        particleCount: 20,
        startVelocity: 30,
        spread: 360,
        origin: {
          x: Math.random(),
          y: Math.random() * 0.3,
        },
        colors,
      })
    }, 400)

    return () => {
      clearTimeout(sideTimeout)
      clearInterval(interval)
    }
  }, [passed])

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <Card className="w-full max-w-2xl self-center border-2 border-border/90 bg-card shadow-xl shadow-primary/10 ring-1 ring-primary/15 quiz-question-animate">
          <CardHeader className="pb-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Rezultate
            </p>
            <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
              {mode === "simulation" ? "Rezultatul simulării" : "Rezultatul sesiunii de practică"}
            </h1>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 pt-2">
            <div className="rounded-xl border border-border bg-secondary/40 px-5 py-4">
              {mode === "simulation" ? (
                <>
                  <p className="text-sm text-muted-foreground">Scor final</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
                    {correctCount}
                    <span className="text-lg font-medium text-muted-foreground">
                      {" "}
                      / {totalQuestions}
                    </span>
                  </p>
                  <p
                    className={`mt-3 inline-flex w-fit rounded-lg px-3 py-1 text-sm font-semibold ${
                      isPassed
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {isPassed ? "ADMIS" : "RESPINS"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Statistici generale</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    Corecte: <span className="font-bold text-emerald-600 dark:text-emerald-400">{correctCount}</span>
                  </p>
                  <p className="text-xl font-semibold text-foreground">
                    Greșite: <span className="font-bold text-rose-600 dark:text-rose-400">{wrongCount}</span>
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <p className="text-muted-foreground">Timp scurs</p>
              <p className="font-mono text-base font-medium text-foreground">
                {elapsedLabel}
              </p>
            </div>

            {finishedByTimeout && (
              <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                Timpul a expirat — răspunsurile tale au fost evaluate până în acest
                moment.
              </p>
            )}

            {onViewMistakes && mistakeCount > 0 && (
              <Button
                type="button"
                onClick={onViewMistakes}
                className={PRIMARY_CTA_CLASS}
              >
                Vezi greșelile ({mistakeCount})
              </Button>
            )}

            <Button
              type="button"
              onClick={onRestart}
              className={PRIMARY_CTA_CLASS}
            >
              Gata
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
