import { Suspense } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { normalizeRole, type AppRole } from "@/lib/auth/roles"
import { getInitials } from "@/lib/avatar"
import { ProfileTabs } from "@/components/profile/ProfileTabs"
import { ProfileAvatar } from "@/components/profile/ProfileAvatar"
import { NameField } from "@/components/profile/NameField"
import { EmailField } from "@/components/profile/EmailField"
import { ConsentStatusCard } from "@/components/profile/ConsentStatusCard"
import { LeaveOrgAdminButton } from "@/components/profile/LeaveOrgAdminButton"
import { LeaveOrganizationButton } from "@/components/profile/LeaveOrganizationButton"
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
  const email = user.email ?? ""
  const displayName = fullName?.trim() ? fullName : email
  const initials = getInitials(fullName, email)

  // Server-side gate: the join section must not render at all for org admins /
  // super admins (not merely be hidden on the client).
  const canJoinOrg = role !== "super_admin" && (role === "user" || !orgId)

  const datePersonale = (
    <div className="flex max-w-md flex-col gap-4">
      <h2 className="mb-4 text-lg font-semibold text-foreground">Date personale</h2>
      <NameField initialName={fullName} />
      <EmailField initialEmail={email} />
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Rol</span>
        <Badge variant={role === "user" ? "secondary" : "default"}>
          {ROLE_LABEL[role]}
        </Badge>
      </div>
    </div>
  )

  const organizatie = (
    <div className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Organizație</h2>
        {orgId ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Nume organizație</span>
              <p className="font-medium text-foreground">{orgName ?? "—"}</p>
            </div>
            {role === "org_admin" ? (
              <Suspense fallback={<SectionSkeleton />}>
                <OrgAdminActions userId={user.id} orgId={orgId} />
              </Suspense>
            ) : role === "user" ? (
              <LeaveOrganizationButton />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nu faci parte din nicio organizație.
          </p>
        )}
      </div>

      {canJoinOrg ? (
        <div className="flex flex-col gap-3 border-t border-border pt-6">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-foreground">
              Intră într-o organizație
            </h3>
            <p className="text-sm text-muted-foreground">
              Trimite o cerere de aderare folosind codul organizației.
            </p>
          </div>
          <Suspense fallback={<SectionSkeleton />}>
            <JoinOrgCard userId={user.id} />
          </Suspense>
        </div>
      ) : null}
    </div>
  )

  const examene = (
    <div className="flex max-w-lg flex-col gap-4">
      <h2 className="mb-4 text-lg font-semibold text-foreground">Examene proprii</h2>
      <Suspense fallback={<SectionSkeleton />}>
        <PersonalExamsCard userId={user.id} maxPersonal={maxPersonal} />
      </Suspense>
    </div>
  )

  const setari = (
    <div className="flex flex-col gap-8">
      <h2 className="mb-4 text-lg font-semibold text-foreground">Setări cont</h2>

      <div className="flex max-w-md flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Schimbă parola</h3>
        <PasswordChangeForm />
      </div>

      <div className="border-t border-border" />

      <Suspense fallback={<SectionSkeleton />}>
        <ConsentStatusCard userId={user.id} />
      </Suspense>

      <div className="border-t border-rose-500/30" />

      <div className="flex max-w-md flex-col gap-3">
        <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-400">
          Zonă cu risc
        </h3>
        <p className="text-sm text-muted-foreground">
          Aceste acțiuni sunt permanente și nu pot fi anulate.
        </p>
        <DeleteAccountSection deletionRequestedAt={deletionRequestedAt} />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="flex flex-col gap-4">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            Înapoi
          </Link>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <ProfileAvatar initials={initials} size="lg" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Profilul meu
                </p>
                <h1 className="truncate text-xl font-semibold text-foreground">
                  {displayName}
                </h1>
                <Badge
                  variant={role === "user" ? "secondary" : "default"}
                  className="w-fit"
                >
                  {ROLE_LABEL[role]}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <ProfileTabs
          name={fullName}
          email={email}
          roleLabel={ROLE_LABEL[role]}
          isPlainUser={role === "user"}
          datePersonale={datePersonale}
          organizatie={organizatie}
          examene={examene}
          setari={setari}
        />
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
    // Only surface requests still actionable from the user's POV. Approved rows
    // are kept for audit but are stale here (a user reaching this form has
    // org_id = NULL), so excluding them prevents a leftover "Aprobată" badge
    // from blocking a fresh join request.
    .in("status", ["pending", "rejected"])
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
