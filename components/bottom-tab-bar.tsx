"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { BarChart3, BookOpen, FileText, Home, LogOut, Moon, Shield, Sun, User } from "lucide-react"
import { usePathname } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { isAdminRole } from "@/lib/auth/roles"
import { cn } from "@/lib/utils"

type Theme = "light" | "dark"

type Tab = {
  key: string
  label: string
  icon: React.ElementType
  href?: string
  onClick?: () => void
}

export function BottomTabBar() {
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)
  const [userEmail, setUserEmail] = useState("")
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<Theme>("dark")
  const [quizActive, setQuizActive] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [bouncedKey, setBouncedKey] = useState<string | null>(null)
  const [dragDestination, setDragDestination] = useState<string | null>(null)

  const handleTabTap = (key: string) => {
    setBouncedKey(key)
    setTimeout(() => setBouncedKey(null), 400)
  }

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
          return
        }
        setUserEmail(user.email ?? "")

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle()

        if (error) {
          setIsAdmin(false)
          return
        }

        setIsAdmin(isAdminRole(profile?.role))
      } catch {
        setIsAdmin(false)
      }
    }

    void resolveAdminRole()
  }, [])

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem("theme")
    setTheme(savedTheme === "light" ? "light" : "dark")
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("theme", theme)
  }, [mounted, theme])

  useEffect(() => {
    const handleQuizActive = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>
      setQuizActive(Boolean(customEvent.detail))
    }
    window.addEventListener("quiz-active-change", handleQuizActive as EventListener)
    return () => window.removeEventListener("quiz-active-change", handleQuizActive as EventListener)
  }, [])

  useEffect(() => {
    const onOpenProfile = () => setProfileOpen(true)
    window.addEventListener("open-profile-sheet", onOpenProfile)
    return () => window.removeEventListener("open-profile-sheet", onOpenProfile)
  }, [])

  useEffect(() => {
    const onDragProgress = (event: Event) => {
      const ev = event as CustomEvent<{ destinationHref: string | null }>
      setDragDestination(ev.detail.destinationHref)
    }
    window.addEventListener("swipe-drag-progress", onDragProgress as EventListener)
    return () => window.removeEventListener("swipe-drag-progress", onDragProgress as EventListener)
  }, [])

  const closeProfile = () => setProfileOpen(false)

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }

  const handleLogout = async () => {
    closeProfile()
    const supabase = getSupabaseBrowserClient()
    try {
      sessionStorage.removeItem("quizhub_org_banner_dismissed")
    } catch {
      // Storage can throw in private/blocked-cookie contexts — logout still proceeds.
    }
    await supabase.auth.signOut()
    window.location.href = "/"
  }

  const isHidden =
    (pathname === "/" && !userEmail) ||
    pathname.startsWith("/login") ||
    pathname === "/docs" ||
    pathname.startsWith("/docs/") ||
    pathname.startsWith("/join") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/dashboard/admin" ||
    pathname.startsWith("/dashboard/admin/") ||
    pathname.startsWith("/update-password") ||
    quizActive

  if (isHidden) return null

  const tabs: Tab[] = [
    { key: "quiz", label: "Quiz", icon: Home, href: "/" },
    { key: "statistici", label: "Statistici", icon: BarChart3, href: "/dashboard/statistici" },
    ...(isAdmin ? [{ key: "admin", label: "Admin", icon: Shield, href: "/admin" }] : []),
    { key: "profil", label: "Cont", icon: User, onClick: () => setProfileOpen(true) },
  ]

  const isTabActive = (key: string) => {
    if (key === "quiz") return pathname === "/"
    if (key === "statistici") return pathname === "/dashboard/statistici" || pathname.startsWith("/dashboard/statistici/")
    if (key === "admin") return pathname === "/admin" || pathname.startsWith("/admin/")
    return false
  }

  return (
    <>
      {profileOpen && (
        <>
          <button
            type="button"
            aria-label="Close profile sheet"
            onClick={closeProfile}
            className="fixed inset-0 z-[140] bg-black/40 backdrop-blur-sm md:hidden"
          />
          <div className="fixed inset-x-0 bottom-0 z-[150] rounded-t-2xl border-t border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl md:hidden animate-slide-up">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
            <p className="text-sm font-medium text-foreground">{userEmail || "—"}</p>
            <div className="mt-4 space-y-1">
              <Link
                href="/profile"
                onClick={closeProfile}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground transition hover:bg-muted"
              >
                <User size={18} />
                Profilul meu
              </Link>
              <Link
                href="/my-exams"
                onClick={closeProfile}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground transition hover:bg-muted"
              >
                <FileText size={18} />
                Examenele mele
              </Link>
              <button
                type="button"
                onClick={toggleTheme}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground transition hover:bg-muted"
              >
                {mounted && theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <Link
                href="/docs"
                onClick={closeProfile}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground transition hover:bg-muted"
              >
                <BookOpen className="size-[18px]" />
                Documentație
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <LogOut size={18} />
                Deconectare
              </button>
            </div>
          </div>
        </>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-[130] flex justify-center pb-[env(safe-area-inset-bottom)] md:hidden">
        <div
          className="mx-4 mb-2 flex w-full max-w-md items-center justify-around rounded-2xl border border-border/50 bg-card/75 px-2 py-1 shadow-lg shadow-black/5 ring-1 ring-white/10 backdrop-blur-xl dark:bg-card/60 dark:shadow-black/20 dark:ring-white/5"
          style={{ height: "58px" }}
        >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = isTabActive(tab.key)

          if (tab.href) {
            const isDragPreview =
              dragDestination !== null &&
              (
                tab.href === dragDestination ||
                (tab.key === "profil" && dragDestination === "__profile__")
              )
            const showActive = active || isDragPreview
            return (
              <Link
                key={tab.key}
                href={tab.href}
                onClick={() => handleTabTap(tab.key)}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  showActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={showActive ? 2.5 : 1.75}
                  className={cn(bouncedKey === tab.key && "tab-bounce")}
                />
                <span>{tab.label}</span>
              </Link>
            )
          }

          const isDragPreview = dragDestination === "__profile__"
          const showActive = active || isDragPreview

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                handleTabTap(tab.key)
                tab.onClick?.()
              }}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                showActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon
                size={22}
                strokeWidth={showActive ? 2.5 : 1.75}
                className={cn(bouncedKey === tab.key && "tab-bounce")}
              />
              <span>{tab.label}</span>
            </button>
          )
        })}
        </div>
      </nav>
    </>
  )
}
