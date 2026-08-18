"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModalPortal } from "@/components/ui/modal-portal";
import type { LegalSlug } from "@/lib/legal/documents";

interface PendingDoc {
  type: LegalSlug;
  version: string;
}

interface PendingConsentsResponse {
  pending: PendingDoc[];
  isFirstConsent?: boolean;
}

const DOCUMENT_LABELS: Record<LegalSlug, { label: string; href: string }> = {
  termeni: { label: "Termenii și condițiile", href: "/legal/termeni" },
  confidentialitate: {
    label: "Politica de confidențialitate",
    href: "/legal/confidentialitate",
  },
  cookies: { label: "Politica de cookie-uri", href: "/legal/cookies" },
};

export function ReConsentModal() {
  const [pending, setPending] = useState<PendingDoc[]>([]);
  const [isFirstConsent, setIsFirstConsent] = useState(false);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkComplete, setCheckComplete] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function check() {
      try {
        const res = await fetch("/api/legal/pending-consents");
        if (!res.ok) throw new Error("fetch failed");
        const data = (await res.json()) as PendingConsentsResponse;
        if (!cancelledRef.current) {
          setPending(data.pending ?? []);
          setIsFirstConsent(data.isFirstConsent === true);
        }
      } catch (err) {
        // Degradare grațioasă: dacă verificarea eșuează nu blocăm userul.
        console.error("[ReConsentModal] Could not check pending consents:", err);
      } finally {
        if (!cancelledRef.current) setCheckComplete(true);
      }
    }

    void check();

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Absorb Escape key while modal is open — prevent any parent handler from acting.
  useEffect(() => {
    if (!checkComplete || pending.length === 0) return;

    function blockEsc(e: KeyboardEvent) {
      if (e.key === "Escape") e.stopImmediatePropagation();
    }

    window.addEventListener("keydown", blockEsc, { capture: true });
    return () => window.removeEventListener("keydown", blockEsc, { capture: true });
  }, [checkComplete, pending.length]);

  async function handleAccept() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/legal/accept-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: pending }),
      });
      if (!res.ok && res.status !== 207) throw new Error("consent write failed");
      setPending([]);
    } catch (err) {
      // Degradare grațioasă: lăsăm userul să continue, va fi re-verificat la sesiunea următoare.
      console.error("[ReConsentModal] Failed to record re-consent:", err);
      setPending([]);
    } finally {
      setSubmitting(false);
    }
  }

  if (!checkComplete || pending.length === 0) return null;

  return (
    <ModalPortal>
      {/* Full-screen blocking overlay — absorbs all pointer events, no dismiss on click */}
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal card — stopPropagation redundant but explicit */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reconsent-title"
          className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="reconsent-title"
            className="mb-2 text-lg font-semibold text-foreground"
          >
            {isFirstConsent
              ? "Bine ai venit pe QuizHub!"
              : "Actualizare documente legale"}
          </h2>

          <p className="mb-4 text-sm text-muted-foreground">
            {isFirstConsent
              ? "Pentru a continua, te rugăm confirmă că ai citit și ești de acord cu:"
              : "Am actualizat documentele noastre legale. Pentru a continua să folosești QuizHub, te rugăm să confirmi că ai citit și ești de acord cu:"}
          </p>

          <ul className="mb-4 space-y-1.5">
            {pending.map((doc) => (
              <li key={doc.type}>
                <Link
                  href={DOCUMENT_LABELS[doc.type].href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
                >
                  {DOCUMENT_LABELS[doc.type].label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mb-5 flex items-start gap-2">
            <Checkbox
              id="reconsent-check"
              checked={checked}
              onCheckedChange={(c) => setChecked(c === true)}
              className="mt-0.5 shrink-0"
            />
            <label
              htmlFor="reconsent-check"
              className="cursor-pointer text-sm leading-tight text-muted-foreground"
            >
              Am citit și sunt de acord cu documentele de mai sus
            </label>
          </div>

          <Button
            className="w-full"
            disabled={!checked || submitting}
            onClick={handleAccept}
          >
            {submitting ? "Se procesează..." : "Continuă"}
          </Button>
        </div>
      </div>
    </ModalPortal>
  );
}
