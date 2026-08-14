"use client"

import { FormEvent, Suspense, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { PENDING_CONSENT_DOCS_KEY } from "@/lib/signup/types"
import { SignupConsent } from "@/components/signup/SignupConsent"

const TOKEN_REGEX = /^[0-9a-f]{64}$/i

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950" />
      }
    >
      <JoinPageContent />
    </Suspense>
  )
}

function JoinPageContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const tokenIsValid = useMemo(() => TOKEN_REGEX.test(token), [token])

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    if (password !== confirmPassword) {
      setErrorMessage("Parolele nu coincid")
      return
    }
    if (password.length < 6) {
      setErrorMessage("Parola trebuie să aibă cel puțin 6 caractere")
      return
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      setErrorMessage("Trebuie să accepți termenii și politica de confidențialitate.")
      return
    }

    setIsSubmitting(true)
    try {
      const supabase = getSupabaseBrowserClient()
      const appUrl = window.location.origin
      const redirectTo = `${appUrl}/auth/callback?invite=${token}`

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            [PENDING_CONSENT_DOCS_KEY]: ["termeni", "confidentialitate"],
          },
        },
      })

      if (error) {
        setErrorMessage(error.message)
        return
      }

      setSubmitted(true)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "A apărut o eroare neașteptată."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="mb-8 text-center">
        <h1 className="bg-gradient-to-r from-blue-600 via-sky-400 to-blue-500 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
          QuizHub
        </h1>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        {!tokenIsValid ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Link invalid
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Link invalid sau expirat. Cere un link nou administratorului.
            </p>
            <Link
              href="/login"
              className="text-sm font-medium text-blue-600 underline-offset-4 transition hover:underline dark:text-blue-400"
            >
              Înapoi la conectare
            </Link>
          </div>
        ) : submitted ? (
          <div className="flex flex-col items-center gap-4 text-center">
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
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Verifică emailul!
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ți-am trimis un link de confirmare. După ce confirmi emailul, vei fi
              adăugat automat în organizație.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">
                Ai fost invitat pe QuizHub!
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Creează un cont pentru a te alătura organizației.
              </p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="text-sm font-medium text-slate-900 dark:text-white"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-slate-900 dark:text-white"
                >
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-2 inline-flex items-center text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label={showPassword ? "Ascunde parola" : "Arată parola"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="confirm-password"
                  className="text-sm font-medium text-slate-900 dark:text-white"
                >
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-2 inline-flex items-center text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
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
                idPrefix="join"
              />

              {errorMessage && (
                <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  {errorMessage}
                </p>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 py-3.5 text-base text-white hover:bg-blue-500 disabled:opacity-60"
              >
                {isSubmitting ? "Se procesează..." : "Creează cont și alătură-te"}
              </Button>
            </form>

            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Ai deja un cont?{" "}
              <Link
                href="/login"
                className="font-medium text-blue-600 underline-offset-4 transition hover:underline dark:text-blue-400"
              >
                Conectează-te
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
