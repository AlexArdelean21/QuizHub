import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options"

/**
 * Initiates the Supabase PKCE password-reset flow from the server.
 *
 * Running resetPasswordForEmail in a Route Handler (rather than directly from
 * the browser client) guarantees that the PKCE code verifier is delivered to
 * the browser via a proper HTTP Set-Cookie response header instead of a
 * document.cookie write. Set-Cookie headers survive email-client redirect
 * chains and strict browser privacy settings that can silently drop JS
 * cookie writes.
 *
 * SECURITY (F-05): This endpoint MUST NOT leak whether an account exists.
 * It always responds with HTTP 200 `{ success: true }` regardless of outcome:
 *   - missing/invalid body or email      -> 200 { success: true }
 *   - Supabase error (incl. unknown user) -> 200 { success: true }
 *   - success                             -> 200 { success: true }
 * We never branch the response on the result of resetPasswordForEmail, so the
 * status code and body are identical for real and non-existent accounts.
 * (Rate limiting is handled at the edge/middleware layer, not here.)
 */
export async function POST(request: NextRequest) {
  // A single, constant success response. Any PKCE cookies set during a valid
  // attempt are written onto this same response object. Cookie presence is not
  // an enumeration vector: the PKCE verifier is generated before the request
  // and does not depend on whether the email belongs to a real account.
  const response = NextResponse.json({ success: true }, { status: 200 })

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      return response
    }

    let email: string | null = null
    try {
      const body = (await request.json()) as { email?: unknown }
      email = typeof body?.email === "string" ? body.email.trim() : null
    } catch {
      email = null
    }

    if (!email) {
      return response
    }

    // Derive the origin from the request so redirectTo always exactly matches
    // the host the browser is on — prevents localhost vs 127.0.0.1 mismatches.
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ??
      request.headers.get("origin") ??
      (() => {
        const ref = request.headers.get("referer")
        if (ref) {
          try {
            return new URL(ref).origin
          } catch {
            // fall through
          }
        }
        return new URL(request.url).origin
      })()

    const redirectTo = `${origin}/auth/callback/reset-password`

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            response.cookies.set(name, value, SUPABASE_COOKIE_OPTIONS)
          })
          // Forward no-cache headers to prevent CDN/proxy caching of a
          // response that carries auth cookies.
          if (headers) {
            Object.entries(headers).forEach(([key, val]) => {
              response.headers.set(key, val)
            })
          }
        },
      },
    })

    // Intentionally NOT branching on the result: any error (including an
    // unknown email) is swallowed so the response is indistinguishable from
    // the success path. This is the user-enumeration fix.
    await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  } catch {
    // Intentionally swallowed — never leak failure details to the client.
  }

  return response
}
