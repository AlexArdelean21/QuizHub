"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlignLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileJson,
  FilePlus2,
  FileSpreadsheet,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react"
import {
  deleteExam,
  importExamFromExcel,
  importExamFromJson,
  previewExamImport,
  previewExamImportJson,
  setExamOrgWide,
  updateExam,
  updateExamRules,
  type AdminExamRow,
  type AdminOrganizationRow,
  type PreviewRow,
} from "@/app/admin/actions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ModalPortal } from "@/components/ui/modal-portal"
import { Switch } from "@/components/ui/switch"
import { QuestionEditorModal } from "@/components/admin/QuestionEditorModal"
import { DocumentAiImportModal } from "@/components/admin/DocumentAiImportModal"
import { useDocumentAiCredite } from "@/components/admin/DocumentAiCreditContext"
import { getStareCredite } from "@/app/admin/document-ai-actions"
import type { StareCredite } from "@/lib/document-ai/types"
import { parsePlainTextToQuestions } from "@/lib/exams/parse"

type ToastState = {
  type: "success" | "error"
  message: string
} | null

type ExamManagementProps = {
  examene: AdminExamRow[]
  organizations: AdminOrganizationRow[]
  isSuperAdmin: boolean
  defaultOrgId: string | null
}

type PreviewSummary = {
  total: number
  new: number
  duplicate_in_db: number
  duplicate_in_batch: number
}

const PAGE_SIZE = 10

const rowActionBtn =
  "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"

