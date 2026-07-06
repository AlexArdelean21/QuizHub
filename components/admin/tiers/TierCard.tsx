"use client"

import { useMemo, useState, useTransition } from "react"
import { Coins, FileText, UserCog, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import type { PlanTier } from "@/components/admin/tiers/types"

type TierCardProps = {
  tier: PlanTier
  onSave: (updated: PlanTier) => Promise<void>
}

type Draft = {
  max_admini: string
  max_useri: string
  max_examene: string
  tokeni_lunari: string
  pret_luna: string
  pret_an: string
  este_activ: boolean
}

function toDraft(tier: PlanTier): Draft {
  return {
    max_admini: String(tier.max_admini),
    max_useri: String(tier.max_useri),
    max_examene: String(tier.max_examene),
    tokeni_lunari: String(tier.tokeni_lunari),
    pret_luna: String(tier.pret_luna),
    pret_an: String(tier.pret_an),
    este_activ: tier.este_activ,
  }
}

const LIMIT_FIELDS = [
  { key: "max_admini", label: "Admini", icon: UserCog },
  { key: "max_useri", label: "Useri", icon: Users },
  { key: "max_examene", label: "Examene", icon: FileText },
  { key: "tokeni_lunari", label: "Tokeni / lună", icon: Coins },
] as const

const PRICE_FIELDS = [
  { key: "pret_luna", label: "Preț €/lună" },
  { key: "pret_an", label: "Preț €/an" },
] as const

const inputClass =
  "mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"

const labelClass =
  "flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400"

export function TierCard({ tier, onSave }: TierCardProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(tier))
  const [isPending, startTransition] = useTransition()

  const baseline = useMemo(() => toDraft(tier), [tier])

  const isDirty = useMemo(
    () => (Object.keys(baseline) as (keyof Draft)[]).some((k) => draft[k] !== baseline[k]),
    [draft, baseline]
  )

  const validationError = useMemo(() => {
    for (const field of LIMIT_FIELDS) {
      const n = Number(draft[field.key])
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return `${field.label}: introdu un număr întreg pozitiv.`
      }
    }
    for (const field of PRICE_FIELDS) {
      const n = Number(draft[field.key])
      if (!Number.isFinite(n) || n < 0) {
        return `${field.label}: valoare invalidă.`
      }
    }
    return null
  }, [draft])

  const setField = (
    key: "max_admini" | "max_useri" | "max_examene" | "tokeni_lunari" | "pret_luna" | "pret_an",
    value: string
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const setActiv = (value: boolean) => {
    setDraft((prev) => ({ ...prev, este_activ: value }))
  }

  const handleSave = () => {
    if (!isDirty || validationError) return
    startTransition(() => {
      void onSave({
        ...tier,
        max_admini: Number(draft.max_admini),
        max_useri: Number(draft.max_useri),
        max_examene: Number(draft.max_examene),
        tokeni_lunari: Number(draft.tokeni_lunari),
        pret_luna: Number(draft.pret_luna),
        pret_an: Number(draft.pret_an),
        este_activ: draft.este_activ,
      }).catch(() => {
        // Toast surfaced by the parent; keep the dirty draft so the admin can retry.
      })
    })
  }

  return (
    <Card className={cn("gap-4 py-5", !draft.este_activ && "opacity-80")}>
      <CardHeader className="px-5">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="text-base">{tier.display_name}</span>
          <Badge
            className={
              draft.este_activ
                ? "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "border-transparent bg-slate-300/60 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
            }
          >
            {draft.este_activ ? "Activ" : "Inactiv"}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="px-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Limite
          </div>
          {LIMIT_FIELDS.map((field) => {
            const Icon = field.icon
            return (
              <label key={field.key} className="block">
                <span className={labelClass}>
                  <Icon className="size-3.5" />
                  {field.label}
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={draft[field.key]}
                  onChange={(e) => setField(field.key, e.target.value)}
                  disabled={isPending}
                  className={inputClass}
                />
              </label>
            )
          })}

          <div className="col-span-2 mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Prețuri
          </div>
          {PRICE_FIELDS.map((field) => (
            <label key={field.key} className="block">
              <span className={labelClass}>{field.label}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft[field.key]}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={isPending}
                className={inputClass}
              />
            </label>
          ))}
        </div>

        {validationError ? (
          <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{validationError}</p>
        ) : null}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3 border-t px-5">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Switch
            checked={draft.este_activ}
            onCheckedChange={setActiv}
            disabled={isPending}
          />
          <span>{draft.este_activ ? "Activ" : "Inactiv"}</span>
        </label>

        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isPending || !isDirty || Boolean(validationError)}
          className="bg-blue-600 text-white hover:bg-blue-500"
        >
          {isPending ? "Se salvează..." : "Salvează modificările"}
        </Button>
      </CardFooter>
    </Card>
  )
}
