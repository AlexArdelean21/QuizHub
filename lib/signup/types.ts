export type PlanTier = {
  id: number
  nume: string
  display_name: string
  max_admini: number
  max_useri: number
  max_examene: number
  tokeni_lunari: number
  pret_luna: number
  pret_an: number
}

export type CreateOrgResult =
  | { success: true; orgId: string }
  | { success: false; error: string }

/** Key used to carry pending legal-consent docs through Supabase user metadata
 *  until the email is confirmed (see /auth/callback). */
export const PENDING_CONSENT_DOCS_KEY = "pending_consent_docs"
