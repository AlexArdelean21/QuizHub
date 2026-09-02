"use client"

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ExamCategory, ExamSummary } from "@/lib/quiz/types"

/** Fixed display order; a group with no items is never rendered. */
const GROUPS: ReadonlyArray<{ category: ExamCategory; label: string }> = [
  { category: "org", label: "Organizație" },
  { category: "personal", label: "Examenele mele" },
  { category: "public", label: "Publice" },
]

const CATEGORY_LABEL: Record<ExamCategory, string> = {
  org: "Organizație",
  personal: "Personal",
  public: "Public",
}

// Below this, a search box is more noise than help.
const SEARCH_THRESHOLD = 8

function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

export function ExamPicker({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: ExamSummary[]
  value: number | null
  onChange: (examId: number) => void
  disabled?: boolean
}) {
  const baseId = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const showSearch = options.length > SEARCH_THRESHOLD

  const groups = useMemo(() => {
    const query = foldForSearch(search.trim())
    const matches = query
      ? options.filter((exam) => foldForSearch(exam.name).includes(query))
      : options
    return GROUPS.map(({ category, label }) => ({
      label,
      items: matches.filter((exam) => exam.category === category),
    })).filter((group) => group.items.length > 0)
  }, [options, search])

  // Flat render order, so the arrow keys walk across group boundaries.
  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const safeActiveIndex = flatItems.length === 0 ? -1 : Math.min(activeIndex, flatItems.length - 1)
  const activeItem = safeActiveIndex >= 0 ? flatItems[safeActiveIndex] : null

  const selectedExam = options.find((exam) => exam.id === value) ?? null

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target || !containerRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [open])

  // Move focus into the panel on open so the arrow keys work immediately.
  useEffect(() => {
    if (!open) return
    if (showSearch) searchRef.current?.focus()
    else listRef.current?.focus()
  }, [open, showSearch])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [open, safeActiveIndex])

  const closeAndRefocus = () => {
    setOpen(false)
    setSearch("")
    triggerRef.current?.focus()
  }

  const toggleOpen = () => {
    if (disabled) return
    if (open) {
      closeAndRefocus()
      return
    }
    const selectedIndex = flatItems.findIndex((exam) => exam.id === value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  const selectExam = (examId: number) => {
    setOpen(false)
    setSearch("")
    triggerRef.current?.focus()
    if (examId !== value) onChange(examId)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !open) return
    if (event.key === "Escape") {
      event.preventDefault()
      closeAndRefocus()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (flatItems.length > 0) setActiveIndex(Math.min(safeActiveIndex + 1, flatItems.length - 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (flatItems.length > 0) setActiveIndex(Math.max(safeActiveIndex - 1, 0))
      return
    }
    if (event.key === "Enter" && activeItem) {
      event.preventDefault()
      selectExam(activeItem.id)
    }
  }

  if (options.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/70 px-4 py-4 text-sm">
        <p className="text-muted-foreground">Nu ai încă niciun examen disponibil.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/my-exams">Explorează examenele publice</Link>
        </Button>
      </div>
    )
  }

  const listboxId = `${baseId}-listbox`

  return (
    <div ref={containerRef} className="relative w-full" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Examen"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={toggleOpen}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/70 px-4 py-2.5 text-sm font-medium text-foreground shadow-sm backdrop-blur transition hover:border-primary/40 hover:bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate" title={selectedExam?.name}>
            {selectedExam?.name ?? "Selectează un examen"}
          </span>
          {selectedExam ? (
            <Badge variant="secondary" className="shrink-0">
              {CATEGORY_LABEL[selectedExam.category]}
            </Badge>
          ) : null}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-[120] mt-2 overflow-hidden rounded-xl border border-border/60 bg-popover/95 shadow-2xl backdrop-blur-md">
          {showSearch ? (
            <div className="border-b border-border/60 p-2">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setActiveIndex(0)
                }}
                placeholder="Caută examen"
                aria-label="Caută examen"
                aria-controls={listboxId}
                aria-activedescendant={activeItem ? `${baseId}-option-${activeItem.id}` : undefined}
                className="w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          ) : null}

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label="Examene disponibile"
            tabIndex={-1}
            aria-activedescendant={
              !showSearch && activeItem ? `${baseId}-option-${activeItem.id}` : undefined
            }
            className="max-h-[60vh] overflow-y-auto py-1 focus:outline-none"
          >
            {groups.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Niciun examen găsit.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.label} role="group" aria-label={`${group.label} (${group.items.length})`}>
                  <p
                    aria-hidden="true"
                    className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {group.label} ({group.items.length})
                  </p>
                  {group.items.map((exam) => {
                    const isSelected = exam.id === value
                    const isActive = activeItem?.id === exam.id
                    return (
                      <button
                        key={exam.id}
                        id={`${baseId}-option-${exam.id}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-active={isActive ? "true" : undefined}
                        onMouseEnter={() => {
                          const index = flatItems.findIndex((item) => item.id === exam.id)
                          if (index >= 0) setActiveIndex(index)
                        }}
                        onClick={() => selectExam(exam.id)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition ${
                          isSelected
                            ? "bg-primary/15 text-primary"
                            : isActive
                              ? "bg-secondary/60 text-foreground"
                              : "text-foreground"
                        }`}
                      >
                        <span className="truncate" title={exam.name}>
                          {exam.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {exam.intrebariSimulare} î.
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
