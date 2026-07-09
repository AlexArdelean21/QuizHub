import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options"

/**
 * Password-reset callback.
 *
 * The reset-password email link brings the user here with `?code=<pkce>`.
 * We exchange the code for a session (setting Supabase's auth cookies on the
 * response), then redirect to /update-password where the user can type their
 * new password with an authenticated session already in place.
 *
 * Kept separate from `app/auth/callback/route.ts` on purpose:
 *   - signup/invite/generic callback has deferred org-creation + invite
 *     consumption logic that is irrelevant here.
 *   - the destination is always /update-password, not a caller-provided `next`,
 *     so we don't accept a next param and can't be redirected elsewhere by a
 *     tampered link.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL("/login?error=server-config", requestUrl.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing-code", requestUrl.origin))
  }

  let response = NextResponse.redirect(new URL("/update-password", requestUrl.origin))

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
        response = NextResponse.redirect(new URL("/update-password", requestUrl.origin))
        cookiesToSet.forEach(({ name, value }) => {
          response.cookies.set(name, value, SUPABASE_COOKIE_OPTIONS)
        })
        if (headers) {
          Object.entries(headers).forEach(([key, val]) => {
            response.headers.set(key, val)
          })
        }
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Send them back to login with an error param — do NOT try to be clever
    // and interpret specific error codes here. A generic "the link expired
    // or is invalid" experience is the safest UX for password reset.
    return NextResponse.redirect(
      new URL("/login?error=reset-link-invalid", requestUrl.origin)
    )
  }

  return response
}
