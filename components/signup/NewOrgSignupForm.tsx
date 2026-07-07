"use client"

import { useState } from "react"
import { PlanSelectionStep } from "@/components/signup/new-org/PlanSelectionStep"
import { AccountDetailsStep } from "@/components/signup/new-org/AccountDetailsStep"
import { cn } from "@/lib/utils"
import type { PlanTier } from "@/lib/signup/types"

type NewOrgSignupFormProps = {
  tiers: PlanTier[]
  enterpriseTier: PlanTier | null
}

type Step = "plan" | "details"

/**
 * Two-step new-organization signup, orchestrated purely with client state (same
 * /signup/new-org route). Step 1 = plan selection, Step 2 = account details.
 * The selected tier and org name live here so they survive back-navigation;
 * email/password intentionally reset on "Înapoi" (they live in Step 2 and the
 * cost of persisting them outweighs the benefit).
 */
export function NewOrgSignupForm({ tiers, enterpriseTier }: NewOrgSignupFormProps) {
  const [step, setStep] = useState<Step>("plan")
  const [selectedTierId, setSelectedTierId] = useState<number | null>(null)
  const [orgName, setOrgName] = useState("")

  const handleSelectTier = (tierId: number) => {
    setSelectedTierId(tierId)
    setStep("details")
  }

  const onDetails = step === "details" && selectedTierId != null

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {/* Progress indicator */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          Pasul {onDetails ? 2 : 1} din 2
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-8 rounded-full transition-colors",
              "bg-primary"
            )}
          />
          <span
            className={cn(
              "h-1.5 w-8 rounded-full transition-colors",
              onDetails ? "bg-primary" : "bg-border"
            )}
          />
        </div>
      </div>

      {onDetails ? (
        <AccountDetailsStep
          tierId={selectedTierId}
          orgName={orgName}
          onOrgNameChange={setOrgName}
          onBack={() => setStep("plan")}
        />
      ) : (
        <PlanSelectionStep
          tiers={tiers}
          enterpriseTier={enterpriseTier}
          selectedTierId={selectedTierId}
          onSelect={handleSelectTier}
        />
      )}
    </div>
  )
}
