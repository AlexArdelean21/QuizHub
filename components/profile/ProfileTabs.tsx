import { type ReactNode } from "react"
import { Building2, FileText, Settings, User, type LucideIcon } from "lucide-react"

type ProfileTabId = "date" | "org" | "examene" | "setari"

type TabDef = { id: ProfileTabId; label: string; icon: LucideIcon }

const TABS: TabDef[] = [
  { id: "date", label: "Date personale", icon: User },
  { id: "org", label: "Organizație", icon: Building2 },
  { id: "examene", label: "Examene proprii", icon: FileText },
  { id: "setari", label: "Setări cont", icon: Settings },
]

export function ProfileTabs({
  // name / email / roleLabel / isPlainUser are kept in the props contract
  // (the page still passes them) but the identity block they fed now lives in
  // the page header card, so they are intentionally no longer read here.
  datePersonale,
  organizatie,
  examene,
  setari,
}: {
  name: string | null
  email: string
  roleLabel: string
  isPlainUser: boolean
  datePersonale: ReactNode
  organizatie: ReactNode
  examene: ReactNode
  setari: ReactNode
}) {
  return (
    <div className="lg:flex lg:items-start lg:gap-12">
      {/* Desktop-only anchor sidebar (docs-style). No active-state logic. */}
      <aside className="hidden lg:block lg:w-52 lg:shrink-0">
        <nav className="sticky top-20 flex flex-col gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <a
                key={tab.id}
                href={`#${tab.id}`}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4 shrink-0" />
                {tab.label}
              </a>
            )
          })}
        </nav>
      </aside>

      {/* All sections stacked in a single scroll; scroll-mt-24 clears the
          sticky GlobalHeader when an anchor is jumped to. */}
      <main className="min-w-0 flex-1 space-y-10">
        <section id="date" className="scroll-mt-24">{datePersonale}</section>
        <section id="org" className="scroll-mt-24">{organizatie}</section>
        <section id="examene" className="scroll-mt-24">{examene}</section>
        <section id="setari" className="scroll-mt-24">{setari}</section>
      </main>
    </div>
  )
}
