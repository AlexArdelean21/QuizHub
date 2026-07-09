"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"

export function OrgCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">Cod organizație</span>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
          {code}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          {copied ? "Copiat" : "Copiază"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Trimite codul membrilor care vor să se alăture acestei organizații.
      </p>
    </div>
  )
}
