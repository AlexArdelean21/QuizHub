"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  resolveJoinRequest,
  type PendingJoinRequest,
} from "@/app/admin/join-requests/actions"

type Props = {
  orgId: string
  requests: PendingJoinRequest[]
}

type Decision = "approved" | "rejected"

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}

const DONE_LABEL: Record<Decision, string> = {
  approved: "Aprobată",
  rejected: "Respinsă",
}

// orgId is part of the props contract for clarity, but the server action derives
// the caller's scope from the session + request id, so it isn't read here.
export function JoinRequestsList({ requests }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [acting, setActing] = useState<{ id: string; decision: Decision } | null>(null)
  const [resolved, setResolved] = useState<Record<string, Decision>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handle = (id: string, decision: Decision) => {
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setActing({ id, decision })
    startTransition(async () => {
      const result = await resolveJoinRequest(id, decision)
      setActing(null)
      if (!result.success) {
        // Surface the RPC message verbatim (e.g. seat-limit exhaustion).
        setErrors((prev) => ({ ...prev, [id]: result.error }))
        return
      }
      // Hide the row locally right away; router.refresh() re-fetches the RSC so
      // the resolved row disappears from the source of truth on the next render.
      setResolved((prev) => ({ ...prev, [id]: decision }))
      router.refresh()
    })
  }

  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
      {requests.map((req) => {
        const doneAs = resolved[req.id]
        if (doneAs) {
          return (
            <div
              key={req.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="font-medium text-muted-foreground">
                {req.nume ?? req.email ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground">{DONE_LABEL[doneAs]}</span>
            </div>
          )
        }

        const rowActing = acting?.id === req.id
        const error = errors[req.id]

        return (
          <div key={req.id} className="flex flex-col gap-2 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium text-foreground">{req.nume ?? "—"}</span>
                {req.email ? (
                  <span className="text-xs text-muted-foreground">{req.email}</span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  Solicitat:{" "}
                  {new Date(req.requested_at).toLocaleString("ro-RO", DATE_OPTS)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handle(req.id, "rejected")}
                  disabled={isPending}
                >
                  {rowActing && acting?.decision === "rejected"
                    ? "Se procesează..."
                    : "Respinge"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => handle(req.id, "approved")}
                  disabled={isPending}
                >
                  {rowActing && acting?.decision === "approved"
                    ? "Se procesează..."
                    : "Aprobă"}
                </Button>
              </div>
            </div>

            {error ? (
              <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                {error}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
