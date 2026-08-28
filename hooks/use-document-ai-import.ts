"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  anuleazaImport,
  finalizeazaImport,
  getPlanChunkuri,
  getUploadUrlPentruSesiune,
  proceseazaChunkDocument,
  verificaSiCreazaSesiune,
} from "@/app/admin/document-ai-actions"
import { cheieDeduplicareLocala } from "@/lib/document-ai/chunking"
import { esteImagine, numaraPaginiClient } from "@/lib/document-ai/client-page-count"
import type {
  IntrebareExtrasa,
  ModExtractie,
  NivelModel,
  RezultatFinalizare,
} from "@/lib/document-ai/types"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"

const BUCKET = "document-ai-uploads"

export type FazaImport =
  | "configurare"
  | "verificare"
  | "upload"
  | "procesare"
  | "preview"
  | "finalizare"
  | "eroare"

export type ProgresImport = {
  chunkCurent: number
  totalChunkuri: number
  paginaCurenta: number
  totalPagini: number
}

/**
 * O unitate de procesare. Pentru PDF/DOCX corespunde unui interval de pagini din
 * același fișier; pentru un set de imagini, fiecare imagine e propria sarcină.
 */
type SarcinaChunk = {
  cheie: string
  storagePath: string
  chunkStart: number
  chunkEnd: number
  /** Adăugat la `pagina_sursa` — seturile de imagini sunt documente de o pagină. */
  paginaOffset: number
}

export type ChunkEsuat = {
  cheie: string
  eroare: string
  paginaStart: number
}

type ParametriPornire = {
  files: File[]
  nivelModel: NivelModel
  modExtractie: ModExtractie
  numeExamen: string
}

const PROGRES_INITIAL: ProgresImport = {
  chunkCurent: 0,
  totalChunkuri: 0,
  paginaCurenta: 0,
  totalPagini: 0,
}

function mesajEroare(error: unknown): string {
  if (error instanceof Error) return error.message
  return "A apărut o eroare neașteptată."
}

