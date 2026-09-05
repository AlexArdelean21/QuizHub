"use client"

import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { QuizQuestion } from "@/lib/quiz/types"

export type MistakeEntry = {
  question: QuizQuestion
  userSelection: string[]
}

type MistakeReviewProps = {
  mistakes: MistakeEntry[]
  onBack: () => void
  onRestart: () => void
}

// Bento-style breakdown of every question the user missed during the
// session — practice or simulation alike. Each card shows the prompt, the
// user's choice (muted red) and the correct answer(s) (muted green) so the
// user can review what went wrong at a glance.
//
// The list is a single column constrained to ~3xl so a lone mistake doesn't
// look stranded on a wide screen and the reading width stays comfortable
// no matter the count.
//
// This is the terminal screen of a session: both CTAs start a fresh quiz
// rather than walking back to the results card. `onBack` stays in the props
// for callers that still pass it, but nothing in the UI triggers it.
export function MistakeReview({ mistakes, onRestart }: MistakeReviewProps) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <Card className="w-full border-2 border-border/90 bg-card shadow-xl shadow-primary/10 ring-1 ring-primary/15 quiz-question-animate">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Revedere greșeli
                </p>
                <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
                  Vezi greșelile
                </h1>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={onRestart}
                className="h-10 rounded-xl border-2 text-sm font-medium"
              >
                <RotateCcw className="size-4" />
                Începe alt quiz
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {mistakes.length}{" "}
              {mistakes.length === 1 ? "întrebare greșită" : "întrebări greșite"} în sesiunea curentă.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="mx-auto flex w-full flex-col gap-6">
              {mistakes.map((entry, idx) => (
                <MistakeCard key={entry.question.id} entry={entry} number={idx + 1} />
              ))}
            </div>
            {/* Repeated at the foot of the list so a long review doesn't force
                a scroll back to the header to move on. */}
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={onRestart}
                className="h-10 rounded-xl border-2 text-sm font-medium"
              >
                <RotateCcw className="size-4" />
                Începe alt quiz
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

function MistakeCard({ entry, number }: { entry: MistakeEntry; number: number }) {
  const { question, userSelection } = entry
  const correctSet = new Set(question.correctAnswers)
  const userSet = new Set(userSelection)

  const correctOptions = question.options.filter((option) => correctSet.has(option.id))
  const userOptions = question.options.filter((option) => userSet.has(option.id))

  return (
    <div className="flex w-full flex-col gap-5 rounded-2xl border-2 border-border/70 bg-secondary/30 p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          aria-label={`Întrebarea greșită numărul ${number}`}
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl font-bold leading-none shadow-md ring-2 ring-primary/40",
            "bg-primary text-primary-foreground text-lg"
          )}
        >
          {number}
        </span>
        <span className="text-sm font-semibold uppercase leading-none tracking-[0.18em] text-muted-foreground">
          Greșeală
        </span>
      </div>

      <p className="text-pretty text-base font-medium leading-relaxed text-foreground md:text-lg">
        {question.text}
      </p>

      {question.imageUrl && (
        <div className="mt-3">
          <img
            src={question.imageUrl}
            alt="Imagine pentru întrebarea greșită"
            loading="lazy"
            className="max-h-48 w-full rounded-xl border border-border/60 bg-muted/30 object-contain"
          />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Răspunsul tău</p>
          <div className="mt-2 flex flex-col gap-2">
            {userOptions.length === 0 ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                Niciun răspuns selectat
              </div>
            ) : (
              userOptions.map((option) => (
                <AnswerPill
                  key={option.id}
                  label={option.label}
                  text={option.text}
                  tone="wrong"
                />
              ))
            )}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {correctOptions.length > 1 ? "Răspunsuri corecte" : "Răspuns corect"}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {correctOptions.map((option) => (
              <AnswerPill
                key={option.id}
                label={option.label}
                text={option.text}
                tone="correct"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AnswerPill({
  label,
  text,
  tone,
}: {
  label: string
  text: string
  tone: "wrong" | "correct"
}) {
  const isCorrect = tone === "correct"
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        isCorrect
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
          isCorrect
            ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-200"
            : "bg-rose-500/20 text-rose-700 dark:text-rose-200"
        )}
      >
        {label}
      </span>
      <span className="min-w-0 leading-relaxed text-foreground/90">{text}</span>
    </div>
  )
}
