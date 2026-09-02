"use client"

import { useState, type ReactNode } from "react"
import { Compass, FolderOpen, Star } from "lucide-react"
import {
  PublicExamsBrowser,
  type PublicExamItem,
} from "@/components/my-exams/PublicExamsBrowser"
import { tabActive, tabBase, tabIdle, tabStrip } from "@/components/my-exams/styles"

type HubTab = "personal" | "favorites" | "explore"

export function MyExamsHub({
  personalSlot,
  publicExams,
}: {
  personalSlot: ReactNode
  publicExams: PublicExamItem[]
}) {
  const [tab, setTab] = useState<HubTab>("personal")

  const favoriteCount = publicExams.filter((exam) => exam.isFavorite).length

  const tabClass = (value: HubTab) => `${tabBase} ${tab === value ? tabActive : tabIdle}`

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Biblioteca ta</h1>

      <div className={tabStrip}>
        <button type="button" onClick={() => setTab("personal")} className={tabClass("personal")}>
          <FolderOpen className="size-3.5" /> Ale mele
        </button>
        <button
          type="button"
          onClick={() => setTab("favorites")}
          className={tabClass("favorites")}
        >
          <Star className="size-3.5" /> Favorite ({favoriteCount})
        </button>
        <button type="button" onClick={() => setTab("explore")} className={tabClass("explore")}>
          <Compass className="size-3.5" /> Explorează ({publicExams.length})
        </button>
      </div>

      {tab === "personal" ? personalSlot : null}
      {tab === "favorites" ? (
        <PublicExamsBrowser exams={publicExams} mode="favorites" />
      ) : null}
      {tab === "explore" ? <PublicExamsBrowser exams={publicExams} mode="explore" /> : null}
    </div>
  )
}