export function useDocumentAiImport() {
  const [faza, setFaza] = useState<FazaImport>("configurare")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [progres, setProgres] = useState<ProgresImport>(PROGRES_INITIAL)
  const [intrebari, setIntrebari] = useState<IntrebareExtrasa[]>([])
  const [excluse, setExcluse] = useState<Set<string>>(() => new Set())
  const [chunkuriEsuate, setChunkuriEsuate] = useState<ChunkEsuat[]>([])
  const [crediteRamaseX100, setCrediteRamaseX100] = useState<number | null>(null)
  const [mesajEroareStare, setMesajEroareStare] = useState<string | null>(null)
  const [sesiuneOprita, setSesiuneOprita] = useState(false)
  const [paginaOprire, setPaginaOprire] = useState<number | null>(null)

  // Bucla de procesare rulează în afara ciclului de render; fără garda asta ar
  // continua să scrie în state după ce modalul a fost închis.
  const activRef = useRef(true)
  const sesiuneRef = useRef<string | null>(null)
  const sarciniRef = useRef<SarcinaChunk[]>([])
  const cheiVazuteRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    activRef.current = true
    return () => {
      activRef.current = false
    }
  }, [])

  const reseteaza = useCallback(() => {
    sesiuneRef.current = null
    sarciniRef.current = []
    cheiVazuteRef.current = new Set()
    setFaza("configurare")
    setSessionId(null)
    setProgres(PROGRES_INITIAL)
    setIntrebari([])
    setExcluse(new Set())
    setChunkuriEsuate([])
    setCrediteRamaseX100(null)
    setMesajEroareStare(null)
    setSesiuneOprita(false)
    setPaginaOprire(null)
  }, [])

  /** Deduplicare locală: overlap-ul dintre chunk-uri returnează aceleași întrebări de două ori. */
  const adaugaIntrebari = useCallback((noi: IntrebareExtrasa[]) => {
    const unice: IntrebareExtrasa[] = []
    for (const intrebare of noi) {
      const cheie = cheieDeduplicareLocala(intrebare.intrebare, intrebare.variante)
      if (cheiVazuteRef.current.has(cheie)) continue
      cheiVazuteRef.current.add(cheie)
      unice.push(intrebare)
    }
    if (unice.length > 0) {
      setIntrebari((curente) => [...curente, ...unice])
    }
  }, [])

  const ruleazaSarcina = useCallback(
    async (
      sarcina: SarcinaChunk,
      nivelModel: NivelModel,
      modExtractie: ModExtractie
    ): Promise<"ok" | "eroare" | "oprit"> => {
      const idSesiune = sesiuneRef.current
      if (!idSesiune) return "oprit"

      const rezultat = await proceseazaChunkDocument({
        sessionId: idSesiune,
        storagePath: sarcina.storagePath,
        chunkStart: sarcina.chunkStart,
        chunkEnd: sarcina.chunkEnd,
        nivelModel,
        modExtractie,
      })

      if (!activRef.current) return "oprit"

      setCrediteRamaseX100(rezultat.crediteRamaseX100)

      if (rezultat.oprit) {
        setSesiuneOprita(true)
        setPaginaOprire(sarcina.chunkStart + sarcina.paginaOffset)
        setMesajEroareStare(rezultat.eroare ?? null)
        return "oprit"
      }

      if (!rezultat.success) {
        setChunkuriEsuate((curente) => [
          ...curente.filter((chunk) => chunk.cheie !== sarcina.cheie),
          {
            cheie: sarcina.cheie,
            eroare: rezultat.eroare ?? "Blocul de pagini nu a putut fi procesat.",
            paginaStart: sarcina.chunkStart + sarcina.paginaOffset,
          },
        ])
        return "eroare"
      }

      setChunkuriEsuate((curente) =>
        curente.filter((chunk) => chunk.cheie !== sarcina.cheie)
      )

      adaugaIntrebari(
        sarcina.paginaOffset === 0
          ? rezultat.intrebari
          : rezultat.intrebari.map((intrebare) => ({
              ...intrebare,
              pagina_sursa: intrebare.pagina_sursa + sarcina.paginaOffset,
            }))
      )

      return "ok"
    },
    [adaugaIntrebari]
  )

  const porneste = useCallback(
    async (params: ParametriPornire) => {
      const { files, nivelModel, modExtractie } = params

      setMesajEroareStare(null)
      setFaza("verificare")

      try {
        // Reîncercare după o eroare: eliberează sesiunea abandonată, altfel
        // organizația rămâne blocată cu un import „în progres".
        if (sesiuneRef.current) {
          await anuleazaImport(sesiuneRef.current)
          sesiuneRef.current = null
          cheiVazuteRef.current = new Set()
          setIntrebari([])
          setExcluse(new Set())
          setChunkuriEsuate([])
          setSesiuneOprita(false)
          setPaginaOprire(null)
        }

        const numarPagini = await numaraPaginiClient(files)
        if (!activRef.current) return

        const sesiune = await verificaSiCreazaSesiune({
          numeFisier: files.length === 1 ? files[0].name : `${files.length} imagini`,
          numarPagini,
          nivelModel,
          modExtractie,
        })
        if (!activRef.current) return

        if (!sesiune.success || !sesiune.sessionId) {
          setMesajEroareStare(sesiune.eroare ?? "Sesiunea nu a putut fi creată.")
          setFaza("eroare")
          return
        }

        sesiuneRef.current = sesiune.sessionId
        setSessionId(sesiune.sessionId)
        if (typeof sesiune.crediteDisponibileX100 === "number") {
          setCrediteRamaseX100(sesiune.crediteDisponibileX100)
        }

        // --- Upload ---------------------------------------------------------
        setFaza("upload")
        const supabase = getSupabaseBrowserClient()
        const caiIncarcate: string[] = []

        for (const [index, file] of files.entries()) {
          // Serverul truncheză numele la ultimele 120 de caractere; scurtăm întâi
          // numele ca prefixul de index să nu poată fi tăiat și căile să rămână distincte.
          const link = await getUploadUrlPentruSesiune(
            sesiune.sessionId,
            `${index}-${file.name.slice(-80)}`
          )
          if (!activRef.current) return

          if (!link.success || !link.uploadUrl || !link.token || !link.path) {
            setMesajEroareStare(link.eroare ?? "Linkul de încărcare nu a putut fi generat.")
            setFaza("eroare")
            return
          }

          const { error: eroareUpload } = await supabase.storage
            .from(BUCKET)
            .uploadToSignedUrl(link.path, link.token, file)
          if (!activRef.current) return

          if (eroareUpload) {
            setMesajEroareStare(`Încărcarea fișierului a eșuat: ${eroareUpload.message}`)
            setFaza("eroare")
            return
          }

          caiIncarcate.push(link.path)
        }

        // --- Planul de procesare --------------------------------------------
        const toateImagini = files.every(esteImagine)
        let sarcini: SarcinaChunk[]

        if (toateImagini) {
          // Fiecare imagine e un document separat de o pagină; numerotarea absolută
          // se reconstruiește din poziția fișierului în selecție.
          sarcini = caiIncarcate.map((cale, index) => ({
            cheie: `img-${index}`,
            storagePath: cale,
            chunkStart: 1,
            chunkEnd: 1,
            paginaOffset: index,
          }))
        } else {
          const plan = await getPlanChunkuri(numarPagini)
          if (!activRef.current) return

          if (!plan.success) {
            setMesajEroareStare(plan.eroare ?? "Planul de procesare nu a putut fi calculat.")
            setFaza("eroare")
            return
          }

          sarcini = plan.chunkuri.map((chunk, index) => ({
            cheie: `chunk-${index}`,
            storagePath: caiIncarcate[0],
            chunkStart: chunk.start,
            chunkEnd: chunk.end,
            paginaOffset: 0,
          }))
        }

        sarciniRef.current = sarcini
        setProgres({
          chunkCurent: 0,
          totalChunkuri: sarcini.length,
          paginaCurenta: 0,
          totalPagini: numarPagini,
        })

        // --- Procesare secvențială -------------------------------------------
        setFaza("procesare")

        for (const [index, sarcina] of sarcini.entries()) {
          if (!activRef.current) return

          setProgres({
            chunkCurent: index + 1,
            totalChunkuri: sarcini.length,
            paginaCurenta: Math.min(sarcina.chunkEnd + sarcina.paginaOffset, numarPagini),
            totalPagini: numarPagini,
          })

          const stare = await ruleazaSarcina(sarcina, nivelModel, modExtractie)
          if (!activRef.current) return

          // Epuizarea creditelor oprește tot; o eroare tehnică doar marchează
          // blocul pentru retry și lasă restul documentului să continue.
          if (stare === "oprit") break
        }

        if (!activRef.current) return
        setFaza("preview")
      } catch (error) {
        if (!activRef.current) return
        setMesajEroareStare(mesajEroare(error))
        setFaza("eroare")
      }
    },
    [ruleazaSarcina]
  )

  const reincearcaChunk = useCallback(
    async (cheie: string, nivelModel: NivelModel, modExtractie: ModExtractie) => {
      const sarcina = sarciniRef.current.find((item) => item.cheie === cheie)
      if (!sarcina) return
      await ruleazaSarcina(sarcina, nivelModel, modExtractie)
    },
    [ruleazaSarcina]
  )

  const anuleaza = useCallback(async () => {
    const idSesiune = sesiuneRef.current
    if (!idSesiune) {
      reseteaza()
      return { success: true as const, crediteRestituiteX100: 0 }
    }

    // Oprește bucla de procesare înainte de a elibera sesiunea pe server.
    activRef.current = false
    const rezultat = await anuleazaImport(idSesiune)
    reseteaza()
    activRef.current = true
    return rezultat
  }, [reseteaza])

  const excludeIntrebare = useCallback((idTemporar: string) => {
    setExcluse((curente) => {
      const urmatoare = new Set(curente)
      if (urmatoare.has(idTemporar)) urmatoare.delete(idTemporar)
      else urmatoare.add(idTemporar)
      return urmatoare
    })
  }, [])

  const seteazaRaspunsManual = useCallback((idTemporar: string, indexRaspuns: number) => {
    setIntrebari((curente) =>
      curente.map((intrebare) =>
        intrebare.id_temporar === idTemporar
          ? { ...intrebare, raspuns_corect: [indexRaspuns] }
          : intrebare
      )
    )
  }, [])

  const intrebariSelectate = intrebari.filter(
    (intrebare) => !excluse.has(intrebare.id_temporar)
  )

  // O întrebare inclusă fără răspuns stabilit ar ajunge nerezolvabilă în test.
  const nerezolvate = intrebariSelectate.filter(
    (intrebare) => intrebare.raspuns_corect.length === 0
  )
  const poateFinaliza = intrebariSelectate.length > 0 && nerezolvate.length === 0

  const finalizeaza = useCallback(
    async (numeExamen: string): Promise<RezultatFinalizare> => {
      const idSesiune = sesiuneRef.current
      if (!idSesiune) {
        return { success: false, numarImportate: 0, eroare: "Sesiunea de import lipsește." }
      }
      if (!poateFinaliza) {
        return {
          success: false,
          numarImportate: 0,
          eroare: "Stabilește sau exclude întrebările fără răspuns înainte de import.",
        }
      }

      setFaza("finalizare")

      const rezultat = await finalizeazaImport({
        sessionId: idSesiune,
        intrebariSelectate,
        numeExamenNou: numeExamen.trim(),
      })

      if (!rezultat.success) {
        setMesajEroareStare(rezultat.eroare ?? "Importul nu a putut fi finalizat.")
        setFaza("preview")
      }

      return rezultat
    },
    [intrebariSelectate, poateFinaliza]
  )

  return {
    faza,
    sessionId,
    progres,
    intrebari,
    intrebariSelectate,
    excluse,
    chunkuriEsuate,
    crediteRamaseX100,
    mesajEroare: mesajEroareStare,
    sesiuneOprita,
    paginaOprire,
    nerezolvate,
    poateFinaliza,
    porneste,
    reincearcaChunk,
    anuleaza,
    excludeIntrebare,
    seteazaRaspunsManual,
    finalizeaza,
    reseteaza,
  }
}
