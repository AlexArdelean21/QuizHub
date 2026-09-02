"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { BarChart3, BookOpen, FileText, Home, LogOut, Menu, Moon, Sun, X } from "lucide-react"
import { usePathname } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { useTrackActivity } from "@/hooks/use-track-activity"
import { isAdminRole } from "@/lib/auth/roles"
import { useAppSidebar } from "@/components/sidebar-layout"
import { UserMenu } from "@/components/user-menu"
import { cn } from "@/lib/utils"

type Theme = "light" | "dark"

export function GlobalHeader() {
  useTrackActivity()
  const pathname = usePathname()
  const { sidebarOpen, setSidebarOpen, closeSidebar } = useAppSidebar()
  const [showExit, setShowExit] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [userEmail, setUserEmail] = useState("")
  const [userName, setUserName] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<Theme>("dark")
  const [storedExamId, setStoredExamId] = useState<number | null>(null)
  const isLoginRoute = pathname.startsWith("/login")
  const isJoinRoute = pathname.startsWith("/join")
  const isAdminRoute =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/dashboard/admin" ||
    pathname.startsWith("/dashboard/admin/")
  const isStatisticsRoute = pathname === "/dashboard/statistici" || pathname.startsWith("/dashboard/statistici/")
  const isMyExamsRoute = pathname === "/my-exams" || pathname.startsWith("/my-exams/")
  const canExitQuiz = showExit && pathname === "/"

  useEffect(() => {
    const resolveAdminRole = async () => {
      try {
        const supabase = getSupabaseBrowserClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          setIsAdmin(false)
          setUserEmail("")
          setUserName(null)
          return
        }
        setUserEmail(user.email ?? "")

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role, nume")
          .eq("id", user.id)
          .maybeSingle()

        if (error) {
          setIsAdmin(false)
          return
        }

        setIsAdmin(isAdminRole(profile?.role))
        setUserName(
          profile?.nume ? String(profile.nume) : null
        )
      } catch {
        setIsAdmin(false)
      }
    }

    void resolveAdminRole()
  }, [])

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem("theme")
    const initialTheme: Theme = savedTheme === "light" ? "light" : "dark"
    setTheme(initialTheme)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("theme", theme)
  }, [mounted, theme])

  useEffect(() => {
    const handleQuizActive = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>
      setShowExit(Boolean(customEvent.detail))
    }

    window.addEventListener("quiz-active-change", handleQuizActive as EventListener)
    return () => {
      window.removeEventListener("quiz-active-change", handleQuizActive as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSidebar()
      }
    }

    window.addEventListener("keydown", onEscape)
    return () => window.removeEventListener("keydown", onEscape)
  }, [sidebarOpen, closeSidebar])

  useEffect(() => {
    closeSidebar()
  }, [pathname, closeSidebar])

  useEffect(() => {
    const stored = window.localStorage.getItem("quiz.selectedExamId")
    const id = stored ? Number(stored) : null
    if (id && Number.isFinite(id) && id > 0) setStoredExamId(id)
  }, [])

  const handleLogout = async () => {
    const supabase = getSupabaseBrowserClient()
    closeSidebar()
    try {
      sessionStorage.removeItem("quizhub_org_banner_dismissed")
    } catch {
      // Storage can throw in private/blocked-cookie contexts — logout still proceeds.
    }
    await supabase.auth.signOut()
    window.location.href = "/"
  }

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }

  const handleRequestExit = () => {
    window.dispatchEvent(new CustomEvent("quiz-exit-request"))
  }

  const isHomepage = pathname === "/" && !userEmail
  const isDocsRoute = pathname === "/docs" || pathname.startsWith("/docs/")

  if (isLoginRoute || isAdminRoute || isHomepage || isDocsRoute || isJoinRoute) {
    return null
  }

  return (
    <>
      <header className="sticky top-0 z-30 w-full min-w-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* Grid keeps the brand centered in the visible header band (between
              menu and exit), not relative to the full viewport. */}
          <div className="grid h-16 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <div className="flex shrink-0 items-center justify-center md:w-10">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
                className="hidden md:inline-flex size-10 items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-white"
              >
                <Menu className="size-5" />
              </button>
            </div>

            <div className="flex min-w-0 justify-center px-1">
              <Link
                href="/"
                className="truncate bg-gradient-to-r from-primary via-sky-400 to-blue-500 bg-clip-text text-center text-3xl font-extrabold leading-none text-transparent sm:text-4xl"
              >
                QuizHub
              </Link>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-1">
              {canExitQuiz && (
                <button
                  type="button"
                  onClick={handleRequestExit}
                  aria-label="Exit quiz"
                  className="inline-flex size-10 items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-white"
                >
                  <X className="size-5" />
                </button>
              )}
              {userEmail && (
                <span className="hidden md:inline-flex">
                  <UserMenu name={userName} email={userEmail} />
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Backdrop — always rendered, opacity-toggled for smooth perf */}
      <button
        type="button"
        aria-label="Close sidebar backdrop"
        aria-hidden={!sidebarOpen}
        tabIndex={sidebarOpen ? 0 : -1}
        onClick={() => closeSidebar()}
        className={cn(
          "fixed inset-0 z-[125] bg-black/45 transition-opacity duration-200 ease-out",
          sidebarOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
      />

      {/* Drawer — always rendered, transform-toggled */}
      <aside
        aria-hidden={!sidebarOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-[130] flex w-[280px] flex-col",
          "border-r border-slate-200 bg-white shadow-xl",
          "transition-transform ease-out",
          "dark:border-slate-800 dark:bg-slate-950",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ willChange: "transform", transitionDuration: "220ms" }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <p className="max-w-[220px] truncate text-sm text-slate-600 dark:text-slate-300">{userEmail || "No active session"}</p>
          <button
            type="button"
            onClick={() => closeSidebar()}
            aria-label="Close sidebar"
            className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col px-3 py-4">
          <button
            type="button"
            onClick={toggleTheme}
            className="mb-2 flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            {mounted && theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>

          <nav className="mt-2 flex flex-col gap-1">
            <Link
              href="/docs"
              onClick={() => closeSidebar()}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <BookOpen className="size-4" />
              Documentație
            </Link>

            {userEmail && !isMyExamsRoute && (
              <Link
                href="/my-exams"
                onClick={() => closeSidebar()}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                <FileText className="size-4" />
                Bibliotecă
              </Link>
            )}

            {!isStatisticsRoute && (
              <Link
                href={storedExamId ? `/dashboard/statistici?examen=${storedExamId}` : "/dashboard/statistici"}
                onClick={() => closeSidebar()}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                <BarChart3 className="size-4" />
                Statistici
              </Link>
            )}

            {(isStatisticsRoute || isMyExamsRoute) && (
              <Link
                href="/"
                onClick={() => closeSidebar()}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                <Home className="size-4" />
                Înapoi la quiz
              </Link>
            )}

            {isAdmin && !isAdminRoute && (
              <Link
                href="/admin"
                onClick={() => closeSidebar()}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Admin Dashboard
              </Link>
            )}

            {isAdmin && isAdminRoute && (
              <Link
                href="/"
                onClick={() => closeSidebar()}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Inapoi la Quiz
              </Link>
            )}
          </nav>

          <div className="mt-auto border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <LogOut className="size-4" />
              Logout
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
