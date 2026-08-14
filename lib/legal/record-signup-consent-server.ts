import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/admin"

export async function recordSignupConsentServer(
  userId: string,
  documents: ("termeni" | "confidentialitate")[]
): Promise<void> {
  let admin: ReturnType<typeof createSupabaseAdminClient>
  try {
    admin = createSupabaseAdminClient()
  } catch {
    console.warn(
      "[record-signup-consent-server] SUPABASE_SERVICE_ROLE_KEY not set; skipping consent write."
    )
    return
  }

  const { data: docs, error: docsError } = await admin
    .from("legal_documents")
    .select("type, version")
    .in("type", documents)
    .eq("is_current", true)

  if (docsError || !docs?.length) {
    console.error(
      "[record-signup-consent-server] Could not fetch legal_documents:",
      docsError
    )
    return
  }

  const rows = docs.map((doc) => ({
    user_id: userId,
    document_type: doc.type,
    document_version: doc.version,
  }))

  const { error: insertError } = await admin.from("user_consents").upsert(rows, {
    onConflict: "user_id,document_type,document_version",
    ignoreDuplicates: true,
  })

  if (insertError) {
    console.error("[record-signup-consent-server] Insert failed:", insertError)
  }
}
