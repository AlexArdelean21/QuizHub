import type { SupabaseClient } from "@supabase/supabase-js"
import { QuizInterface } from "@/components/quiz/quiz-interface-v2"
import { Homepage } from "@/components/homepage/Homepage"
import { AppChrome } from "@/components/app-chrome"
import { OrgBanner } from "@/components/dashboard/OrgBanner"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getPublicStats } from "@/lib/public-stats"

export const dynamic = "force-dynamic"

export default async function Page() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    return (
      <AppChrome>
        <QuizInterface banner={await orgBannerSlot(supabase, user.id)} />
      </AppChrome>
    )
  }

  const stats = await getPublicStats()
  return <Homepage stats={stats} />
}

/**
 * Decides server-side whether the "join an organization" banner is relevant.
 *
 * Users who already belong to an org never mount the banner at all. Everyone
 * else does, with `initialHidden` telling the client whether to paint it — the
 * component stays mounted across router.refresh() so a success toast raised
 * just before the banner hides itself is not torn down with it.
 */
async function orgBannerSlot(
  supabase: SupabaseClient,
  userId: string
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, hide_org_banner")
    .eq("id", userId)
    .maybeSingle()

  if (!profile || profile.org_id !== null) return null

  const { count: pendingCount } = await supabase
    .from("org_join_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending")

  const initialHidden = profile.hide_org_banner === true || (pendingCount ?? 0) > 0

  return <OrgBanner initialHidden={initialHidden} />
}
