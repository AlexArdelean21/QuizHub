"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { triggerSilentPasswordReset } from "@/lib/auth/silent-password-reset"
import { cn } from "@/lib/utils"

type ExistingEmailNoticeProps = {
  email: string
  /** Width class so this matches the form it replaces (e.g. max-w-md / max-w-lg). */
  className?: string
}

/**
 * Explicit duplicate-email disclosure shown after signUp() reports the email
 * already belongs to an account (identities.length === 0). No reset email is
 * sent automatically — the user must click the button, which reuses the same
 * /api/auth/reset-password call as the login "Ai uitat parola?" flow.
 */
export function ExistingEmailNotice({ email, className }: ExistingEmailNoticeProps) {
  const [isSending, setIsSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSendReset = async () => {
    if (isSending || sent) return
    setIsSending(true)
    await triggerSilentPasswordReset(email)
    setIsSending(false)
    setSent(true)
  }

  return (
    <div className={cn("card-surface w-full self-center", className)}>
      <div className="flex flex-col gap-4 px-6 py-8 md:px-8">
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Acest email este deja înregistrat.
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{email}</span> are deja un
              cont pe QuizHub.
            </p>
          </div>
        </div>

        {sent ? (
          <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            Ți-am trimis un email de resetare, dacă acest cont există.
          </p>
        ) : (
          <Button
            type="button"
            onClick={handleSendReset}
            disabled={isSending}
            className="btn-primary w-full py-3.5 text-base disabled:opacity-60"
          >
            {isSending ? "Se trimite..." : "Trimite link de resetare a parolei"}
          </Button>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Conectează-te
          </Link>
        </p>
      </div>
    </div>
  )
}
