import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { LEGAL_DOCUMENTS, LEGAL_SLUGS, type LegalSlug } from "@/lib/legal/documents"

const LEGAL_ROUTE: Record<LegalSlug, string> = {
  confidentialitate: "/legal/confidentialitate",
  termeni: "/legal/termeni",
  cookies: "/legal/cookies",
}

export async function ConsentStatusCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient()

  // Latest consent per document type for this user, plus the current published
  // version, so we can indicate up-to-date vs. outdated.
  const [{ data: consents }, { data: currentDocs }] = await Promise.all([
    supabase
      .from("user_consents")
      .select("document_type, document_version, accepted_at")
      .eq("user_id", userId)
      .order("accepted_at", { ascending: false }),
    supabase
      .from("legal_documents")
      .select("type, version")
      .eq("is_current", true),
  ])

  const latestBySlug = new Map<string, { version: string; acceptedAt: string }>()
  for (const row of consents ?? []) {
    if (!latestBySlug.has(row.document_type)) {
      latestBySlug.set(row.document_type, {
        version: String(row.document_version),
        acceptedAt: String(row.accepted_at),
      })
    }
  }
  const currentBySlug = new Map<string, string>(
    (currentDocs ?? []).map((d) => [String(d.type), String(d.version)])
  )

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">Consimțăminte legale</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {LEGAL_SLUGS.map((slug) => {
          const meta = LEGAL_DOCUMENTS[slug]
          const latest = latestBySlug.get(slug)
          const current = currentBySlug.get(slug)
          const isUpToDate = latest && current && latest.version === current
          return (
            <li
              key={slug}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <Link
                  href={LEGAL_ROUTE[slug]}
                  className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                >
                  {meta.title}
                  <ExternalLink className="size-3" />
                </Link>
                <span className="text-xs text-muted-foreground">
                  {latest
                    ? `Acceptat versiunea ${latest.version} la ${new Date(
                        latest.acceptedAt
                      ).toLocaleDateString("ro-RO", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}`
                    : "Nici o acceptare înregistrată"}
                </span>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  isUpToDate
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                }`}
              >
                {isUpToDate
                  ? "La zi"
                  : latest
                    ? `Versiune veche (curent: ${current})`
                    : "Neacceptat"}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Când publicăm o versiune nouă a acestor documente, îți vom cere din nou consimțământul.
      </p>
    </div>
  )
}
