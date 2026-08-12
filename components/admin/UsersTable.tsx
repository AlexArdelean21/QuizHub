"use client"

import { useMemo, useState, useTransition } from "react"
import { LogOut, ShieldCheck, Trash2 } from "lucide-react"
import {
  kickUserFromOrg,
  deleteUserAccount,
  grantExamAccess,
  updateUserRole,
} from "@/app/admin/actions"
import type {
  AdminExamRow,
  AdminOrganizationRow,
  AdminUserRow,
} from "@/app/admin/actions"
import type { AppRole } from "@/lib/auth/roles"
import { DataTable, type Column } from "@/components/ui/data-table"

// Tip intern pentru rândul de tabel — oglindește AdminUserRow + câmpuri derivate
type UserTableRow = {
  profile: AdminUserRow
  orgName: string | null
  isCurrentUser: boolean
  canEditRole: boolean
  canKick: boolean
  canDeleteAccount: boolean
  isAdminRole: boolean
  userAccess: string[]
}

export type UsersTableProps = {
  profiles: AdminUserRow[]
  examene: AdminExamRow[]
  organizations: AdminOrganizationRow[]
  activeAccessByUser: Record<string, string[]>
  isSuperAdmin: boolean
  isOrgAdmin?: boolean
  currentUserId: string
  orgFilter?: string | null
}

type PendingAction = {
  type: "grant" | "kick" | "deleteAccount" | "role"
  userId: string
} | null

const ROLE_ORDER: Record<AppRole, number> = {
  super_admin: 0,
  org_admin: 1,
  user: 2,
}

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  user: "User",
}

const ROLE_BADGE: Record<AppRole, string> = {
  super_admin: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  org_admin: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  user: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
}

const UNASSIGNED_KEY = "__unassigned__"

