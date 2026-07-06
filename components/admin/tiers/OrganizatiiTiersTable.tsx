"use client"

import { useMemo, useState, useTransition } from "react"
import { RotateCcw, Search, Settings2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ModalPortal } from "@/components/ui/modal-portal"
import { DataTable, type Column } from "@/components/ui/data-table"
import {
  resetOrgTokens,
  updateOrgAiImport,
  updateOrgLimits,
  updateOrgManualMode,
  updateOrgStatus,
  updateOrgTier,
} from "@/app/admin/actions"
import type {
  OrgSubscriptionStatus,
  OrgTierRow,
  PlanTier,
} from "@/components/admin/tiers/types"
import type { ToastKind } from "@/components/admin/tiers/TiersPageClient"

type OrganizatiiTiersTableProps = {
  tiers: PlanTier[]
  organizatii: OrgTierRow[]
  onUpdate: (updated: OrgTierRow) => void
  onToast: (type: ToastKind, message: string) => void
}

const STATUS_OPTIONS: { value: OrgSubscriptionStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "suspended", label: "Suspended" },
  { value: "canceled", label: "Canceled" },
]

const STATUS_SELECT_CLASS: Record<OrgSubscriptionStatus, string> = {
  active:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  past_due:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  suspended:
    "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  canceled: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}

const selectBaseClass =
  "h-8 rounded-md border px-2 text-xs font-medium outline-none transition focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"

const inlineInputClass =
  "h-7 w-14 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"

type ManualDialogState = { org: OrgTierRow; next: boolean } | null

export function OrganizatiiTiersTable({
  tiers,
  organizatii,
  onUpdate,
  onToast,
}: OrganizatiiTiersTableProps) {
  const [search, setSearch] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [manualDialog, setManualDialog] = useState<ManualDialogState>(null)
  const [, startTransition] = useTransition()

  const tierById = useMemo(
    () => new Map<number, PlanTier>(tiers.map((t) => [t.id, t])),
    [tiers]
  )

  const run = (
    orgId: string,
    action: () => Promise<{ error: string | null }>,
    optimistic: OrgTierRow,
    successMessage: string
  ) => {
    setBusyId(orgId)
    startTransition(() => {
      void (async () => {
        try {
          const { error } = await action()
          if (error) {
            onToast("error", error)
            return
          }
          onUpdate(optimistic)
          onToast("success", successMessage)
        } catch (error) {
          onToast("error", error instanceof Error ? error.message : "Eroare neașteptată.")
        } finally {
          setBusyId(null)
        }
      })()
    })
  }

  const handleTierChange = (org: OrgTierRow, tierId: number) => {
    const tier = tierById.get(tierId)
    const optimistic: OrgTierRow = {
      ...org,
      tier_id: tierId,
      ...(tier && !org.is_managed_manually
        ? {
            max_admini: tier.max_admini,
            max_useri: tier.max_useri,
            max_examene: tier.max_examene,
            tokeni_lunari: tier.tokeni_lunari,
          }
        : {}),
    }
    run(
      org.id,
      () => updateOrgTier(org.id, tierId),
      optimistic,
      `Plan actualizat pentru „${org.nume}”.`
    )
  }

  const handleStatusChange = (org: OrgTierRow, status: OrgSubscriptionStatus) => {
    const nowIso = new Date().toISOString()
    const optimistic: OrgTierRow = {
      ...org,
      subscription_status: status,
      past_due_at:
        status === "active"
          ? null
          : status === "past_due" && !org.past_due_at
            ? nowIso
            : org.past_due_at,
      suspended_at:
        status === "active"
          ? null
          : status === "suspended" && !org.suspended_at
            ? nowIso
            : org.suspended_at,
    }
    run(
      org.id,
      () => updateOrgStatus(org.id, status),
      optimistic,
      `Status actualizat pentru „${org.nume}”.`
    )
  }

  const handleLimitBlur = (
    org: OrgTierRow,
    field: "max_admini" | "max_useri" | "max_examene",
    raw: string
  ) => {
    const value = Math.floor(Number(raw))
    if (!Number.isFinite(value) || value <= 0) {
      onToast("error", "Valoarea trebuie să fie un număr întreg pozitiv.")
      return
    }
    if (value === org[field]) return
    run(
      org.id,
      () => updateOrgLimits(org.id, { [field]: value }),
      { ...org, [field]: value },
      `Limite actualizate pentru „${org.nume}”.`
    )
  }

  const handleAiToggle = (org: OrgTierRow, enabled: boolean) => {
    run(
      org.id,
      () => updateOrgAiImport(org.id, enabled),
      { ...org, ai_import_enabled: enabled },
      `AI Import ${enabled ? "activat" : "dezactivat"} pentru „${org.nume}”.`
    )
  }

  const handleResetTokens = (org: OrgTierRow) => {
    run(
      org.id,
      () => resetOrgTokens(org.id),
      { ...org, tokeni_consumati_luna: 0 },
      `Tokeni resetați pentru „${org.nume}”.`
    )
  }

  const confirmManualMode = () => {
    if (!manualDialog) return
    const { org, next } = manualDialog
    const tier = org.tier_id != null ? tierById.get(org.tier_id) : undefined
    const optimistic: OrgTierRow = {
      ...org,
      is_managed_manually: next,
      ...(!next && tier
        ? {
            max_admini: tier.max_admini,
            max_useri: tier.max_useri,
            max_examene: tier.max_examene,
            tokeni_lunari: tier.tokeni_lunari,
          }
        : {}),
    }
    setManualDialog(null)
    run(
      org.id,
      () => updateOrgManualMode(org.id, next),
      optimistic,
      next
        ? `„${org.nume}” trecută în mod manual.`
        : `„${org.nume}” revenită la limitele tier-ului.`
    )
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return organizatii
    return organizatii.filter((org) => org.nume.toLowerCase().includes(needle))
  }, [organizatii, search])

  const columns = useMemo<Column<OrgTierRow>[]>(
    () => [
      {
        key: "organizatie",
        header: "Organizație",
        pin: "left",
        minWidth: 200,
        render: (org) => (
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{org.nume}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{org.slug}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {org.grandfathered ? (
                <Badge className="border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300">
                  Grandfathered
                </Badge>
              ) : null}
              {org.is_managed_manually ? (
                <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  Manual
                </Badge>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: "tier",
        header: "Tier",
        minWidth: 140,
        render: (org) => (
          <select
            value={org.tier_id ?? ""}
            disabled={org.is_managed_manually || busyId === org.id}
            onChange={(e) => handleTierChange(org, Number(e.target.value))}
            title={
              org.is_managed_manually
                ? "Dezactivează modul manual pentru a schimba tier-ul."
                : undefined
            }
            className={cn(
              selectBaseClass,
              "border-slate-300 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            )}
          >
            <option value="" disabled>
              — Fără tier —
            </option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.display_name}
              </option>
            ))}
          </select>
        ),
      },
      {
        key: "status",
        header: "Status",
        minWidth: 140,
        render: (org) => (
          <select
            value={org.subscription_status}
            disabled={busyId === org.id}
            onChange={(e) =>
              handleStatusChange(org, e.target.value as OrgSubscriptionStatus)
            }
            className={cn(selectBaseClass, STATUS_SELECT_CLASS[org.subscription_status])}
          >
            {STATUS_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className="bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100"
              >
                {option.label}
              </option>
            ))}
          </select>
        ),
      },
      {
        key: "limite",
        header: "Limite efective",
        minWidth: 220,
        render: (org) => {
          if (!org.is_managed_manually) {
            return (
              <span className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                👥 {org.max_useri} useri · 📝 {org.max_examene} examene · 👤{" "}
                {org.max_admini} admini
              </span>
            )
          }
          return (
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1">
                👥
                <input
                  type="number"
                  min={1}
                  defaultValue={org.max_useri}
                  disabled={busyId === org.id}
                  onBlur={(e) => handleLimitBlur(org, "max_useri", e.target.value)}
                  className={inlineInputClass}
                />
              </span>
              <span className="inline-flex items-center gap-1">
                📝
                <input
                  type="number"
                  min={1}
                  defaultValue={org.max_examene}
                  disabled={busyId === org.id}
                  onBlur={(e) => handleLimitBlur(org, "max_examene", e.target.value)}
                  className={inlineInputClass}
                />
              </span>
              <span className="inline-flex items-center gap-1">
                👤
                <input
                  type="number"
                  min={1}
                  defaultValue={org.max_admini}
                  disabled={busyId === org.id}
                  onBlur={(e) => handleLimitBlur(org, "max_admini", e.target.value)}
                  className={inlineInputClass}
                />
              </span>
            </div>
          )
        },
      },
      {
        key: "ai_import",
        header: "AI Import",
        minWidth: 100,
        align: "center",
        render: (org) => (
          <div className="flex justify-center">
            <Switch
              checked={org.ai_import_enabled}
              disabled={busyId === org.id}
              onCheckedChange={(checked) => handleAiToggle(org, checked)}
            />
          </div>
        ),
      },
      {
        key: "actiuni",
        header: "Acțiuni",
        pin: "right",
        minWidth: 200,
        align: "right",
        render: (org) => (
          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={org.is_managed_manually ? "default" : "outline"}
              disabled={busyId === org.id}
              onClick={() =>
                setManualDialog({ org, next: !org.is_managed_manually })
              }
              className={
                org.is_managed_manually
                  ? "bg-amber-600 text-white hover:bg-amber-500"
                  : undefined
              }
            >
              <Settings2 className="mr-1 size-3.5" />
              Manual Override
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyId === org.id}
              onClick={() => handleResetTokens(org)}
              title={`Consumați: ${org.tokeni_consumati_luna} / ${org.tokeni_lunari}`}
            >
              <RotateCcw className="mr-1 size-3.5" />
              Tokeni: Reset
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiers, busyId, tierById]
  )

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Caută organizație..."
          className="h-9 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500"
        />
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        totalCount={filtered.length}
        pageSize={filtered.length || 1}
        currentPage={1}
        buildHref={() => "#"}
        emptyState={{
          title: "Nu am găsit organizații.",
          description: "Încearcă alt termen de căutare.",
        }}
      />

      {manualDialog ? (
        <ModalPortal>
          <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Închide"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setManualDialog(null)}
            />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {manualDialog.next
                  ? "Activează modul manual"
                  : "Revino la limitele tier-ului"}
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {manualDialog.next
                  ? "Organizația va fi scoasă din sistemul de tiers. Limitele pot fi setate liber."
                  : "Organizația va reveni la limitele tier-ului selectat."}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setManualDialog(null)}
                >
                  Anulează
                </Button>
                <Button
                  type="button"
                  onClick={confirmManualMode}
                  className={
                    manualDialog.next
                      ? "bg-amber-600 text-white hover:bg-amber-500"
                      : "bg-blue-600 text-white hover:bg-blue-500"
                  }
                >
                  Confirmă
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  )
}
