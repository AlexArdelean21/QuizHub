"use client"

import Link from "next/link"
import { Checkbox } from "@/components/ui/checkbox"

export type SignupConsentProps = {
  acceptedTerms: boolean
  acceptedPrivacy: boolean
  onTermsChange: (checked: boolean) => void
  onPrivacyChange: (checked: boolean) => void
  disabled?: boolean
  idPrefix?: string
}

/**
 * The GDPR consent checkboxes shown at signup (terms + privacy). Ported from the
 * original /login signup form so consent is recorded identically on both the
 * personal and new-organization signup variants.
 */
export function SignupConsent({
  acceptedTerms,
  acceptedPrivacy,
  onTermsChange,
  onPrivacyChange,
  disabled = false,
  idPrefix = "signup",
}: SignupConsentProps) {
  const termsId = `${idPrefix}-accept-terms`
  const privacyId = `${idPrefix}-accept-privacy`

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id={termsId}
          checked={acceptedTerms}
          onCheckedChange={(checked) => onTermsChange(checked === true)}
          disabled={disabled}
          className="mt-0.5"
        />
        <label
          htmlFor={termsId}
          className="cursor-pointer text-sm leading-tight text-muted-foreground"
        >
          Sunt de acord cu{" "}
          <Link
            href="/legal/termeni"
            target="_blank"
            className="text-foreground underline underline-offset-4"
          >
            Termenii și condițiile
          </Link>
        </label>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id={privacyId}
          checked={acceptedPrivacy}
          onCheckedChange={(checked) => onPrivacyChange(checked === true)}
          disabled={disabled}
          className="mt-0.5"
        />
        <label
          htmlFor={privacyId}
          className="cursor-pointer text-sm leading-tight text-muted-foreground"
        >
          Am citit și sunt de acord cu{" "}
          <Link
            href="/legal/confidentialitate"
            target="_blank"
            className="text-foreground underline underline-offset-4"
          >
            Politica de confidențialitate
          </Link>
        </label>
      </div>
    </div>
  )
}
