"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export type ActionResult = { success: true } | { success: false; error: string }

const MIN_PASSWORD_LENGTH = 8
const NOT_AUTHENTICATED = "Trebuie să fii autentificat."

/**
 * All actions re-derive the user id from the server-side session and never
 * accept a client-passed user id. The underlying RPCs also guard internally,
 * but this is the first (and trusted) caller layer — defense in depth.
 */

export async function leaveOrgAdminRole(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const { error } = await supabase.rpc("leave_org_admin_role", {
    p_user_id: user.id,
  })
  if (error) return { success: false, error: error.message }

  revalidatePath("/profile")
  return { success: true }
}

export async function leaveOrganization(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const { error } = await supabase.rpc("leave_organization")
  if (error) return { success: false, error: error.message }

  // Re-render the org section, and the home page (leaving the org changes which
  // exams / quiz options the user sees there).
  revalidatePath("/profile")
  revalidatePath("/")
  return { success: true }
}

export async function requestJoinOrg(
  codOrg: string,
  message?: string
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const trimmedCode = codOrg.trim()
  if (!trimmedCode) {
    return { success: false, error: "Introdu codul organizației." }
  }

  const trimmedMessage = message?.trim()
  const { error } = await supabase.rpc("request_join_org", {
    p_user_id: user.id,
    p_cod_org: trimmedCode,
    p_message: trimmedMessage ? trimmedMessage : null,
  })
  if (error) return { success: false, error: error.message }

  revalidatePath("/profile")
  return { success: true }
}

export async function cancelJoinRequest(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  // Takes no arguments: the RPC resolves the caller via auth.uid() internally and
  // deletes only their own pending row. It returns false (never raises) when
  // there is nothing to cancel, which we deliberately treat as success — the
  // user's intent ("I no longer have a pending request") is already satisfied.
  const { error } = await supabase.rpc("cancel_org_join_request")
  if (error) return { success: false, error: error.message }

  // "/" too: with no pending request left, the dashboard org banner becomes
  // eligible to show again.
  revalidatePath("/profile")
  revalidatePath("/")
  return { success: true }
}

export async function requestAccountDeletion(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const { error } = await supabase.rpc("request_account_deletion", {
    p_user_id: user.id,
  })
  if (error) return { success: false, error: error.message }

  revalidatePath("/profile")
  return { success: true }
}

export async function cancelAccountDeletion(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const { error } = await supabase.rpc("cancel_account_deletion", {
    p_user_id: user.id,
  })
  if (error) return { success: false, error: error.message }

  revalidatePath("/profile")
  return { success: true }
}

export async function updateName(nume: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const trimmed = nume.trim()
  if (trimmed.length < 2 || trimmed.length > 80) {
    return {
      success: false,
      error: "Numele trebuie să aibă între 2 și 80 de caractere.",
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ nume: trimmed })
    .eq("id", user.id)
  if (error) return { success: false, error: error.message }

  revalidatePath("/profile")
  return { success: true }
}

export async function changePassword(newPassword: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      success: false,
      error: `Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`,
    }
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { success: false, error: error.message }

  return { success: true }
}

export async function updateEmail(newEmail: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const trimmed = newEmail.trim().toLowerCase()
  // Minimal server-side email shape check — Supabase re-validates and enforces uniqueness itself.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { success: false, error: "Introdu o adresă de email validă." }
  }
  if (trimmed === (user.email ?? "").toLowerCase()) {
    return { success: false, error: "Aceasta este deja adresa ta actuală." }
  }

  // Triggers Supabase's built-in email-change confirmation flow. If the project
  // has "Enable email change confirmations" enabled (default and recommended),
  // both old and new addresses receive a confirmation link; auth.users.email
  // only changes after the user confirms via the new address. profiles.email
  // is kept in sync by the existing DB trigger — do not update it here manually.
  const { error } = await supabase.auth.updateUser({ email: trimmed })
  if (error) return { success: false, error: error.message }

  revalidatePath("/profile")
  return { success: true }
}