export function ExamManagement({
  examene,
  organizations,
  isSuperAdmin,
  defaultOrgId,
}: ExamManagementProps) {
  const router = useRouter()
  const credite = useDocumentAiCredite()
  const [searchTerm, setSearchTerm] = useState("")
  const [page, setPage] = useState(1)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [examName, setExamName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [createOrgId, setCreateOrgId] = useState<string | null>(defaultOrgId)
  const [createOrgWide, setCreateOrgWide] = useState(false)
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null)
  const [previewSkippedRows, setPreviewSkippedRows] = useState(0)
  const [toast, setToast] = useState<ToastState>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [previewInfo, setPreviewInfo] = useState<string | null>(null)
  const [editTargetExam, setEditTargetExam] = useState<AdminExamRow | null>(null)
  const [editExamName, setEditExamName] = useState("")
  const [editFile, setEditFile] = useState<File | null>(null)
  const [editUploadMode, setEditUploadMode] = useState<"excel" | "json" | "text">("excel")
  const [editJsonText, setEditJsonText] = useState("")
  const [editPlainText, setEditPlainText] = useState("")
  const [editShowFormatGuide, setEditShowFormatGuide] = useState(false)
  const [deleteTargetExam, setDeleteTargetExam] = useState<AdminExamRow | null>(null)
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("")
  const [questionEditorExam, setQuestionEditorExam] = useState<AdminExamRow | null>(null)
  const [settingsTargetExam, setSettingsTargetExam] = useState<AdminExamRow | null>(null)
  const [settingsDraft, setSettingsDraft] = useState({
    nume_examen: "",
    prag_trecere: 18,
    intrebari_simulare: 25,
    durata_minute: 30,
  })
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsOrgWide, setSettingsOrgWide] = useState(false)

  const [uploadMode, setUploadMode] = useState<"excel" | "json" | "text">("excel")
  const [jsonText, setJsonText] = useState("")
  const [plainText, setPlainText] = useState("")
  const [showFormatGuide, setShowFormatGuide] = useState(false)
  const [showJsonGuide, setShowJsonGuide] = useState(false)
  const [showTextGuide, setShowTextGuide] = useState(false)

  const [showDocumentAiModal, setShowDocumentAiModal] = useState(false)
  /** Setat când importul AI adaugă întrebări într-un examen existent; null = examen nou. */
  const [documentAiExam, setDocumentAiExam] = useState<AdminExamRow | null>(null)
  const [stareCredite, setStareCredite] = useState<StareCredite | null>(null)

  const [previewing, startPreviewTransition] = useTransition()
  const [creating, startCreateTransition] = useTransition()
  const [savingUpdate, startSavingUpdateTransition] = useTransition()
  const [deleting, startDeleteTransition] = useTransition()
  const [savingRules, startSavingRulesTransition] = useTransition()
  const [togglingOrgWide, startOrgWideTransition] = useTransition()
  const [collapsed, setCollapsed] = useState(true)

  const isBusy = previewing || creating || savingUpdate || deleting || savingRules

  /**
   * `is_org_wide` only applies to exams owned by an organisation. An org_admin
   * always creates inside their own org; a super_admin may pick "no org", and
   * in that case the control is not rendered at all.
   */
  const createBelongsToOrg = isSuperAdmin ? createOrgId !== null : true
  const settingsBelongsToOrg =
    settingsTargetExam !== null &&
    settingsTargetExam.org_id !== null &&
    !settingsTargetExam.is_public
  const canPreview =
    !isBusy &&
    (uploadMode === "excel"
      ? Boolean(file)
      : uploadMode === "json"
        ? Boolean(jsonText.trim())
        : Boolean(plainText.trim()))
  const canCreate =
    examName.trim().length > 0 &&
    previewSummary !== null &&
    !isBusy &&
    (isSuperAdmin ? Boolean(createOrgId) : true) &&
    (uploadMode === "excel"
      ? Boolean(file)
      : uploadMode === "json"
        ? Boolean(jsonText.trim())
        : Boolean(plainText.trim()))
  const canSaveUpdate =
    editExamName.trim().length > 0 &&
    !savingUpdate &&
    (
      editUploadMode === "excel" ? true :
      editUploadMode === "json" ? editJsonText.trim().length > 0 :
      editPlainText.trim().length > 0
    )
  const canDeleteForever =
    deleteTargetExam != null &&
    deleteConfirmationInput.trim() === deleteTargetExam.nume_examen &&
    !deleting

  const toastClasses = useMemo(() => {
    if (!toast) return ""
    return toast.type === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
  }, [toast])

  const pushToast = (nextToast: Exclude<ToastState, null>) => {
    setToast(nextToast)
    window.setTimeout(() => {
      setToast((current) => (current?.message === nextToast.message ? null : current))
    }, 4000)
  }

  // Decide dacă „Examen nou" pornește fluxul Document AI sau pe cel clasic.
  useEffect(() => {
    let activ = true
    void getStareCredite().then((rezultat) => {
      if (activ) setStareCredite(rezultat)
    })
    return () => {
      activ = false
    }
  }, [])

  // Creditele rămase se schimbă după fiecare import, deci se recitesc la închidere:
  // local, pentru decizia butonului „Examen nou", și în widget-ul de pe dashboard.
  const reincarcaCredite = () => {
    void getStareCredite().then(setStareCredite)
    credite.refresh()
  }

  const aiImportActiv = Boolean(stareCredite?.success && stareCredite.aiImportEnabled)

  const handleClickExamenNou = () => {
    if (aiImportActiv) {
      setDocumentAiExam(null)
      setShowDocumentAiModal(true)
      return
    }
    setShowCreateModal(true)
  }

  /** „Adaugă întrebări” pe un examen existent: aceeași rutare ca la examen nou. */
  const handleClickAdaugaIntrebari = (exam: AdminExamRow) => {
    if (isBusy) return
    if (aiImportActiv) {
      setDocumentAiExam(exam)
      setShowDocumentAiModal(true)
      return
    }
    handleOpenUpdateModal(exam)
  }

  const filteredExams = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase()
    if (!needle) return examene
    return examene.filter((exam) => {
      const haystack = `${exam.nume_examen} ${exam.org_nume ?? ""}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [examene, searchTerm])

  const pageCount = Math.max(1, Math.ceil(filteredExams.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedExams = filteredExams.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )

  const handleClosePopup = () => {
    setShowCreateModal(false)
    setExamName("")
    setFile(null)
    setJsonText("")
    setPlainText("")
    setPreviewRows([])
    setPreviewSummary(null)
    setPreviewSkippedRows(0)
    setShowFormatGuide(false)
    setShowJsonGuide(false)
    setShowTextGuide(false)
    setCreateError(null)
    setPreviewInfo(null)
    setCreateOrgWide(false)
  }

  const handlePreview = () => {
    if (!file) return
    startPreviewTransition(() => {
      void (async () => {
        try {
          const formData = new FormData()
          formData.set("file", file)
          const result = await previewExamImport(formData)
          setPreviewRows(result.rows)
          setPreviewSummary(result.summary)
          setPreviewSkippedRows(result.skippedRows)
          pushToast({
            type: "success",
            message: `Preview gata: ${result.summary.total} întrebări procesate.`,
          })
        } catch (error) {
          console.error("Preview exam failed:", error)
          setPreviewRows([])
          setPreviewSummary(null)
          setPreviewSkippedRows(0)
          pushToast({
            type: "error",
            message: error instanceof Error ? error.message : "Nu s-a putut genera preview-ul.",
          })
        }
      })()
    })
  }

  const handlePreviewJson = () => {
    if (!jsonText.trim()) return
    startPreviewTransition(() => {
      void (async () => {
        try {
          const formData = new FormData()
          formData.set("jsonContent", jsonText.trim())
          const result = await previewExamImportJson(formData)
          setPreviewRows(result.rows)
          setPreviewSummary(result.summary)
          setPreviewSkippedRows(result.skippedRows)
          setCreateError(null)
          setPreviewInfo(`Preview gata: ${result.summary.total} întrebări procesate.`)
        } catch (error) {
          setPreviewRows([])
          setPreviewSummary(null)
          setPreviewSkippedRows(0)
          setPreviewInfo(null)
          setCreateError(error instanceof Error ? error.message : "Nu s-a putut genera preview-ul.")
        }
      })()
    })
  }

  const applyCreateFlags = (formData: FormData) => {
    if (isSuperAdmin && createOrgId) formData.set("orgId", createOrgId)
    if (createBelongsToOrg && createOrgWide) formData.set("isOrgWide", "true")
  }

  const handleCreateExamJson = () => {
    if (!jsonText.trim() || !examName.trim()) return
    startCreateTransition(() => {
      void (async () => {
        try {
          const formData = new FormData()
          formData.set("jsonContent", jsonText.trim())
          formData.set("examName", examName.trim())
          applyCreateFlags(formData)
          const result = await importExamFromJson(formData)
          setCreateError(null)
          handleClosePopup()
          pushToast({
            type: "success",
            message: `Importate: ${result.inserted} · Sărite (duplicate): ${result.skipped}`,
          })
          router.refresh()
        } catch (error) {
          console.error("Create exam import failed:", error)
          setCreateError(error instanceof Error ? error.message : "Nu s-a putut crea examenul.")
        }
      })()
    })
  }

  const handlePreviewText = () => {
    if (!plainText.trim()) return
    const parsed = parsePlainTextToQuestions(plainText)
    if (!parsed.questions.length) {
      setPreviewInfo(null)
      setCreateError("Nu am găsit întrebări valide în text. Verifică formatul.")
      return
    }
    startPreviewTransition(() => {
      void (async () => {
        try {
          const formData = new FormData()
          formData.set("jsonContent", JSON.stringify(parsed))
          const result = await previewExamImportJson(formData)
          setPreviewRows(result.rows)
          setPreviewSummary(result.summary)
          setPreviewSkippedRows(result.skippedRows)
          setCreateError(null)
          setPreviewInfo(`Preview gata: ${result.summary.total} întrebări procesate.`)
        } catch (error) {
          setPreviewRows([])
          setPreviewSummary(null)
          setPreviewSkippedRows(0)
          setPreviewInfo(null)
          setCreateError(error instanceof Error ? error.message : "Nu s-a putut genera preview-ul.")
        }
      })()
    })
  }

  const handleCreateExamText = () => {
    if (!plainText.trim() || !examName.trim()) return
    const parsed = parsePlainTextToQuestions(plainText)
    if (!parsed.questions.length) {
      pushToast({
        type: "error",
        message: "Nu am găsit întrebări valide în text. Verifică formatul.",
      })
      return
    }
    startCreateTransition(() => {
      void (async () => {
        try {
          const formData = new FormData()
          formData.set("jsonContent", JSON.stringify(parsed))
          formData.set("examName", examName.trim())
          applyCreateFlags(formData)
          const result = await importExamFromJson(formData)
          setCreateError(null)
          handleClosePopup()
          pushToast({
            type: "success",
            message: `Importate: ${result.inserted} · Sărite (duplicate): ${result.skipped}`,
          })
          router.refresh()
        } catch (error) {
          console.error("Create exam import failed:", error)
          setCreateError(error instanceof Error ? error.message : "Nu s-a putut crea examenul.")
        }
      })()
    })
  }

  const handleCreateExam = () => {
    if (!file || !examName.trim()) return
    startCreateTransition(() => {
      void (async () => {
        try {
          const formData = new FormData()
          formData.set("file", file)
          formData.set("examName", examName.trim())
          applyCreateFlags(formData)
          const result = await importExamFromExcel(formData)
          setCreateError(null)
          handleClosePopup()
          pushToast({
            type: "success",
            message: `Importate: ${result.inserted} · Sărite (duplicate): ${result.skipped}`,
          })
          router.refresh()
        } catch (error) {
          console.error("Create exam import failed:", error)
          setCreateError(error instanceof Error ? error.message : "Nu s-a putut crea examenul.")
        }
      })()
    })
  }

  const handleOpenUpdateModal = (exam: AdminExamRow) => {
    if (isBusy) return
    setEditTargetExam(exam)
    setEditExamName(exam.nume_examen)
    setEditFile(null)
  }

  const handleOpenSettingsModal = (exam: AdminExamRow) => {
    if (isBusy) return
    setSettingsTargetExam(exam)
    setSettingsDraft({
      nume_examen: exam.nume_examen,
      prag_trecere: exam.prag_trecere,
      intrebari_simulare: exam.intrebari_simulare,
      durata_minute: exam.durata_minute,
    })
    setSettingsOrgWide(exam.is_org_wide)
    setSettingsError(null)
  }

  /** Saves on its own, independently of the rules form's "Salvează" button. */
  const handleToggleOrgWide = (exam: AdminExamRow, next: boolean) => {
    const previous = settingsOrgWide
    setSettingsOrgWide(next)
    startOrgWideTransition(() => {
      void (async () => {
        const result = await setExamOrgWide(exam.id, next)
        if (result.error) {
          setSettingsOrgWide(previous)
          pushToast({ type: "error", message: result.error })
          return
        }
        pushToast({
          type: "success",
          message: next
            ? "Examenul este acum disponibil tuturor membrilor organizației."
            : "Accesul extins a fost dezactivat.",
        })
        router.refresh()
      })()
    })
  }

  const handleSaveSettings = () => {
    if (!settingsTargetExam) return

    const trimmedName = settingsDraft.nume_examen.trim()
    if (!trimmedName) {
      setSettingsError("Numele examenului nu poate fi gol.")
      return
    }

    const questionCount = settingsTargetExam.question_count
    if (settingsDraft.intrebari_simulare < 1 || settingsDraft.prag_trecere < 1) {
      setSettingsError("Valorile trebuie să fie cel puțin 1.")
      return
    }
    if (settingsDraft.intrebari_simulare > questionCount) {
      setSettingsError(
        `Numărul de întrebări din simulare nu poate depăși numărul de întrebări din examen (${questionCount}).`,
      )
      return
    }
    if (settingsDraft.prag_trecere > settingsDraft.intrebari_simulare) {
      setSettingsError("Pragul de trecere nu poate depăși numărul de întrebări din simulare.")
      return
    }

    startSavingRulesTransition(() => {
      void (async () => {
        try {
          if (trimmedName !== settingsTargetExam.nume_examen) {
            const formData = new FormData()
            formData.set("examId", String(settingsTargetExam.id))
            formData.set("examName", trimmedName)
            await updateExam(formData)
          }

          await updateExamRules(settingsTargetExam.id, {
            prag_trecere: settingsDraft.prag_trecere,
            intrebari_simulare: settingsDraft.intrebari_simulare,
            durata_minute: settingsDraft.durata_minute,
          })

          pushToast({
            type: "success",
            message: "Setările examenului au fost actualizate.",
          })
          setSettingsTargetExam(null)
          router.refresh()
        } catch (error) {
          console.error("Update settings failed:", error)
          setSettingsError(
            error instanceof Error ? error.message : "Nu s-au putut salva setările.",
          )
        }
      })()
    })
  }

  const handleSaveUpdate = () => {
    if (!editTargetExam) return
    startSavingUpdateTransition(() => {
      void (async () => {
        try {
          const formData = new FormData()
          if (editUploadMode === "excel") {
            formData.set("examId", String(editTargetExam.id))
            formData.set("examName", editExamName.trim())
            if (editFile) {
              formData.set("file", editFile)
            }
            const result = await updateExam(formData)
            pushToast({
              type: "success",
              message:
                `Examen actualizat. +${result.insertedCount} întrebări noi, ` +
                `${result.duplicateCount} duplicate ignorate.` +
                (result.skippedRows > 0 ? ` ${result.skippedRows} rânduri invalide ignorate.` : ""),
            })
          } else if (editUploadMode === "json") {
            formData.set("jsonContent", editJsonText.trim())
            formData.set("examName", editExamName.trim())
            formData.set("existingExamenId", String(editTargetExam.id))
            const result = await importExamFromJson(formData)
            pushToast({
              type: "success",
              message: `Actualizat. +${result.inserted} întrebări noi, ${result.skipped} duplicate ignorate.`,
            })
          } else {
            const parsed = parsePlainTextToQuestions(editPlainText.trim())
            if (!parsed.questions.length) {
              pushToast({
                type: "error",
                message: "Nu am găsit întrebări valide în text. Verifică formatul.",
              })
              return
            }
            formData.set("jsonContent", JSON.stringify(parsed))
            formData.set("examName", editExamName.trim())
            formData.set("existingExamenId", String(editTargetExam.id))
            const result = await importExamFromJson(formData)
            pushToast({
              type: "success",
              message: `Actualizat. +${result.inserted} întrebări noi, ${result.skipped} duplicate ignorate.`,
            })
          }
          setEditTargetExam(null)
          setEditExamName("")
          setEditFile(null)
          setEditUploadMode("excel")
          setEditJsonText("")
          setEditPlainText("")
          setEditShowFormatGuide(false)
          router.refresh()
        } catch (error) {
          console.error("Update exam import failed:", error)
          pushToast({
            type: "error",
            message: error instanceof Error ? error.message : "Nu s-a putut actualiza examenul.",
          })
        }
      })()
    })
  }

  const handleDeleteExam = () => {
    if (!deleteTargetExam) return
    startDeleteTransition(() => {
      void (async () => {
        try {
          await deleteExam(deleteTargetExam.id)
          pushToast({
            type: "success",
            message: `Examenul "${deleteTargetExam.nume_examen}" a fost șters definitiv.`,
          })
          setDeleteTargetExam(null)
          setDeleteConfirmationInput("")
          router.refresh()
        } catch (error) {
          console.error("Delete exam failed:", error)
          pushToast({
            type: "error",
            message: error instanceof Error ? error.message : "Nu s-a putut șterge examenul.",
          })
        }
      })()
    })
  }

  const renderExamActions = (exam: AdminExamRow, iconSize: string) => (
    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setQuestionEditorExam(exam)}
        disabled={isBusy}
        className={rowActionBtn}
      >
        <ClipboardList className={iconSize} /> Întrebări
      </button>
      <button
        type="button"
        onClick={() => handleClickAdaugaIntrebari(exam)}
        disabled={isBusy}
        className={rowActionBtn}
        aria-label="Adaugă întrebări"
      >
        <Upload className={iconSize} /> Adaugă întrebări
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isBusy}
            className={rowActionBtn}
            aria-label="Mai multe acțiuni"
          >
            <MoreHorizontal className={iconSize} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleOpenSettingsModal(exam)}>
            <Settings2 />
            Setări examen
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setDeleteTargetExam(exam)
              setDeleteConfirmationInput("")
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 />
            Șterge
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <section
      id="examene"
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-4 dark:border-slate-800">
        <div
          className="flex-1 cursor-pointer select-none"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            Exam Management
            <ChevronDown
              className={`size-4 text-slate-400 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            />
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Gestionează examenele, întrebările și regulile de simulare.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleClickExamenNou}
          className="bg-blue-600 text-white hover:bg-blue-500"
        >
          <Plus className="mr-1 size-4" />
          Examen nou
        </Button>
      </div>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`mt-4 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm transition-all ${toastClasses}`}
        >
          {toast.message}
        </div>
      ) : null}

      {!collapsed && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value)
                  setPage(1)
                }}
                placeholder="Caută examen..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500"
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {filteredExams.length} {filteredExams.length === 1 ? "examen" : "examene"}
            </p>
          </div>

          {/* Desktop table — hidden on mobile */}
          <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200/70 dark:border-slate-800 sm:block">
            <table className="min-w-full divide-y divide-slate-200/70 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Examen</th>
                  {isSuperAdmin && <th className="px-4 py-3">Organizație</th>}
                  <th className="px-4 py-3">Întrebări</th>
                  <th className="px-4 py-3">Reguli simulare</th>
                  <th className="px-4 py-3 text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {pagedExams.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isSuperAdmin ? 5 : 4}
                      className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      Nu există examene care să corespundă filtrului.
                    </td>
                  </tr>
                ) : (
                  pagedExams.map((exam) => (
                    <tr
                      key={exam.id}
                      className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-950/60"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {exam.nume_examen}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">ID #{exam.id}</p>
                      </td>
                      {isSuperAdmin && (
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {exam.org_nume ?? "—"}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                          {exam.question_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                            {exam.intrebari_simulare} întrebări
                          </span>
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                            {exam.durata_minute} min
                          </span>
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                            prag {exam.prag_trecere}
                          </span>
                          {exam.is_org_wide ? (
                            <Badge variant="secondary">Acces org</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {renderExamActions(exam, "size-3.5")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list — shown only on mobile */}
          <div className="mt-4 flex flex-col divide-y divide-slate-200/70 overflow-hidden rounded-xl border border-slate-200/70 dark:divide-slate-800 dark:border-slate-800 sm:hidden">
            {pagedExams.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Nu există examene.
              </p>
            ) : (
              pagedExams.map((exam) => (
                <div key={exam.id} className="flex flex-col gap-2 bg-white px-4 py-3 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium leading-tight text-slate-900 dark:text-white">
                        {exam.nume_examen}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        ID #{exam.id}
                        {isSuperAdmin && exam.org_nume ? ` · ${exam.org_nume}` : ""}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                      {exam.question_count}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                      {exam.intrebari_simulare} întrebări
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                      {exam.durata_minute} min
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                      prag {exam.prag_trecere}
                    </span>
                    {exam.is_org_wide ? <Badge variant="secondary">Acces org</Badge> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {renderExamActions(exam, "size-3")}
                  </div>
                </div>
              ))
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <p>
                Pagina {safePage} din {pageCount}
              </p>
              <div className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={safePage <= 1}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                  disabled={safePage >= pageCount}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

        </>
      )}

      <DocumentAiImportModal
        open={showDocumentAiModal}
        stareCredite={stareCredite}
        examenExistent={
          documentAiExam
            ? { id: documentAiExam.id, nume: documentAiExam.nume_examen }
            : undefined
        }
        onClose={() => {
          setShowDocumentAiModal(false)
          setDocumentAiExam(null)
          reincarcaCredite()
        }}
        onImportManual={() => {
          setShowDocumentAiModal(false)
          // Fluxul clasic are două forme: adăugare într-un examen existent sau creare.
          if (documentAiExam) handleOpenUpdateModal(documentAiExam)
          else setShowCreateModal(true)
          setDocumentAiExam(null)
        }}
        onFinalizat={(mesaj) => {
          setShowDocumentAiModal(false)
          setDocumentAiExam(null)
          reincarcaCredite()
          pushToast({ type: "success", message: mesaj })
          router.refresh()
        }}
        onAnulat={(mesaj) => {
          setShowDocumentAiModal(false)
          setDocumentAiExam(null)
          reincarcaCredite()
          pushToast({ type: "success", message: mesaj })
        }}
        onCrediteSchimbate={reincarcaCredite}
      />

      {showCreateModal ? (
        <ModalPortal>
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Închide popup"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClosePopup}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Creare examen nou
                </h3>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {uploadMode === "excel"
                      ? "Încarcă un fișier Excel (.xlsx) cu întrebări și răspunsuri."
                      : uploadMode === "json"
                        ? "Lipește sau încarcă un fișier JSON cu întrebările examenului."
                        : "Lipește întrebările ca text simplu, numerotate, cu variante a), b), c)..."}
                  </p>
                  {(uploadMode === "excel" || uploadMode === "json" || uploadMode === "text") && (
                    <button
                      type="button"
                      onClick={() => {
                        if (uploadMode === "excel") setShowFormatGuide((prev) => !prev)
                        else if (uploadMode === "json") setShowJsonGuide((prev) => !prev)
                        else setShowTextGuide((prev) => !prev)
                      }}
                      className="flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-slate-400 transition hover:border-blue-400 hover:text-blue-500 dark:border-slate-600 dark:hover:border-blue-500"
                      aria-label="Format fișier"
                    >
                      ?
                    </button>
                  )}
                </div>

                {uploadMode === "excel" && showFormatGuide && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-500/10 dark:text-blue-300">
                    <p className="font-semibold mb-1">Structura fișierului Excel:</p>
                    <ul className="space-y-1 list-none">
                      <li>• <strong>Coloana A</strong> — textul întrebării</li>
                      <li>• <strong>Coloanele B, C, D...</strong> — variantele de răspuns</li>
                      <li>• <strong>Răspunsuri corecte</strong> — celulele corecte trebuie evidențiate cu fundal <strong>galben</strong></li>
                      <li>• Un rând = o întrebare. Rândurile fără text în col. A sunt ignorate.</li>
                      <li>• Suportă 2–10 variante per întrebare.</li>
                    </ul>
                    <a
                      href="/docs#import-excel"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Află mai mult →
                    </a>
                  </div>
                )}

                {uploadMode === "json" && showJsonGuide && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-500/10 dark:text-blue-300">
                    <p className="font-semibold mb-2">Format JSON:</p>
                    <pre className="rounded bg-white/60 p-2 font-mono text-[10px] leading-relaxed dark:bg-black/20 overflow-x-auto">{`{
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
                      <li>• <strong>correct</strong> — indecși 1-bazați ai răspunsurilor corecte (ex: [1] pentru primul)</li>
                      <li>• Suportă răspunsuri multiple: <code className="rounded bg-white/60 px-1 dark:bg-black/20">"correct": [1, 3]</code></li>
                    </ul>
                    <a
                      href="/docs#import-json"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Află mai mult →
                    </a>
                  </div>
                )}

                {uploadMode === "text" && showTextGuide && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-500/10 dark:text-blue-300">
                    <p className="font-semibold mb-1">Format text simplu:</p>
                    <ul className="space-y-1">
                      <li>• Fiecare întrebare începe cu număr: <code className="rounded bg-white/60 px-1 dark:bg-black/20">1.</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">1)</code></li>
                      <li>• Variantele cu <code className="rounded bg-white/60 px-1 dark:bg-black/20">a)</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">a.</code></li>
                      <li>• Marchează corect cu <code className="rounded bg-white/60 px-1 dark:bg-black/20">*</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">✓</code> la finalul variantei</li>
                    </ul>
                    <a href="/docs#import-text" target="_blank" rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                      Află mai mult →
                    </a>
                  </div>
                )}
              </div>
              <FilePlus2 className="size-5 text-blue-500" />
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Nume examen
                <input
                  value={examName}
                  onChange={(event) => setExamName(event.target.value)}
                  placeholder="Ex: Autorizare electrician..."
                  disabled={isBusy}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
              </label>

              {isSuperAdmin && (
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Organizație
                  <select
                    value={createOrgId ?? ""}
                    onChange={(event) => setCreateOrgId(event.target.value || null)}
                    disabled={isBusy}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">— Fără organizație —</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.nume}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {createBelongsToOrg && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-3">
                    <label
                      htmlFor="create-org-wide"
                      className="text-sm font-medium text-slate-800 dark:text-slate-100"
                    >
                      Acces pentru toți membrii organizației
                    </label>
                    <Switch
                      id="create-org-wide"
                      checked={createOrgWide}
                      onCheckedChange={setCreateOrgWide}
                      disabled={isBusy}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    Toți membrii organizației vor putea da acest examen, fără alocare
                    individuală.
                  </p>
                </div>
              )}

              <div>
                <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => {
                      setUploadMode("excel")
                      setPreviewRows([])
                      setPreviewSummary(null)
                      setPreviewSkippedRows(0)
                      setShowFormatGuide(false)
                      setShowJsonGuide(false)
                      setShowTextGuide(false)
                    }}
                    disabled={isBusy}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      uploadMode === "excel"
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadMode("json")
                      setPreviewRows([])
                      setPreviewSummary(null)
                      setPreviewSkippedRows(0)
                      setShowFormatGuide(false)
                      setShowJsonGuide(false)
                      setShowTextGuide(false)
                    }}
                    disabled={isBusy}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      uploadMode === "json"
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    <FileJson className="size-3.5" />
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadMode("text")
                      setPreviewRows([])
                      setPreviewSummary(null)
                      setPreviewSkippedRows(0)
                      setShowFormatGuide(false)
                      setShowJsonGuide(false)
                      setShowTextGuide(false)
                    }}
                    disabled={isBusy}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      uploadMode === "text"
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    <AlignLeft className="size-3.5" />
                    Text
                  </button>
                </div>

                {uploadMode === "excel" ? (
                  <label className="mt-3 block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Fișier Excel (.xlsx)
                    <input
                      key={file?.name ?? "empty"}
                      type="file"
                      accept=".xlsx"
                      onChange={(event) => {
                        const next = event.target.files?.[0] ?? null
                        setFile(next)
                        setPreviewRows([])
                        setPreviewSummary(null)
                        setPreviewSkippedRows(0)
                      }}
                      disabled={isBusy}
                      className="mt-1 w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                    />
                  </label>
                ) : uploadMode === "json" ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Conținut JSON
                      </span>
                      <label className="cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400">
                        Încarcă fișier .json
                        <input
                          type="file"
                          accept=".json"
                          className="sr-only"
                          disabled={isBusy}
                          onChange={(event) => {
                            const f = event.target.files?.[0]
                            if (!f) return
                            f.text().then((text) => {
                              setJsonText(text)
                              setPreviewRows([])
                              setPreviewSummary(null)
                              setPreviewSkippedRows(0)
                            }).catch(() => {})
                            event.target.value = ""
                          }}
                        />
                      </label>
                    </div>
                    <textarea
                      value={jsonText}
                      onChange={(event) => {
                        setJsonText(event.target.value)
                        setPreviewRows([])
                        setPreviewSummary(null)
                        setPreviewSkippedRows(0)
                      }}
                      disabled={isBusy}
                      rows={6}
                      placeholder={`{\n  "questions": [\n    {\n      "question": "Textul întrebării",\n      "answers": ["Variantă A", "Variantă B", "Variantă C"],\n      "correct": [2]\n    }\n  ]\n}`}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-medium">Format:</span> fiecare întrebare are{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">question</code>,{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">answers</code>{" "}
                      (2–10 variante) și{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">correct</code>{" "}
                      (indecși 1-bazați ai răspunsurilor corecte).
                    </p>
                  </div>
                ) : uploadMode === "text" ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Text întrebări
                      </span>
                    </div>
                    <textarea
                      value={plainText}
                      onChange={(event) => {
                        setPlainText(event.target.value)
                        setPreviewRows([])
                        setPreviewSummary(null)
                        setPreviewSkippedRows(0)
                      }}
                      disabled={isBusy}
                      rows={8}
                      placeholder={`1. Care este tensiunea nominală?
a) 220V *
b) 110V
c) 380V

2. Curentul alternativ are frecvența de:
a) 50 Hz *
b) 60 Hz
c) 100 Hz`}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600"
                    />
                  </div>
                ) : null}
              </div>

              {previewSummary ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Total: {previewSummary.total} · Noi: {previewSummary.new} · Duplicate în DB:{" "}
                    {previewSummary.duplicate_in_db} · Duplicate în fișier:{" "}
                    {previewSummary.duplicate_in_batch}
                  </p>
                  {previewSkippedRows > 0 ? (
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Rânduri invalide ignorate la parsare: {previewSkippedRows}
                    </p>
                  ) : null}
                  <div className="mt-3 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                        <tr>
                          <th className="px-2 py-2">#</th>
                          <th className="px-2 py-2">Întrebare</th>
                          <th className="px-2 py-2">Variante</th>
                          <th className="px-2 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {previewRows.map((row) => {
                          const isDuplicate = row.duplicate_in_db || row.duplicate_in_batch
                          return (
                            <tr
                              key={`${row.idx}-${row.intrebare_text}`}
                              className={isDuplicate ? "opacity-60" : undefined}
                            >
                              <td className="px-2 py-2 align-top text-slate-500 dark:text-slate-400">
                                {row.idx + 1}
                              </td>
                              <td className="px-2 py-2 align-top text-slate-800 dark:text-slate-100">
                                {row.intrebare_text}
                              </td>
                              <td className="px-2 py-2 align-top text-slate-600 dark:text-slate-300">
                                {row.variante.join(" | ")}
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="flex flex-wrap gap-1">
                                  {row.duplicate_in_db ? (
                                    <Badge variant="secondary">Duplicat în DB</Badge>
                                  ) : null}
                                  {row.duplicate_in_batch ? (
                                    <Badge variant="outline">Duplicat în fișier</Badge>
                                  ) : null}
                                  {!isDuplicate ? (
                                    <Badge variant="default">Nou</Badge>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>

            {previewInfo ? (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-400">
                {previewInfo}
              </div>
            ) : null}

            {createError ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
                {createError}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClosePopup}
                disabled={isBusy}
              >
                Anulează
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={
                  uploadMode === "excel"
                    ? handlePreview
                    : uploadMode === "json"
                      ? handlePreviewJson
                      : handlePreviewText
                }
                disabled={!canPreview}
              >
                {previewing ? "Preview..." : "Preview"}
              </Button>
              <Button
                type="button"
                onClick={
                  uploadMode === "excel"
                    ? handleCreateExam
                    : uploadMode === "json"
                      ? handleCreateExamJson
                      : handleCreateExamText
                }
                disabled={!canCreate}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                {creating ? "Import în curs..." : "Importă examen"}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {deleteTargetExam ? (
        <ModalPortal>
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!deleting) {
                setDeleteTargetExam(null)
                setDeleteConfirmationInput("")
              }
            }}
            aria-label="Închide confirmarea"
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-rose-500/40 bg-white p-5 shadow-2xl dark:bg-slate-950">
            <h4 className="text-lg font-semibold text-rose-600 dark:text-rose-300">
              Confirmă ștergerea examenului
            </h4>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
              Această acțiune va șterge definitiv examenul, întrebările asociate și progresul
              utilizatorilor legat de acesta.
            </p>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Pentru confirmare, tastați exact numele examenului:{" "}
              <span className="font-semibold text-slate-900 dark:text-white">
                {deleteTargetExam.nume_examen}
              </span>
            </p>
            <input
              value={deleteConfirmationInput}
              onChange={(event) => setDeleteConfirmationInput(event.target.value)}
              placeholder="Numele examenului"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              disabled={deleting}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDeleteTargetExam(null)
                  setDeleteConfirmationInput("")
                }}
                disabled={deleting}
              >
                Anulează
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteExam}
                disabled={!canDeleteForever}
              >
                {deleting ? "Se șterge..." : "Șterge definitiv"}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {editTargetExam ? (
        <ModalPortal>
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Închide adăugarea întrebărilor"
            onClick={() => {
              if (!savingUpdate) {
                setEditTargetExam(null)
                setEditExamName("")
                setEditFile(null)
                setEditUploadMode("excel")
                setEditJsonText("")
                setEditPlainText("")
                setEditShowFormatGuide(false)
              }
            }}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950 max-h-[90vh] overflow-y-auto">
            <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
              Adaugă întrebări
            </h4>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Poți modifica numele examenului și/sau adăuga întrebări noi.
            </p>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Nume examen
            </label>
            <input
              value={editExamName}
              onChange={(event) => setEditExamName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              disabled={savingUpdate}
            />

            {/* Tab switcher */}
            <div className="mt-4 bg-slate-100 rounded-lg p-1 flex gap-1">
              <button
                type="button"
                onClick={() => { setEditUploadMode("excel"); setEditShowFormatGuide(false) }}
                disabled={savingUpdate}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  editUploadMode === "excel"
                    ? "bg-white border border-slate-200 shadow-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <FileSpreadsheet className="size-3.5" />
                Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={() => { setEditUploadMode("json"); setEditShowFormatGuide(false) }}
                disabled={savingUpdate}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  editUploadMode === "json"
                    ? "bg-white border border-slate-200 shadow-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <FileJson className="size-3.5" />
                JSON
              </button>
              <button
                type="button"
                onClick={() => { setEditUploadMode("text"); setEditShowFormatGuide(false) }}
                disabled={savingUpdate}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  editUploadMode === "text"
                    ? "bg-white border border-slate-200 shadow-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <AlignLeft className="size-3.5" />
                Text
              </button>
            </div>

            {/* Tab content */}
            {editUploadMode === "excel" ? (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Fișier Excel (.xlsx) – Opțional
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditShowFormatGuide((prev) => !prev)}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-slate-400 transition hover:border-blue-400 hover:text-blue-500 dark:border-slate-600 dark:hover:border-blue-500"
                    aria-label="Format fișier"
                  >
                    ?
                  </button>
                </div>
                {editShowFormatGuide && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-500/10 dark:text-blue-300">
                    <p className="font-semibold mb-1">Structura fișierului Excel:</p>
                    <ul className="space-y-1 list-none">
                      <li>• <strong>Coloana A</strong> — textul întrebării</li>
                      <li>• <strong>Coloanele B, C, D...</strong> — variantele de răspuns</li>
                      <li>• <strong>Răspunsuri corecte</strong> — celulele corecte trebuie evidențiate cu fundal <strong>galben</strong></li>
                      <li>• Un rând = o întrebare. Rândurile fără text în col. A sunt ignorate.</li>
                      <li>• Suportă 2–10 variante per întrebare.</li>
                    </ul>
                    <a
                      href="/docs#import-excel"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Află mai mult →
                    </a>
                  </div>
                )}
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => setEditFile(event.target.files?.[0] ?? null)}
                  className="mt-2 w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  disabled={savingUpdate}
                />
              </div>
            ) : editUploadMode === "json" ? (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Conținut JSON
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditShowFormatGuide((prev) => !prev)}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-slate-400 transition hover:border-blue-400 hover:text-blue-500 dark:border-slate-600 dark:hover:border-blue-500"
                    aria-label="Format JSON"
                  >
                    ?
                  </button>
                </div>
                {editShowFormatGuide && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-500/10 dark:text-blue-300">
                    <p className="font-semibold mb-2">Format JSON:</p>
                    <pre className="rounded bg-white/60 p-2 font-mono text-[10px] leading-relaxed dark:bg-black/20 overflow-x-auto">{`{
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
                      <li>• <strong>correct</strong> — indecși 1-bazați ai răspunsurilor corecte (ex: [1] pentru primul)</li>
                      <li>• Suportă răspunsuri multiple: <code className="rounded bg-white/60 px-1 dark:bg-black/20">&quot;correct&quot;: [1, 3]</code></li>
                    </ul>
                    <a
                      href="/docs#import-json"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Află mai mult →
                    </a>
                  </div>
                )}
                <textarea
                  value={editJsonText}
                  onChange={(event) => setEditJsonText(event.target.value)}
                  disabled={savingUpdate}
                  rows={8}
                  placeholder="Lipește conținutul JSON aici..."
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600"
                />
              </div>
            ) : (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Text Simplu
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditShowFormatGuide((prev) => !prev)}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-slate-400 transition hover:border-blue-400 hover:text-blue-500 dark:border-slate-600 dark:hover:border-blue-500"
                    aria-label="Format text"
                  >
                    ?
                  </button>
                </div>
                {editShowFormatGuide && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-500/10 dark:text-blue-300">
                    <p className="font-semibold mb-1">Format text simplu:</p>
                    <ul className="space-y-1">
                      <li>• Fiecare întrebare începe cu număr: <code className="rounded bg-white/60 px-1 dark:bg-black/20">1.</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">1)</code></li>
                      <li>• Variantele cu <code className="rounded bg-white/60 px-1 dark:bg-black/20">a)</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">a.</code></li>
                      <li>• Marchează corect cu <code className="rounded bg-white/60 px-1 dark:bg-black/20">*</code> sau <code className="rounded bg-white/60 px-1 dark:bg-black/20">✓</code> la finalul variantei</li>
                    </ul>
                    <a
                      href="/docs#import-text"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Află mai mult →
                    </a>
                  </div>
                )}
                <textarea
                  value={editPlainText}
                  onChange={(event) => setEditPlainText(event.target.value)}
                  disabled={savingUpdate}
                  rows={8}
                  placeholder="Lipește textul cu întrebările aici..."
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600"
                />
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditTargetExam(null)
                  setEditExamName("")
                  setEditFile(null)
                  setEditUploadMode("excel")
                  setEditJsonText("")
                  setEditPlainText("")
                  setEditShowFormatGuide(false)
                }}
                disabled={savingUpdate}
              >
                Anulează
              </Button>
              <Button type="button" onClick={handleSaveUpdate} disabled={!canSaveUpdate}>
                {savingUpdate ? "Se salvează..." : "Salvează modificările"}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {settingsTargetExam ? (
        <ModalPortal>
        <div className="fixed inset-0 z-[96] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Închide setările examenului"
            onClick={() => {
              if (!savingRules) setSettingsTargetExam(null)
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Setări examen
                </h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  ID #{settingsTargetExam.id} · {settingsTargetExam.question_count} întrebări
                </p>
              </div>
              <Settings2 className="size-5 text-blue-500" />
            </div>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Nume examen
              <input
                value={settingsDraft.nume_examen}
                onChange={(event) =>
                  setSettingsDraft((prev) => ({ ...prev, nume_examen: event.target.value }))
                }
                autoFocus
                disabled={savingRules}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Întrebări simulare
                <input
                  type="number"
                  min={1}
                  value={settingsDraft.intrebari_simulare}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      intrebari_simulare: Number(event.target.value),
                    }))
                  }
                  disabled={savingRules}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Durata (minute)
                <input
                  type="number"
                  min={1}
                  value={settingsDraft.durata_minute}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      durata_minute: Number(event.target.value),
                    }))
                  }
                  disabled={savingRules}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="col-span-2 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Prag trecere
                <input
                  type="number"
                  min={1}
                  value={settingsDraft.prag_trecere}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      prag_trecere: Number(event.target.value),
                    }))
                  }
                  disabled={savingRules}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>
            {/* variante_raspuns: deprecat la nivel de UI — coloana rămâne în DB dar nu mai e editabilă. */}

            {settingsBelongsToOrg ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <label
                    htmlFor="settings-org-wide"
                    className="text-sm font-medium text-slate-800 dark:text-slate-100"
                  >
                    Acces pentru toți membrii organizației
                  </label>
                  <Switch
                    id="settings-org-wide"
                    checked={settingsOrgWide}
                    onCheckedChange={(next) =>
                      handleToggleOrgWide(settingsTargetExam, next)
                    }
                    disabled={togglingOrgWide || savingRules}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Toți membrii organizației vor putea da acest examen, fără alocare
                  individuală.
                </p>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Alocările individuale rămân salvate și redevin active dacă dezactivezi
                  această opțiune.
                </p>
              </div>
            ) : null}

            {settingsError ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
                {settingsError}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSettingsTargetExam(null)}
                disabled={savingRules}
              >
                Anulează
              </Button>
              <Button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingRules}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                {savingRules ? "Se salvează..." : "Salvează"}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {questionEditorExam ? (
        <QuestionEditorModal
          examId={questionEditorExam.id}
          examName={questionEditorExam.nume_examen}
          onClose={() => setQuestionEditorExam(null)}
          onRefresh={() => router.refresh()}
        />
      ) : null}
    </section>
  )
}
