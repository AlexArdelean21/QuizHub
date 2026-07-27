"use client"

import { useEffect, useMemo, useState, useTransition, type ChangeEvent } from "react"
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import {
  deletePersonalQuestion,
  getPersonalExamQuestions,
  updatePersonalQuestion,
  type PersonalQuestionRow,
} from "@/app/my-exams/actions"
import { Button } from "@/components/ui/button"
import { ModalPortal } from "@/components/ui/modal-portal"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import {
  MAX_QUIZ_VARIANTS,
  MIN_QUIZ_VARIANTS,
  OPTION_IDS,
  OPTION_LABELS,
} from "@/lib/quiz/types"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

type PersonalQuestionEditorModalProps = {
  examId: number
  examName: string
  onClose: () => void
  onRefresh: () => void
}

type QuestionDraft = {
  intrebare_text: string
  variante: string[]
  raspunsuri_corecte: string[]
  image_url: string | null
}

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ș/g, "s")
    .replace(/ț/g, "t")

function toDraft(question: PersonalQuestionRow): QuestionDraft {
  return {
    intrebare_text: question.intrebare_text,
    variante: [...question.variante],
    raspunsuri_corecte: [...question.raspunsuri_corecte],
    image_url: question.image_url ?? null,
  }
}

function trimDraftCorrects(draft: QuestionDraft): QuestionDraft {
  const allowed = new Set<string>(OPTION_IDS.slice(0, draft.variante.length))
  return {
    ...draft,
    raspunsuri_corecte: draft.raspunsuri_corecte.filter((id) => allowed.has(id)),
  }
}

