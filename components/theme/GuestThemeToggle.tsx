"use client"

import { useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

/** localStorage key dedicated to the pre-auth (guest) pages. Intentionally
 *  separate from the authenticated app's "theme" key so the two never collide. */
export const GUEST_THEME_STORAGE_KEY = "quizhub-guest-theme"

// The icon is derived directly from the `dark` class on <html> (set by the
// blocking script), never from localStorage — so it can't disagree with the DOM.
// useSyncExternalStore reads that class safely across SSR/hydration without a
// setState-in-effect anti-pattern, and a MutationObserver keeps it in sync when
// the class is toggled (here or by another tab/page).
function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark")
}

function getServerSnapshot(): boolean {
  // Matches the root layout's SSR default (dark) to avoid hydration mismatch.
  return true
}

export function GuestThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark")
    document.documentElement.classList.toggle("dark", next)
    try {
      localStorage.setItem(GUEST_THEME_STORAGE_KEY, next ? "dark" : "light")
    } catch {
      // Ignore storage failures (private mode, etc.) — the toggle still works
      // for the current session; the observer updates the icon from the class.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Comută pe modul luminos" : "Comută pe modul întunecat"}
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  )
}
