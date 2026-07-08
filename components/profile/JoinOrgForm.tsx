"use client"

import { FormEvent, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { requestJoinOrg } from "@/app/profile/actions"

export type JoinRequestStatus = "pending" | "approved" | "rejected"

export type ExistingJoinRequest = {
  status: JoinRequestStatus
  orgName: string | null
  createdAt: string
}

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

const STATUS_LABEL: Record<JoinRequestStatus, string> = {
  pending: "În așteptare",
  approved: "Aprobată",
  rejected: "Respinsă",
}

export function JoinOrgForm({
  existingRequest,
}: {
  existingRequest: ExistingJoinRequest | null
}) {
  const router = useRouter()
  const [codOrg, setCodOrg] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // A pending or approved request means no new form. A rejected one may be
  // shown alongside the option to try again.
  if (existingRequest && existingRequest.status !== "rejected") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Cerere de aderare:</span>
          <Badge variant={existingRequest.status === "approved" ? "default" : "secondary"}>
            {STATUS_LABEL[existingRequest.status]}
          </Badge>
        </div>
        {existingRequest.orgName ? (
          <p className="text-sm text-muted-foreground">
            Organizația{" "}
            <span className="font-medium text-foreground">{existingRequest.orgName}</span>
            {existingRequest.status === "pending"
              ? " va analiza cererea ta în curând."
              : "."}
          </p>
        ) : null}
      </div>
    )
  }

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
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {existingRequest?.status === "rejected" ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Cererea anterioară a fost respinsă. Poți încerca din nou.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cod-org" className="text-sm font-medium text-foreground">
          Cod organizație
        </label>
        <input
          id="cod-org"
          type="text"
          required
          value={codOrg}
          onChange={(event) => setCodOrg(event.target.value)}
          placeholder="Ex: QH-4F82K1"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="join-message" className="text-sm font-medium text-foreground">
          Mesaj (opțional)
        </label>
        <textarea
          id="join-message"
          rows={3}
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

      <Button type="submit" disabled={isPending} className="btn-primary w-full">
        {isPending ? "Se trimite..." : "Trimite cererea"}
      </Button>
    </form>
  )
}
