"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { Building2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModalPortal } from "@/components/ui/modal-portal"
import { JoinOrgModal } from "@/components/dashboard/JoinOrgModal"
import { hideOrgBanner } from "@/lib/actions/org-banner"

const SESSION_DISMISS_KEY = "quizhub_org_banner_dismissed"

const OPTED_OUT_MESSAGE =
  "Poți vedea și accesa detaliile organizației oricând din pagina de profil."
const REQUEST_SENT_MESSAGE = "Cerere trimisă. Vezi statusul din pagina de profil."

type Toast = { message: string; variant: "success" | "error" }

export function OrgBanner({ initialHidden }: { initialHidden: boolean }) {
  const [sessionDismissed, setSessionDismissed] = useState(false)
  const [optedOut, setOptedOut] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [isPending, startTransition] = useTransition()

  // Read after mount, never during render: sessionStorage does not exist on the
  // server, so touching it in the render path would cause a hydration mismatch.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SESSION_DISMISS_KEY) === "1") {
        setSessionDismissed(true)
      }
    } catch {
      // Storage can throw in private/blocked-cookie contexts — fall back to
      // showing the banner rather than failing.
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const dismissForSession = () => {
    setSessionDismissed(true)
    try {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, "1")
    } catch {
      // Non-fatal: the banner still goes away for this render.
    }
  }

  const optOutPermanently = () => {
    startTransition(async () => {
      const result = await hideOrgBanner()
      if (!result.success) {
        setToast({ message: result.error, variant: "error" })
        return
      }
      // Hide locally right away instead of waiting for the revalidated payload.
      setOptedOut(true)
      setToast({ message: OPTED_OUT_MESSAGE, variant: "success" })
    })
  }

  // Rendered outside the card so it survives the banner hiding itself.
  const toastNode = toast ? (
    <ModalPortal>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[300] flex justify-center px-4">
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.variant === "success"
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"
              : "border-rose-500/40 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200"
          }`}
        >
          {toast.message}
        </div>
      </div>
    </ModalPortal>
  ) : null

  if (initialHidden || sessionDismissed || optedOut) return toastNode

  return (
    <>
      <div className="relative rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
        <button
          type="button"
          aria-label="Închide"
          onClick={dismissForSession}
          className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-4 pr-8">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
            <Building2 className="size-5" />
          </span>
          <h2 className="text-base font-semibold text-foreground sm:text-lg">
            Nu ești în nicio organizație
          </h2>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          Alătură-te unei organizații cu un cod de invitație ca să ai acces la
          examenele și statisticile ei — sau creează-ți propria organizație.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            onClick={() => setModalOpen(true)}
            className="btn-primary w-full sm:w-auto"
          >
            Introdu cod
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/org/creeaza">Creează organizație</Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={optOutPermanently}
          disabled={isPending}
          className="mt-4 text-xs text-slate-400 underline transition hover:text-slate-600 disabled:opacity-60 dark:hover:text-slate-300"
        >
          {isPending ? "Se salvează..." : "Nu mai afișa acest mesaj"}
        </button>
      </div>

      <JoinOrgModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={() =>
          setToast({ message: REQUEST_SENT_MESSAGE, variant: "success" })
        }
      />

      {toastNode}
    </>
  )
}
