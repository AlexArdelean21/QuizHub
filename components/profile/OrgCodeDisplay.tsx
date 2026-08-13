"use client"

import { useCallback, useState, useTransition } from "react"
import { Check, Copy } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { updateOrgCode } from "@/app/admin/actions"

const ORG_CODE_REGEX = /^[A-Z0-9_-]{3,12}$/
const CODE_FORMAT_ERROR =
  "Codul trebuie să conțină doar litere mari (A-Z), cifre (0-9), cratimă (-) sau underscore (_), 3-12 caractere."

type Toast = { type: "success" | "error"; message: string } | null

type OrgCodeDisplayProps = {
  code: string
  /** When set with canEdit, enables inline editing via updateOrgCode. */
  orgId?: string
  canEdit?: boolean
}

export function OrgCodeDisplay({
  code,
  orgId,
  canEdit = false,
}: OrgCodeDisplayProps) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  const [localError, setLocalError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [isPending, startTransition] = useTransition()

  const pushToast = useCallback((next: Exclude<Toast, null>) => {
    setToast(next)
    window.setTimeout(() => {
      setToast((current) => (current?.message === next.message ? null : current))
    }, 4000)
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  const startEdit = () => {
    setDraft(code)
    setLocalError(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setDraft(code)
    setLocalError(null)
    setEditing(false)
  }

  const handleSave = () => {
    if (!orgId || !canEdit) return
    const normalized = draft.trim().toUpperCase()
    if (!ORG_CODE_REGEX.test(normalized)) {
      setLocalError(CODE_FORMAT_ERROR)
      return
    }
    setLocalError(null)
    startTransition(async () => {
      try {
        await updateOrgCode(orgId, normalized)
        setEditing(false)
        pushToast({ type: "success", message: "Codul organizației a fost actualizat." })
        router.refresh()
      } catch (error) {
        pushToast({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Nu s-a putut actualiza codul.",
        })
      }
    })
  }

  const toastClasses =
    toast?.type === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">Cod organizație</span>
      {editing && canEdit ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value.toUpperCase())
              setLocalError(null)
            }}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm uppercase text-foreground outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            style={{ textTransform: "uppercase" }}
            disabled={isPending}
            aria-invalid={localError ? true : undefined}
          />
          {localError ? (
            <p className="text-xs text-rose-600 dark:text-rose-400">{localError}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending}
              className="bg-blue-600 text-white hover:bg-blue-500"
            >
              {isPending ? "Se salvează..." : "Salvează"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelEdit}
              disabled={isPending}
            >
              Anulează
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
            {code}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="shrink-0"
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            {copied ? "Copiat" : "Copiază"}
          </Button>
          {canEdit && orgId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startEdit}
              className="shrink-0"
            >
              Editează
            </Button>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Trimite codul membrilor care vor să se alăture acestei organizații.
      </p>
      {toast ? (
        <div className={`mt-1 rounded-md border px-3 py-2 text-sm ${toastClasses}`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