export function PersonalQuestionEditorModal({
  examId,
  examName,
  onClose,
  onRefresh,
}: PersonalQuestionEditorModalProps) {
  const [questions, setQuestions] = useState<PersonalQuestionRow[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<QuestionDraft | null>(null)
  const [loading, startLoadingTransition] = useTransition()
  const [saving, startSavingTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)

  useEffect(() => {
    startLoadingTransition(() => {
      void (async () => {
        try {
          setError(null)
          const data = await getPersonalExamQuestions(examId)
          setQuestions(data)
        } catch (fetchError) {
          setError(fetchError instanceof Error ? fetchError.message : "Nu s-au putut încărca întrebările.")
        }
      })()
    })
  }, [examId])

  const filteredQuestions = useMemo(() => {
    const needle = normalizeText(searchTerm.trim())
    if (!needle) return questions

    return questions.filter((question) => {
      const haystack = normalizeText(
        `${question.intrebare_text} ${question.variante.join(" ")}`
      )
      return haystack.includes(needle)
    })
  }, [questions, searchTerm])

  const closeEditor = () => {
    if (saving || deletingId !== null) return
    onClose()
  }

  const openEditMode = (question: PersonalQuestionRow) => {
    setEditingId(question.id)
    setDraft(toDraft(question))
    setImageFile(null)
    setImagePreview(question.image_url ?? null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(null)
    setImageFile(null)
    setImagePreview(null)
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Tip de fișier neacceptat. Folosește JPEG, PNG, WebP sau GIF.")
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Imaginea depășește limita de 5MB.")
      return
    }
    setError(null)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const updateVariantText = (index: number, value: string) => {
    setDraft((current) => {
      if (!current) return current
      const variante = [...current.variante]
      variante[index] = value
      return { ...current, variante }
    })
  }

  const addVariant = () => {
    setDraft((current) => {
      if (!current) return current
      if (current.variante.length >= MAX_QUIZ_VARIANTS) return current
      return { ...current, variante: [...current.variante, ""] }
    })
  }

  const removeVariant = (index: number) => {
    setDraft((current) => {
      if (!current) return current
      if (current.variante.length <= MIN_QUIZ_VARIANTS) return current
      const variante = current.variante.filter((_, i) => i !== index)
      const removedId = OPTION_IDS[index]
      const optionIds = OPTION_IDS as readonly string[]
      const remappedCorrects = current.raspunsuri_corecte
        .filter((id) => id !== removedId)
        .map<string>((id) => {
          const oldIdx = optionIds.indexOf(id)
          if (oldIdx > index) return optionIds[oldIdx - 1]
          return id
        })
      return trimDraftCorrects({
        ...current,
        variante,
        raspunsuri_corecte: remappedCorrects,
      })
    })
  }

  const toggleCorrectAnswer = (id: string) => {
    setDraft((current) => {
      if (!current) return current
      const isCurrentlyMarked = current.raspunsuri_corecte.includes(id)
      const next = isCurrentlyMarked
        ? current.raspunsuri_corecte.filter((value) => value !== id)
        : [...current.raspunsuri_corecte, id]
      next.sort()
      return { ...current, raspunsuri_corecte: next }
    })
  }

  const handleSave = (questionId: number) => {
    if (!draft) return
    const cleaned = trimDraftCorrects(draft)
    const trimmedVariants = cleaned.variante.map((value) => value.trim())

    if (trimmedVariants.some((value) => value.length === 0)) {
      setError("Toate variantele afișate trebuie să aibă text. Șterge cele goale înainte de salvare.")
      return
    }
    if (trimmedVariants.length < MIN_QUIZ_VARIANTS) {
      setError(`Sunt necesare cel puțin ${MIN_QUIZ_VARIANTS} variante.`)
      return
    }
    if (cleaned.raspunsuri_corecte.length === 0) {
      setError("Bifează cel puțin un răspuns corect.")
      return
    }

    startSavingTransition(() => {
      void (async () => {
        try {
          setError(null)

          let imageUrlToSave: string | null = imagePreview
          if (imageFile) {
            setImageUploading(true)
            const supabase = getSupabaseBrowserClient()
            const ext = imageFile.name.split(".").pop() ?? "jpg"
            const path = `${examId}/${questionId}/${Date.now()}.${ext}`
            const { error: uploadError } = await supabase.storage
              .from("question-images")
              .upload(path, imageFile, { upsert: true })
            if (uploadError) {
              setImageUploading(false)
              setError(`Nu s-a putut încărca imaginea: ${uploadError.message}`)
              return
            }
            const { data: urlData } = supabase.storage
              .from("question-images")
              .getPublicUrl(path)
            imageUrlToSave = urlData.publicUrl
            setImageUploading(false)
          }

          await updatePersonalQuestion(questionId, {
            intrebare_text: cleaned.intrebare_text,
            variante: trimmedVariants,
            raspunsuri_corecte: cleaned.raspunsuri_corecte,
            image_url: imageUrlToSave,
          })

          setQuestions((current) =>
            current.map((question) =>
              question.id === questionId
                ? {
                    ...question,
                    intrebare_text: cleaned.intrebare_text,
                    variante: trimmedVariants,
                    raspunsuri_corecte: [...cleaned.raspunsuri_corecte],
                    image_url: imageUrlToSave,
                  }
                : question
            )
          )
          cancelEdit()
          onRefresh()
        } catch (saveError) {
          setImageUploading(false)
          setError(saveError instanceof Error ? saveError.message : "Nu s-a putut salva întrebarea.")
        }
      })()
    })
  }

  const handleDelete = (questionId: number) => {
    const confirmed = window.confirm("Sigur vrei să ștergi această întrebare?")
    if (!confirmed) return

    setDeletingId(questionId)
    void (async () => {
      try {
        setError(null)
        await deletePersonalQuestion(questionId)
        setQuestions((current) => current.filter((question) => question.id !== questionId))
        if (editingId === questionId) {
          cancelEdit()
        }
        onRefresh()
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Nu s-a putut șterge întrebarea.")
      } finally {
        setDeletingId(null)
      }
    })()
  }

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[98] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Închide editorul de întrebări"
        onClick={closeEditor}
      />

      <div className="relative z-10 flex max-h-[88vh] h-auto w-full max-w-6xl flex-col rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h4 className="text-lg font-semibold text-foreground">Editor întrebări</h4>
            <p className="text-sm text-muted-foreground">
              Examen: <span className="font-medium text-foreground">{examName}</span>
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={closeEditor} disabled={saving}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="border-b border-border px-5 py-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Caută după textul întrebării..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/70"
          />
        </div>

        {error ? (
          <div className="mx-5 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-5 no-scrollbar">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Se încarcă întrebările...
            </div>
          ) : filteredQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nu există întrebări pentru filtrul curent.</p>
          ) : (
            <div className="space-y-3">
              {filteredQuestions.map((question, index) => {
                const isEditing = editingId === question.id && draft != null
                const isDeleting = deletingId === question.id
                const correctSet = new Set(question.raspunsuri_corecte)
                return (
                  <div
                    key={question.id}
                    className="rounded-lg border border-border bg-background/50 p-4 transition-colors hover:bg-background"
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Întrebarea #{index + 1} (ID: {question.id})
                        {question.raspunsuri_corecte.length > 1 ? (
                          <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            Multi-răspuns
                          </span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-2">
                        {!isEditing ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => openEditMode(question)}
                            disabled={saving || isDeleting}
                          >
                            <Pencil className="mr-1 size-3.5" />
                            Edit
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleSave(question.id)}
                              disabled={saving || isDeleting || imageUploading}
                            >
                              <Save className="mr-1 size-3.5" />
                              {imageUploading ? "Încărcare..." : saving ? "Salvare..." : "Save"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={saving || isDeleting || imageUploading}
                            >
                              <X className="mr-1 size-3.5" />
                              Anulează
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(question.id)}
                          disabled={saving || isDeleting}
                        >
                          <Trash2 className="mr-1 size-3.5" />
                          {isDeleting ? "Ștergere..." : "Delete"}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-xs font-medium text-muted-foreground md:col-span-2">
                        Întrebare
                        {isEditing && draft ? (
                          <textarea
                            value={draft.intrebare_text}
                            onChange={(event) =>
                              setDraft((current) =>
                                current ? { ...current, intrebare_text: event.target.value } : current
                              )
                            }
                            rows={2}
                            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                          />
                        ) : (
                          <p className="mt-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                            {question.intrebare_text}
                          </p>
                        )}
                      </label>

                      {isEditing && draft ? (
                        <div className="mt-1 space-y-2 md:col-span-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            Imagine (opțional)
                          </label>

                          {imagePreview && (
                            <div className="relative w-full overflow-hidden rounded-xl border border-border/60 bg-muted/30">
                              <img
                                src={imagePreview}
                                alt="Preview imagine"
                                className="max-h-48 w-full object-contain"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setImageFile(null)
                                  setImagePreview(null)
                                }}
                                className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                                aria-label="Șterge imagine"
                              >
                                <svg
                                  className="size-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          )}

                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            onChange={handleImageChange}
                            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                          />
                          <p className="text-xs text-muted-foreground">
                            Max 5MB · JPEG, PNG, WebP · Click pe imagine pentru a o schimba
                          </p>
                        </div>
                      ) : question.image_url ? (
                        <div className="md:col-span-2">
                          <img
                            src={question.image_url}
                            alt="Imagine atașată întrebării"
                            loading="lazy"
                            className="max-h-40 w-full rounded-lg border border-border/60 bg-muted/30 object-contain"
                          />
                        </div>
                      ) : null}

                      {isEditing && draft ? (
                        <div className="md:col-span-2">
                          <p className="mb-2 text-xs font-medium text-muted-foreground">
                            Variante (bifează căsuța din dreapta pentru fiecare răspuns corect)
                          </p>
                          <div className="flex flex-col gap-2">
                            {draft.variante.map((variantText, variantIndex) => {
                              const optionId = OPTION_IDS[variantIndex]
                              const isCorrect = draft.raspunsuri_corecte.includes(optionId)
                              return (
                                <div
                                  key={`variant-${variantIndex}`}
                                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                                >
                                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-foreground">
                                    {OPTION_LABELS[variantIndex]}
                                  </span>
                                  <input
                                    value={variantText}
                                    onChange={(event) => updateVariantText(variantIndex, event.target.value)}
                                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                  />
                                  <label className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={isCorrect}
                                      onChange={() => toggleCorrectAnswer(optionId)}
                                      className="size-4 accent-primary"
                                      aria-label={`Marchează ${OPTION_LABELS[variantIndex]} ca răspuns corect`}
                                    />
                                    Corect
                                  </label>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => removeVariant(variantIndex)}
                                    disabled={draft.variante.length <= MIN_QUIZ_VARIANTS}
                                    aria-label={`Șterge varianta ${OPTION_LABELS[variantIndex]}`}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              )
                            })}
                          </div>
                          <div className="mt-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={addVariant}
                              disabled={draft.variante.length >= MAX_QUIZ_VARIANTS}
                            >
                              <Plus className="mr-1 size-3.5" />
                              Adaugă variantă ({draft.variante.length}/{MAX_QUIZ_VARIANTS})
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="md:col-span-2">
                          <div className="grid gap-2 md:grid-cols-2">
                            {question.variante.map((variantText, variantIndex) => {
                              const optionId = OPTION_IDS[variantIndex]
                              const isCorrect = correctSet.has(optionId)
                              return (
                                <div
                                  key={`view-variant-${variantIndex}`}
                                  className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm ${
                                    isCorrect
                                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                      : "border-border bg-card text-foreground"
                                  }`}
                                >
                                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-secondary text-[10px] font-semibold">
                                    {OPTION_LABELS[variantIndex]}
                                  </span>
                                  <span className="min-w-0 flex-1">{variantText}</span>
                                </div>
                              )
                            })}
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Răspuns
                            {question.raspunsuri_corecte.length > 1 ? "uri " : " "}
                            corect
                            {question.raspunsuri_corecte.length > 1 ? "e:" : ":"}{" "}
                            <span className="font-medium uppercase text-foreground">
                              {question.raspunsuri_corecte.join(", ") || "—"}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
