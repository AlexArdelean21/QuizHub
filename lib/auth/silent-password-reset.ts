/**
 * Silently triggers the standard password-reset flow for an email.
 *
 * Used on signup when Supabase's anti-enumeration response indicates the email
 * already belongs to a confirmed account: we notify the real owner ("someone
 * tried to sign up — reset your password / sign in") without ever revealing to
 * the requester that the account exists.
 *
 * It reuses the hardened /api/auth/reset-password route (which owns the reset
 * redirect URL, delivers the PKCE verifier via Set-Cookie, and always returns a
 * constant 200). The result and any error are intentionally swallowed so this
 * call can never change control flow, the UI, or leak which case occurred.
 */
export async function triggerSilentPasswordReset(email: string): Promise<void> {
  try {
    await fetch("/api/auth/reset-password", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
  } catch {
    // Intentionally swallowed — never surface or log differently than the
    // new-user path, to preserve anti-enumeration.
  }
}
