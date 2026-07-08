"use client"

import { FormEvent, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NAME_UPDATED_EVENT } from "@/lib/avatar"
import { updateName } from "@/app/profile/actions"

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"

export function NameField({ initialName }: { initialName: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initialName ?? "")
  const [savedValue, setSavedValue] = useState(initialName ?? "")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isDirty = value.trim() !== savedValue.trim()

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isDirty) return
    setError(null)
    setSuccess(false)

    startTransition(async () => {
      const result = await updateName(value)
      if (!result.success) {
        setError(result.error)
        return
      }
      const trimmed = value.trim()
      setValue(trimmed)
      setSavedValue(trimmed)
      setSuccess(true)
      // Notify the header avatar (independent client fetch) + refresh the
      // server-rendered sidebar so initials update without a manual reload.
      window.dispatchEvent(new CustomEvent(NAME_UPDATED_EVENT, { detail: trimmed }))
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
      <label htmlFor="profile-name" className="text-sm text-muted-foreground">
        Nume
      </label>
      <div className="flex items-center gap-2">
        <input
          id="profile-name"
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setSuccess(false)
          }}
          placeholder="Adaugă numele tău"
          className={inputClass}
        />
        {isDirty ? (
          <Button
            type="submit"
            size="icon"
            aria-label="Salvează numele"
            disabled={isPending}
          >
            <Check className="size-4" />
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Numele a fost actualizat.
        </p>
      ) : null}
    </form>
  )
}
