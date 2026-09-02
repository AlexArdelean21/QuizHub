import { Suspense, type ReactNode } from "react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  MyExamsManager,
  type PersonalExamItem,
} from "@/components/my-exams/MyExamsManager"
import { MyExamsHub } from "@/components/my-exams/MyExamsHub"
import type { PublicExamItem } from "@/components/my-exams/PublicExamsBrowser"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Examenele mele — QuizHub" }

/** Row shape for the public library; defined with the component that renders it. */
export type { PublicExamItem }

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
    // pb-20 keeps the last card clear of the mobile BottomTabBar.
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 pb-20 sm:px-6 md:pb-8 lg:px-8">
      <Suspense fallback={<ListSkeleton />}>
        <PublicLibraryLoader
          userId={user.id}
          personalSlot={
            <Suspense fallback={<ListSkeleton />}>
              <PersonalExamsLoader
                userId={user.id}
                maxExams={maxExams}
                maxQuestionsPerExam={maxQuestionsPerExam}
              />
            </Suspense>
          }
        />
      </Suspense>
    </main>
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

// Loads the public catalogue and the caller's favourites, then hands both to
// the hub. The personal list streams independently inside `personalSlot`.
async function PublicLibraryLoader({
  userId,
  personalSlot,
}: {
  userId: string
  personalSlot: ReactNode
}) {
  const supabase = await createSupabaseServerClient()

  const [favoriteResult, publicResult] = await Promise.all([
    supabase.from("examene_favorite").select("examen_id").eq("user_id", userId),
    supabase
      .from("examene")
      .select(
        "id, nume_examen, categorie, prag_trecere, intrebari_simulare, durata_minute, is_showcase, intrebari(count)"
      )
      .eq("is_public", true)
      .order("categorie", { ascending: true, nullsFirst: false })
      .order("nume_examen", { ascending: true }),
  ])

  const favoriteIds = new Set(
    (favoriteResult.data ?? []).map((row) => Number(row.examen_id))
  )

  const publicExams: PublicExamItem[] = (publicResult.data ?? []).map((row) => {
    const id = Number(row.id)
    return {
      id,
      nume_examen: String(row.nume_examen ?? ""),
      categorie: row.categorie == null ? null : String(row.categorie),
      pragTrecere: Number(row.prag_trecere ?? 0),
      intrebariSimulare: Number(row.intrebari_simulare ?? 0),
      durataMinute: Number(row.durata_minute ?? 0),
      isShowcase: Boolean(row.is_showcase),
      questionCount: extractCount(row.intrebari),
      isFavorite: favoriteIds.has(id),
    }
  })

  return <MyExamsHub personalSlot={personalSlot} publicExams={publicExams} />
}
