"use client"

import { FormEvent, useState, useTransition } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { changePassword } from "@/app/profile/actions"

const MIN_PASSWORD_LENGTH = 8

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

export function PasswordChangeForm() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`)
      return
    }
    if (password !== confirmPassword) {
      setError("Parolele nu coincid.")
      return
    }

    startTransition(async () => {
      const result = await changePassword(password)
      if (!result.success) {
        setError(result.error)
        return
      }
      setPassword("")
      setConfirmPassword("")
      setSuccess("Parola a fost actualizată cu succes.")
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Alege o parolă nouă pentru contul tău.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-sm font-medium text-foreground">
          Parolă nouă
        </label>
        <p className="text-xs text-muted-foreground">Minim {MIN_PASSWORD_LENGTH} caractere.</p>
        <div className="relative">
          <input
            id="new-password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-new-password" className="text-sm font-medium text-foreground">
          Confirmă parola
        </label>
        <div className="relative">
          <input
            id="confirm-new-password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          {success}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full sm:w-auto sm:self-start">
        {isPending ? "Se salvează..." : "Schimbă parola"}
      </Button>
    </form>
  )
}
