import { AppChrome } from "@/components/app-chrome"

export default function MyExamsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppChrome>{children}</AppChrome>
}
