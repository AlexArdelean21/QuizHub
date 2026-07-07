import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CreateOrgResult } from "@/lib/signup/types"

/**
 * Shared implementation for creating an organization on signup. Accepts an
 * already-authenticated Supabase client so it can be driven either from a
 * Server Action (cookie-based server client) or from the auth callback
 * (the in-memory client that just exchanged the confirmation code).
 *
 * The heavy lifting + all guards live in the `create_org_on_signup` RPC; this
 * wrapper only normalizes input and maps the Postgres exception to a readable,
 * user-facing message.
 */
export async function createOrgOnSignup(
  client: SupabaseClient,
  params: { userId: string; orgName: string; tierId: number }
): Promise<CreateOrgResult> {
  const orgName = params.orgName?.trim() ?? ""
  if (!orgName) {
    return { success: false, error: "Numele organizației este obligatoriu." }
  }
  if (!Number.isInteger(params.tierId) || params.tierId <= 0) {
    return { success: false, error: "Planul selectat este invalid." }
  }

  const { data, error } = await client.rpc("create_org_on_signup", {
    p_user_id: params.userId,
    p_nume_org: orgName,
    p_tier_id: params.tierId,
  })

  if (error) {
    return { success: false, error: error.message }
  }
  if (!data) {
    return { success: false, error: "Nu s-a putut crea organizația." }
  }

  return { success: true, orgId: String(data) }
}
