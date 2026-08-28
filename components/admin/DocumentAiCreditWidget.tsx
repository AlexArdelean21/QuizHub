"use client"

import { useEffect, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"

import { getStareCredite } from "@/app/admin/document-ai-actions"
import { formateazaCredite } from "@/lib/document-ai/pricing"
import type { StareCredite } from "@/lib/document-ai/types"

function formateazaData(iso: string | null | undefined): string | null {
  if (!iso) return null
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return null
  return data.toLocaleDateString("ro-RO", { day: "numeric", month: "long" })
}

export function DocumentAiCreditWidget() {
  const [stare, setStare] = useState<StareCredite | null>(null)
  const [extins, setExtins] = useState(false)

  useEffect(() => {
    let activ = true
    void getStareCredite().then((rezultat) => {
      if (activ) setStare(rezultat)
    })
    return () => {
      activ = false
    }
  }, [])

  // Fără credite AI (sau fără drept de acces) widget-ul nu ocupă spațiu în dashboard.
  if (!stare?.success || !stare.aiImportEnabled) return null

  const disponibile = stare.disponibileX100 ?? 0
  const epuizate = disponibile <= 0
  const dataReset = formateazaData(stare.resetLa)

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-9 items-center justify-center rounded-xl ${
              epuizate
                ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                : "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
            }`}
          >
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {formateazaCredite(disponibile)} credite disponibile
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {epuizate
                ? "Credite epuizate pentru importul cu Document AI."
                : "Import de întrebări cu Document AI."}
              {dataReset ? ` Se reînnoiesc pe ${dataReset}.` : ""}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExtins((precedent) => !precedent)}
          aria-expanded={extins}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Detalii
          <ChevronDown
            className={`size-3.5 transition-transform duration-200 ${extins ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {extins ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200/70 pt-3 text-xs dark:border-slate-800 sm:grid-cols-4">
          <LinieCredit eticheta="Lunare" valoareX100={stare.lunareX100 ?? 0} />
          <LinieCredit eticheta="Reportate" valoareX100={stare.acumulateX100 ?? 0} />
          <LinieCredit eticheta="Extra" valoareX100={stare.extraX100 ?? 0} />
          <LinieCredit eticheta="Consumate" valoareX100={stare.consumateX100 ?? 0} />
        </dl>
      ) : null}
    </section>
  )
}

function LinieCredit({ eticheta, valoareX100 }: { eticheta: string; valoareX100: number }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {eticheta}
      </dt>
      <dd className="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">
        {formateazaCredite(valoareX100)}
      </dd>
    </div>
  )
}
