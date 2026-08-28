import { NextResponse, type NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { createSupabaseAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BUCKET = "document-ai-uploads"

/** Documentele sursă se păstrează șapte zile, indiferent de statusul sesiunii. */
const ZILE_RETENTIE = 7

/**
 * O sesiune rămasă `in_progres` blochează organizația: `verificaSiCreazaSesiune`
 * refuză un import nou cât timp există una activă. Cele abandonate se închid și
 * creditele se restituie.
 */
const ORE_SESIUNE_ABANDONATA = 24

/** Sesiunile nefinalizate: încă în lucru sau oprite de epuizarea creditelor. */
const STATUSURI_DESCHISE = ["in_progres", "partial"]

const MAX_SESIUNI_PER_RULARE = 500

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()

  const sesiuniAbandonate = await inchideSesiuniAbandonate(admin)
  const rezultatCuratare = await stergeFisiereExpirate(admin)

  return NextResponse.json({
    ok: true,
    sesiuni_abandonate_inchise: sesiuniAbandonate,
    ...rezultatCuratare,
  })
}

async function inchideSesiuniAbandonate(admin: SupabaseClient): Promise<number> {
  const limita = new Date(Date.now() - ORE_SESIUNE_ABANDONATA * 3_600_000).toISOString()

  const { data: sesiuni, error } = await admin
    .from("document_ai_sesiuni_import")
    .select("id, org_id")
    .in("status", STATUSURI_DESCHISE)
    .is("finalizat_la", null)
    .lt("creat_la", limita)
    .limit(MAX_SESIUNI_PER_RULARE)

  if (error || !sesiuni?.length) return 0

  let inchise = 0
  for (const sesiune of sesiuni) {
    const { error: eroareAnulare } = await admin.rpc("anuleaza_sesiune_import", {
      p_sesiune_id: sesiune.id,
      p_org_id: sesiune.org_id,
    })
    if (!eroareAnulare) inchise++
  }

  return inchise
}

async function stergeFisiereExpirate(
  admin: SupabaseClient
): Promise<{ sesiuni_curatate: number; fisiere_sterse: number }> {
  const limita = new Date(Date.now() - ZILE_RETENTIE * 86_400_000).toISOString()

  const { data: sesiuni, error } = await admin
    .from("document_ai_sesiuni_import")
    .select("id, org_id")
    .lt("creat_la", limita)
    .limit(MAX_SESIUNI_PER_RULARE)

  if (error || !sesiuni?.length) {
    return { sesiuni_curatate: 0, fisiere_sterse: 0 }
  }

  let sesiuniCuratate = 0
  let fisiereSterse = 0

  for (const sesiune of sesiuni) {
    const prefix = `${sesiune.org_id}/${sesiune.id}`

    const { data: fisiere, error: eroareListare } = await admin.storage
      .from(BUCKET)
      .list(prefix, { limit: 1000 })

    if (eroareListare || !fisiere?.length) continue

    const cai = fisiere.map((fisier) => `${prefix}/${fisier.name}`)
    const { error: eroareStergere } = await admin.storage.from(BUCKET).remove(cai)

    if (!eroareStergere) {
      sesiuniCuratate++
      fisiereSterse += cai.length
    }
  }

  return { sesiuni_curatate: sesiuniCuratate, fisiere_sterse: fisiereSterse }
}
