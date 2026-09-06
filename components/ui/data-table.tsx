"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)")
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return isDesktop
}

export type Column<TRow> = {
  key: string
  header: React.ReactNode
  sortable?: boolean
  sortKey?: string
  render: (row: TRow) => React.ReactNode
  headerClassName?: string
  cellClassName?: string
  align?: "left" | "right" | "center"
  /** Pin this column to an edge during horizontal scroll. */
  pin?: "left" | "right"
  /** Fixed width (px). Needed for correct sticky offsets when pinning >1 column on a side. */
  width?: number
  /** Minimum width (px). Forces the table wide enough to trigger horizontal scroll. */
  minWidth?: number
  /** Prevent text wrapping. Defaults to true for pinned columns, false otherwise. */
  noWrap?: boolean
}

export type DataTableProps<TRow> = {
  rows: TRow[]
  columns: Column<TRow>[]
  totalCount: number
  pageSize?: number
  currentPage: number
  currentSort?: string
  onRowClick?: (row: TRow) => void
  searchPlaceholder?: string
  currentSearch?: string
  isLoading?: boolean
  emptyState?: { title: string; description?: string }
  availableSortKeys?: string[]
  buildHref: (params: { page?: number; sort?: string; search?: string }) => string
}

type SortDirection = "ascending" | "descending" | "none"

function alignClass(align?: "left" | "right" | "center") {
  if (align === "right") return "text-right"
  if (align === "center") return "text-center"
  return "text-left"
}

function sortDirectionFromKey(sortKey?: string): SortDirection {
  if (!sortKey) return "none"
  if (sortKey.endsWith("_asc")) return "ascending"
  if (sortKey.endsWith("_desc")) return "descending"
  return "none"
}

