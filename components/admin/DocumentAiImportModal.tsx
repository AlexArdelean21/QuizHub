"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, RotateCcw, Sparkles, Upload, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ModalPortal } from "@/components/ui/modal-portal"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  useDocumentAiImport,
  type ChunkEsuat,
  type FazaImport,
  type ProgresImport,
} from "@/hooks/use-document-ai-import"
import { esteImagine } from "@/lib/document-ai/client-page-count"
import { formateazaCredite } from "@/lib/document-ai/pricing"
import {
  MAX_FILE_SIZE_MB,
  MAX_PAGES_PER_DOCUMENT,
  MODEL_CONFIG,
  esteMimeTypeAcceptat,
  necesitaVerificare,
  type IntrebareExtrasa,
  type ModExtractie,
  type NivelModel,
  type StareCredite,
} from "@/lib/document-ai/types"

const ETICHETE_MODEL: Record<NivelModel, string> = {
  standard: "Standard",
  precizie_ridicata: "Precizie ridicată",
  maxim: "Maxim",
}

const NIVELE: NivelModel[] = ["standard", "precizie_ridicata", "maxim"]

const EMAIL_CREDITE =
  "mailto:contact@quizhub.ro?subject=Credite%20Document%20AI"

type DocumentAiImportModalProps = {
  open: boolean
  stareCredite: StareCredite | null
  onClose: () => void
  /** Închide acest modal și deschide fluxul clasic Excel/JSON/Text. */
  onImportManual: () => void
  onFinalizat: (mesaj: string) => void
  onAnulat: (mesaj: string) => void
}

function motiveVerificare(intrebare: IntrebareExtrasa): string[] {
  const motive: string[] = []
  if (intrebare.raspuns_corect.length === 0) {
    motive.push("Răspunsul corect nu a putut fi determinat")
  }
  if (intrebare.confidence !== "high") {
    motive.push("Nivel de încredere scăzut la extragere")
  }
  if (intrebare.necesita_imagine_pentru_raspuns) {
    motive.push("Răspunsul depinde de o imagine din document")
  }
  if (intrebare.taietura_pagina !== null) {
    motive.push("Întrebarea pare tăiată la marginea paginii")
  }
  if (intrebare.structura_neclara) {
    motive.push("Structura întrebării este neclară")
  }
  return motive
}

function valideazaSelectia(files: File[]): string | null {
  if (files.length === 0) return null

  for (const file of files) {
    if (!esteMimeTypeAcceptat(file.type)) {
      return `„${file.name}" nu este un tip acceptat. Acceptăm PDF, DOCX, PNG și JPEG.`
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return `„${file.name}" depășește limita de ${MAX_FILE_SIZE_MB}MB.`
    }
  }

  const imagini = files.filter(esteImagine)
  if (imagini.length > 0 && imagini.length !== files.length) {
    return "Nu poți combina imagini cu PDF sau DOCX în aceeași selecție."
  }
  if (imagini.length === 0 && files.length > 1) {
    return "Poți încărca un singur document PDF sau DOCX odată."
  }
  if (imagini.length > MAX_PAGES_PER_DOCUMENT) {
    return `Maximum ${MAX_PAGES_PER_DOCUMENT} imagini pentru un import.`
  }

  return null
}

