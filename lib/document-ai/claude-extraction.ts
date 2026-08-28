import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { randomUUID } from "node:crypto"

import type { ContinutChunk } from "@/lib/document-ai/document-parser"
import { buildSystemBlocks, buildUserPrompt } from "@/lib/document-ai/prompts"
import {
  MODEL_CONFIG,
  type IntrebareExtrasa,
  type ModExtractie,
  type NivelModel,
  type RezultatChunk,
} from "@/lib/document-ai/types"

const NUME_TOOL = "extrage_intrebari"

/**
 * Plafonul de output per chunk, tokenii de gândire incluși. Ține și rolul de
 * limită superioară a costului unui singur apel.
 */
const MAX_TOKENS: Record<NivelModel, number> = {
  standard: 16_000,
  precizie_ridicata: 20_000,
  maxim: 20_000,
}

type NivelEffort = "low" | "medium" | "high" | "xhigh" | "max"

/**
 * Extragerea e o sarcină structurată, nu una de raționament liber, iar valoarea
 * nivelurilor superioare stă în capabilitatea modelului, nu în adâncimea gândirii.
 * Fără `effort`, Sonnet 5 și Opus 5 rulează implicit pe `high` și consumă tokeni
 * de gândire facturați ca output, ceea ce ar depăși estimarea de credite.
 * Haiku 4.5 nu acceptă parametrul.
 */
const EFFORT: Record<NivelModel, NivelEffort | null> = {
  standard: null,
  precizie_ridicata: "low",
  maxim: "medium",
}

const TIMEOUT_MS = 10 * 60 * 1000
const MAX_RETRIES = 2

type ParamsCuEffort = Anthropic.MessageCreateParamsNonStreaming & {
  output_config?: { effort: NivelEffort }
}

const TOOL_EXTRAGERE: Anthropic.Tool = {
  name: NUME_TOOL,
  description:
    "Returnează întrebările grilă extrase din paginile primite. Se apelează exact o dată, " +
    "inclusiv atunci când nu s-a găsit nicio întrebare (cu `intrebari` gol).",
  input_schema: {
    type: "object",
    properties: {
      intrebari: {
        type: "array",
        description: "Întrebările găsite, în ordinea din document.",
        items: {
          type: "object",
          properties: {
            intrebare: {
              type: "string",
              description: "Enunțul, fără numerotarea de la început.",
            },
            variante: {
              type: "array",
              description: "Textele opțiunilor, în ordinea din pagină, fără etichete.",
              items: { type: "string" },
              minItems: 2,
              maxItems: 10,
            },
            raspuns_corect: {
              type: "array",
              description:
                "Indecși 0-based în `variante`. Gol dacă răspunsul nu poate fi determinat.",
              items: { type: "integer", minimum: 0 },
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "Certitudinea privind `raspuns_corect`, nu privind transcrierea.",
            },
            necesita_imagine_pentru_raspuns: {
              type: "boolean",
              description:
                "true doar dacă un element vizual e necesar pentru a răspunde, nu doar decorativ.",
            },
            taietura_pagina: {
              type: ["string", "null"],
              enum: ["inceput", "sfarsit", null],
              description: "Marginea la care întrebarea pare tăiată, sau null dacă e completă.",
            },
            structura_neclara: {
              type: "boolean",
              description: "true dacă nu e sigur că blocul e într-adevăr o întrebare grilă.",
            },
            pagina_sursa: {
              type: "integer",
              minimum: 1,
              description: "Numărul absolut de pagină din documentul original.",
            },
          },
          required: [
            "intrebare",
            "variante",
            "raspuns_corect",
            "confidence",
            "necesita_imagine_pentru_raspuns",
            "taietura_pagina",
            "structura_neclara",
            "pagina_sursa",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["intrebari"],
    additionalProperties: false,
  },
}

let clientCache: Anthropic | null = null

function getClient(): Anthropic {
  if (clientCache) return clientCache

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("Lipsește ANTHROPIC_API_KEY în variabilele de mediu.")
  }

  clientCache = new Anthropic({ apiKey, maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS })
  return clientCache
}

function construiesteContinut(continut: ContinutChunk): Anthropic.ContentBlockParam[] {
  if (continut.tip === "pdf") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: continut.pdf.toString("base64"),
        },
      },
    ]
  }

  if (continut.tip === "imagini") {
    return continut.imagini.map((imagine) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: imagine.mediaType,
        data: imagine.buffer.toString("base64"),
      },
    }))
  }

  return [{ type: "text", text: continut.text }]
}

