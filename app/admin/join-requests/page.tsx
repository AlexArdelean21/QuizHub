import { redirect } from "next/navigation"
import { Inbox, Users } from "lucide-react"
import { getAdminContext } from "@/lib/auth/admin-context"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  listPendingJoinRequests,
  type PendingJoinRequest,
} from "@/app/admin/join-requests/actions"
import { JoinRequestsList } from "@/components/admin/JoinRequestsList"
import { InviteManagement } from "@/components/admin/InviteManagement"
import { OrgCodeDisplay } from "@/components/profile/OrgCodeDisplay"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const dynamic = "force-dynamic"
export const metadata = { title: "Invitații și cereri — QuizHub" }

type OrgPageData = {
  id: string
  nume: string
  cod_org: string | null
  invite_links_enabled: boolean
  cod_org_custom_override: boolean
  tierNume: string | null
}

function extractTierNume(relation: unknown): string | null {
  const record = Array.isArray(relation) ? relation[0] : relation
  if (record && typeof record === "object" && "nume" in record) {
    const nume = (record as { nume?: unknown }).nume
    return typeof nume === "string" ? nume : null
  }
  return null
}

function canEditOrgCode(
  tierNume: string | null,
  customOverride: boolean
): boolean {
  if (customOverride) return true
  const normalized = (tierNume ?? "").trim().toLowerCase()
  return normalized === "pro" || normalized === "enterprise"
}

export default async function MembersInvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>
}) {
  const context = await getAdminContext()
  if (!context) {
    redirect("/")
  }

  const { org } = await searchParams
  const mode: "super_admin" | "org_admin" = context.isSuperAdmin
    ? "super_admin"
    : "org_admin"

  const selectedOrgId = mode === "super_admin" ? (org ?? null) : context.orgId

  const supabase = await createSupabaseServerClient()

  let organizations: { id: string; nume: string }[] = []
  if (mode === "super_admin") {
    const { data } = await supabase
      .from("organizatii")
      .select("id, nume")
      .order("nume", { ascending: true })
    organizations = (data ?? []).map((o) => ({
      id: String(o.id),
      nume: String(o.nume),
    }))
  }

  let orgData: OrgPageData | null = null
  if (selectedOrgId) {
    const { data } = await supabase
      .from("organizatii")
      .select(
        "id, nume, cod_org, invite_links_enabled, cod_org_custom_override, plan_tiers(nume)"
      )
      .eq("id", selectedOrgId)
      .maybeSingle()

    if (data) {
      orgData = {
        id: String(data.id),
        nume: String(data.nume ?? ""),
        cod_org: data.cod_org ? String(data.cod_org) : null,
        invite_links_enabled: Boolean(data.invite_links_enabled),
        cod_org_custom_override: Boolean(data.cod_org_custom_override),
        tierNume: extractTierNume(data.plan_tiers),
      }
    }
  }

  let requests: PendingJoinRequest[] = []
  let loadError: string | null = null
  if (selectedOrgId) {
    const result = await listPendingJoinRequests(selectedOrgId)
    if (result.success) {
      requests = result.requests
    } else {
      loadError = result.error
    }
  }

  const showOrgCode =
    Boolean(orgData?.cod_org) &&
    (mode === "org_admin" || mode === "super_admin")
  const editEligible = orgData
    ? canEditOrgCode(orgData.tierNume, orgData.cod_org_custom_override)
    : false

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-600 dark:text-blue-300">
            <Users className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground md:text-3xl">
              Invitații și cereri
            </h1>
            <p className="text-sm text-muted-foreground">
              Codul organizației, linkuri de invitație și cereri de aderare —
              într-un singur loc.
            </p>
          </div>
        </div>
      </div>

      {mode === "super_admin" ? (
        <form method="get" className="flex flex-col gap-2">
          <label htmlFor="org-picker" className="text-sm text-muted-foreground">
            Organizație
          </label>
          <select
            id="org-picker"
            name="org"
            defaultValue={selectedOrgId ?? ""}
            className="max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">— Alege o organizație —</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nume}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn-primary max-w-max rounded-lg px-4 py-2 text-sm font-medium"
          >
            Afișează
          </button>
        </form>
      ) : null}

      {!selectedOrgId ? (
        <p className="text-sm text-muted-foreground">
          Selectează o organizație pentru a gestiona invitațiile și cererile.
        </p>
      ) : !orgData ? (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
          Organizația nu a fost găsită.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {showOrgCode && orgData.cod_org ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cod organizație</CardTitle>
                <CardDescription>
                  Trimite acest cod membrilor care vor să trimită o cerere de
                  aderare.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OrgCodeDisplay
                  code={orgData.cod_org}
                  orgId={orgData.id}
                  canEdit={editEligible}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cereri de aderare</CardTitle>
              <CardDescription>
                Aprobă sau respinge utilizatorii care vor să se alăture
                organizației.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadError ? (
                <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  {loadError}
                </p>
              ) : requests.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 px-6 py-12 text-center">
                  <Inbox className="size-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Nu există cereri în așteptare.
                  </p>
                </div>
              ) : (
                <JoinRequestsList orgId={orgData.id} requests={requests} />
              )}
            </CardContent>
          </Card>

          {/* No CardHeader here on purpose: InviteManagement renders its own
              header as the collapse trigger (title + active badge + chevron),
              so a CardTitle would duplicate it. Card + CardContent still match
              the chrome and padding of the sections above. */}
          <Card>
            <CardContent>
              <InviteManagement
                orgId={orgData.id}
                inviteLinksEnabled={orgData.invite_links_enabled}
                isSuperAdmin={mode === "super_admin"}
                collapsible
                orgName={orgData.nume}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