export function UsersTable({
  profiles,
  examene,
  organizations,
  activeAccessByUser,
  isSuperAdmin,
  isOrgAdmin = false,
  currentUserId,
  orgFilter,
}: UsersTableProps) {
  const [isPending, startTransition] = useTransition()
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [selectedExamByUser, setSelectedExamByUser] = useState<Record<string, number>>({})
  const [daysByUser, setDaysByUser] = useState<Record<string, number>>({})
  const [selectedOrg, setSelectedOrg] = useState<string>("")
  const [deleteAccountTarget, setDeleteAccountTarget] = useState<{
    id: string
    email: string | null
    nume: string | null
  } | null>(null)
  const [deleteAccountConfirmInput, setDeleteAccountConfirmInput] = useState("")

  const defaultExamId = examene[0]?.id ?? null
  const orgNameById = new Map<string, string>(
    organizations.map((org) => [org.id, org.nume])
  )

  // Apply org filter then sort by role rank, then email
  const displayedProfiles = useMemo(() => {
    let base = profiles
    if (isSuperAdmin) {
      if (selectedOrg === UNASSIGNED_KEY) {
        base = base.filter((p) => !p.org_id)
      } else if (selectedOrg) {
        base = base.filter((p) => p.org_id === selectedOrg)
      }
    } else if (orgFilter) {
      base = base.filter((p) => p.org_id === orgFilter)
    }
    return [...base].sort((a, b) => {
      const rankDiff = ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
      if (rankDiff !== 0) return rankDiff
      return (a.email ?? "").localeCompare(b.email ?? "")
    })
  }, [profiles, isSuperAdmin, selectedOrg, orgFilter])

  const handleGrantAccess = (userId: string) => {
    const selectedExamId = selectedExamByUser[userId] ?? defaultExamId
    const selectedDays = Math.max(1, Number(daysByUser[userId] ?? 30))

    if (!selectedExamId) {
      window.alert("Nu există examene disponibile.")
      return
    }

    setPendingAction({ type: "grant", userId })
    startTransition(() => {
      void (async () => {
        try {
          await grantExamAccess(userId, selectedExamId, selectedDays)
        } catch (error) {
          console.error("Failed to grant exam access:", error)
          window.alert(error instanceof Error ? error.message : "Nu s-a putut acorda accesul.")
        } finally {
          setPendingAction(null)
        }
      })()
    })
  }

  const handleKickFromOrg = (userId: string, userEmail: string | null) => {
    if (isPending) return
    const label = userEmail ?? userId
    if (
      !window.confirm(
        `Scoate utilizatorul ${label} din organizație? Contul și examenele personale rămân active.`
      )
    ) {
      return
    }

    setPendingAction({ type: "kick", userId })
    startTransition(() => {
      void (async () => {
        try {
          await kickUserFromOrg(userId)
        } catch (error) {
          console.error("Failed to kick user from org:", error)
          window.alert(
            error instanceof Error ? error.message : "Nu s-a putut scoate utilizatorul din organizație."
          )
        } finally {
          setPendingAction(null)
        }
      })()
    })
  }

  const handleDeleteAccountClick = (
    userId: string,
    userEmail: string | null,
    userName: string | null
  ) => {
    if (isPending) return
    setDeleteAccountTarget({ id: userId, email: userEmail, nume: userName })
    setDeleteAccountConfirmInput("")
  }

  const handleDeleteAccountConfirm = () => {
    if (!deleteAccountTarget) return
    setPendingAction({ type: "deleteAccount", userId: deleteAccountTarget.id })
    startTransition(() => {
      void (async () => {
        try {
          await deleteUserAccount(deleteAccountTarget.id)
          setDeleteAccountTarget(null)
          setDeleteAccountConfirmInput("")
        } catch (error) {
          console.error("Failed to delete user account:", error)
          window.alert(error instanceof Error ? error.message : "Nu s-a putut șterge contul.")
        } finally {
          setPendingAction(null)
        }
      })()
    })
  }

  const handleChangeRole = (userId: string, role: AppRole) => {
    setPendingAction({ type: "role", userId })
    startTransition(() => {
      void (async () => {
        try {
          await updateUserRole({ userId, role })
        } catch (error) {
          console.error("Failed to update role:", error)
          window.alert(error instanceof Error ? error.message : "Nu s-a putut schimba rolul.")
        } finally {
          setPendingAction(null)
        }
      })()
    })
  }

  const userRows = useMemo<UserTableRow[]>(() => {
    return displayedProfiles.map((profile) => {
      const isCurrentUser = profile.id === currentUserId
      const role = profile.role
      const isAdminRole = role === "super_admin" || role === "org_admin"
      const orgName =
        profile.org_nume ??
        (profile.org_id ? orgNameById.get(profile.org_id) ?? null : null)
      const isOrgAdminPeer = !isSuperAdmin && role === "org_admin"
      const canEditRole =
        (isSuperAdmin || isOrgAdmin) &&
        !isCurrentUser &&
        role !== "super_admin" &&
        !(isOrgAdmin && role === "org_admin")
      const canKick =
        !isCurrentUser &&
        Boolean(profile.org_id) &&
        role !== "super_admin" &&
        !isOrgAdminPeer
      const canDeleteAccount = isSuperAdmin && !isCurrentUser && role !== "super_admin"
      const userAccess = activeAccessByUser[profile.id] ?? []
      return {
        profile,
        orgName,
        isCurrentUser,
        canEditRole,
        canKick,
        canDeleteAccount,
        isAdminRole,
        userAccess,
      }
    })
  }, [displayedProfiles, currentUserId, isSuperAdmin, isOrgAdmin, orgNameById, activeAccessByUser])

  const columns = useMemo<Column<UserTableRow>[]>(() => {
    const cols: Column<UserTableRow>[] = [
      {
        key: "email",
        header: "Email",
        pin: "left",
        minWidth: 220,
        noWrap: true,
        render: ({ profile, isCurrentUser }) => (
          <span className="text-slate-900 dark:text-white">
            {profile.email ?? "-"}
            {isCurrentUser && (
              <span className="ml-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                TU
              </span>
            )}
          </span>
        ),
      },
      {
        key: "nume",
        header: "Nume",
        minWidth: 140,
        render: ({ profile }) => (
          <span className="text-slate-700 dark:text-slate-200">{profile.nume ?? "—"}</span>
        ),
      },
      {
        key: "rol",
        header: "Rol",
        minWidth: 130,
        render: ({ profile, canEditRole }) => {
          const role = profile.role
          return canEditRole ? (
            <select
              value={role}
              onChange={(event) => handleChangeRole(profile.id, event.target.value as AppRole)}
              disabled={isPending && pendingAction?.userId === profile.id}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="user">User</option>
              <option value="org_admin">Org Admin</option>
              {isSuperAdmin && <option value="super_admin">Super Admin</option>}
            </select>
          ) : (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[role]}`}>
              {ROLE_LABELS[role]}
            </span>
          )
        },
      },
      ...(isSuperAdmin
        ? [{
            key: "organizatie",
            header: "Organizație",
            minWidth: 140,
            render: ({ orgName }: UserTableRow) => (
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {orgName ?? "—"}
              </span>
            ),
          } satisfies Column<UserTableRow>]
        : []),
      {
        key: "acces",
        header: "Acces activ",
        minWidth: 160,
        render: ({ isAdminRole, userAccess, profile }) => {
          if (isAdminRole) {
            return (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                <ShieldCheck className="size-3" />
                Acces Admin
              </span>
            )
          }
          if (userAccess.length > 0) {
            const hasAll = examene.length > 0 && userAccess.length >= examene.length
            if (hasAll) {
              return (
                <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  Toate ({examene.length})
                </span>
              )
            }
            return (
              <div className="flex max-w-[180px] flex-col gap-1">
                {userAccess.slice(0, 3).map((examName) => (
                  <span
                    key={`${profile.id}-${examName}`}
                    title={examName}
                    className="block truncate rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    {examName}
                  </span>
                ))}
                {userAccess.length > 3 && (
                  <span className="pl-1 text-[11px] text-slate-400 dark:text-slate-500">
                    +{userAccess.length - 3} mai multe
                  </span>
                )}
              </div>
            )
          }
          return (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Fără acces
            </span>
          )
        },
      },
      {
        key: "actiuni",
        header: "Acțiuni",
        minWidth: 180,
        align: "right",
        render: ({ profile, canKick, canDeleteAccount, isAdminRole }) => {
          const isOrgAdminPeer = !isSuperAdmin && profile.role === "org_admin"
          return (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {!isAdminRole && (
                <>
                  <select
                    value={selectedExamByUser[profile.id] ?? defaultExamId ?? ""}
                    onChange={(event) =>
                      setSelectedExamByUser((prev) => ({
                        ...prev,
                        [profile.id]: Number(event.target.value),
                      }))
                    }
                    disabled={isPending || examene.length === 0}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 transition focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {examene.length === 0 ? (
                      <option value="">No exams</option>
                    ) : (
                      examene.map((exam) => (
                        <option key={exam.id} value={exam.id}>
                          {exam.nume_examen}
                        </option>
                      ))
                    )}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={daysByUser[profile.id] ?? 30}
                    onChange={(event) =>
                      setDaysByUser((prev) => ({
                        ...prev,
                        [profile.id]: Number(event.target.value),
                      }))
                    }
                    disabled={isPending}
                    className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => handleGrantAccess(profile.id)}
                    disabled={isPending || examene.length === 0}
                    className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {pendingAction?.type === "grant" && pendingAction.userId === profile.id
                      ? "Se acordă..."
                      : "Acordă acces"}
                  </button>
                </>
              )}
              {canKick ? (
                <button
                  type="button"
                  onClick={() => handleKickFromOrg(profile.id, profile.email)}
                  disabled={isPending}
                  title="Scoate din organizație"
                  className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <LogOut className="size-3" />
                  {pendingAction?.type === "kick" && pendingAction.userId === profile.id
                    ? "..."
                    : "Scoate"}
                </button>
              ) : null}
              {canDeleteAccount ? (
                <button
                  type="button"
                  onClick={() =>
                    handleDeleteAccountClick(profile.id, profile.email, profile.nume)
                  }
                  disabled={isPending}
                  title="Șterge cont permanent"
                  className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                >
                  <Trash2 className="size-3" />
                  {pendingAction?.type === "deleteAccount" &&
                  pendingAction.userId === profile.id
                    ? "..."
                    : "Șterge cont"}
                </button>
              ) : isOrgAdminPeer ? (
                <span
                  className="text-[10px] text-slate-400 dark:text-slate-500"
                  title="Doar super admin poate scoate un org admin"
                >
                  —
                </span>
              ) : null}
            </div>
          )
        },
      },
    ]
    return cols
  }, [
    isSuperAdmin,
    isPending,
    pendingAction,
    handleGrantAccess,
    handleChangeRole,
    handleKickFromOrg,
    handleDeleteAccountClick,
    selectedExamByUser,
    daysByUser,
    defaultExamId,
    activeAccessByUser,
    examene,
  ])

  return (
    <div className="space-y-3">
      {/* Org filter — super_admin only */}
      {isSuperAdmin && organizations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Filtrează organizație:</span>
          <select
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">Toate organizațiile</option>
            <option value={UNASSIGNED_KEY}>— Fără org (Lobby) —</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.nume}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {displayedProfiles.length} {displayedProfiles.length === 1 ? "utilizator" : "utilizatori"}
          </span>
        </div>
      )}

      <DataTable
        rows={userRows}
        columns={columns}
        totalCount={userRows.length}
        pageSize={userRows.length || 1}
        currentPage={1}
        buildHref={() => "#"}
        emptyState={{ title: "Nu am găsit utilizatori." }}
      />

      {deleteAccountTarget ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Închide confirmarea"
            onClick={() => {
              if (!isPending) {
                setDeleteAccountTarget(null)
                setDeleteAccountConfirmInput("")
              }
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-rose-500/40 bg-white p-5 shadow-2xl dark:bg-slate-950">
            <h4 className="text-lg font-semibold text-rose-600 dark:text-rose-300">
              Confirmă ștergerea contului
            </h4>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
              Această acțiune este permanentă și va șterge contul, progresul și toate datele
              asociate utilizatorului.
            </p>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Pentru confirmare, tastați exact adresa de email:{" "}
              <span className="font-semibold text-slate-900 dark:text-white">
                {deleteAccountTarget.email ?? deleteAccountTarget.id}
              </span>
            </p>
            <input
              value={deleteAccountConfirmInput}
              onChange={(event) => setDeleteAccountConfirmInput(event.target.value)}
              placeholder="Adresa de email"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              disabled={isPending}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteAccountTarget(null)
                  setDeleteAccountConfirmInput("")
                }}
                disabled={isPending}
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={handleDeleteAccountConfirm}
                disabled={
                  deleteAccountConfirmInput.trim() !==
                    (deleteAccountTarget.email ?? deleteAccountTarget.id) || isPending
                }
                className="inline-flex items-center justify-center rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {isPending &&
                pendingAction?.type === "deleteAccount" &&
                pendingAction.userId === deleteAccountTarget.id
                  ? "Se șterge..."
                  : "Șterge definitiv"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
