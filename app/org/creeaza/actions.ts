"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createOrgOnSignup } from "@/lib/signup/create-org"
import type { CreateOrgResult } from "@/lib/signup/types"

const NOT_AUTHENTICATED = "Trebuie să fii autentificat."

/**
 * Creates an organization for the currently authenticated user. The user id is
 * re-derived from the server-side session and is never accepted from the client
 * — same contract as app/profile/actions.ts.
 *
 * The RPC create_org_on_signup still enforces: caller must be a base `user`
 * with org_id = null, and the tier must not be enterprise.
 */
export async function createOrgFromDashboard(
  orgName: string,
  tierId: number
): Promise<CreateOrgResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const result = await createOrgOnSignup(supabase, {
    userId: user.id,
    orgName,
    tierId,
  })
  if (!result.success) return result

  revalidatePath("/")
  revalidatePath("/profile")
  return result
}
