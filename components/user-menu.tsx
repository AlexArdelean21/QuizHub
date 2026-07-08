"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getInitials, NAME_UPDATED_EVENT } from "@/lib/avatar"

export function UserMenu({
  name,
  email,
}: {
  name: string | null
  email: string
}) {
  const [displayName, setDisplayName] = useState(name)

  // Keep the avatar in sync with an inline name edit on /profile without
  // requiring a manual browser refresh (this header fetches independently).
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      setDisplayName(typeof detail === "string" ? detail : null)
    }
    window.addEventListener(NAME_UPDATED_EVENT, handler as EventListener)
    return () =>
      window.removeEventListener(NAME_UPDATED_EVENT, handler as EventListener)
  }, [])

  const initials = getInitials(displayName, email)

  return (
    <Link
      href="/profile"
      aria-label="Profilul meu"
      className="inline-flex size-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white outline-none transition hover:bg-blue-600/90 focus-visible:ring-2 focus-visible:ring-blue-500/50"
    >
      {initials}
    </Link>
  )
}
