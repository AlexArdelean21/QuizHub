"use server"

import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createOrgOnSignup } from "@/lib/signup/create-org"
import type { CreateOrgResult } from "@/lib/signup/types"

/**
 * Server Action wrapper around the create_org_on_signup RPC, using the
 * cookie-based (authenticated) server client. In the current email-confirmation
 * flow the org is actually created from /auth/callback after the user confirms
 * their email (see there); this action exists as the canonical, typed entry
 * point and is safe to call once an authenticated session exists.
 */
export async function createOrganizationSignup(
  userId: string,
  orgName: string,
  tierId: number
): Promise<CreateOrgResult> {
  const supabase = await createSupabaseServerClient()
  return createOrgOnSignup(supabase, { userId, orgName, tierId })
}
