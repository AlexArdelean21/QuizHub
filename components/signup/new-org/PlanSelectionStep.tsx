"use client"

import { useState } from "react"
import {
  ArrowRight,
  Building2,
  FileText,
  GraduationCap,
  Rocket,
  Sparkles,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PlanTier } from "@/lib/signup/types"

const ENTERPRISE_MAILTO =
  "mailto:contact@quizhub.ro?subject=Interes%20tier%20Enterprise"

const tokenFormatter = new Intl.NumberFormat("ro-RO")

const PLAN_META: Record<string, { icon: LucideIcon; description: string }> = {
  standard: {
    icon: GraduationCap,
    description: "Pentru echipe mici, la început de drum.",
  },
  pro: {
    icon: Rocket,
    description: "Pentru organizații în creștere.",
  },
  enterprise: {
    icon: Building2,
    description: "Soluție personalizată pentru organizații mari.",
  },
}

const FALLBACK_META = { icon: GraduationCap, description: "" }

type BillingCycle = "monthly" | "yearly"

type PlanSelectionStepProps = {
  tiers: PlanTier[]
  enterpriseTier: PlanTier | null
  selectedTierId: number | null
  onSelect: (tierId: number) => void
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function AiTokensChip({ tier, isEnterprise }: { tier: PlanTier; isEnterprise: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
      <Sparkles className="mt-0.5 size-4 shrink-0" />
      {isEnterprise ? (
        <span>
          <span className="font-semibold">Tokeni AI personalizați</span> — generează
          întrebări automat din poze, cursuri sau documente.
        </span>
      ) : (
        <span>
          <span className="font-semibold">{tokenFormatter.format(tier.tokeni_lunari)}</span>{" "}
          tokeni AI/lună — generează întrebări automat din poze, cursuri sau documente.
        </span>
      )}
    </div>
  )
}

type PlanCardProps = {
  tier: PlanTier
  billing: BillingCycle
  isEnterprise: boolean
  isRecommended: boolean
  isSelected: boolean
  onSelect?: (tierId: number) => void
}

function PlanCard({
  tier,
  billing,
  isEnterprise,
  isRecommended,
  isSelected,
  onSelect,
}: PlanCardProps) {
  const meta = PLAN_META[tier.nume] ?? FALLBACK_META
  const Icon = meta.icon
  const price = billing === "monthly" ? tier.pret_luna : tier.pret_an
  const suffix = billing === "monthly" ? "/lună" : "/an"

  return (
    <div
      className={cn(
        "relative flex flex-col gap-5 rounded-2xl border border-slate-200 p-6 transition-all dark:border-slate-800",
        isEnterprise
          ? "bg-slate-50 dark:bg-slate-800/50"
          : "bg-white hover:-translate-y-1 dark:bg-slate-900",
        isRecommended && !isSelected && "border-blue-500/50",
        isSelected && "ring-2 ring-primary"
      )}
    >
      {isRecommended ? (
        <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white">
          Popular
        </span>
      ) : null}

      {/* Icon badge → name + description → price */}
      <div className="flex flex-col gap-4">
        <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950">
          <Icon className="size-6 text-blue-600 dark:text-blue-400" />
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold text-foreground">{tier.display_name}</h3>
          {meta.description ? (
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          ) : null}
        </div>

        <div className="flex items-baseline gap-1">
          {isEnterprise ? (
            <span className="text-2xl font-bold text-foreground">Personalizat</span>
          ) : (
            <>
              <span className="text-3xl font-bold text-foreground">
                {formatPrice(price)}€
              </span>
              <span className="text-sm text-muted-foreground">{suffix}</span>
            </>
          )}
        </div>
      </div>

      <hr className="border-slate-200 dark:border-slate-800" />

      {/* Feature list */}
      <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <UserCog className="size-4 shrink-0 text-primary" />
          {tier.max_admini}
          {isEnterprise ? "+" : ""} administratori
        </li>
        <li className="flex items-center gap-2">
          <Users className="size-4 shrink-0 text-primary" />
          {tier.max_useri}
          {isEnterprise ? "+" : ""} utilizatori
        </li>
        <li className="flex items-center gap-2">
          <FileText className="size-4 shrink-0 text-primary" />
          {isEnterprise ? "examene nelimitate" : `${tier.max_examene} examene`}
        </li>
      </ul>

      <AiTokensChip tier={tier} isEnterprise={isEnterprise} />

      {/* CTA */}
      {isEnterprise ? (
        <a
          href={ENTERPRISE_MAILTO}
          className="mt-auto inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
        >
          Contactează-ne
        </a>
      ) : (
        <Button
          type="button"
          onClick={() => onSelect?.(tier.id)}
          className="btn-primary mt-auto w-full"
        >
          {isSelected ? "Continuă" : `Alege ${tier.display_name}`}
          <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  )
}

export function PlanSelectionStep({
  tiers,
  enterpriseTier,
  selectedTierId,
  onSelect,
}: PlanSelectionStepProps) {
  // Purely presentational, resets to "monthly" on mount (the component unmounts
  // when the user advances to step 2 and remounts on "Înapoi").
  const [billing, setBilling] = useState<BillingCycle>("monthly")

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Monthly / Yearly segmented control */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {(["monthly", "yearly"] as const).map((cycle) => (
            <button
              key={cycle}
              type="button"
              onClick={() => setBilling(cycle)}
              aria-pressed={billing === cycle}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition",
                billing === cycle
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {cycle === "monthly" ? "Lunar" : "Anual"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-3">
        {tiers.map((tier) => (
          <PlanCard
            key={tier.id}
            tier={tier}
            billing={billing}
            isEnterprise={false}
            isRecommended={tier.nume === "pro"}
            isSelected={selectedTierId === tier.id}
            onSelect={onSelect}
          />
        ))}

        {enterpriseTier ? (
          <PlanCard
            tier={enterpriseTier}
            billing={billing}
            isEnterprise
            isRecommended={false}
            isSelected={false}
          />
        ) : null}
      </div>
    </div>
  )
}
