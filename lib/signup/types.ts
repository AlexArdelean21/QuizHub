export type PlanTier = {
  id: number
  nume: string
  display_name: string
  max_admini: number
  max_useri: number
  max_examene: number
  pret_luna: number
  pret_an: number
}

export type CreateOrgResult =
  | { success: true; orgId: string }
  | { success: false; error: string }

/** Keys used to carry the pending-org intent through Supabase user metadata
 *  until the email is confirmed (see /auth/callback). */
export const PENDING_ORG_NUME_KEY = "pending_org_nume"
export const PENDING_ORG_TIER_KEY = "pending_org_tier_id"
