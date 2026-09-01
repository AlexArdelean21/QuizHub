"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

/**
 * Widget-ul de credite și modalul de import sunt componente surori, randate dintr-un
 * Server Component care nu poate ține state. Contextul ăsta le leagă cu strictul
 * necesar: un contor pe care importul îl incrementează și widget-ul îl urmărește.
 */
type DocumentAiCreditContextValue = {
  refreshKey: number
  refresh: () => void
}

const DocumentAiCreditContext = createContext<DocumentAiCreditContextValue>({
  refreshKey: 0,
  refresh: () => {},
})

export function DocumentAiCreditProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey((precedent) => precedent + 1)
  }, [])

  const valoare = useMemo(() => ({ refreshKey, refresh }), [refreshKey, refresh])

  return (
    <DocumentAiCreditContext.Provider value={valoare}>
      {children}
    </DocumentAiCreditContext.Provider>
  )
}

/** Fără provider returnează valorile implicite, deci componentele merg și izolat. */
export function useDocumentAiCredite(): DocumentAiCreditContextValue {
  return useContext(DocumentAiCreditContext)
}
