"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { recordSignupConsent } from "@/lib/legal/record-signup-consent"
import { SignupConsent } from "@/components/signup/SignupConsent"
import { ExistingEmailNotice } from "@/components/signup/ExistingEmailNotice"
import { cn } from "@/lib/utils"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

export function PersonalSignupForm() {
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
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/")}`
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      })

      if (error) {
        setErrorMessage(error.message)
        return
      }

      // With email confirmations on, signing up with an already-registered email
      // returns an obfuscated user with an empty `identities` array (Supabase
      // anti-enumeration). Product decision: disclose this explicitly instead of
      // hiding it. Short-circuit here — no consent write (the id is a throwaway)
      // and no reset email; the user chooses to send one from the notice.
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
    return <ExistingEmailNotice email={email} className="max-w-md" />
  }

  if (signupDone) {
    return (
      <div className="card-surface w-full max-w-md self-center">
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
              <span className="font-medium text-foreground">{email}</span>. Accesează
              linkul pentru a-ți activa contul.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card-surface w-full max-w-md self-center">
      <div className="px-6 pt-6 pb-2 md:px-8 md:pt-8">
        <p className="section-label">Cont personal</p>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">Creare cont</h1>
      </div>
      <div className="flex flex-col gap-5 px-6 pb-6 pt-2 md:px-8 md:pb-8">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
            idPrefix="personal"
          />

          {errorMessage && (
            <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              {errorMessage}
            </p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !acceptedTerms || !acceptedPrivacy}
            className="btn-primary w-full py-3.5 text-base disabled:opacity-60"
          >
            {isSubmitting ? "Se procesează..." : "Creare cont"}
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
