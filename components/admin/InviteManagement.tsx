"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Link2,
  Lock,
  Plus,
  Trash2,
} from "lucide-react"
import {
  generateInviteToken,
  getInviteTokens,
  revokeInviteToken,
  toggleOrgInviteLinks,
  type InviteTokenRow,
} from "@/app/admin/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type InviteManagementProps = {
  orgId: string
  inviteLinksEnabled: boolean
  isSuperAdmin: boolean
  /**
   * Renders the section header as a collapse toggle. Opt-in because the
   * super-admin org list already nests this component inside its own
   * expandable row, where a second collapse layer would mean two clicks to
   * reach the table.
   */
  collapsible?: boolean
  /** Shown in the header copy so super admins can confirm the target org. */
  orgName?: string
}

const PAGE_SIZE = 10

/** Above this many live links the header nudges the admin to revoke some. */
const ACTIVE_LINKS_NUDGE_THRESHOLD = 4

type Toast = { type: "success" | "error"; message: string } | null

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://quizhub.ro"

const STATUS_BADGE: Record<InviteTokenRow["status"], { label: string; className: string }> = {
  active: {
    label: "Activ",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  expired: {
    label: "Expirat",
    className: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  used: {
    label: "Folosit",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function InviteManagement({
  orgId,
  inviteLinksEnabled,
  isSuperAdmin,
  collapsible = false,
  orgName,
}: InviteManagementProps) {
  const [tokens, setTokens] = useState<InviteTokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [inviteEnabled, setInviteEnabled] = useState(inviteLinksEnabled)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  // null = the admin hasn't toggled yet, so the open state still follows the
  // data (see `isOpen`). Any explicit click pins it.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  const [page, setPage] = useState(1)

  const activeCount = useMemo(
    () => tokens.filter((row) => row.status === "active").length,
    [tokens]
  )

  // Tokens arrive after mount, so the default can only be resolved once they
  // load: an org with live links opens, a fresh org with none stays closed.
  const isOpen = openOverride ?? activeCount > 0
  const contentVisible = !collapsible || isOpen

  const pageCount = Math.max(1, Math.ceil(tokens.length / PAGE_SIZE))
  const pagedTokens = tokens.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Revoking the last row on the final page (or the 7-day window dropping
  // rows) can strand `page` past the end, which would render an empty table.
  useEffect(() => {
    setPage((prev) => Math.min(prev, pageCount))
  }, [pageCount])

  const pushToast = useCallback((next: Exclude<Toast, null>) => {
    setToast(next)
    window.setTimeout(() => {
      setToast((current) => (current?.message === next.message ? null : current))
    }, 4000)
  }, [])

  const loadTokens = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getInviteTokens(orgId)
      setTokens(rows)
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error ? error.message : "Nu s-au putut încărca linkurile.",
      })
    } finally {
      setLoading(false)
    }
  }, [orgId, pushToast])

  useEffect(() => {
    void loadTokens()
  }, [loadTokens])

  const handleToggleEnabled = async () => {
    if (togglingEnabled) return
    setTogglingEnabled(true)
    const nextValue = !inviteEnabled
    try {
      await toggleOrgInviteLinks(orgId, nextValue)
      setInviteEnabled(nextValue)
      pushToast({
        type: "success",
        message: nextValue ? "Invite links activate." : "Invite links dezactivate.",
      })
      await loadTokens()
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error ? error.message : "Nu s-a putut modifica setarea.",
      })
    } finally {
      setTogglingEnabled(false)
    }
  }

  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    try {
      await generateInviteToken(orgId)
      await loadTokens()
      pushToast({ type: "success", message: "Link generat! Copiază-l și trimite-l." })
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error ? error.message : "Nu s-a putut genera linkul.",
      })
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async (row: InviteTokenRow) => {
    const url = `${window.location.origin}/join?token=${row.token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(row.id)
      window.setTimeout(() => {
        setCopiedId((current) => (current === row.id ? null : current))
      }, 2000)
    } catch {
      pushToast({ type: "error", message: "Nu s-a putut copia linkul." })
    }
  }

  const handleRevoke = async (row: InviteTokenRow) => {
    if (!window.confirm("Sigur vrei să revoci acest link?")) return
    try {
      await revokeInviteToken(row.id)
      await loadTokens()
      pushToast({ type: "success", message: "Link revocat." })
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error ? error.message : "Nu s-a putut revoca linkul.",
      })
    }
  }

  const toastClasses =
    toast?.type === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"

  const header = (
    <>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-700 dark:text-blue-300">
          <Lock className="size-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Invitații
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Permite membrilor noi să se alăture{" "}
            {orgName?.trim() ? orgName : "organizației"} printr-un link.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {activeCount > 0 ? (
          <Badge variant="secondary">{activeCount} active</Badge>
        ) : null}
        {collapsible ? (
          <ChevronDown
            className={`size-4 text-slate-400 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        ) : null}
      </div>
    </>
  )

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpenOverride(!isOpen)}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3">{header}</div>
      )}

      {contentVisible && isSuperAdmin ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/70 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
          <span className="text-sm text-slate-700 dark:text-slate-200">
            Activează invite links pentru această organizație
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={inviteEnabled}
            disabled={togglingEnabled}
            onClick={handleToggleEnabled}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
              inviteEnabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-700"
            }`}
          >
            <span
              className={`inline-block size-5 transform rounded-full bg-white shadow transition ${
                inviteEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      ) : null}

      {!contentVisible ? null : !inviteEnabled ? (
        <div className="rounded-lg border border-slate-200/70 bg-slate-100/70 px-3 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
          <p>Invite links sunt dezactivate pentru această organizație.</p>
          {isSuperAdmin ? (
            <p className="mt-1 text-xs">
              Activează opțiunea de mai sus pentru a permite generarea de linkuri.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {activeCount >= ACTIVE_LINKS_NUDGE_THRESHOLD ? (
              <p className="mr-auto max-w-md text-[11px] text-amber-600 dark:text-amber-400">
                Ai {activeCount} linkuri active. Revocă-le pe cele neutilizate
                înainte de a genera altele.
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="bg-blue-600 text-white hover:bg-blue-500"
            >
              <Plus className="mr-1 size-4" />
              {generating ? "Se generează..." : "Generează link nou"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200/70 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200/70 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Token</th>
                  <th className="px-3 py-2">Creat la</th>
                  <th className="px-3 py-2">Expiră la</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      Se încarcă...
                    </td>
                  </tr>
                ) : tokens.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      Nu există linkuri active sau generate în ultimele 7 zile.
                    </td>
                  </tr>
                ) : (
                  pagedTokens.map((row) => {
                    const badge = STATUS_BADGE[row.status]
                    return (
                      <tr
                        key={row.id}
                        className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-950/60"
                      >
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                          {row.token.slice(0, 16)}...
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          {formatDate(row.expires_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {row.status === "active" ? (
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleCopy(row)}
                              >
                                {copiedId === row.id ? (
                                  <>
                                    <Check className="mr-1 size-3.5 text-emerald-500" />
                                    Copiat
                                  </>
                                ) : (
                                  <>
                                    <Copy className="mr-1 size-3.5" />
                                    Copiază link
                                  </>
                                )}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleRevoke(row)}
                                className="border-rose-300 text-rose-600 hover:bg-rose-500/10 dark:border-rose-500/40 dark:text-rose-300"
                              >
                                <Trash2 className="mr-1 size-3.5" />
                                Revocă
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <p>
                Pagina {page} din {pageCount} · {tokens.length}{" "}
                {tokens.length === 1 ? "link" : "linkuri"}
              </p>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          ) : null}

          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            <Link2 className="mr-1 inline size-3" />
            Linkurile folosesc {appUrl}/join
          </p>
        </div>
      )}

      {toast ? (
        <div className={`rounded-md border px-3 py-2 text-sm ${toastClasses}`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
