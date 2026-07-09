"use client";

import { readCookieConsent } from "@/lib/legal/cookie-consent";

/**
 * If the current browser has an anonymous cookie-consent record in localStorage
 * that has not yet been reflected as a row in user_consents for this user,
 * write it now. Idempotent: the server-side recordConsent skips if a row for
 * (user_id, document_type, document_version) already exists.
 *
 * Fire-and-forget. Never blocks the login flow. Logs on failure and moves on.
 */
export async function migrateAnonymousCookieConsent(): Promise<void> {
  const local = readCookieConsent();
  if (!local) return;

  try {
    await fetch("/api/legal/accept-pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: [{ type: "cookies", version: local.version }],
      }),
    });
  } catch (err) {
    console.error("[consent-migration] Failed to migrate cookie consent:", err);
  }
}
