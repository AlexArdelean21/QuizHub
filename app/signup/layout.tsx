import type { ReactNode } from "react"
import { GuestChrome } from "@/components/theme/GuestChrome"

export default function SignupLayout({ children }: { children: ReactNode }) {
  return <GuestChrome>{children}</GuestChrome>
}
