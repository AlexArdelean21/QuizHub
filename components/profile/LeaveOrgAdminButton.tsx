"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ModalPortal } from "@/components/ui/modal-portal"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { leaveOrgAdminRole } from "@/app/profile/actions"

const LAST_ADMIN_MSG =
  "Ești singurul administrator al organizației — promovează pe altcineva înainte de a renunța la rol."

export function LeaveOrgAdminButton({ isLastAdmin }: { isLastAdmin: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (isLastAdmin) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">
            <Button variant="outline" disabled className="pointer-events-none">
              Renunță la rolul de org_admin
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{LAST_ADMIN_MSG}</TooltipContent>
      </Tooltip>
    )
  }

  const handleConfirm = () => {
    setError(null)
    startTransition(async () => {
      const result = await leaveOrgAdminRole()
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
        Renunță la rolul de org_admin
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
                Renunți la rolul de administrator?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Vei deveni membru obișnuit al organizației. Vei rămâne în aceeași
                organizație, dar nu vei mai avea acces la administrare.
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
                  {isPending ? "Se procesează..." : "Renunță la rol"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  )
}
