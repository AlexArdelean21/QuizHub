"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { ChevronLeft, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { updatePlanTier } from "@/app/admin/actions"
import { TierCard } from "@/components/admin/tiers/TierCard"
import { OrganizatiiTiersTable } from "@/components/admin/tiers/OrganizatiiTiersTable"
import type { OrgTierRow, PlanTier } from "@/components/admin/tiers/types"

export type ToastKind = "success" | "error"

type ToastState = { id: number; type: ToastKind; message: string } | null

type TiersPageClientProps = {
  initialTiers: PlanTier[]
  initialOrganizatii: OrgTierRow[]
}

export function TiersPageClient({
  initialTiers,
  initialOrganizatii,
}: TiersPageClientProps) {
  const [tiers, setTiers] = useState<PlanTier[]>(initialTiers)
  const [organizatii, setOrganizatii] = useState<OrgTierRow[]>(initialOrganizatii)
  const [toast, setToast] = useState<ToastState>(null)

  const pushToast = useCallback((type: ToastKind, message: string) => {
    const id = Date.now()
    setToast({ id, type, message })
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, 4000)
  }, [])

  // Editing a tier can also change the effective limits of any tier-managed
  // org, so we optimistically re-apply the tier limits to those orgs too.
  const handleSaveTier = useCallback(
    async (updated: PlanTier) => {
      const { error } = await updatePlanTier(updated.id, {
        max_admini: updated.max_admini,
        max_useri: updated.max_useri,
        max_examene: updated.max_examene,
        tokeni_lunari: updated.tokeni_lunari,
        pret_luna: updated.pret_luna,
        pret_an: updated.pret_an,
        este_activ: updated.este_activ,
      })

      if (error) {
        pushToast("error", error)
        throw new Error(error)
      }

      setTiers((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      setOrganizatii((prev) =>
        prev.map((org) =>
          org.tier_id === updated.id && !org.is_managed_manually
            ? {
                ...org,
                max_admini: updated.max_admini,
                max_useri: updated.max_useri,
                max_examene: updated.max_examene,
                tokeni_lunari: updated.tokeni_lunari,
              }
            : org
        )
      )
      pushToast("success", `Planul „${updated.display_name}” a fost actualizat.`)
    },
    [pushToast]
  )

  const handleOrgUpdate = useCallback((updated: OrgTierRow) => {
    setOrganizatii((prev) => prev.map((org) => (org.id === updated.id ? updated : org)))
  }, [])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ChevronLeft className="size-4" />
          Înapoi la Admin
        </Link>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
            <Layers className="size-6" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Super Admin
            </p>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
              Gestionare Tiers &amp; Organizații
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Configurează planurile disponibile și suprascrie limitele fiecărei
              organizații.
            </p>
          </div>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Planuri disponibile
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Modificările se aplică imediat organizațiilor gestionate prin tier.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tiers.map((tier) => (
            <TierCard key={tier.id} tier={tier} onSave={handleSaveTier} />
          ))}
        </div>
      </section>

      <div className="my-8 h-px w-full bg-slate-200 dark:bg-slate-800" />

      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Organizații
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Atribuie planuri, gestionează statusul abonamentului și suprascrie
          limitele individual.
        </p>

        <div className="mt-4">
          <OrganizatiiTiersTable
            tiers={tiers}
            organizatii={organizatii}
            onUpdate={handleOrgUpdate}
            onToast={pushToast}
          />
        </div>
      </section>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4">
          <div
            className={cn(
              "pointer-events-auto rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg",
              toast.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            )}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </div>
  )
}
