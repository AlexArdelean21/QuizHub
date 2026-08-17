import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options"
import { consumeInviteToken } from "@/lib/auth/invite-token"
import { recordSignupConsentServer } from "@/lib/legal/record-signup-consent-server"
import { PENDING_CONSENT_DOCS_KEY } from "@/lib/signup/types"

function sanitizeNext(next: string): string {
  // Only allow same-origin relative paths — reject absolute and
  // protocol-relative URLs to prevent open redirects.
  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/"
  }
  return next
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = sanitizeNext(requestUrl.searchParams.get("next") ?? "/")
  const invite = requestUrl.searchParams.get("invite")

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL("/login?error=server-config", requestUrl.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing-code", requestUrl.origin))
  }

  let response = NextResponse.redirect(new URL(next, requestUrl.origin))

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
        response = NextResponse.redirect(new URL(next, requestUrl.origin))
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
    // Double-click / prefetch resilience: a prior request may already have
    // exchanged this code and set a session cookie. If so, treat as success.
    const {
      data: { user: existingUser },
    } = await supabase.auth.getUser()
    if (existingUser) {
      console.log(
        "[auth/callback] exchangeCodeForSession failed but valid session present — redirecting to next",
        { next, invite: Boolean(invite) }
      )
      return NextResponse.redirect(new URL(next, requestUrl.origin))
    }
    console.log(
      "[auth/callback] exchangeCodeForSession failed with no session — auth-code-error",
      { message: error.message }
    )
    return NextResponse.redirect(
      new URL("/login?error=auth-code-error", requestUrl.origin)
    )
  }

  console.log("[auth/callback] exchangeCodeForSession succeeded")

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>

  // Pending consent docs from signUp metadata — written once the session exists.
  if (user?.id) {
    const rawConsentDocs = meta[PENDING_CONSENT_DOCS_KEY]
    const consentDocs = Array.isArray(rawConsentDocs)
      ? rawConsentDocs.filter(
          (d): d is "termeni" | "confidentialitate" =>
            d === "termeni" || d === "confidentialitate"
        )
      : []
    if (consentDocs.length > 0) {
      await recordSignupConsentServer(user.id, consentDocs)
      await supabase.auth.updateUser({ data: { [PENDING_CONSENT_DOCS_KEY]: null } })
    }
  }

  if (invite && typeof invite === "string") {
    console.log("[auth/callback] invite flow started", {
      hasUser: Boolean(user?.id),
      tokenLength: invite.length,
    })
    if (user?.id) {
      const result = await consumeInviteToken(invite, user.id)
      if (!result.ok) {
        console.error("[auth/callback] consumeInviteToken failed", { reason: result.reason })
      } else {
        console.log("[auth/callback] consumeInviteToken success", {
          org_id: result.org_id,
          already_in_org: result.already_in_org,
        })
      }
    } else {
      console.error("[auth/callback] no user after exchangeCodeForSession")
    }
    // Carry over the session cookies that exchangeCodeForSession set on
    // `response` so the user stays authenticated after the redirect.
    const inviteResponse = NextResponse.redirect(new URL("/", requestUrl.origin))
    response.cookies.getAll().forEach((cookie) => {
      inviteResponse.cookies.set(cookie)
    })
    return inviteResponse
  }

  return response
}
