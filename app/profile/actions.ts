"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export type ActionResult = { success: true } | { success: false; error: string }
export type CreateExamResult =
  | { success: true; examId: number }
  | { success: false; error: string }

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

export async function createPersonalExam(data: {
  nume_examen: string
}): Promise<CreateExamResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: NOT_AUTHENTICATED }

  const examName = data.nume_examen.trim()
  if (!examName) {
    return { success: false, error: "Numele examenului este obligatoriu." }
  }

  // Fetch the user's personal-exam cap.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("max_examene_personale")
    .eq("id", user.id)
    .maybeSingle()
  if (profileError || !profile) {
    return { success: false, error: "Nu s-a putut verifica limita de examene." }
  }
  const maxPersonal = Number(profile.max_examene_personale ?? 0)

  // Count existing personal exams (scoped by creator, org_id IS NULL) server-side.
  const { count, error: countError } = await supabase
    .from("examene")
    .select("id", { count: "exact", head: true })
    .eq("creator_user_id", user.id)
    .is("org_id", null)
  if (countError) {
    return { success: false, error: "Nu s-a putut verifica numărul de examene." }
  }

  // Fail loudly before attempting the insert (don't rely on a DB constraint).
  if ((count ?? 0) >= maxPersonal) {
    return { success: false, error: "Ai atins limita de examene proprii" }
  }

  const { data: created, error: insertError } = await supabase
    .from("examene")
    .insert({ nume_examen: examName, org_id: null, creator_user_id: user.id })
    .select("id")
    .single()
  if (insertError || !created) {
    return { success: false, error: insertError?.message ?? "Nu s-a putut crea examenul." }
  }

  revalidatePath("/profile")
  return { success: true, examId: Number(created.id) }
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
