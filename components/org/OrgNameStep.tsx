"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createOrgFromDashboard } from "@/app/org/creeaza/actions"

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

type OrgNameStepProps = {
  tierId: number
  orgName: string
  onOrgNameChange: (value: string) => void
  onBack: () => void
}

export function OrgNameStep({
  tierId,
  orgName,
  onOrgNameChange,
  onBack,
}: OrgNameStepProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    if (!orgName.trim()) {
      setErrorMessage("Numele organizației este obligatoriu.")
      return
    }

    setIsSubmitting(true)
    try {
      const result = await createOrgFromDashboard(orgName, tierId)
      if (!result.success) {
        setErrorMessage(result.error)
        return
      }
      router.push("/admin")
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "A apărut o eroare neașteptată."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="card-surface w-full max-w-lg self-center">
      <div className="px-6 pt-6 pb-2 md:px-8 md:pt-8">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Înapoi
        </button>
        <p className="section-label">Organizație nouă</p>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Numele organizației
        </h1>
      </div>
      <div className="flex flex-col gap-5 px-6 pb-6 pt-2 md:px-8 md:pb-8">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="org-name" className="text-sm font-medium text-foreground">
              Nume organizație
            </label>
            <input
              id="org-name"
              type="text"
              required
              autoFocus
              value={orgName}
              onChange={(event) => onOrgNameChange(event.target.value)}
              placeholder="Ex: StarElectro SRL"
              className={inputClass}
            />
          </div>

          {errorMessage ? (
            <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full py-3.5 text-base disabled:opacity-60"
          >
            {isSubmitting ? "Se creează..." : "Creează organizația"}
          </Button>
        </form>
      </div>
    </div>
  )
}
