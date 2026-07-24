"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlignLeft,
  FileJson,
  FilePlus2,
  FileSpreadsheet,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ModalPortal } from "@/components/ui/modal-portal"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { parseExamJson, parsePlainTextToQuestions } from "@/lib/exams/parse"
import {
  createPersonalExam,
  deletePersonalExam,
  importPersonalExamFromExcel,
  importPersonalExamFromJson,
  renamePersonalExam,
  updatePersonalExamRules,
  type ImportResult,
  type PersonalExamRulesPayload,
} from "@/app/my-exams/actions"

export type PersonalExamItem = {
  id: number
  nume_examen: string
  pragTrecere: number
  intrebariSimulare: number
  varianteRaspuns: number
  durataMinute: number
  questionCount: number
}

type ToastState = { type: "success" | "error"; message: string } | null
type ImportMode = "excel" | "json" | "text"
type ImportPreview = {
  items: Array<{ idx: number; intrebare_text: string; variante: string[] }>
  skipped: number
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600"
const overlayClass =
  "fixed inset-0 z-[90] flex items-center justify-center p-4"
const scrimClass = "absolute inset-0 bg-black/60 backdrop-blur-sm"
const tabBase =
  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
const tabActive = "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
const tabIdle =
  "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
const guideBox =
  "mt-2 max-h-52 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-500/10 dark:text-blue-300"
const rowActionBtn =
  "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
const rowDeleteBtn =
  "inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
const ruleBadge =
  "rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800"

export function MyExamsManager({
  exams,
  maxExams,
  maxQuestionsPerExam,
}: {
  exams: PersonalExamItem[]
  maxExams: number
  maxQuestionsPerExam: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<ToastState>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)

  const [renameTarget, setRenameTarget] = useState<PersonalExamItem | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameError, setRenameError] = useState<string | null>(null)

  const [rulesTarget, setRulesTarget] = useState<PersonalExamItem | null>(null)
  const [rulesDraft, setRulesDraft] = useState<PersonalExamRulesPayload>({
    prag_trecere: 18,
    intrebari_simulare: 25,
    variante_raspuns: 3,
    durata_minute: 30,
  })
  const [rulesError, setRulesError] = useState<string | null>(null)

  const [importTarget, setImportTarget] = useState<PersonalExamItem | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>("excel")
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importJson, setImportJson] = useState("")
  const [importText, setImportText] = useState("")
  const [importGuide, setImportGuide] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importInfo, setImportInfo] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<PersonalExamItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState("")

  const atLimit = exams.length >= maxExams

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openRename = (exam: PersonalExamItem) => {
    setRenameTarget(exam)
    setRenameValue(exam.nume_examen)
    setRenameError(null)
  }

  const openRules = (exam: PersonalExamItem) => {
    setRulesTarget(exam)
    setRulesDraft({
      prag_trecere: exam.pragTrecere || 18,
      intrebari_simulare: exam.intrebariSimulare || 25,
      variante_raspuns: exam.varianteRaspuns || 3,
      durata_minute: exam.durataMinute || 30,
    })
    setRulesError(null)
  }

  const openImport = (exam: PersonalExamItem) => {
    setImportTarget(exam)
    setImportMode("excel")
    setImportFile(null)
    setImportJson("")
    setImportText("")
    setImportGuide(false)
    setImportPreview(null)
    setImportInfo(null)
    setImportError(null)
  }

  const resetImportOutput = () => {
    setImportPreview(null)
    setImportInfo(null)
    setImportError(null)
  }

  const switchImportMode = (mode: ImportMode) => {
    setImportMode(mode)
    setImportGuide(false)
    resetImportOutput()
  }

  const handleCreate = () => {
    if (!createName.trim()) return
    setCreateError(null)
    startTransition(async () => {
      const result = await createPersonalExam({ nume_examen: createName })
      if (!result.success) {
        setCreateError(result.error)
        return
      }
      setShowCreate(false)
      setCreateName("")
      setToast({ type: "success", message: "Examen creat." })
      router.refresh()
    })
  }

  const handleRename = () => {
    if (!renameTarget) return
    setRenameError(null)
    const examId = renameTarget.id
    startTransition(async () => {
      const result = await renamePersonalExam(examId, renameValue)
      if (!result.success) {
        setRenameError(result.error)
        return
      }
      setRenameTarget(null)
      setToast({ type: "success", message: "Nume actualizat." })
      router.refresh()
    })
  }

  const handleSaveRules = () => {
    if (!rulesTarget) return
    setRulesError(null)
    const examId = rulesTarget.id
    const payload = rulesDraft
    startTransition(async () => {
      const result = await updatePersonalExamRules(examId, payload)
      if (!result.success) {
        setRulesError(result.error)
        return
      }
      setRulesTarget(null)
      setToast({ type: "success", message: "Regulile examenului au fost actualizate." })
      router.refresh()
    })
  }

  const handlePreview = () => {
    resetImportOutput()
    if (importMode === "json") {
      try {
        const parsed = parseExamJson(importJson)
        setImportPreview({
          items: parsed.questions.map((q, idx) => ({
            idx,
            intrebare_text: q.intrebare_text,
            variante: q.variante,
          })),
          skipped: parsed.skippedRows,
        })
        setImportInfo(`Preview gata: ${parsed.questions.length} întrebări procesate.`)
      } catch (error) {
        setImportError(error instanceof Error ? error.message : "Nu s-a putut genera preview-ul.")
      }
      return
    }
    if (importMode === "text") {
      const parsed = parsePlainTextToQuestions(importText)
      if (!parsed.questions.length) {
        setImportError("Nu am găsit întrebări valide în text. Verifică formatul.")
        return
      }
      setImportPreview({
        items: parsed.questions.map((q, idx) => ({
          idx,
          intrebare_text: q.question,
          variante: q.answers,
        })),
        skipped: 0,
      })
      setImportInfo(`Preview gata: ${parsed.questions.length} întrebări procesate.`)
    }
  }

  const handleImport = () => {
    if (!importTarget) return
    const examId = importTarget.id
    setImportError(null)
    startTransition(async () => {
      let result: ImportResult
      if (importMode === "excel") {
        if (!importFile) {
          setImportError("Selectează un fișier .xlsx.")
          return
        }
        const formData = new FormData()
        formData.append("file", importFile)
        result = await importPersonalExamFromExcel(examId, formData)
      } else if (importMode === "json") {
        result = await importPersonalExamFromJson(examId, importJson)
      } else {
        const parsed = parsePlainTextToQuestions(importText)
        if (!parsed.questions.length) {
          setImportError("Nu am găsit întrebări valide în text. Verifică formatul.")
          return
        }
        result = await importPersonalExamFromJson(examId, JSON.stringify(parsed))
      }

      if (!result.success) {
        setImportError(result.error)
        return
      }
      setImportTarget(null)
      const base = `Import reușit. +${result.inserted} întrebări noi, ${result.skipped} duplicate ignorate.`
      const adjusted = result.rulesAdjusted
        ? ` Regulile au fost ajustate: ${result.rulesAdjusted.intrebariSimulare} întrebări în simulare, prag ${result.rulesAdjusted.pragTrecere}.`
        : ""
      setToast({ type: "success", message: base + adjusted })
      router.refresh()
    })
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    const examId = deleteTarget.id
    const name = deleteTarget.nume_examen
    startTransition(async () => {
      const result = await deletePersonalExam(examId)
      if (!result.success) {
        setToast({ type: "error", message: result.error })
        setDeleteTarget(null)
        setDeleteConfirm("")
        return
      }
      setDeleteTarget(null)
      setDeleteConfirm("")
      setToast({ type: "success", message: `Examenul „${name}" a fost șters definitiv.` })
      router.refresh()
    })
  }

  const canDeleteForever =
    !isPending && deleteTarget !== null && deleteConfirm.trim() === deleteTarget.nume_examen.trim()

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-4 dark:border-slate-800">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Examenele mele
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Creează și gestionează examenele tale personale.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {exams.length} / {maxExams} examene proprii
          </p>
          {atLimit ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <Button type="button" disabled className="pointer-events-none bg-blue-600 text-white">
                    <Plus className="mr-1 size-4" />
                    Examen nou
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Ai atins limita de {maxExams} examene proprii.
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              disabled={isPending}
              onClick={() => {
                setCreateName("")
                setCreateError(null)
                setShowCreate(true)
              }}
              className="bg-blue-600 text-white hover:bg-blue-500"
            >
              <Plus className="mr-1 size-4" />
              Examen nou
            </Button>
          )}
        </div>
      </div>

      {/* Desktop table — hidden on mobile */}
      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200/70 dark:border-slate-800 sm:block">
        <table className="min-w-full divide-y divide-slate-200/70 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Examen</th>
              <th className="px-4 py-3">Întrebări</th>
              <th className="px-4 py-3">Reguli simulare</th>
              <th className="px-4 py-3 text-right">Acțiuni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {exams.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Nu ai încă examene proprii.
                </td>
              </tr>
            ) : (
              exams.map((exam) => (
                <tr key={exam.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-950/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-white">{exam.nume_examen}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">ID #{exam.id}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                      {exam.questionCount} / {maxQuestionsPerExam}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex flex-wrap gap-1">
                      <span className={ruleBadge}>{exam.intrebariSimulare} întrebări</span>
                      <span className={ruleBadge}>{exam.durataMinute} min</span>
                      <span className={ruleBadge}>prag {exam.pragTrecere}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <button type="button" onClick={() => openRename(exam)} disabled={isPending} className={rowActionBtn}>
                        <Pencil className="size-3.5" /> Redenumește
                      </button>
                      {exam.questionCount === 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-block">
                              <button type="button" disabled className={`${rowActionBtn} pointer-events-none opacity-50`}>
                                <Settings2 className="size-3.5" /> Reguli
                              </button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Importă întâi întrebări.</TooltipContent>
                        </Tooltip>
                      ) : (
                        <button type="button" onClick={() => openRules(exam)} disabled={isPending} className={rowActionBtn}>
                          <Settings2 className="size-3.5" /> Reguli
                        </button>
                      )}
                      <button type="button" onClick={() => openImport(exam)} disabled={isPending} className={rowActionBtn}>
                        <Upload className="size-3.5" /> Import
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDeleteTarget(exam); setDeleteConfirm("") }}
                        disabled={isPending}
                        className={rowDeleteBtn}
                      >
                        <Trash2 className="size-3.5" /> Șterge
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list — shown only on mobile */}
      <div className="mt-4 flex flex-col divide-y divide-slate-200/70 overflow-hidden rounded-xl border border-slate-200/70 dark:divide-slate-800 dark:border-slate-800 sm:hidden">
        {exams.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Nu ai încă examene proprii.</p>
        ) : (
          exams.map((exam) => (
            <div key={exam.id} className="flex flex-col gap-2 bg-white px-4 py-3 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium leading-tight text-slate-900 dark:text-white">{exam.nume_examen}</p>
                  <p className="mt-0.5 text-xs text-slate-400">ID #{exam.id}</p>
                </div>
                <span className="inline-flex shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                  {exam.questionCount} / {maxQuestionsPerExam}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span className={ruleBadge}>{exam.intrebariSimulare} întrebări</span>
                <span className={ruleBadge}>{exam.durataMinute} min</span>
                <span className={ruleBadge}>prag {exam.pragTrecere}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <button type="button" onClick={() => openRename(exam)} disabled={isPending} className={rowActionBtn}>
                  <Pencil className="size-3" /> Redenumește
                </button>
                {exam.questionCount === 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block">
                        <button type="button" disabled className={`${rowActionBtn} pointer-events-none opacity-50`}>
                          <Settings2 className="size-3" /> Reguli
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Importă întâi întrebări.</TooltipContent>
                  </Tooltip>
                ) : (
                  <button type="button" onClick={() => openRules(exam)} disabled={isPending} className={rowActionBtn}>
                    <Settings2 className="size-3" /> Reguli
                  </button>
                )}
                <button type="button" onClick={() => openImport(exam)} disabled={isPending} className={rowActionBtn}>
                  <Upload className="size-3" /> Import
                </button>
                <button
                  type="button"
                  onClick={() => { setDeleteTarget(exam); setDeleteConfirm("") }}
                  disabled={isPending}
                  className={rowDeleteBtn}
                >
                  <Trash2 className="size-3" /> Șterge
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {toast ? (
        <div
          className={`fixed top-6 right-6 z-[200] w-full max-w-sm rounded-xl border px-4 py-3 text-center text-sm font-medium shadow-xl transition-all duration-300 ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300"
              : "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      {/* Create modal */}
      {showCreate ? (
        <ModalPortal>
          <div className={overlayClass}>
            <button type="button" aria-label="Închide" className={scrimClass} onClick={() => !isPending && setShowCreate(false)} />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Examen personal nou</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Dă-i un nume. Vei putea importa întrebări după creare.
                  </p>
                </div>
                <FilePlus2 className="size-5 text-blue-500" />
              </div>
              <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Nume examen
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Ex: Recapitulare capitolul 3"
                  autoFocus
                  disabled={isPending}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              {createError ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
                  {createError}
                </div>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowCreate(false)} disabled={isPending}>
                  Anulează
                </Button>
                <Button type="button" onClick={handleCreate} disabled={isPending || !createName.trim()} className="bg-blue-600 text-white hover:bg-blue-500">
                  {isPending ? "Se creează..." : "Creează"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {/* Rename modal */}
      {renameTarget ? (
        <ModalPortal>
          <div className={overlayClass}>
            <button type="button" aria-label="Închide" className={scrimClass} onClick={() => !isPending && setRenameTarget(null)} />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Redenumește examenul</h4>
              <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Nume examen
                <input
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  autoFocus
                  disabled={isPending}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              {renameError ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
                  {renameError}
                </div>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRenameTarget(null)} disabled={isPending}>
                  Anulează
                </Button>
                <Button type="button" onClick={handleRename} disabled={isPending} className="bg-blue-600 text-white hover:bg-blue-500">
                  {isPending ? "Se salvează..." : "Salvează"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {/* Import modal */}
      {importTarget ? (
        <ModalPortal>
          <div className={overlayClass}>
            <button type="button" aria-label="Închide" className={scrimClass} onClick={() => !isPending && setImportTarget(null)} />
            <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Import întrebări</h3>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {importMode === "excel"
                        ? "Încarcă un fișier Excel (.xlsx) cu întrebări și răspunsuri."
                        : importMode === "json"
                          ? "Lipește un JSON cu întrebările examenului."
                          : "Lipește întrebările ca text simplu, numerotate, cu variante a), b), c)..."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setImportGuide((prev) => !prev)}
                      className="flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-slate-400 transition hover:border-blue-400 hover:text-blue-500 dark:border-slate-600 dark:hover:border-blue-500"
                      aria-label="Format fișier"
                    >
                      ?
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {importTarget.nume_examen} · {importTarget.questionCount} / {maxQuestionsPerExam} întrebări
                  </p>

                  {importGuide && importMode === "excel" ? (
                    <div className={guideBox}>
                      <p className="mb-1 font-semibold">Structura fișierului Excel:</p>
                      <ul className="list-none space-y-1">
                        <li>• <strong>Coloana A</strong> — textul întrebării</li>
                        <li>• <strong>Coloanele B, C, D...</strong> — variantele de răspuns</li>
                        <li>• <strong>Răspunsuri corecte</strong> — celulele corecte trebuie evidențiate cu fundal <strong>galben</strong></li>
                        <li>• Un rând = o întrebare. Rândurile fără text în col. A sunt ignorate.</li>
                        <li>• Suportă 2–10 variante per întrebare.</li>
                      </ul>
                      <a href="/docs#import-excel" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                        Află mai mult →
                      </a>
                    </div>
                  ) : null}
                  {importGuide && importMode === "json" ? (
                    <div className={guideBox}>
                      <p className="mb-2 font-semibold">Format JSON:</p>
                      <pre className="overflow-x-auto rounded bg-white/60 p-2 font-mono text-[10px] leading-relaxed dark:bg-black/20">{`{
  "questions": [
    {
      "question": "Textul întrebării",
      "answers": ["Variantă A", "Variantă B", "Variantă C"],
      "correct": [1]
    }
  ]
}`}</pre>
                      <ul className="mt-2 space-y-1">
                        <li>• <strong>question</strong> — textul întrebării</li>
                        <li>• <strong>answers</strong> — 2–10 variante de răspuns</li>
                        <li>• <strong>correct</strong> — indecși 1-bazați ai răspunsurilor corecte (ex: [1])</li>
                      </ul>
                      <a href="/docs#import-json" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                        Află mai mult →
                      </a>
                    </div>
                  ) : null}
                  {importGuide && importMode === "text" ? (
                    <div className={guideBox}>
                      <p className="mb-1 font-semibold">Format text simplu:</p>
                      <ul className="space-y-1">
                        <li>• Fiecare întrebare începe cu număr: <code className="rounded bg-white/60 px-1 dark:bg-black/20">1.</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">1)</code></li>
                        <li>• Variantele cu <code className="rounded bg-white/60 px-1 dark:bg-black/20">a)</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">a.</code></li>
                        <li>• Marchează corect cu <code className="rounded bg-white/60 px-1 dark:bg-black/20">*</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">✓</code> la finalul variantei</li>
                      </ul>
                      <a href="/docs#import-text" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                        Află mai mult →
                      </a>
                    </div>
                  ) : null}
                </div>
                <Upload className="size-5 text-blue-500" />
              </div>

              <div className="mt-4">
                <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
                  <button type="button" onClick={() => switchImportMode("excel")} disabled={isPending} className={`${tabBase} ${importMode === "excel" ? tabActive : tabIdle}`}>
                    <FileSpreadsheet className="size-3.5" /> Excel (.xlsx)
                  </button>
                  <button type="button" onClick={() => switchImportMode("json")} disabled={isPending} className={`${tabBase} ${importMode === "json" ? tabActive : tabIdle}`}>
                    <FileJson className="size-3.5" /> JSON
                  </button>
                  <button type="button" onClick={() => switchImportMode("text")} disabled={isPending} className={`${tabBase} ${importMode === "text" ? tabActive : tabIdle}`}>
                    <AlignLeft className="size-3.5" /> Text
                  </button>
                </div>

                {importMode === "excel" ? (
                  <div className="mt-3">
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); resetImportOutput() }}
                      disabled={isPending}
                      className="w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                    />
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Preview indisponibil pentru Excel — importă direct.
                    </p>
                  </div>
                ) : importMode === "json" ? (
                  <textarea
                    value={importJson}
                    onChange={(event) => { setImportJson(event.target.value); resetImportOutput() }}
                    disabled={isPending}
                    rows={7}
                    placeholder={`{\n  "questions": [\n    {\n      "question": "Textul întrebării",\n      "answers": ["Variantă A", "Variantă B", "Variantă C"],\n      "correct": [1]\n    }\n  ]\n}`}
                    className={`mt-3 font-mono ${inputClass}`}
                  />
                ) : (
                  <textarea
                    value={importText}
                    onChange={(event) => { setImportText(event.target.value); resetImportOutput() }}
                    disabled={isPending}
                    rows={8}
                    placeholder={"1. Care este tensiunea nominală?\na) 220V *\nb) 110V\nc) 380V"}
                    className={`mt-3 ${inputClass}`}
                  />
                )}
              </div>

              {importPreview ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Total: {importPreview.items.length}
                    {importPreview.skipped > 0 ? ` · Rânduri invalide ignorate: ${importPreview.skipped}` : ""}
                  </p>
                  <div className="mt-3 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                        <tr>
                          <th className="px-2 py-2">#</th>
                          <th className="px-2 py-2">Întrebare</th>
                          <th className="px-2 py-2">Variante</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {importPreview.items.map((row) => (
                          <tr key={`${row.idx}-${row.intrebare_text}`}>
                            <td className="px-2 py-2 align-top text-slate-500 dark:text-slate-400">{row.idx + 1}</td>
                            <td className="px-2 py-2 align-top text-slate-800 dark:text-slate-100">{row.intrebare_text}</td>
                            <td className="px-2 py-2 align-top text-slate-600 dark:text-slate-300">{row.variante.join(" | ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {importInfo ? (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-400">
                  {importInfo}
                </div>
              ) : null}
              {importError ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
                  {importError}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setImportTarget(null)} disabled={isPending}>
                  Anulează
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePreview}
                  disabled={isPending || importMode === "excel" || (importMode === "json" ? !importJson.trim() : !importText.trim())}
                >
                  Preview
                </Button>
                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={
                    isPending ||
                    (importMode === "excel" ? !importFile : importMode === "json" ? !importJson.trim() : !importText.trim())
                  }
                  className="bg-blue-600 text-white hover:bg-blue-500"
                >
                  {isPending ? "Import în curs..." : "Importă"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {/* Rules modal */}
      {rulesTarget ? (
        <ModalPortal>
          <div className={overlayClass}>
            <button type="button" aria-label="Închide" className={scrimClass} onClick={() => !isPending && setRulesTarget(null)} />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Reguli simulare</h4>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {rulesTarget.nume_examen} · {rulesTarget.questionCount} întrebări
                  </p>
                </div>
                <Settings2 className="size-5 text-blue-500" />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Întrebări simulare
                  <input
                    type="number"
                    min={1}
                    value={rulesDraft.intrebari_simulare}
                    onChange={(event) => setRulesDraft((prev) => ({ ...prev, intrebari_simulare: Number(event.target.value) }))}
                    disabled={isPending}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Durata (minute)
                  <input
                    type="number"
                    min={1}
                    value={rulesDraft.durata_minute}
                    onChange={(event) => setRulesDraft((prev) => ({ ...prev, durata_minute: Number(event.target.value) }))}
                    disabled={isPending}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Prag trecere
                  <input
                    type="number"
                    min={1}
                    value={rulesDraft.prag_trecere}
                    onChange={(event) => setRulesDraft((prev) => ({ ...prev, prag_trecere: Number(event.target.value) }))}
                    disabled={isPending}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Variante răspuns (max implicit)
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={rulesDraft.variante_raspuns}
                    onChange={(event) => setRulesDraft((prev) => ({ ...prev, variante_raspuns: Number(event.target.value) }))}
                    disabled={isPending}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Notă: &bdquo;Variante răspuns&rdquo; este un maxim implicit. În quiz, fiecare
                întrebare se afișează exact cu numărul de variante stocat în coloana JSONB{" "}
                <code>variante</code>.
              </p>

              {rulesError ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
                  {rulesError}
                </div>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRulesTarget(null)} disabled={isPending}>
                  Anulează
                </Button>
                <Button type="button" onClick={handleSaveRules} disabled={isPending} className="bg-blue-600 text-white hover:bg-blue-500">
                  {isPending ? "Se salvează..." : "Salvează regulile"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {/* Delete modal */}
      {deleteTarget ? (
        <ModalPortal>
          <div className={overlayClass}>
            <button
              type="button"
              aria-label="Închide confirmarea"
              className={scrimClass}
              onClick={() => { if (!isPending) { setDeleteTarget(null); setDeleteConfirm("") } }}
            />
            <div className="relative z-10 w-full max-w-lg rounded-2xl border border-rose-500/40 bg-white p-5 shadow-2xl dark:bg-slate-950">
              <h4 className="text-lg font-semibold text-rose-600 dark:text-rose-300">Confirmă ștergerea examenului</h4>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                Această acțiune va șterge definitiv examenul și toate întrebările asociate.
              </p>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                Pentru confirmare, tastați exact numele examenului:{" "}
                <span className="font-semibold text-slate-900 dark:text-white">{deleteTarget.nume_examen}</span>
              </p>
              <input
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder="Numele examenului"
                disabled={isPending}
                className={`mt-3 ${inputClass}`}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteConfirm("") }} disabled={isPending}>
                  Anulează
                </Button>
                <Button type="button" variant="destructive" onClick={handleDelete} disabled={!canDeleteForever}>
                  {isPending ? "Se șterge..." : "Șterge definitiv"}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </section>
  )
}
