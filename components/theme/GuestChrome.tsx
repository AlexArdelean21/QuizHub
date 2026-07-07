import type { ReactNode } from "react"
import { GuestThemeToggle } from "@/components/theme/GuestThemeToggle"

// Blocking, pre-hydration theme setup for guest pages. Runs synchronously as the
// browser parses this node (before the guest content paints), so switching to
// light mode never flashes the dark default. Reads "quizhub-guest-theme"
// (defaults to "dark") and toggles the same `dark` class the pages already use.
const GUEST_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("quizhub-guest-theme");if(t!=="light"&&t!=="dark"){t="dark";}document.documentElement.classList.toggle("dark",t==="dark");}catch(e){document.documentElement.classList.add("dark");}})();`

/**
 * Shared wrapper for the pre-auth pages (/login, /signup/*, /legal/*). Provides
 * the no-flash theme script and a floating light/dark toggle without touching
 * the authenticated app's theme logic (AppChrome / GlobalHeader).
 */
export function GuestChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: GUEST_THEME_SCRIPT }} />
      <div className="fixed right-4 top-4 z-50">
        <GuestThemeToggle />
      </div>
      {children}
    </>
  )
}