export async function extractChunkFromClaude(params: {
  nivelModel: NivelModel
  modExtractie: ModExtractie
  /** Conținutul chunk-ului: PDF decupat, imagini sau text. */
  continut: ContinutChunk
  /** Numerele absolute de pagină corespunzătoare conținutului. */
  pageNumbers: number[]
}): Promise<RezultatChunk> {
  const { nivelModel, modExtractie, continut, pageNumbers } = params
  const gol: RezultatChunk = {
    intrebari: [],
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    eroare: null,
  }

  try {
    const client = getClient()
    const [blocFix, blocMod] = buildSystemBlocks(modExtractie)

    const cerere: ParamsCuEffort = {
      model: MODEL_CONFIG[nivelModel].model,
      max_tokens: MAX_TOKENS[nivelModel],
      system: [
        // Prefixul cacheable: identic pentru mod_a și mod_b.
        { type: "text", text: blocFix, cache_control: { type: "ephemeral" } },
        { type: "text", text: blocMod },
      ],
      tools: [TOOL_EXTRAGERE],
      tool_choice: { type: "tool", name: NUME_TOOL },
      messages: [
        {
          role: "user",
          content: [
            ...construiesteContinut(continut),
            { type: "text", text: buildUserPrompt(pageNumbers) },
          ],
        },
      ],
    }

    const effort = EFFORT[nivelModel]
    if (effort) cerere.output_config = { effort }

    const raspuns = await client.messages.create(cerere)

    const usage = raspuns.usage
    const rezultat: RezultatChunk = {
      intrebari: [],
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
      eroare: null,
    }

    const blocTool = raspuns.content.find(
      (bloc): bloc is Anthropic.ToolUseBlock =>
        bloc.type === "tool_use" && bloc.name === NUME_TOOL
    )

    if (!blocTool) {
      // Consumul e real chiar dacă răspunsul e inutilizabil, dar apelantul nu
      // taxează chunk-urile cu eroare, deci tokenii rămân doar pentru telemetrie.
      return {
        ...rezultat,
        eroare:
          raspuns.stop_reason === "max_tokens"
            ? "Răspunsul modelului a depășit bugetul de tokeni pentru acest bloc de pagini."
            : "Modelul nu a returnat un rezultat structurat pentru acest bloc de pagini.",
      }
    }

    rezultat.intrebari = normalizeazaIntrebari(blocTool.input, pageNumbers)
    return rezultat
  } catch (error) {
    return { ...gol, eroare: mesajEroareApi(error) }
  }
}

function mesajEroareApi(error: unknown): string {
  // Verificat înaintea APIError, de care moștenește.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "Apelul către Claude a expirat pentru acest bloc de pagini."
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return "Conexiunea către Claude a eșuat. Reîncearcă."
  }

  if (error instanceof Anthropic.APIError) {
    if (error.status === 429) return "Limita de cereri către Claude a fost atinsă. Reîncearcă."
    if (error.status === 529) return "Serviciul Claude este supraîncărcat. Reîncearcă."
    if (error.status === 401 || error.status === 403) {
      return "Cheia API pentru Claude este invalidă sau fără drepturi."
    }
    if (error.status === 400) {
      return "Blocul de pagini a fost respins de Claude (prea mare sau format neacceptat)."
    }
    if (typeof error.status === "number" && error.status >= 500) {
      return "Serviciul Claude a returnat o eroare temporară. Reîncearcă."
    }
    return "Apelul către Claude a eșuat."
  }

  if (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")) {
    return error.message
  }

  // Mesajul brut poate conține fragmente din document; nu îl propagăm către client.
  return "Eroare neașteptată la procesarea blocului de pagini."
}

function normalizeazaIntrebari(input: unknown, pageNumbers: number[]): IntrebareExtrasa[] {
  if (!input || typeof input !== "object") return []

  const brute = (input as { intrebari?: unknown }).intrebari
  if (!Array.isArray(brute)) return []

  const primaPagina = pageNumbers[0] ?? 1
  const ultimaPagina = pageNumbers[pageNumbers.length - 1] ?? primaPagina

  const intrebari: IntrebareExtrasa[] = []

  for (const brut of brute) {
    if (!brut || typeof brut !== "object") continue
    const item = brut as Record<string, unknown>

    const intrebare = normalizeazaText(item.intrebare)
    if (!intrebare) continue

    const variante = Array.isArray(item.variante)
      ? item.variante.map(normalizeazaText).filter((v): v is string => v.length > 0)
      : []
    if (variante.length < 2 || variante.length > 10) continue

    const raspunsCorect = Array.isArray(item.raspuns_corect)
      ? Array.from(
          new Set(
            item.raspuns_corect
              .map((valoare) => Number(valoare))
              .filter(
                (valoare) =>
                  Number.isInteger(valoare) && valoare >= 0 && valoare < variante.length
              )
          )
        ).sort((a, b) => a - b)
      : []

    const confidence =
      item.confidence === "high" || item.confidence === "medium" ? item.confidence : "low"

    const taietura =
      item.taietura_pagina === "inceput" || item.taietura_pagina === "sfarsit"
        ? item.taietura_pagina
        : null

    const paginaBruta = Number(item.pagina_sursa)
    const pagina = Number.isInteger(paginaBruta)
      ? Math.min(Math.max(paginaBruta, primaPagina), ultimaPagina)
      : primaPagina

    intrebari.push({
      id_temporar: randomUUID(),
      intrebare,
      variante,
      raspuns_corect: raspunsCorect,
      // Un răspuns nedeterminat nu poate avea încredere ridicată, indiferent ce a raportat modelul.
      confidence: raspunsCorect.length === 0 ? "low" : confidence,
      necesita_imagine_pentru_raspuns: item.necesita_imagine_pentru_raspuns === true,
      taietura_pagina: taietura,
      structura_neclara: item.structura_neclara === true,
      pagina_sursa: pagina,
    })
  }

  return intrebari
}

function normalizeazaText(valoare: unknown): string {
  if (typeof valoare !== "string") return ""
  return valoare.replace(/\s+/g, " ").trim()
}
