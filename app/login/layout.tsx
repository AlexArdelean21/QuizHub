import type { ReactNode } from "react"
import { GuestChrome } from "@/components/theme/GuestChrome"

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <GuestChrome>{children}</GuestChrome>
}
