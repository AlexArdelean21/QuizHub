import { redirect } from "next/navigation"
import { Inbox } from "lucide-react"
import { getAdminContext } from "@/lib/auth/admin-context"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  listPendingJoinRequests,
  type PendingJoinRequest,
} from "@/app/admin/join-requests/actions"
import { JoinRequestsList } from "@/components/admin/JoinRequestsList"

export const dynamic = "force-dynamic"
export const metadata = { title: "Cereri de aderare — QuizHub" }

export default async function JoinRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>
}) {
  // Same auth gate as /admin/global: getAdminContext returns null for plain
  // users (and for org_admins without an org), so they never reach the fetch.
  const context = await getAdminContext()
  if (!context) {
    redirect("/")
  }

  const { org } = await searchParams
  const mode: "super_admin" | "org_admin" = context.isSuperAdmin
    ? "super_admin"
    : "org_admin"

  // org_admin is always scoped to their own org; super_admin picks one via ?org.
  const selectedOrgId = mode === "super_admin" ? (org ?? null) : context.orgId

  // Org picker options (super_admin only). RLS already restricts what they see.
  let organizations: { id: string; nume: string }[] = []
  if (mode === "super_admin") {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase
      .from("organizatii")
      .select("id, nume")
      .order("nume", { ascending: true })
    organizations = (data ?? []).map((o) => ({
      id: String(o.id),
      nume: String(o.nume),
    }))
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground md:text-3xl">
          Cereri de aderare
        </h1>
        <p className="text-sm text-muted-foreground">
          Aprobă sau respinge utilizatorii care vor să se alăture{" "}
          {mode === "super_admin" ? "unei organizații" : "organizației tale"}.
        </p>
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

      {loadError ? (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
          {loadError}
        </p>
      ) : null}

      {selectedOrgId ? (
        requests.length === 0 && !loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-16 text-center shadow-sm">
            <Inbox className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nu există cereri în așteptare.
            </p>
          </div>
        ) : (
          <JoinRequestsList orgId={selectedOrgId} requests={requests} />
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          Selectează o organizație pentru a vedea cererile în așteptare.
        </p>
      )}
    </div>
  )
}
