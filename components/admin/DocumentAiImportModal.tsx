"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Copy, FileText, RotateCcw, Sparkles, Upload, X } from "lucide-react"

import { anuleazaImport, getSesiuneActiva } from "@/app/admin/document-ai-actions"

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

type SesiuneBlocata = {
  id: string
  numeFisier: string
  creatLa: string
  status: string
}

type DocumentAiImportModalProps = {
  open: boolean
  stareCredite: StareCredite | null
  onClose: () => void
  /** Închide acest modal și deschide fluxul clasic Excel/JSON/Text. */
  onImportManual: () => void
  onFinalizat: (mesaj: string) => void
  onAnulat: (mesaj: string) => void
  /** Reîmprospătează soldul afișat după o restituire care nu închide modalul. */
  onCrediteSchimbate: () => void
  /**
   * Prezentă când importul adaugă întrebări într-un examen deja creat. Absentă,
   * fluxul creează un examen nou din numele cerut în ecranul de configurare.
   */
  examenExistent?: { id: number; nume: string }
}

function formateazaMomentul(iso: string): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return "un moment necunoscut"
  return data.toLocaleString("ro-RO", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })
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
      return `„${file.name}” nu este un tip acceptat. Acceptăm PDF, DOCX, PNG și JPEG.`
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return `„${file.name}” depășește limita de ${MAX_FILE_SIZE_MB}MB.`
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
  onCrediteSchimbate,
  examenExistent,
}: DocumentAiImportModalProps) {
  const [numeExamen, setNumeExamen] = useState("")
  const [nivelModel, setNivelModel] = useState<NivelModel>("standard")
  const [modExtractie, setModExtractie] = useState<ModExtractie>("mod_a")
  const [files, setFiles] = useState<File[]>([])
  const [eroareFisier, setEroareFisier] = useState<string | null>(null)
  const [sesiuneBlocata, setSesiuneBlocata] = useState<SesiuneBlocata | null>(null)
  const [seDeblocheaza, setSeDeblocheaza] = useState(false)
  const [eroareDeblocare, setEroareDeblocare] = useState<string | null>(null)

  const importAi = useDocumentAiImport()
  const {
    faza,
    progres,
    intrebari,
    intrebariSelectate,
    excluse,
    raspunsuriMultiple,
    duplicateNeverificate,
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

  // Un tab închis în timpul procesării lasă sesiunea `in_progres` în baza de date,
  // iar serverul refuză orice import nou până e eliberată.
  useEffect(() => {
    if (!open || faza !== "configurare") return

    let activ = true
    void getSesiuneActiva().then((rezultat) => {
      if (activ && rezultat.success) setSesiuneBlocata(rezultat.sesiune ?? null)
    })
    return () => {
      activ = false
    }
  }, [open, faza])

  const afiseazaDeblocare = sesiuneBlocata !== null && faza === "configurare"

  // Numele se cere doar când importul creează examenul; altfel ținta e deja fixată.
  const numeExamenValid = examenExistent !== undefined || numeExamen.trim().length > 0

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
    setSesiuneBlocata(null)
    setEroareDeblocare(null)
    onClose()
  }

  const handleDeblocheaza = () => {
    if (!sesiuneBlocata) return
    setSeDeblocheaza(true)
    setEroareDeblocare(null)

    void (async () => {
      const rezultat = await anuleazaImport(sesiuneBlocata.id)
      setSeDeblocheaza(false)

      if (!rezultat.success) {
        setEroareDeblocare(rezultat.eroare ?? "Importul blocat nu a putut fi anulat.")
        return
      }

      setSesiuneBlocata(null)
      onCrediteSchimbate()
    })()
  }

  const handleSelecteazaFisiere = (lista: FileList | null) => {
    const selectate = lista ? Array.from(lista) : []
    const eroare = valideazaSelectia(selectate)
    setEroareFisier(eroare)
    setFiles(eroare ? [] : selectate)
  }

  const handlePorneste = () => {
    if (!numeExamenValid || files.length === 0 || fararCredite) return
    void importAi.porneste({
      files,
      nivelModel,
      modExtractie,
      numeExamen,
      examenId: examenExistent?.id,
    })
  }

  const handleAnuleaza = () => {
    // Anularea închide modalul pe loc. Serverul e anunțat în fundal, pentru că
    // apelul stă în spatele chunk-ului aflat în procesare (poate dura minute), iar
    // restituirea ajunge în widget prin `onCrediteSchimbate` când se încheie.
    importAi.anuleaza((rezultat) => {
      if (rezultat.success) onCrediteSchimbate()
    })
    reseteazaFormular()
    onAnulat("Import anulat. Creditele consumate îți vor fi restituite.")
  }

  const handleFinalizeaza = () => {
    void (async () => {
      const rezultat = await importAi.finalizeaza(
        examenExistent ? { examenId: examenExistent.id } : { numeExamenNou: numeExamen }
      )
      if (!rezultat.success) return

      const detalii: string[] = [`${rezultat.numarImportate} întrebări importate`]
      if (rezultat.numarDuplicate) detalii.push(`${rezultat.numarDuplicate} duplicate ignorate`)
      reseteazaFormular()
      importAi.reseteaza()
      onFinalizat(
        examenExistent
          ? `Examenul „${examenExistent.nume}” a fost actualizat: ${detalii.join(", ")}.`
          : `Examen creat: ${detalii.join(", ")}.`
      )
    })()
  }

  const handleImportManual = () => {
    reseteazaFormular()
    importAi.reseteaza()
    onImportManual()
  }

  return (
    <ModalPortal>
      {/*
        Pe mobil bara de navigație plutește la z-[130] peste modal (z-[90]), deci
        ultima secțiune — avertismentul despre întrebările fără răspuns — ar rămâne
        sub ea. Padding-ul de jos rezervă exact înălțimea barei.
      */}
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 pb-[calc(1rem+var(--mobile-nav-height)+env(safe-area-inset-bottom))] md:pb-4">
        {/*
          Overlay inert: un click accidental în afara modalului nu trebuie să arunce
          la gunoi un import în curs. Închiderea se face doar din X sau din butoanele
          explicite.
        */}
        <div aria-hidden className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        <div className="relative z-10 flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:max-h-[90vh] dark:border-slate-800 dark:bg-slate-950">
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
            {afiseazaDeblocare && sesiuneBlocata ? (
              <EcranSesiuneBlocata sesiune={sesiuneBlocata} eroare={eroareDeblocare} />
            ) : null}

            {!afiseazaDeblocare && (faza === "configurare" || faza === "eroare") ? (
              <EcranConfigurare
                examenExistent={examenExistent}
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
                raspunsuriMultiple={raspunsuriMultiple}
                duplicateNeverificate={duplicateNeverificate}
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
                onComutaRaspuns={importAi.comutaRaspunsManual}
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-5 pt-3 dark:border-slate-800">
            {afiseazaDeblocare ? (
              <>
                <Button type="button" variant="secondary" onClick={inchideSiReseteaza}>
                  Închide
                </Button>
                <Button
                  type="button"
                  onClick={handleDeblocheaza}
                  disabled={seDeblocheaza}
                  className="bg-blue-600 text-white hover:bg-blue-500"
                >
                  {seDeblocheaza ? "Se anulează..." : "Anulează importul blocat"}
                </Button>
              </>
            ) : null}

            {!afiseazaDeblocare && (faza === "configurare" || faza === "eroare") ? (
              <>
                <Button type="button" variant="secondary" onClick={inchideSiReseteaza}>
                  Anulează
                </Button>
                <Button
                  type="button"
                  onClick={handlePorneste}
                  disabled={!numeExamenValid || files.length === 0 || fararCredite}
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
                    : intrebariSelectate.length === 0
                      ? "Nimic de importat"
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

function EcranSesiuneBlocata({
  sesiune,
  eroare,
}: {
  sesiune: SesiuneBlocata
  eroare: string | null
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          Ai un import neterminat, început la {formateazaMomentul(sesiune.creatLa)}, pentru
          documentul „{sesiune.numeFisier}&rdquo;. Anulează-l pentru a putea începe unul nou.
        </span>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        Progresul acelui import nu mai poate fi reluat. Creditele consumate până la
        întrerupere îți vor fi restituite la anulare.
      </p>

      {eroare ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
          {eroare}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

type EcranConfigurareProps = {
  examenExistent?: { id: number; nume: string }
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
  examenExistent,
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

      {examenExistent ? (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
          <FileText className="mt-0.5 size-4 shrink-0" />
          <span>
            Întrebările vor fi adăugate în examenul „{examenExistent.nume}”.
          </span>
        </div>
      ) : (
        <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Nume examen
          <input
            value={numeExamen}
            onChange={(event) => setNumeExamen(event.target.value)}
            placeholder="Ex: Autorizare electrician..."
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </label>
      )}

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
        {/* Fără credite zona rămâne vizibilă, dar inertă: modalul se deschide normal,
            iar userul vede clar de ce nu poate porni și ce alternative are. */}
        <label
          className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-center transition-colors ${
            fararCredite
              ? "cursor-not-allowed border-slate-200 bg-slate-100 opacity-60 dark:border-slate-800 dark:bg-slate-900"
              : "cursor-pointer border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-500 dark:hover:bg-blue-500/5"
          }`}
        >
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
            disabled={fararCredite}
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

  // Progresul e setat înainte de a porni apelul către Claude, deci ultimul chunk
  // ar rămâne blocat pe 100% cât durează extragerea. Un document care încape într-un
  // singur chunk ar arăta 100% de la bun început.
  const nedeterminat =
    faza !== "procesare" ||
    progres.totalChunkuri <= 1 ||
    progres.chunkCurent >= progres.totalChunkuri

  return (
    <div className="py-8">
      <p className="text-center text-sm font-medium text-slate-700 dark:text-slate-200">
        {eticheta}
      </p>
      <div className="mx-auto mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        {nedeterminat ? (
          <div className="progress-indeterminate h-full rounded-full bg-blue-600" />
        ) : (
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-500"
            style={{ width: `${procent}%` }}
          />
        )}
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
  raspunsuriMultiple: Set<string>
  duplicateNeverificate: boolean
  sesiuneOprita: boolean
  paginaOprire: number | null
  numarDeVerificat: number
  mesajEroare: string | null
  chunkuriEsuate: ChunkEsuat[]
  onReincearca: (cheie: string) => void
  onToggleIncludere: (idTemporar: string) => void
  onRaspunsManual: (idTemporar: string, index: number) => void
  onComutaRaspuns: (idTemporar: string, index: number) => void
}

function EcranPreview({
  intrebari,
  excluse,
  raspunsuriMultiple,
  duplicateNeverificate,
  sesiuneOprita,
  paginaOprire,
  numarDeVerificat,
  mesajEroare,
  chunkuriEsuate,
  onReincearca,
  onToggleIncludere,
  onRaspunsManual,
  onComutaRaspuns,
}: EcranPreviewProps) {
  const numarDuplicate = intrebari.filter((intrebare) => intrebare.duplicat_in_examen).length
  const toateDuplicate = intrebari.length > 0 && numarDuplicate === intrebari.length

  const segmente = [
    `${intrebari.length} întrebări găsite`,
    numarDuplicate > 0 ? `${numarDuplicate} deja în examen` : null,
    numarDeVerificat > 0 ? `${numarDeVerificat} marcate pentru verificare` : null,
  ].filter((segment): segment is string => segment !== null)

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {segmente.join(", ")}
      </p>

      {duplicateNeverificate ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Duplicatele n-au putut fi verificate în avans. Cele deja existente vor fi
          ignorate automat la import.
        </p>
      ) : null}

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

      {toateDuplicate ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <Copy className="mx-auto size-5 text-slate-400 dark:text-slate-500" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            Toate cele {intrebari.length} întrebări extrase există deja în acest examen.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Nu mai e nimic de importat din acest document.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {intrebari.map((intrebare) => (
            <CardIntrebare
              key={intrebare.id_temporar}
              intrebare={intrebare}
              inclusa={!excluse.has(intrebare.id_temporar)}
              raspunsMultiplu={raspunsuriMultiple.has(intrebare.id_temporar)}
              onToggleIncludere={onToggleIncludere}
              onRaspunsManual={onRaspunsManual}
              onComutaRaspuns={onComutaRaspuns}
            />
          ))}
        </ul>
      )}

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
  raspunsMultiplu,
  onToggleIncludere,
  onRaspunsManual,
  onComutaRaspuns,
}: {
  intrebare: IntrebareExtrasa
  inclusa: boolean
  /** Extrasă cu mai multe răspunsuri corecte: se bifează independent, nu exclusiv. */
  raspunsMultiplu: boolean
  onToggleIncludere: (idTemporar: string) => void
  onRaspunsManual: (idTemporar: string, index: number) => void
  onComutaRaspuns: (idTemporar: string, index: number) => void
}) {
  const faraRaspuns = intrebare.raspuns_corect.length === 0
  const motive = motiveVerificare(intrebare)
  const duplicat = Boolean(intrebare.duplicat_in_examen || intrebare.duplicat_in_lot)

  return (
    <li
      className={`rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 ${
        duplicat ? "opacity-60" : ""
      }`}
    >
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
            <div className="flex shrink-0 items-center gap-1">
            {duplicat ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    Duplicat
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {intrebare.duplicat_in_examen
                      ? "Această întrebare există deja în examen"
                      : "Apare de mai multe ori în document"}
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : null}
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
          </div>

          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            Pagina {intrebare.pagina_sursa}
          </p>

          <ul className="mt-2 space-y-1">
            {intrebare.variante.map((varianta, index) => {
              const corecta = intrebare.raspuns_corect.includes(index)
              const numeGrup = `raspuns-${intrebare.id_temporar}`

              // Orice răspuns e editabil, inclusiv cele extrase cu încredere mare:
              // decizia finală o are omul care face importul.
              return (
                <li key={`${numeGrup}-${index}`}>
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
                      corecta
                        ? "bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <input
                      type={raspunsMultiplu ? "checkbox" : "radio"}
                      name={numeGrup}
                      checked={corecta}
                      className="mt-1 accent-blue-600"
                      onChange={() =>
                        raspunsMultiplu
                          ? onComutaRaspuns(intrebare.id_temporar, index)
                          : onRaspunsManual(intrebare.id_temporar, index)
                      }
                    />
                    <span>{varianta}</span>
                  </label>
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
