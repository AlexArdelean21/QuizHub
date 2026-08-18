"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"

async function getRequestOrigin(): Promise<string> {
  const headerList = await headers()
  const origin = headerList.get("origin")
  if (origin) return origin

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host")
  const proto = headerList.get("x-forwarded-proto") ?? "https"
  if (!host) {
    throw new Error("Nu s-a putut determina originea cererii.")
  }
  return `${proto}://${host}`
}

/**
 * Starts the Google OAuth flow. Always redirects (to Google, or throws) —
 * never returns to the caller.
 */
export async function signInWithGoogle(): Promise<never> {
  const origin = await getRequestOrigin()
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    console.error("[signInWithGoogle]", error.message)
    throw new Error(error.message)
  }
  if (!data.url) {
    console.error("[signInWithGoogle] missing OAuth URL")
    throw new Error("Nu s-a putut porni autentificarea cu Google.")
  }

  redirect(data.url)
}
