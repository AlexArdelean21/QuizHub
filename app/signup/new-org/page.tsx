import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { createSupabaseAdminClient } from "@/lib/supabase/admin"
import { NewOrgSignupForm } from "@/components/signup/NewOrgSignupForm"
import type { PlanTier } from "@/lib/signup/types"

export const metadata = { title: "Organizație nouă — QuizHub" }

type PlanTierRow = {
  id: number
  nume: string
  display_name: string | null
  max_admini: number
  max_useri: number
  max_examene: number
  tokeni_lunari: number | null
  pret_luna: number | string | null
  pret_an: number | string | null
  este_activ: boolean
}

function toPlanTier(row: PlanTierRow): PlanTier {
  return {
    id: row.id,
    nume: row.nume,
    display_name: row.display_name ?? row.nume,
    max_admini: row.max_admini,
    max_useri: row.max_useri,
    max_examene: row.max_examene,
    tokeni_lunari: Number(row.tokeni_lunari ?? 0),
    pret_luna: Number(row.pret_luna ?? 0),
    pret_an: Number(row.pret_an ?? 0),
  }
}

export default async function NewOrgSignupPage() {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from("plan_tiers")
    .select(
      "id, nume, display_name, max_admini, max_useri, max_examene, tokeni_lunari, pret_luna, pret_an, este_activ"
    )
    .eq("este_activ", true)
    .order("id")

  const rows = (data ?? []) as PlanTierRow[]
  const selectableTiers = rows
    .filter((row) => row.nume !== "enterprise")
    .map(toPlanTier)
  const enterpriseRow = rows.find((row) => row.nume === "enterprise")
  const enterpriseTier = enterpriseRow ? toPlanTier(enterpriseRow) : null

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="self-center text-center">
          <h1 className="bg-gradient-to-r from-primary via-sky-400 to-blue-500 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            QuizHub
          </h1>
        </div>

        <div className="w-full max-w-lg self-center">
          <Link
            href="/signup"
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            Înapoi
          </Link>
        </div>

        <NewOrgSignupForm tiers={selectableTiers} enterpriseTier={enterpriseTier} />
      </main>
    </div>
  )
}
