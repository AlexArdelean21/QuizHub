import { type ReactNode } from "react"

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
  // All sections live in ONE card, split by dividers. The anchor sidebar was
  // removed (page is too short to warrant a table of contents); the section
  // ids + scroll-mt-24 are kept so re-adding it later is trivial.
  return (
    <main className="min-w-0">
      <div className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
        <section id="date" className="scroll-mt-24 p-6">{datePersonale}</section>
        <section id="org" className="scroll-mt-24 p-6">{organizatie}</section>
        <section id="examene" className="scroll-mt-24 p-6">{examene}</section>
        <section id="setari" className="scroll-mt-24 p-6">{setari}</section>
      </div>
    </main>
  )
}
