"use client"

import { useMemo, useState } from "react"
import { OrgBreakdown, LOBBY_KEY, type OrgStat } from "@/components/admin/OrgBreakdown"
import { DocumentAiCreditProvider } from "@/components/admin/DocumentAiCreditContext"
import { DocumentAiCreditWidget } from "@/components/admin/DocumentAiCreditWidget"
import { ExamManagement } from "@/components/admin/ExamManagement"
import { UserManagement } from "@/components/admin/UserManagement"
import type {
  AdminExamRow,
  AdminOrganizationRow,
  AdminUserRow,
} from "@/app/admin/actions"

type AdminDashboardShellProps = {
  profiles: AdminUserRow[]
  examene: AdminExamRow[]
  organizations: AdminOrganizationRow[]
  activeAccessByUser: Record<string, string[]>
  orgStats: OrgStat[]
  unassignedCount: number
  currentUserId: string
}

export function AdminDashboardShell({
  profiles,
  examene,
  organizations,
  activeAccessByUser,
  orgStats,
  unassignedCount,
  currentUserId,
}: AdminDashboardShellProps) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)

  const handleSelectOrg = (id: string | null) => {
    setSelectedOrgId((prev) => (prev === id ? null : id))
  }

  // Derive filtered slices from the full server-fetched arrays
  const filteredProfiles = useMemo(() => {
    if (!selectedOrgId) return profiles
    if (selectedOrgId === LOBBY_KEY) return profiles.filter((p) => !p.org_id)
    return profiles.filter((p) => p.org_id === selectedOrgId)
  }, [profiles, selectedOrgId])

  const filteredExamene = useMemo(() => {
    if (!selectedOrgId || selectedOrgId === LOBBY_KEY) return examene
    return examene.filter((e) => e.org_id === selectedOrgId)
  }, [examene, selectedOrgId])

  // When the org selection changes we remount the heavy components so their
  // internal search/page state is reset cleanly instead of showing stale pagination.
  const shellKey = selectedOrgId ?? "__all__"

  return (
    <DocumentAiCreditProvider>
      <OrgBreakdown
        orgs={orgStats}
        unassignedCount={unassignedCount}
        selectedOrgId={selectedOrgId}
        onSelectOrg={handleSelectOrg}
      />

      {/* Creditele sunt legate de organizația contului, deci widget-ul se ascunde
          singur în vederea agregată peste toate organizațiile. */}
      {selectedOrgId && selectedOrgId !== LOBBY_KEY ? <DocumentAiCreditWidget /> : null}

      <ExamManagement
        key={`exams-${shellKey}`}
        examene={filteredExamene}
        organizations={organizations}
        isSuperAdmin
        defaultOrgId={null}
      />

      <UserManagement
        key={`users-${shellKey}`}
        profiles={filteredProfiles}
        examene={filteredExamene}
        organizations={organizations}
        activeAccessByUser={activeAccessByUser}
        isSuperAdmin
        currentUserId={currentUserId}
        scopedOrgId={null}
      />
    </DocumentAiCreditProvider>
  )
}
