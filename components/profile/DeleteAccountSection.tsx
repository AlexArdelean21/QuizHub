"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModalPortal } from "@/components/ui/modal-portal"
import {
  cancelAccountDeletion,
  requestAccountDeletion,
} from "@/app/profile/actions"

const GRACE_PERIOD_DAYS = 14

function formatDeletionDate(requestedAt: string): string {
  const date = new Date(requestedAt)
  date.setDate(date.getDate() + GRACE_PERIOD_DAYS)
  return date.toLocaleDateString("ro-RO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function DeleteAccountSection({
  deletionRequestedAt,
}: {
  deletionRequestedAt: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleRequest = () => {
    setError(null)
    startTransition(async () => {
      const result = await requestAccountDeletion()
      if (!result.success) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  const handleCancel = () => {
    setError(null)
    startTransition(async () => {
      const result = await cancelAccountDeletion()
      if (!result.success) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  if (deletionRequestedAt) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Cont programat pentru ștergere pe {formatDeletionDate(deletionRequestedAt)}
            </p>
            <p className="text-sm text-muted-foreground">
              Poți anula oricând în această perioadă. După această dată, contul va fi
              anonimizat definitiv.
            </p>
          </div>
        </div>

        {error ? (
          <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}

        <Button variant="outline" onClick={handleCancel} disabled={isPending}>
          {isPending ? "Se procesează..." : "Anulează ștergerea"}
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Șterge contul
      </Button>

      {open ? (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
            onClick={() => !isPending && setOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="text-lg font-semibold text-foreground">Ștergi contul?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Contul tău va fi programat pentru ștergere. Ai la dispoziție{" "}
                {GRACE_PERIOD_DAYS} zile în care te poți răzgândi și anula procesul.
                După această perioadă, datele vor fi anonimizate definitiv.
              </p>

              {error ? (
                <p className="mt-3 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                  Anulează
                </Button>
                <Button variant="destructive" onClick={handleRequest} disabled={isPending}>
                  {isPending ? "Se procesează..." : "Confirmă ștergerea"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  )
}
