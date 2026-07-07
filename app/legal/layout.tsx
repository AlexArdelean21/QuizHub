import type { ReactNode } from "react"
import { GuestChrome } from "@/components/theme/GuestChrome"

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <GuestChrome>{children}</GuestChrome>
}