export function DataTable<TRow>({
  rows,
  columns,
  totalCount,
  pageSize = 25,
  currentPage,
  currentSort,
  onRowClick,
  searchPlaceholder,
  currentSearch,
  isLoading = false,
  emptyState,
  availableSortKeys,
  buildHref,
}: DataTableProps<TRow>) {
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const [searchInput, setSearchInput] = useState(currentSearch ?? "")

  useEffect(() => {
    if (!searchPlaceholder) return
    const handle = window.setTimeout(() => {
      const nextSearch = searchInput.trim() || undefined
      const current = (currentSearch ?? "").trim() || undefined
      if (nextSearch === current) return
      router.replace(buildHref({ page: 1, search: nextSearch }))
    }, 300)
    return () => window.clearTimeout(handle)
  }, [buildHref, currentSearch, router, searchInput, searchPlaceholder])

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const showPagination = totalCount > pageSize
  const hasRows = rows.length > 0
  const allSortKeys = useMemo(
    () => [
      ...columns
        .map((column) => column.sortKey)
        .filter((value): value is string => Boolean(value)),
      ...(availableSortKeys ?? []),
    ],
    [availableSortKeys, columns],
  )

  const pageNumbers = useMemo(() => {
    const maxButtons = 5
    if (pageCount <= maxButtons) {
      return Array.from({ length: pageCount }, (_, idx) => idx + 1)
    }
    const start = Math.max(1, Math.min(currentPage - 2, pageCount - maxButtons + 1))
    return Array.from({ length: maxButtons }, (_, idx) => start + idx)
  }, [currentPage, pageCount])

  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const [scroll, setScroll] = useState({ atStart: true, atEnd: true })

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atStart = el.scrollLeft <= 0
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
    setScroll((prev) =>
      prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd },
    )
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [measure])

  useEffect(() => {
    measure()
  }, [rows, measure])

  const handleScroll = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      measure()
    })
  }, [measure])

  const DEFAULT_PIN_WIDTH = 200
  const leftPins = useMemo(() => columns.filter((c) => c.pin === "left"), [columns])
  const rightPins = useMemo(() => columns.filter((c) => c.pin === "right"), [columns])
  const lastLeftPinKey = leftPins.at(-1)?.key
  const firstRightPinKey = rightPins[0]?.key

  const cellStyle = useCallback(
    (column: Column<TRow>, kind: "head" | "cell"): React.CSSProperties | undefined => {
      const style: React.CSSProperties = {}
      if (column.width != null) style.width = column.width
      if (column.minWidth != null) style.minWidth = column.minWidth
      if (column.pin === "left" && isDesktop) {
        const i = leftPins.findIndex((c) => c.key === column.key)
        style.position = "sticky"
        style.left = leftPins.slice(0, i).reduce((s, c) => s + (c.width ?? DEFAULT_PIN_WIDTH), 0)
        style.zIndex = kind === "head" ? 30 : 20
        if (column.key === lastLeftPinKey && !scroll.atStart) {
          style.boxShadow = "8px 0 12px -8px rgb(0 0 0 / 0.18)"
        }
      } else if (column.pin === "right" && isDesktop) {
        const i = rightPins.findIndex((c) => c.key === column.key)
        style.position = "sticky"
        style.right = rightPins.slice(i + 1).reduce((s, c) => s + (c.width ?? DEFAULT_PIN_WIDTH), 0)
        style.zIndex = kind === "head" ? 30 : 20
        if (column.key === firstRightPinKey && !scroll.atEnd) {
          style.boxShadow = "-8px 0 12px -8px rgb(0 0 0 / 0.18)"
        }
      }
      return Object.keys(style).length ? style : undefined
    },
    [leftPins, rightPins, lastLeftPinKey, firstRightPinKey, scroll.atStart, scroll.atEnd],
  )

  const getNextSort = (columnSortKey?: string): string | undefined => {
    if (!columnSortKey) return undefined
    if (currentSort !== columnSortKey) return columnSortKey

    if (columnSortKey.endsWith("_asc")) {
      const descKey = `${columnSortKey.slice(0, -4)}_desc`
      return allSortKeys.includes(descKey) ? descKey : undefined
    }
    if (columnSortKey.endsWith("_desc")) {
      const ascKey = `${columnSortKey.slice(0, -5)}_asc`
      return allSortKeys.includes(ascKey) ? ascKey : undefined
    }
    return undefined
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      {searchPlaceholder ? (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative overflow-x-auto overscroll-x-contain [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
      >
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => {
                const isSortable = Boolean(column.sortable && column.sortKey)
                const isActive = currentSort === column.sortKey
                const nextSort = getNextSort(column.sortKey)
                const ariaSort: SortDirection = isActive
                  ? sortDirectionFromKey(currentSort)
                  : "none"

                return (
                  <TableHead
                    key={column.key}
                    aria-sort={ariaSort}
                    className={cn(
                      alignClass(column.align),
                      column.headerClassName,
                      column.pin && isDesktop && "bg-card",
                      (column.noWrap ?? Boolean(column.pin)) && "whitespace-nowrap",
                    )}
                    style={cellStyle(column, "head")}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => router.replace(buildHref({ page: 1, sort: nextSort }))}
                        className={cn(
                          "inline-flex items-center gap-1.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground transition hover:text-foreground",
                          column.align === "right" && "ml-auto",
                          column.align === "center" && "mx-auto",
                        )}
                      >
                        <span>{column.header}</span>
                        {isActive ? (
                          currentSort?.endsWith("_asc") ? (
                            <ChevronUp className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-70" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: Math.min(pageSize, 5) }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {columns.map((column) => (
                    <TableCell key={`${column.key}-${rowIndex}`}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : hasRows ? (
              rows.map((row, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn("group/row", onRowClick && "cursor-pointer")}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        alignClass(column.align),
                        column.cellClassName,
                        column.pin && isDesktop && "bg-card group-hover/row:bg-muted transition-[box-shadow,background-color]",
                        (column.noWrap ?? Boolean(column.pin)) && "whitespace-nowrap",
                      )}
                      style={cellStyle(column, "cell")}
                    >
                      {column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-16">
                  <div className="mx-auto max-w-md text-center">
                    <p className="text-base font-medium text-foreground">
                      {emptyState?.title ?? "Nu există rezultate"}
                    </p>
                    {emptyState?.description ? (
                      <p className="mt-2 text-sm text-muted-foreground">{emptyState.description}</p>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination ? (
        <div className="flex flex-col gap-3 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            Pagina {Math.min(currentPage, pageCount)} din {pageCount} · {totalCount} rezultate
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              asChild
              disabled={currentPage <= 1}
              className={cn(currentPage <= 1 && "pointer-events-none opacity-50")}
            >
              <Link href={buildHref({ page: currentPage - 1 })}>
                <ChevronLeft className="size-4" />
                Previous
              </Link>
            </Button>
            {pageNumbers.map((page) => (
              <Button key={page} size="sm" variant={page === currentPage ? "default" : "outline"} asChild>
                <Link href={buildHref({ page })}>{page}</Link>
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              asChild
              disabled={currentPage >= pageCount}
              className={cn(currentPage >= pageCount && "pointer-events-none opacity-50")}
            >
              <Link href={buildHref({ page: currentPage + 1 })}>
                Next
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
