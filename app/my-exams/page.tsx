import { Suspense } from "react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  MyExamsManager,
  type PersonalExamItem,
} from "@/components/my-exams/MyExamsManager"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Examenele mele — QuizHub" }

function ListSkeleton() {
  return <div className="h-48 w-full animate-pulse rounded-xl bg-muted" />
}

// The embedded `intrebari(count)` aggregate comes back as `[{ count: n }]`.
function extractCount(relation: unknown): number {
  const record = Array.isArray(relation) ? relation[0] : relation
  if (record && typeof record === "object" && "count" in record) {
    const value = (record as { count?: unknown }).count
    return typeof value === "number" ? value : Number(value ?? 0)
  }
  return 0
}

export default async function MyExamsPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Personal exams are independent of role and organization — no role gate here.
  const { data: profile } = await supabase
    .from("profiles")
    .select("max_examene_personale, max_intrebari_examen_personal")
    .eq("id", user.id)
    .maybeSingle()

  const maxExams = Number(profile?.max_examene_personale ?? 2)
  const maxQuestionsPerExam = Number(profile?.max_intrebari_examen_personal ?? 500)

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Înapoi
        </Link>

        <Suspense fallback={<ListSkeleton />}>
          <PersonalExamsLoader
            userId={user.id}
            maxExams={maxExams}
            maxQuestionsPerExam={maxQuestionsPerExam}
          />
        </Suspense>
      </main>
    </div>
  )
}

async function PersonalExamsLoader({
  userId,
  maxExams,
  maxQuestionsPerExam,
}: {
  userId: string
  maxExams: number
  maxQuestionsPerExam: number
}) {
  const supabase = await createSupabaseServerClient()
  // Scoped by creator_user_id + org_id IS NULL server-side (defense in depth).
  const { data } = await supabase
    .from("examene")
    .select(
      "id, nume_examen, prag_trecere, intrebari_simulare, variante_raspuns, durata_minute, intrebari(count)"
    )
    .eq("creator_user_id", userId)
    .is("org_id", null)
    .order("id", { ascending: false })

  const exams: PersonalExamItem[] = (data ?? []).map((row) => ({
    id: Number(row.id),
    nume_examen: String(row.nume_examen ?? ""),
    pragTrecere: Number(row.prag_trecere ?? 0),
    intrebariSimulare: Number(row.intrebari_simulare ?? 0),
    varianteRaspuns: Number(row.variante_raspuns ?? 0),
    durataMinute: Number(row.durata_minute ?? 0),
    questionCount: extractCount(row.intrebari),
  }))

  return (
    <MyExamsManager
      exams={exams}
      maxExams={maxExams}
      maxQuestionsPerExam={maxQuestionsPerExam}
    />
  )
}
