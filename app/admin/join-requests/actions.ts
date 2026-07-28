"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export type JoinRequestActionResult = { success: true } | { success: false; error: string }

export type PendingJoinRequest = {
  id: string
  user_id: string
  nume: string | null
  email: string | null
  message: string | null
  requested_at: string
}

/**
 * List pending join requests for a specific org. Authorization is enforced
 * INSIDE `public.get_pending_join_requests` (returns empty set unless the
 * caller is super_admin or org_admin of exactly this org), so this wrapper
 * doesn't need to re-check the caller's role.
 *
 * For super_admins looking across all orgs, this function must be called
 * once per org. Do not fan-out here — the UI decides which org to inspect.
 */
export async function listPendingJoinRequests(
  orgId: string
): Promise<{ success: true; requests: PendingJoinRequest[] } | { success: false; error: string }> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Trebuie să fii autentificat." }

  const { data, error } = await supabase.rpc("get_pending_join_requests", { p_org_id: orgId })
  if (error) return { success: false, error: error.message }

  const requests: PendingJoinRequest[] = (
    (data ?? []) as {
      id: string
      user_id: string
      nume: string | null
      email: string | null
      message: string | null
      requested_at: string
    }[]
  ).map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    nume: row.nume ? String(row.nume) : null,
    email: row.email ? String(row.email) : null,
    message: row.message ? String(row.message) : null,
    requested_at: String(row.requested_at),
  }))

  return { success: true, requests }
}

/**
 * Approve or reject a pending join request. The underlying RPC
 * `resolve_join_request` re-checks caller scope AND, on approve, re-checks
 * `check_org_limits(org_id, 'useri')` — so this wrapper doesn't need to do
 * either. All we do here is pass the caller's own id as p_resolved_by.
 */
export async function resolveJoinRequest(
  requestId: string,
  decision: "approved" | "rejected"
): Promise<JoinRequestActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Trebuie să fii autentificat." }

  if (decision !== "approved" && decision !== "rejected") {
    return { success: false, error: "Decizie invalidă." }
  }

  const { error } = await supabase.rpc("resolve_join_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_resolved_by: user.id,
  })
  if (error) return { success: false, error: error.message }

  revalidatePath("/admin")
  return { success: true }
}
