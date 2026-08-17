"use client"

import { useState } from "react"
import { PlanSelectionStep } from "@/components/signup/new-org/PlanSelectionStep"
import { OrgNameStep } from "@/components/org/OrgNameStep"
import { cn } from "@/lib/utils"
import type { PlanTier } from "@/lib/signup/types"

type CreateOrgFormProps = {
  tiers: PlanTier[]
  enterpriseTier: PlanTier | null
}

type Step = "plan" | "nume"

/**
 * Two-step create-organization flow for an already-authenticated user with no
 * org. Same shell as NewOrgSignupForm (progress + PlanSelectionStep); step 2
 * is just the org name, not account details.
 */
export function CreateOrgForm({ tiers, enterpriseTier }: CreateOrgFormProps) {
  const [step, setStep] = useState<Step>("plan")
  const [selectedTierId, setSelectedTierId] = useState<number | null>(null)
  const [orgName, setOrgName] = useState("")

  const handleSelectTier = (tierId: number) => {
    setSelectedTierId(tierId)
    setStep("nume")
  }

  const onNume = step === "nume" && selectedTierId != null

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          Pasul {onNume ? 2 : 1} din 2
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
              onNume ? "bg-primary" : "bg-border"
            )}
          />
        </div>
      </div>

      {onNume ? (
        <OrgNameStep
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
