import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options"
import { consumeInviteToken } from "@/lib/auth/invite-token"
import { createOrgOnSignup } from "@/lib/signup/create-org"
import { PENDING_ORG_NUME_KEY, PENDING_ORG_TIER_KEY } from "@/lib/signup/types"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = requestUrl.searchParams.get("next") ?? "/"
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

  // Deferred organization creation (new-org signup): the org name + tier were
  // stored in user metadata at signUp and are consumed now that the email is
  // confirmed and an authenticated session exists.
  {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
    const rawNume = meta[PENDING_ORG_NUME_KEY]
    const rawTier = meta[PENDING_ORG_TIER_KEY]
    const pendingNume = typeof rawNume === "string" ? rawNume.trim() : ""
    const pendingTier =
      typeof rawTier === "number" ? rawTier : Number(rawTier)

    if (
      user?.id &&
      pendingNume &&
      Number.isInteger(pendingTier) &&
      pendingTier > 0
    ) {
      const result = await createOrgOnSignup(supabase, {
        userId: user.id,
        orgName: pendingNume,
        tierId: pendingTier,
      })

      // Clear the pending intent so it can never be re-applied on a later visit.
      await supabase.auth.updateUser({
        data: {
          [PENDING_ORG_NUME_KEY]: null,
          [PENDING_ORG_TIER_KEY]: null,
        },
      })

      // The admin dashboard lives at /admin (getAdminContext admits org_admin);
      // /dashboard/admin has only a layout and no index page, so it 404s.
      const target = result.success
        ? "/admin"
        : `/?org_error=${encodeURIComponent(result.error)}`

      const orgResponse = NextResponse.redirect(new URL(target, requestUrl.origin))
      response.cookies.getAll().forEach((cookie) => {
        orgResponse.cookies.set(cookie)
      })
      return orgResponse
    }
  }

  if (invite && typeof invite === "string") {
    const {
      data: { user },
    } = await supabase.auth.getUser()
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
