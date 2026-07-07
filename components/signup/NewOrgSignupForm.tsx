"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { Check, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { recordSignupConsent } from "@/lib/legal/record-signup-consent"
import { SignupConsent } from "@/components/signup/SignupConsent"
import { ExistingEmailNotice } from "@/components/signup/ExistingEmailNotice"
import {
  PENDING_ORG_NUME_KEY,
  PENDING_ORG_TIER_KEY,
  type PlanTier,
} from "@/lib/signup/types"
import { cn } from "@/lib/utils"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const ENTERPRISE_MAILTO =
  "mailto:contact@quizhub.ro?subject=Interes%20tier%20Enterprise"

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

type NewOrgSignupFormProps = {
  tiers: PlanTier[]
  enterpriseTier: PlanTier | null
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function NewOrgSignupForm({ tiers, enterpriseTier }: NewOrgSignupFormProps) {
  const [orgName, setOrgName] = useState("")
  const [selectedTierId, setSelectedTierId] = useState<number | null>(
    tiers.length === 1 ? tiers[0].id : null
  )
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [signupDone, setSignupDone] = useState(false)
  const [existingEmail, setExistingEmail] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    if (!orgName.trim()) {
      setErrorMessage("Numele organizației este obligatoriu.")
      return
    }
    if (selectedTierId == null) {
      setErrorMessage("Selectează un plan.")
      return
    }
    if (!EMAIL_REGEX.test(email)) {
      setErrorMessage("Introdu o adresă de email validă.")
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`)
      return
    }
    if (password !== confirmPassword) {
      setErrorMessage("Parolele nu coincid.")
      return
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      setErrorMessage("Trebuie să accepți termenii și politica de confidențialitate.")
      return
    }

    setIsSubmitting(true)
    try {
      const supabase = getSupabaseBrowserClient()
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/admin")}`
      // The org intent is carried in user metadata and consumed in
      // /auth/callback once the email is confirmed (a session only exists then).
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            [PENDING_ORG_NUME_KEY]: orgName.trim(),
            [PENDING_ORG_TIER_KEY]: selectedTierId,
          },
        },
      })

      if (error) {
        setErrorMessage(error.message)
        return
      }

      // With email confirmations on, signing up with an already-registered email
      // returns an obfuscated user with an empty `identities` array (Supabase
      // anti-enumeration). Product decision: disclose this explicitly.
      //
      // Early return BEFORE any further processing: the pending_org_* metadata
      // was passed to signUp() above, but Supabase attaches it only to the
      // throwaway obfuscated user, never to the real account — and since no
      // confirmation email is sent for an existing user, /auth/callback never
      // runs, so no organizatii row is created. We also skip the consent write
      // (throwaway id) and never auto-send a reset.
      const isExistingUser =
        Array.isArray(data.user?.identities) && data.user.identities.length === 0
      if (isExistingUser) {
        setExistingEmail(true)
        return
      }

      if (data.user) {
        await recordSignupConsent(data.user.id)
      }

      setSignupDone(true)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "A apărut o eroare neașteptată."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (existingEmail) {
    return <ExistingEmailNotice email={email} className="max-w-lg" />
  }

  if (signupDone) {
    return (
      <div className="card-surface w-full max-w-lg self-center">
        <div className="flex flex-col items-center gap-4 px-6 py-10 text-center md:px-8">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="size-8 text-emerald-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-foreground">Verifică-ți emailul</h2>
            <p className="text-sm text-muted-foreground">
              Am trimis un link de confirmare la{" "}
              <span className="font-medium text-foreground">{email}</span>. După ce
              confirmi emailul, organizația{" "}
              <span className="font-medium text-foreground">{orgName.trim()}</span> va fi
              creată automat și vei fi dus în panoul de administrare.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card-surface w-full max-w-lg self-center">
      <div className="px-6 pt-6 pb-2 md:px-8 md:pt-8">
        <p className="section-label">Organizație nouă</p>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Înregistrează organizația
        </h1>
      </div>
      <div className="flex flex-col gap-5 px-6 pb-6 pt-2 md:px-8 md:pb-8">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="org-name" className="text-sm font-medium text-foreground">
              Nume organizație
            </label>
            <input
              id="org-name"
              type="text"
              required
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              placeholder="Ex: StarElectro SRL"
              className={inputClass}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">Alege un plan</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {tiers.map((tier) => {
                const selected = selectedTierId === tier.id
                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => setSelectedTierId(tier.id)}
                    aria-pressed={selected}
                    className={cn(
                      "relative flex flex-col rounded-xl border p-4 text-left transition",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-input hover:border-primary/50"
                    )}
                  >
                    {selected ? (
                      <span className="absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    ) : null}
                    <span className="text-base font-semibold text-foreground">
                      {tier.display_name}
                    </span>
                    <span className="mt-1 text-sm text-muted-foreground">
                      {formatPrice(tier.pret_luna)} €/lună ·{" "}
                      {formatPrice(tier.pret_an)} €/an
                    </span>
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <li>👤 {tier.max_admini} administratori</li>
                      <li>👥 {tier.max_useri} utilizatori</li>
                      <li>📝 {tier.max_examene} examene</li>
                    </ul>
                  </button>
                )
              })}

              {enterpriseTier ? (
                <div className="flex flex-col rounded-xl border border-dashed border-input p-4 text-left">
                  <span className="text-base font-semibold text-foreground">
                    {enterpriseTier.display_name}
                  </span>
                  <span className="mt-1 text-sm text-muted-foreground">
                    Soluție personalizată pentru organizații mari.
                  </span>
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <li>👤 {enterpriseTier.max_admini}+ administratori</li>
                    <li>👥 {enterpriseTier.max_useri}+ utilizatori</li>
                    <li>📝 examene nelimitate</li>
                  </ul>
                  <a
                    href={ENTERPRISE_MAILTO}
                    className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
                  >
                    Contactează-ne
                  </a>
                </div>
              ) : null}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Parolă
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={cn(inputClass, "w-full pr-10")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-2 inline-flex items-center text-muted-foreground transition hover:text-foreground"
                aria-label={showPassword ? "Ascunde parola" : "Arată parola"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Minim {MIN_PASSWORD_LENGTH} caractere.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
              Confirmă parola
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={cn(inputClass, "w-full pr-10")}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute inset-y-0 right-2 inline-flex items-center text-muted-foreground transition hover:text-foreground"
                aria-label={showConfirmPassword ? "Ascunde parola" : "Arată parola"}
              >
                {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <SignupConsent
            acceptedTerms={acceptedTerms}
            acceptedPrivacy={acceptedPrivacy}
            onTermsChange={setAcceptedTerms}
            onPrivacyChange={setAcceptedPrivacy}
            disabled={isSubmitting}
            idPrefix="neworg"
          />

          {errorMessage && (
            <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              {errorMessage}
            </p>
          )}

          <Button
            type="submit"
            disabled={
              isSubmitting ||
              selectedTierId == null ||
              !acceptedTerms ||
              !acceptedPrivacy
            }
            className="btn-primary w-full py-3.5 text-base disabled:opacity-60"
          >
            {isSubmitting ? "Se procesează..." : "Creează organizația"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Ai deja un cont?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Conectează-te
          </Link>
        </p>
      </div>
    </div>
  )
}
