"use client"

import { useEffect, useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ModalPortal } from "@/components/ui/modal-portal"
import { requestJoinOrg } from "@/app/profile/actions"

type JoinOrgModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after the request lands, so the owner can surface a toast. */
  onSuccess?: () => void
}

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

export function JoinOrgModal({ open, onOpenChange, onSuccess }: JoinOrgModalProps) {
  const router = useRouter()
  const [codOrg, setCodOrg] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) onOpenChange(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, isPending, onOpenChange])

  if (!open) return null

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await requestJoinOrg(codOrg, message)
      if (!result.success) {
        setError(result.error)
        return
      }
      setCodOrg("")
      setMessage("")
      onOpenChange(false)
      onSuccess?.()
      router.refresh()
    })
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
        onClick={() => !isPending && onOpenChange(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-org-modal-title"
          aria-describedby="join-org-modal-description"
          className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <h2
            id="join-org-modal-title"
            className="text-lg font-semibold text-foreground"
          >
            Intră într-o organizație
          </h2>
          <p
            id="join-org-modal-description"
            className="mt-1 text-sm text-muted-foreground"
          >
            Introdu codul primit de la administrator. Cererea ta va fi analizată de
            organizație.
          </p>

          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="join-modal-cod-org"
                className="text-sm font-medium text-foreground"
              >
                Cod organizație
              </label>
              <input
                id="join-modal-cod-org"
                type="text"
                required
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={codOrg}
                onChange={(event) => setCodOrg(event.target.value.toUpperCase())}
                placeholder="Ex: QH-4F82K1"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="join-modal-message"
                className="text-sm font-medium text-foreground"
              >
                Mesaj (opțional)
              </label>
              <textarea
                id="join-modal-message"
                rows={3}
                maxLength={500}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Spune-le cine ești..."
                className={inputClass}
              />
            </div>

            {error ? (
              <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Anulează
              </Button>
              <Button type="submit" disabled={isPending} className="btn-primary">
                {isPending ? "Se trimite..." : "Trimite cererea"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  )
}
