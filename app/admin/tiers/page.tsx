import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { TiersPageClient } from "@/components/admin/tiers/TiersPageClient"
import type { OrgTierRow, PlanTier } from "@/components/admin/tiers/types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Gestionare Tiers — QuizHub Admin" }

export default async function TiersPage() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "super_admin") redirect("/dashboard")

  const [{ data: tiers }, { data: organizatii }] = await Promise.all([
    supabase.from("plan_tiers").select("*").order("id"),
    supabase
      .from("organizatii")
      .select(
        `
        id, nume, slug,
        tier_id, subscription_status, is_managed_manually,
        grandfathered, over_limit, ai_import_enabled, cod_org_custom_override,
        max_admini, max_useri, max_examene,
        tokeni_lunari, tokeni_consumati_luna,
        past_due_at, suspended_at, actualizat_la
      `
      )
      .order("nume"),
  ])

  return (
    <TiersPageClient
      initialTiers={(tiers ?? []) as PlanTier[]}
      initialOrganizatii={(organizatii ?? []).map((row) => ({
        ...(row as OrgTierRow),
        cod_org_custom_override: Boolean(
          (row as { cod_org_custom_override?: boolean | null }).cod_org_custom_override
        ),
      }))}
    />
  )
}
