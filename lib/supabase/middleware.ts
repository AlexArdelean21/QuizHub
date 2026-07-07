import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import {
  getSupabaseCookieOptions,
  REMEMBER_COOKIE_NAME,
  SUPABASE_COOKIE_BASE,
} from "@/lib/supabase/cookie-options"

const PUBLIC_PATHS = ["/login", "/signup", "/auth/callback", "/api/auth", "/api/webhooks", "/join", "/docs", "/legal"]

// Routes an unauthenticated visitor is allowed to view. Unlike PUBLIC_PATHS,
// these still go through the Supabase client so a logged-in user's session is
// refreshed (the homepage renders the quiz for authenticated users and the
// marketing page for guests).
const PUBLIC_UNAUTH_ROUTES = ["/", "/docs"]

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const remember = request.cookies.get(REMEMBER_COOKIE_NAME)?.value === "1"
  const authCookieOptions = getSupabaseCookieOptions(remember)
  const isPublic = PUBLIC_PATHS.some(
    (publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  )

  // Pass public routes through without creating a Supabase client.
  // This is essential for /auth/callback: calling getUser() here would trigger
  // applyServerStorage, which could overwrite the PKCE code-verifier cookie
  // in request.cookies before the route handler gets to read it.
  if (isPublic) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SUPABASE_COOKIE_BASE,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value }) => {
          response.cookies.set(name, value, authCookieOptions)
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const isPublicRoute = PUBLIC_UNAUTH_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`)
    )

    if (!isPublicRoute) {
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      url.searchParams.set("next", pathname)
      return NextResponse.redirect(url)
    }
  }

  if (pathname === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return response
}
