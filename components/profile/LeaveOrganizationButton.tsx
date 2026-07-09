"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ModalPortal } from "@/components/ui/modal-portal"
import { leaveOrganization } from "@/app/profile/actions"

export function LeaveOrganizationButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleConfirm = () => {
    setError(null)
    startTransition(async () => {
      const result = await leaveOrganization()
      if (!result.success) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Ieși din organizație
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
              <h2 className="text-lg font-semibold text-foreground">
                Ieși din organizație?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Vei pierde accesul la examenele organizației și la statisticile
                aferente. Datele tale rămân salvate — dacă te alături din nou aceleiași
                organizații, statisticile tale vor redeveni vizibile. Poți cere
                reprimirea folosind codul organizației.
              </p>

              {error ? (
                <p className="mt-3 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  Anulează
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirm}
                  disabled={isPending}
                >
                  {isPending ? "Se procesează..." : "Ieși din organizație"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  )
}
