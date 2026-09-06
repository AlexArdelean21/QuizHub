import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Shared CTA classes so the primary actions across the quiz flow
// ("Începe quiz-ul", "Vezi greșelile", "Gata", ...)
// have identical height, radius, padding and color treatment in both
// light and dark mode. Keep these in one place to avoid drift.
export const PRIMARY_CTA_CLASS =
  'h-12 w-full rounded-xl bg-white text-base font-semibold text-black shadow-sm transition-colors hover:bg-white/90 disabled:opacity-60'

export const SECONDARY_CTA_CLASS =
  'h-12 w-full rounded-xl border-2 border-border bg-transparent text-base font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60'

/**
 * Reads an `<input type="number">` value into state that can be genuinely
 * empty, returning `undefined` for a cleared field.
 *
 * Coercing the raw string with `Number()` turns "" into 0, which a controlled
 * input immediately renders back as "0" — the field then looks stuck and can't
 * be cleared without selecting the zero first. Pair this with
 * `value={x ?? ''}` and a `placeholder` showing the fallback.
 */
export function parseNumericInput(raw: string): number | undefined {
  if (raw.trim() === '') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}
