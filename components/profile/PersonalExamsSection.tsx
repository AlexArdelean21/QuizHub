"use client"

import { FormEvent, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FileText, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModalPortal } from "@/components/ui/modal-portal"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { createPersonalExam } from "@/app/profile/actions"

export type PersonalExam = { id: number; nume_examen: string }

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

export function PersonalExamsSection({
  exams,
  maxPersonal,
}: {
  exams: PersonalExam[]
  maxPersonal: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const atLimit = exams.length >= maxPersonal

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createPersonalExam({ nume_examen: name })
      if (!result.success) {
        setError(result.error)
        return
      }
      setName("")
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {exams.length} / {maxPersonal} examene proprii
        </p>
        {atLimit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button size="sm" disabled className="pointer-events-none">
                  <Plus className="size-4" />
                  Creează examen
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Ai atins limita de {maxPersonal} examene proprii.
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Creează examen
          </Button>
        )}
      </div>

      {exams.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nu ai încă examene proprii.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {exams.map((exam) => (
            <li
              key={exam.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <FileText className="size-4 shrink-0 text-primary" />
              <span className="truncate">{exam.nume_examen}</span>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
            onClick={() => !isPending && setOpen(false)}
          >
            <form
              onSubmit={onSubmit}
              className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="text-lg font-semibold text-foreground">Examen nou</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Dă-i un nume examenului tău personal.
              </p>

              <div className="mt-4 flex flex-col gap-1.5">
                <label htmlFor="exam-name" className="text-sm font-medium text-foreground">
                  Nume examen
                </label>
                <input
                  id="exam-name"
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex: Recapitulare capitolul 3"
                  className={inputClass}
                />
              </div>

              {error ? (
                <p className="mt-3 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  Anulează
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Se creează..." : "Creează"}
                </Button>
              </div>
            </form>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  )
}
