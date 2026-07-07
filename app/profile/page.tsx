import { Suspense } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { normalizeRole, type AppRole } from "@/lib/auth/roles"
import { LeaveOrgAdminButton } from "@/components/profile/LeaveOrgAdminButton"
import {
  JoinOrgForm,
  type ExistingJoinRequest,
  type JoinRequestStatus,
} from "@/components/profile/JoinOrgForm"
import {
  PersonalExamsSection,
  type PersonalExam,
} from "@/components/profile/PersonalExamsSection"
import { PasswordChangeForm } from "@/components/profile/PasswordChangeForm"
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection"

export const dynamic = "force-dynamic"
export const metadata = { title: "Profil — QuizHub" }

const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin",
  org_admin: "Administrator",
  user: "Membru",
}

function extractOrgName(relation: unknown): string | null {
  const record = Array.isArray(relation) ? relation[0] : relation
  if (record && typeof record === "object" && "nume" in record) {
    const nume = (record as { nume?: unknown }).nume
    return typeof nume === "string" ? nume : null
  }
  return null
}

function SectionSkeleton() {
  return <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
}

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("nume, role, org_id, max_examene_personale, deletion_requested_at, organizatii(nume)")
    .eq("id", user.id)
    .maybeSingle()

  const role = normalizeRole(profile?.role)
  const orgId = profile?.org_id ? String(profile.org_id) : null
  const orgName = extractOrgName(profile?.organizatii)
  const maxPersonal = Number(profile?.max_examene_personale ?? 2)
  const deletionRequestedAt = profile?.deletion_requested_at
    ? String(profile.deletion_requested_at)
    : null
  const fullName = profile?.nume ? String(profile.nume) : null

  // Server-side gate: the join section must not render at all for org admins /
  // super admins (not merely be hidden on the client).
  const canJoinOrg = role !== "super_admin" && (role === "user" || !orgId)

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="flex flex-col gap-2">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            Înapoi
          </Link>
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">Profilul meu</h1>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {/* 1. Date personale */}
          <Card>
            <CardHeader>
              <CardTitle>Date personale</CardTitle>
              <CardDescription>Informațiile contului tău.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Nume</span>
                <span className="font-medium text-foreground">
                  {fullName ?? "—"}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium text-foreground">{user.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Rol</span>
                <Badge variant={role === "user" ? "secondary" : "default"}>
                  {ROLE_LABEL[role]}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* 2. Organizație */}
          <Card>
            <CardHeader>
              <CardTitle>Organizație</CardTitle>
              <CardDescription>
                {orgId
                  ? "Organizația din care faci parte."
                  : "Nu faci parte din nicio organizație."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              {orgId ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Nume organizație</span>
                    <span className="font-medium text-foreground">{orgName ?? "—"}</span>
                  </div>
                  {role === "org_admin" ? (
                    <Suspense fallback={<SectionSkeleton />}>
                      <OrgAdminActions userId={user.id} orgId={orgId} />
                    </Suspense>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Poți intra într-o organizație folosind un cod de organizație.
                </p>
              )}
            </CardContent>
          </Card>

          {/* 3. Intră într-o organizație (gated server-side) */}
          {canJoinOrg ? (
            <Card>
              <CardHeader>
                <CardTitle>Intră într-o organizație</CardTitle>
                <CardDescription>
                  Trimite o cerere de aderare folosind codul organizației.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Suspense fallback={<SectionSkeleton />}>
                  <JoinOrgCard userId={user.id} />
                </Suspense>
              </CardContent>
            </Card>
          ) : null}

          {/* 4. Examene proprii */}
          <Card>
            <CardHeader>
              <CardTitle>Examene proprii</CardTitle>
              <CardDescription>Examenele create de tine.</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<SectionSkeleton />}>
                <PersonalExamsCard userId={user.id} maxPersonal={maxPersonal} />
              </Suspense>
            </CardContent>
          </Card>

          {/* 5. Setări cont */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Setări cont</CardTitle>
              <CardDescription>Parolă și gestionarea contului.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-8 md:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-foreground">Schimbă parola</h3>
                <PasswordChangeForm />
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-foreground">Șterge contul</h3>
                <DeleteAccountSection deletionRequestedAt={deletionRequestedAt} />
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

// --- Async section components (each wrapped in <Suspense> above) ---

async function OrgAdminActions({ userId, orgId }: { userId: string; orgId: string }) {
  const supabase = await createSupabaseServerClient()
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "org_admin")
    .neq("id", userId)

  const isLastAdmin = (count ?? 0) === 0
  return <LeaveOrgAdminButton isLastAdmin={isLastAdmin} />
}

async function JoinOrgCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("org_join_requests")
    .select("status, created_at, organizatii(nume)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const existingRequest: ExistingJoinRequest | null = data
    ? {
        status: data.status as JoinRequestStatus,
        orgName: extractOrgName(data.organizatii),
        createdAt: String(data.created_at),
      }
    : null

  return <JoinOrgForm existingRequest={existingRequest} />
}

async function PersonalExamsCard({
  userId,
  maxPersonal,
}: {
  userId: string
  maxPersonal: number
}) {
  const supabase = await createSupabaseServerClient()
  // Scoped by creator_user_id server-side (defense in depth beyond RLS).
  const { data } = await supabase
    .from("examene")
    .select("id, nume_examen")
    .eq("creator_user_id", userId)
    .is("org_id", null)
    .order("id", { ascending: false })

  const exams: PersonalExam[] = (data ?? []).map((row) => ({
    id: Number(row.id),
    nume_examen: String(row.nume_examen),
  }))

  return <PersonalExamsSection exams={exams} maxPersonal={maxPersonal} />
}
