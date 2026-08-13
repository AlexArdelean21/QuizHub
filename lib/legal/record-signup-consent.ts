/**
 * Records GDPR consent for a freshly-created user by calling
 * /api/legal/record-signup-consent. Best-effort: failures are logged but never
 * block the signup UX.
 *
 * `documents` must list exactly the types the user checked in the UI.
 */
export async function recordSignupConsent(
  userId: string,
  documents: ("termeni" | "confidentialitate")[]
): Promise<void> {
  try {
    const res = await fetch("/api/legal/record-signup-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        documents,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
    })
    if (!res.ok) {
      console.error("[signup] Consent recording failed:", await res.text())
    }
  } catch (error) {
    console.error("[signup] Consent recording error:", error)
  }
}