export function DocumentAiImportModal({
  open,
  stareCredite,
  onClose,
  onImportManual,
  onFinalizat,
  onAnulat,
}: DocumentAiImportModalProps) {
  const [numeExamen, setNumeExamen] = useState("")
  const [nivelModel, setNivelModel] = useState<NivelModel>("standard")
  const [modExtractie, setModExtractie] = useState<ModExtractie>("mod_a")
  const [files, setFiles] = useState<File[]>([])
  const [eroareFisier, setEroareFisier] = useState<string | null>(null)

  const importAi = useDocumentAiImport()
  const {
    faza,
    progres,
    intrebari,
    intrebariSelectate,
    excluse,
    chunkuriEsuate,
    crediteRamaseX100,
    mesajEroare,
    sesiuneOprita,
    paginaOprire,
    nerezolvate,
    poateFinaliza,
  } = importAi

  const crediteAfisate =
    crediteRamaseX100 ?? stareCredite?.disponibileX100 ?? 0
  const fararCredite = crediteAfisate <= 0

  const numarDeVerificat = useMemo(
    () => intrebari.filter(necesitaVerificare).length,
    [intrebari]
  )

  const inLucru = faza === "verificare" || faza === "upload" || faza === "procesare"
  const poateInchide = faza !== "finalizare" && !inLucru

  if (!open) return null

  const reseteazaFormular = () => {
    setNumeExamen("")
    setNivelModel("standard")
    setModExtractie("mod_a")
    setFiles([])
    setEroareFisier(null)
  }

  const inchideSiReseteaza = () => {
    importAi.reseteaza()
    reseteazaFormular()
    onClose()
  }

  const handleSelecteazaFisiere = (lista: FileList | null) => {
    const selectate = lista ? Array.from(lista) : []
    const eroare = valideazaSelectia(selectate)
    setEroareFisier(eroare)
    setFiles(eroare ? [] : selectate)
  }

  const handlePorneste = () => {
    if (!numeExamen.trim() || files.length === 0 || fararCredite) return
    void importAi.porneste({ files, nivelModel, modExtractie, numeExamen })
  }

  const handleAnuleaza = () => {
    void (async () => {
      const rezultat = await importAi.anuleaza()
      reseteazaFormular()
      onAnulat(
        rezultat.success
          ? `Import anulat. ${formateazaCredite(rezultat.crediteRestituiteX100 ?? 0)} credite au fost restituite.`
          : (rezultat.eroare ?? "Importul nu a putut fi anulat.")
      )
    })()
  }

  const handleFinalizeaza = () => {
    void (async () => {
      const rezultat = await importAi.finalizeaza(numeExamen)
      if (!rezultat.success) return

      const detalii: string[] = [`${rezultat.numarImportate} întrebări importate`]
      if (rezultat.numarDuplicate) detalii.push(`${rezultat.numarDuplicate} duplicate ignorate`)
      reseteazaFormular()
      importAi.reseteaza()
      onFinalizat(`Examen creat: ${detalii.join(", ")}.`)
    })()
  }

  const handleImportManual = () => {
    reseteazaFormular()
    importAi.reseteaza()
    onImportManual()
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Închide popup"
          disabled={!poateInchide}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm disabled:cursor-not-allowed"
          onClick={() => {
            if (faza === "preview") handleAnuleaza()
            else inchideSiReseteaza()
          }}
        />

        <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5 pb-3 dark:border-slate-800">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <Sparkles className="size-4 text-blue-600 dark:text-blue-400" />
                Import cu Document AI
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {formateazaCredite(crediteAfisate)} credite disponibile
              </p>
            </div>
            {poateInchide ? (
              <button
                type="button"
                aria-label="Închide"
                onClick={() => (faza === "preview" ? handleAnuleaza() : inchideSiReseteaza())}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {faza === "configurare" || faza === "eroare" ? (
              <EcranConfigurare
                numeExamen={numeExamen}
                setNumeExamen={setNumeExamen}
                nivelModel={nivelModel}
                setNivelModel={setNivelModel}
                modExtractie={modExtractie}
                setModExtractie={setModExtractie}
                files={files}
                onSelecteazaFisiere={handleSelecteazaFisiere}
                eroareFisier={eroareFisier}
                mesajEroare={faza === "eroare" ? mesajEroare : null}
                fararCredite={fararCredite}
                onImportManual={handleImportManual}
              />
            ) : null}

            {inLucru ? <EcranProcesare faza={faza} progres={progres} /> : null}

            {/* Preview-ul se populează în timp ce chunk-urile sosesc, nu abia la final. */}
            {faza === "preview" ||
            faza === "finalizare" ||
            (faza === "procesare" && intrebari.length > 0) ? (
              <EcranPreview
                intrebari={intrebari}
                excluse={excluse}
                sesiuneOprita={sesiuneOprita}
                paginaOprire={paginaOprire}
                numarDeVerificat={numarDeVerificat}
                mesajEroare={mesajEroare}
                chunkuriEsuate={chunkuriEsuate}
                onReincearca={(cheie) =>
                  void importAi.reincearcaChunk(cheie, nivelModel, modExtractie)
                }
                onToggleIncludere={importAi.excludeIntrebare}
                onRaspunsManual={importAi.seteazaRaspunsManual}
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-5 pt-3 dark:border-slate-800">
            {faza === "configurare" || faza === "eroare" ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    window.location.href = EMAIL_CREDITE
                  }}
                >
                  Cumpără credite extra
                </Button>
                <Button type="button" variant="secondary" onClick={inchideSiReseteaza}>
                  Anulează
                </Button>
                <Button
                  type="button"
                  onClick={handlePorneste}
                  disabled={!numeExamen.trim() || files.length === 0 || fararCredite}
                  className="bg-blue-600 text-white hover:bg-blue-500"
                >
                  Începe importul
                </Button>
              </>
            ) : null}

            {inLucru ? (
              <Button type="button" variant="secondary" onClick={handleAnuleaza}>
                Anulează
              </Button>
            ) : null}

            {faza === "preview" || faza === "finalizare" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAnuleaza}
                  disabled={faza === "finalizare"}
                >
                  Renunță
                </Button>
                <Button
                  type="button"
                  onClick={handleFinalizeaza}
                  disabled={!poateFinaliza || faza === "finalizare"}
                  className="bg-blue-600 text-white hover:bg-blue-500"
                >
                  {faza === "finalizare"
                    ? "Se importă..."
                    : `Importă ${intrebariSelectate.length} întrebări`}
                </Button>
              </>
            ) : null}
          </div>

          {faza === "preview" && nerezolvate.length > 0 ? (
            <p className="border-t border-slate-200 bg-amber-50 px-5 py-2 text-xs text-amber-700 dark:border-slate-800 dark:bg-amber-500/10 dark:text-amber-400">
              {nerezolvate.length} întrebări incluse nu au un răspuns corect stabilit. Alege
              răspunsul sau debifează-le pentru a putea importa.
            </p>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  )
}

// ---------------------------------------------------------------------------

type EcranConfigurareProps = {
  numeExamen: string
  setNumeExamen: (valoare: string) => void
  nivelModel: NivelModel
  setNivelModel: (valoare: NivelModel) => void
  modExtractie: ModExtractie
  setModExtractie: (valoare: ModExtractie) => void
  files: File[]
  onSelecteazaFisiere: (lista: FileList | null) => void
  eroareFisier: string | null
  mesajEroare: string | null
  fararCredite: boolean
  onImportManual: () => void
}

function EcranConfigurare({
  numeExamen,
  setNumeExamen,
  nivelModel,
  setNivelModel,
  modExtractie,
  setModExtractie,
  files,
  onSelecteazaFisiere,
  eroareFisier,
  mesajEroare,
  fararCredite,
  onImportManual,
}: EcranConfigurareProps) {
  return (
    <div className="space-y-4">
      {fararCredite ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Nu mai ai credite Document AI. Poți importa în continuare manual, din Excel, JSON
            sau text.
          </span>
        </div>
      ) : null}

      <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Nume examen
        <input
          value={numeExamen}
          onChange={(event) => setNumeExamen(event.target.value)}
          placeholder="Ex: Autorizare electrician..."
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
      </label>

      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Nivel de precizie
        </p>
        <div className="mt-1 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
          {NIVELE.map((nivel) => (
            <button
              key={nivel}
              type="button"
              onClick={() => setNivelModel(nivel)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                nivelModel === nivel
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {ETICHETE_MODEL[nivel]}
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {MODEL_CONFIG[nivel].multiplier}x
              </Badge>
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <Checkbox
          checked={modExtractie === "mod_b"}
          onCheckedChange={(bifat) => setModExtractie(bifat === true ? "mod_b" : "mod_a")}
          className="mt-0.5"
        />
        <span className="text-sm text-slate-700 dark:text-slate-300">
          Documentul nu are răspunsurile marcate — vreau ca AI să le determine
        </span>
      </label>

      <div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-500 dark:hover:bg-blue-500/5">
          <Upload className="size-5 text-slate-400" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {files.length === 0
              ? "Alege fișierul"
              : files.length === 1
                ? files[0].name
                : `${files.length} imagini selectate`}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            PDF, DOCX sau imagini, max {MAX_PAGES_PER_DOCUMENT} pagini / {MAX_FILE_SIZE_MB}MB
          </span>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,image/png,image/jpeg"
            className="hidden"
            onChange={(event) => onSelecteazaFisiere(event.target.files)}
          />
        </label>

        {eroareFisier ? (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
            {eroareFisier}
          </p>
        ) : null}
      </div>

      {mesajEroare ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
          {mesajEroare}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onImportManual}
        className="text-xs text-slate-500 underline underline-offset-2 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        Preferi import manual (Excel/JSON/Text)?
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

function EcranProcesare({ faza, progres }: { faza: FazaImport; progres: ProgresImport }) {
  const procent =
    progres.totalChunkuri > 0
      ? Math.round((progres.chunkCurent / progres.totalChunkuri) * 100)
      : 0

  const eticheta =
    faza === "verificare"
      ? "Se verifică documentul..."
      : faza === "upload"
        ? "Se încarcă fișierul..."
        : `Se procesează... pagina ${progres.paginaCurenta} din ${progres.totalPagini}`

  return (
    <div className="py-8">
      <p className="text-center text-sm font-medium text-slate-700 dark:text-slate-200">
        {eticheta}
      </p>
      <div className="mx-auto mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: `${faza === "procesare" ? procent : 5}%` }}
        />
      </div>
      <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
        Poți lăsa fereastra deschisă — extragerea continuă în fundal.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

type EcranPreviewProps = {
  intrebari: IntrebareExtrasa[]
  excluse: Set<string>
  sesiuneOprita: boolean
  paginaOprire: number | null
  numarDeVerificat: number
  mesajEroare: string | null
  chunkuriEsuate: ChunkEsuat[]
  onReincearca: (cheie: string) => void
  onToggleIncludere: (idTemporar: string) => void
  onRaspunsManual: (idTemporar: string, index: number) => void
}

function EcranPreview({
  intrebari,
  excluse,
  sesiuneOprita,
  paginaOprire,
  numarDeVerificat,
  mesajEroare,
  chunkuriEsuate,
  onReincearca,
  onToggleIncludere,
  onRaspunsManual,
}: EcranPreviewProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {intrebari.length} întrebări găsite, {numarDeVerificat} marcate pentru verificare
      </p>

      {sesiuneOprita ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Import oprit{paginaOprire ? ` la pagina ${paginaOprire}` : ""} din lipsă de credite —
            poți importa ce s-a extras până acum.
          </span>
        </div>
      ) : null}

      {chunkuriEsuate.map((chunk) => (
        <div
          key={chunk.cheie}
          className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400"
        >
          <span>
            Pagina {chunk.paginaStart}: {chunk.eroare}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onReincearca(chunk.cheie)}
          >
            <RotateCcw className="mr-1 size-3.5" />
            Reîncearcă
          </Button>
        </div>
      ))}

      {mesajEroare && !sesiuneOprita ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
          {mesajEroare}
        </p>
      ) : null}

      <ul className="space-y-2">
        {intrebari.map((intrebare) => (
          <CardIntrebare
            key={intrebare.id_temporar}
            intrebare={intrebare}
            inclusa={!excluse.has(intrebare.id_temporar)}
            onToggleIncludere={onToggleIncludere}
            onRaspunsManual={onRaspunsManual}
          />
        ))}
      </ul>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Poți corecta orice întrebare după import, din editorul de întrebări.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function CardIntrebare({
  intrebare,
  inclusa,
  onToggleIncludere,
  onRaspunsManual,
}: {
  intrebare: IntrebareExtrasa
  inclusa: boolean
  onToggleIncludere: (idTemporar: string) => void
  onRaspunsManual: (idTemporar: string, index: number) => void
}) {
  const faraRaspuns = intrebare.raspuns_corect.length === 0
  const motive = motiveVerificare(intrebare)

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={inclusa}
          onCheckedChange={() => onToggleIncludere(intrebare.id_temporar)}
          className="mt-0.5"
          aria-label="Include întrebarea la import"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-slate-900 dark:text-white">{intrebare.intrebare}</p>
            {motive.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  >
                    Verifică
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <ul className="list-inside list-disc text-xs">
                    {motive.map((motiv) => (
                      <li key={motiv}>{motiv}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            Pagina {intrebare.pagina_sursa}
          </p>

          <ul className="mt-2 space-y-1">
            {intrebare.variante.map((varianta, index) => {
              const corecta = intrebare.raspuns_corect.includes(index)
              const numeGrup = `raspuns-${intrebare.id_temporar}`

              if (faraRaspuns) {
                return (
                  <li key={`${numeGrup}-${index}`}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                      <input
                        type="radio"
                        name={numeGrup}
                        className="mt-1 accent-blue-600"
                        onChange={() => onRaspunsManual(intrebare.id_temporar, index)}
                      />
                      <span>{varianta}</span>
                    </label>
                  </li>
                )
              }

              return (
                <li
                  key={`${numeGrup}-${index}`}
                  className={`rounded-md px-2 py-1 text-sm ${
                    corecta
                      ? "bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {varianta}
                </li>
              )
            })}
          </ul>

          {faraRaspuns ? (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
              Alege răspunsul corect sau debifează întrebarea pentru a putea importa.
            </p>
          ) : null}
        </div>
      </div>
    </li>
  )
}
