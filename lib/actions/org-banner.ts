"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export type ActionResult = { success: true } | { success: false; error: string }

const NOT_AUTHENTICATED = "Trebuie să fii autentificat."

/**
 * Permanently opts the current user out of the dashboard "join an organization"
 * banner. Same contract as app/profile/actions.ts: the user id is re-derived
 * from the server-side session and never accepted from the client.
 *
 * This is a plain UPDATE on the caller's own profiles row (guarded by the
 * existing "Users can update own profile" policy) — no SECURITY DEFINER RPC,
 * because there is nothing here the user is not already allowed to do.
 */
export async function hideOrgBanner(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const { error } = await supabase
    .from("profiles")
    .update({ hide_org_banner: true })
    .eq("id", user.id)
  if (error) return { success: false, error: error.message }

  revalidatePath("/")
  return { success: true }
}
