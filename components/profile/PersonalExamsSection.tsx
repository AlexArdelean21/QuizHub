import Link from "next/link"
import { ChevronRight, FileText } from "lucide-react"

export type PersonalExam = { id: number; nume_examen: string }

export function PersonalExamsSection({
  exams,
  maxPersonal,
}: {
  exams: PersonalExam[]
  maxPersonal: number
}) {
  return (
    <Link
      href="/my-exams"
      className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-center gap-3">
        <FileText className="size-5 shrink-0 text-primary" />
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">Examenele mele</span>
          <span className="text-xs text-muted-foreground">
            {exams.length} / {maxPersonal} examene proprii
          </span>
        </div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
