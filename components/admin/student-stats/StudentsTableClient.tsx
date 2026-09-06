"use client"

import { useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { ro } from "date-fns/locale"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable, useIsDesktop, type Column } from "@/components/ui/data-table"
import { cn } from "@/lib/utils"
import type { StudentStatsRow } from "@/lib/student-stats/types"

type Props = {
  rows: StudentStatsRow[]
  totalCount: number
  page: number
  pageSize: number
  currentSort: string
  currentSearch: string
  examenId: number | null
  emptyState: { title: string; description?: string }
  examPassThresholdPct: number | null
  peerAdmins?: StudentStatsRow[]
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toFixed(1)}%`
}

function relativeTime(value: string | null) {
  if (!value) return "—"
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ro })
}

function formatDuration(secs: number): string {
  if (!secs) return "—"
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)} min`
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

function passRateClass(pct: number, thresholdPct: number | null) {
  return pct >= (thresholdPct ?? 50)
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
}

// Sub-640px stand-in for the DataTable: the eight columns don't survive a
// phone width, so each student becomes a card with the same figures in a 2x2
// grid. Shared by the students list and the peer-admins list.
function StudentCardList({
  rows,
  emptyTitle,
  examPassThresholdPct,
  onSelect,
}: {
  rows: StudentStatsRow[]
  emptyTitle: string
  examPassThresholdPct: number | null
  onSelect: ((row: StudentStatsRow) => void) | null
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyTitle}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.user_id} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {row.nume ?? "—"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {row.email ?? "—"}
              </p>
            </div>
            <div className="shrink-0 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-sm font-medium tabular-nums text-foreground">
              {formatPercent(row.scor_mediu)}
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Simulări
              </p>
              <p className="text-sm font-medium tabular-nums text-foreground">
                {row.simulari_finalizate}
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Rată trecere
              </p>
              {row.rata_trecere_pct == null ? (
                <p className="text-sm font-medium text-muted-foreground">—</p>
              ) : (
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                    passRateClass(row.rata_trecere_pct, examPassThresholdPct),
                  )}
                >
                  {formatPercent(row.rata_trecere_pct)}
                </span>
              )}
            </div>
            <div className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Nivel pregătire
              </p>
              <p className="text-sm font-medium tabular-nums text-foreground">
                {formatPercent(row.nivel_pregatire_pct)}
              </p>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, row.nivel_pregatire_pct ?? 0))}%`,
                  }}
                />
              </div>
            </div>
            <div className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Timp dedicat
              </p>
              <p className="text-sm font-medium text-foreground">
                {formatDuration(row.timp_dedicat_secunde)}
              </p>
            </div>
          </div>

          <p className="mb-3 text-xs text-muted-foreground">
            Ultima activitate: {relativeTime(row.ultima_activitate)}
          </p>

          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(row)}
              className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground transition hover:bg-muted/30"
            >
              Vezi detalii →
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function StudentsTableClient({
  rows,
  totalCount,
  page,
  pageSize,
  currentSort,
  currentSearch,
  examenId,
  emptyState,
  examPassThresholdPct,
  peerAdmins,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isDesktop = useIsDesktop()

  // Drilling into a student needs the exam in the query string, so without a
  // selected exam the row/card simply isn't clickable — same rule both layouts.
  const openStudent = examenId
    ? (row: StudentStatsRow) =>
        router.push(`/dashboard/admin/elevi/${row.user_id}?examen_id=${examenId}`)
    : null

  const buildHref = ({
    page: nextPage,
    sort: nextSort,
    search,
  }: {
    page?: number
    sort?: string
    search?: string
  }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (typeof nextPage === "number") params.set("page", String(nextPage))
    if (typeof nextSort !== "undefined") {
      if (nextSort) params.set("sort", nextSort)
      else params.delete("sort")
    }
    if (typeof search !== "undefined") {
      if (search) params.set("q", search)
      else params.delete("q")
    }
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))

  const columns = useMemo<Column<StudentStatsRow>[]>(
    () => [
      {
        key: "nume",
        header: "Nume",
        sortable: true,
        sortKey: "nume_asc",
        pin: "left",
        minWidth: 240,
        noWrap: false,
        render: (row) => (
          <div>
            <p className="font-medium text-foreground">{row.nume ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{row.email ?? "—"}</p>
          </div>
        ),
      },
      {
        key: "scor",
        header: "Scor mediu",
        sortable: true,
        sortKey: "scor_desc",
        align: "right",
        minWidth: 120,
        render: (row) => <span className="tabular-nums">{formatPercent(row.scor_mediu)}</span>,
      },
      {
        key: "simulari",
        header: "Simulări finalizate",
        sortable: true,
        sortKey: "simulari_desc",
        align: "right",
        minWidth: 160,
        render: (row) => <span className="tabular-nums">{row.simulari_finalizate}</span>,
      },
      {
        key: "rata",
        header: "Rată trecere",
        align: "center",
        minWidth: 130,
        render: (row) => {
          if (row.rata_trecere_pct == null) {
            return (
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                —
              </span>
            )
          }
          const isPassed =
            examPassThresholdPct == null
              ? row.rata_trecere_pct >= 50
              : row.rata_trecere_pct >= examPassThresholdPct
          return (
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                isPassed
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
              )}
            >
              {formatPercent(row.rata_trecere_pct)}
            </span>
          )
        },
      },
      {
        key: "pregatire",
        header: "Nivel pregătire",
        minWidth: 170,
        render: (row) => {
          const pct = row.nivel_pregatire_pct
          return (
            <div className="space-y-1">
              <p className="text-sm tabular-nums">{formatPercent(pct)}</p>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
                />
              </div>
            </div>
          )
        },
      },
      {
        key: "timp",
        header: "Timp dedicat",
        sortable: true,
        sortKey: "timp_desc",
        align: "right",
        minWidth: 140,
        render: (row) => <span className="tabular-nums">{formatDuration(row.timp_dedicat_secunde)}</span>,
      },
      {
        key: "ultima",
        header: "Ultima activitate",
        sortable: true,
        sortKey: "ultima_activitate_desc",
        minWidth: 180,
        render: (row) => <span className="text-sm text-muted-foreground">{relativeTime(row.ultima_activitate)}</span>,
      },
    ],
    [examPassThresholdPct],
  )

  return (
    <>
      {peerAdmins && peerAdmins.length > 0 ? (
        <div className="rounded-xl border bg-card p-4 mb-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Colegi admini</h3>
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
              {peerAdmins.length}
            </span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Org admini din organizația ta care au activat partajarea statisticilor.
          </p>
          {isDesktop ? (
            <DataTable
              rows={peerAdmins}
              columns={columns}
              totalCount={peerAdmins.length}
              pageSize={peerAdmins.length || 1}
              currentPage={1}
              currentSort={currentSort}
              currentSearch={currentSearch}
              emptyState={{ title: "—" }}
              availableSortKeys={[]}
              buildHref={() => "#"}
              onRowClick={openStudent ?? undefined}
            />
          ) : (
            <StudentCardList
              rows={peerAdmins}
              emptyTitle="—"
              examPassThresholdPct={examPassThresholdPct}
              onSelect={openStudent}
            />
          )}
        </div>
      ) : null}

      {isDesktop ? (
        <DataTable
          key={currentSearch}
          rows={rows}
          columns={columns}
          totalCount={totalCount}
          pageSize={pageSize}
          currentPage={page}
          currentSort={currentSort}
          currentSearch={currentSearch}
          emptyState={emptyState}
          availableSortKeys={[
            "nume_asc",
            "nume_desc",
            "scor_desc",
            "scor_asc",
            "simulari_desc",
            "timp_desc",
            "ultima_activitate_desc",
          ]}
          buildHref={buildHref}
          onRowClick={openStudent ?? undefined}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <StudentCardList
            rows={rows}
            emptyTitle={emptyState.title}
            examPassThresholdPct={examPassThresholdPct}
            onSelect={openStudent}
          />

          {/* The list is paginated server-side, so the cards need their own
              controls — otherwise mobile is stuck on the first page. */}
          {totalCount > pageSize ? (
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <p className="text-muted-foreground">
                Pagina {Math.min(page, pageCount)} din {pageCount} · {totalCount} rezultate
              </p>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className={cn(page <= 1 && "pointer-events-none opacity-50")}
                >
                  <Link href={buildHref({ page: page - 1 })} aria-label="Pagina anterioară">
                    <ChevronLeft className="size-4" />
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className={cn(page >= pageCount && "pointer-events-none opacity-50")}
                >
                  <Link href={buildHref({ page: page + 1 })} aria-label="Pagina următoare">
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
