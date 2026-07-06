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
  este_activ: boolean
}

export type OrgSubscriptionStatus =
  | "active"
  | "past_due"
  | "suspended"
  | "canceled"

export type OrgTierRow = {
  id: string
  nume: string
  slug: string
  tier_id: number | null
  subscription_status: OrgSubscriptionStatus
  is_managed_manually: boolean
  grandfathered: boolean
  over_limit: boolean
  ai_import_enabled: boolean
  max_admini: number
  max_useri: number
  max_examene: number
  tokeni_lunari: number
  tokeni_consumati_luna: number
  past_due_at: string | null
  suspended_at: string | null
  actualizat_la: string | null
}
