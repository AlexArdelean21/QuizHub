/**
 * Records the GDPR terms + privacy consent for a freshly-created user by calling
 * the existing /api/legal/record-signup-consent endpoint. Best-effort: failures
 * are logged but never block the signup UX (mirrors the original /login flow).
 */
export async function recordSignupConsent(userId: string): Promise<void> {
  try {
    const res = await fetch("/api/legal/record-signup-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
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
