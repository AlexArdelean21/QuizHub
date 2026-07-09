"use client"

import { FormEvent, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { updateEmail } from "@/app/profile/actions"

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

export function EmailField({ initialEmail }: { initialEmail: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initialEmail)
  // The confirmed email never changes client-side (the new address only takes
  // effect after the user clicks the confirmation link), so this stays fixed.
  const [savedValue] = useState(initialEmail)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isDirty = value.trim().toLowerCase() !== savedValue.trim().toLowerCase()

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isDirty) return
    setError(null)

    startTransition(async () => {
      const result = await updateEmail(value)
      if (!result.success) {
        setError(result.error)
        return
      }
      const trimmed = value.trim().toLowerCase()
      setPendingEmail(trimmed)
      // Revert the input to the confirmed value; the pending change hasn't been
      // applied yet on the server side until the user clicks the confirmation
      // link, so we should reflect that.
      setValue(savedValue)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
      <label htmlFor="profile-email" className="text-sm text-muted-foreground">
        Email
      </label>
      <div className="flex items-center gap-2">
        <input
          id="profile-email"
          type="email"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          className={inputClass}
          autoComplete="email"
        />
        {isDirty ? (
          <Button type="submit" size="icon" aria-label="Salvează emailul" disabled={isPending}>
            <Check className="size-4" />
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      {pendingEmail ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Am trimis un email de confirmare la <strong>{pendingEmail}</strong>. Adresa se va schimba
          doar după ce apeși linkul din email.
        </p>
      ) : null}
    </form>
  )
}
