"use client"

import { FormEvent, Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { migrateAnonymousCookieConsent } from "@/lib/legal/consent-migration"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginSuccess, setLoginSuccess] = useState(false)
  const [message, setMessage] = useState<string | null>(() => {
    if (searchParams.get("confirmed") === "true") {
      return "Cont confirmat cu succes! Te poți autentifica acum."
    }
    if (searchParams.get("reset") === "true") {
      return "Parola a fost actualizată cu succes! Te poți autentifica cu noua parolă."
    }
    return null
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    // The old signup lived at /login?tab=signup — send those visitors to the
    // new dedicated signup selector.
    if (searchParams.get("tab") === "signup") {
      router.replace("/signup")
    }
  }, [searchParams, router])

  const clearFeedback = () => {
    setMessage(null)
    setErrorMessage(null)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearFeedback()
    setIsSubmitting(true)

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      })
      const result = await response.json()

      if (!response.ok) {
        setErrorMessage(result.error ?? "Nu s-a putut face autentificarea.")
        setIsSubmitting(false)
        return
      }

      // Briefly morph the button into a green checkmark before navigating
      // so the success is visible. The full reload happens right after.
      setLoginSuccess(true)
      // Migrate any localStorage cookie-consent record to the DB now that
      // we have an authenticated session. Errors are swallowed inside.
      await migrateAnonymousCookieConsent()
      await new Promise((resolve) => setTimeout(resolve, 700))
      window.location.href = result.redirectTo ?? "/"
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "A apărut o eroare neașteptată."
      )
      setIsSubmitting(false)
    }
  }

  const handleForgotPassword = async () => {
    clearFeedback()
    if (!email) {
      setErrorMessage("Introdu mai întâi adresa de email.")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMessage(data.error ?? "Nu s-a putut trimite email-ul.")
        return
      }

      setMessage("Am trimis email-ul pentru resetarea parolei.")
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Nu s-a putut trimite email-ul."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="self-center text-center">
          <h1 className="bg-gradient-to-r from-primary via-sky-400 to-blue-500 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            QuizHub
          </h1>
        </div>

        <div className="card-surface w-full max-w-md self-center">
          <div className="px-6 pt-6 pb-2 md:px-8 md:pt-8">
            <p className="section-label">Autentificare</p>
            <h1 className="text-2xl font-semibold text-foreground md:text-3xl">Conectare</h1>
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
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
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
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
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
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-sky-600 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
                />
                Ține-mă minte
              </label>

              {errorMessage && (
                <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  {errorMessage}
                </p>
              )}
              {message && (
                <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                  {message}
                </p>
              )}

              <Button
                type="submit"
                disabled={isSubmitting || loginSuccess}
                className={cn(
                  "btn-primary w-full py-3.5 text-base disabled:opacity-60",
                  loginSuccess && "button-success"
                )}
              >
                {loginSuccess ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="check-draw size-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        stroke="white"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Conectat</span>
                  </span>
                ) : isSubmitting ? (
                  "Se procesează..."
                ) : (
                  "Conectare"
                )}
              </Button>
            </form>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleForgotPassword}
              className="text-left text-sm text-primary underline-offset-4 transition hover:underline disabled:opacity-50"
            >
              Ai uitat parola?
            </button>

            <p className="text-center text-sm text-muted-foreground">
              Nu ai cont?{" "}
              <Link
                href="/signup"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Creează unul
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
