"use client"

import Link from "next/link"
import { ReactNode, useEffect, useState } from "react"
import { ReConsentModal } from "@/components/legal/ReConsentModal"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Home,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Sun,
  User,
  Users,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { AppRole } from "@/lib/auth/roles"
import { SwipeNavigator } from "@/components/swipe-navigator"

type Theme = "light" | "dark"

export type AdminSidebarProps = {
  email: string | null
  fullName: string | null
  role: AppRole
  orgName: string | null
  isSuperAdmin: boolean
  children: ReactNode
}

type NavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  exact?: boolean
  show: boolean
}

const NAV_TOOLTIP =
  "pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg lg:group-hover:block dark:bg-slate-50 dark:text-slate-900"

function roleLabel(role: AppRole): string {
  switch (role) {
    case "super_admin":
      return "Super Admin"
    case "org_admin":
      return "Organization Admin"
    default:
      return "User"
  }
}

type AdminBottomTab = {
  key: string
  label: string
  icon: typeof LayoutDashboard
  href?: string
  isBack?: boolean
  isMore?: boolean
}

// Overflow routes surfaced inside the "Mai mult" sheet. Kept in one place so the
// active-state check and the sheet links can't drift apart.
const MORE_ROUTES = ["/admin/join-requests"] as const

function AdminBottomTabBar({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname()
  const [hash, setHash] = useState("")
  const [bouncedKey, setBouncedKey] = useState<string | null>(null)
  const [dragDestination, setDragDestination] = useState<string | null>(null)
  const [barMounted, setBarMounted] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    setBarMounted(true)
  }, [])

  const handleTabTap = (key: string) => {
    setBouncedKey(key)
    setTimeout(() => setBouncedKey(null), 400)
  }

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    setHash(window.location.hash)
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  useEffect(() => {
    const onDragProgress = (event: Event) => {
      const ev = event as CustomEvent<{ destinationHref: string | null }>
      setDragDestination(ev.detail.destinationHref)
    }
    window.addEventListener("swipe-drag-progress", onDragProgress as EventListener)
    return () => window.removeEventListener("swipe-drag-progress", onDragProgress as EventListener)
  }, [])

  // Belt-and-suspenders: close the sheet on any route change, in case the item
  // onClick close races the navigation (mirrors global-header.tsx's drawer).
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  const isActive = (href: string) => {
    const [path, h] = href.split("#")
    if (h) return pathname === path && hash === `#${h}`
    if (href === "/admin") return pathname === "/admin" && !hash
    return pathname.startsWith(path)
  }

  const moreActive = MORE_ROUTES.some((route) => pathname.startsWith(route))

  const tabs: AdminBottomTab[] = [
    { key: "dashboard", href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { key: "statistici", href: "/dashboard/admin/elevi", label: "Statistici", icon: BarChart3 },
    ...(isSuperAdmin
      ? [
          {
            key: "organizatii",
            href: "/admin/global",
            label: "Organizații",
            icon: Building2,
          } satisfies AdminBottomTab,
        ]
      : []),
    { key: "more", label: "Mai mult", icon: MoreHorizontal, isMore: true },
    { key: "quiz", href: "/", label: "← Quiz", icon: Home, isBack: true },
  ]

  if (!barMounted) return null

  return createPortal(
    <>
      {moreOpen ? (
        <>
          <button
            type="button"
            aria-label="Închide meniul"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-[140] bg-black/40 backdrop-blur-sm md:hidden"
          />
          <div className="fixed inset-x-0 bottom-0 z-[150] rounded-t-2xl border-t border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl md:hidden animate-slide-up">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Mai mult
            </p>
            <div className="space-y-1 border-t border-border pt-2">
              <Link
                href="/admin/join-requests"
                onClick={() => setMoreOpen(false)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground transition hover:bg-muted"
              >
                <Users size={18} />
                Invitații și cereri
              </Link>
            </div>
          </div>
        </>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-[130] flex justify-center pb-[env(safe-area-inset-bottom)] md:hidden">
        <div
          className={cn(
            "mx-4 mb-2 flex w-full max-w-md items-center justify-around",
            "rounded-2xl border border-border/50 bg-card/75 px-2 py-1",
            "shadow-lg shadow-black/5 ring-1 ring-white/10 backdrop-blur-xl",
            "dark:bg-card/60 dark:shadow-black/20 dark:ring-white/5"
          )}
          style={{ height: "58px" }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon

            if (tab.isMore) {
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    handleTabTap(tab.key)
                    setMoreOpen((prev) => !prev)
                  }}
                  aria-expanded={moreOpen}
                  className={cn(
                    "flex flex-1 flex-col items-center justify-center gap-0.5",
                    "py-2 text-[10px] font-medium transition-colors",
                    moreActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon
                    size={22}
                    strokeWidth={moreActive ? 2.5 : 1.75}
                    className={cn(bouncedKey === tab.key && "tab-bounce")}
                  />
                  <span className="leading-none">{tab.label}</span>
                </button>
              )
            }

            const href = tab.href ?? "/"
            const active = isActive(href)
            const isDragPreview = dragDestination !== null && href === dragDestination
            const showActive = active || isDragPreview
            return (
              <Link
                key={tab.key}
                href={href}
                onClick={() => handleTabTap(tab.key)}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5",
                  "py-2 text-[10px] font-medium transition-colors",
                  tab.isBack
                    ? "text-muted-foreground/70 hover:text-foreground"
                    : showActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={showActive ? 2.5 : 1.75}
                  className={cn(bouncedKey === tab.key && "tab-bounce")}
                />
                <span className="leading-none">{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>,
    document.body
  )
}

export function AdminLayoutShell({
  email,
  fullName,
  role,
  orgName,
  isSuperAdmin,
  children,
}: AdminSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<Theme>("dark")

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem("theme")
    setTheme(saved === "light" ? "light" : "dark")
    const savedCollapsed = localStorage.getItem("admin.sidebar.collapsed")
    if (savedCollapsed === "1") setCollapsed(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("theme", theme)
  }, [mounted, theme])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem("admin.sidebar.collapsed", collapsed ? "1" : "0")
  }, [mounted, collapsed])

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false)
    }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [drawerOpen])

  const handleLogout = async () => {
    const supabase = getSupabaseBrowserClient()
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

  const items: NavItem[] = [
    {
      href: "/admin",
      label: "Dashboard",
      icon: LayoutDashboard,
      exact: true,
      show: true,
    },
    {
      href: "/dashboard/admin/elevi",
      label: "Statistici utilizatori",
      icon: BarChart3,
      show: role === "super_admin" || role === "org_admin",
    },
    {
      href: "/admin/join-requests",
      label: "Invitații și cereri",
      icon: Users,
      show: role === "super_admin" || role === "org_admin",
    },
    {
      href: "/admin/global",
      label: "Organizații",
      icon: Building2,
      show: isSuperAdmin,
    },
    {
      href: "/admin/tiers",
      label: "Tiers & Planuri",
      icon: Layers,
      show: isSuperAdmin,
    },
    {
      href: "/profile",
      label: "Profilul meu",
      icon: User,
      show: true,
    },
  ].filter((item) => item.show)

  const displayName = fullName?.trim() || email?.split("@")[0] || "Admin"
  const initials = displayName
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("")

  const isPathActive = (item: NavItem) => {
    const target = item.href.split("#")[0]
    if (!target) return false
    if (item.exact) return pathname === target
    return pathname === target || pathname.startsWith(`${target}/`)
  }

  const renderBackToQuizLink = (variant: "drawer" | "desktop") => {
    const isCollapsedDesktop = variant === "desktop" && collapsed
    return (
      <div className="mt-1 border-t border-white/10 pt-2">
        <Link
          href="/"
          onClick={() => setDrawerOpen(false)}
          className={cn(
            "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white",
            isCollapsedDesktop ? "justify-center px-2" : ""
          )}
        >
          <Home className="size-4 shrink-0" />
          <span className={cn(isCollapsedDesktop ? "sr-only" : "")}>Înapoi la Quiz</span>
          {isCollapsedDesktop ? <span className={NAV_TOOLTIP}>Înapoi la Quiz</span> : null}
        </Link>
      </div>
    )
  }

  const renderNavLink = (item: NavItem, variant: "drawer" | "desktop") => {
    const Icon = item.icon
    const active = isPathActive(item)
    const isCollapsedDesktop = variant === "desktop" && collapsed
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setDrawerOpen(false)}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          isCollapsedDesktop ? "justify-center px-2" : "",
          active
            ? "bg-white/15 text-white shadow-inner"
            : "text-blue-100/85 hover:bg-white/10 hover:text-white"
        )}
        aria-current={active ? "page" : undefined}
      >
        <Icon className="size-5 shrink-0" />
        <span
          className={cn(
            "truncate transition-opacity",
            isCollapsedDesktop ? "sr-only" : ""
          )}
        >
          {item.label}
        </span>
        {isCollapsedDesktop ? <span className={NAV_TOOLTIP}>{item.label}</span> : null}
      </Link>
    )
  }

  const renderHeader = (variant: "drawer" | "desktop") => {
    const isCollapsedDesktop = variant === "desktop" && collapsed
    return (
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-5",
          isCollapsedDesktop ? "justify-center px-2" : ""
        )}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-base font-semibold uppercase text-white shadow-sm">
          {initials || "QH"}
        </div>
        {!isCollapsedDesktop && (
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">QuizHub Admin</p>
            <p className="truncate text-xs text-blue-100/80">
              {orgName ?? (isSuperAdmin ? "Toate organizațiile" : "Fără organizație")}
            </p>
          </div>
        )}
      </div>
    )
  }

  const renderFooter = (variant: "drawer" | "desktop") => {
    const isCollapsedDesktop = variant === "desktop" && collapsed
    return (
      <div
        className={cn(
          "mt-auto border-t border-white/10 px-3 pb-5 pt-3",
          isCollapsedDesktop ? "px-2" : ""
        )}
      >
        <button
          type="button"
          onClick={toggleTheme}
          className={cn(
            "group relative mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-blue-100/85 transition-colors hover:bg-white/10 hover:text-white",
            isCollapsedDesktop ? "justify-center px-2" : ""
          )}
        >
          {mounted && theme === "dark" ? (
            <Sun className="size-5 shrink-0" />
          ) : (
            <Moon className="size-5 shrink-0" />
          )}
          <span className={cn("truncate", isCollapsedDesktop ? "sr-only" : "")}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </span>
          {isCollapsedDesktop ? (
            <span className={NAV_TOOLTIP}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-blue-100/85 transition-colors hover:bg-white/10 hover:text-white",
            isCollapsedDesktop ? "justify-center px-2" : ""
          )}
        >
          <LogOut className="size-5 shrink-0" />
          <span className={cn("truncate", isCollapsedDesktop ? "sr-only" : "")}>Logout</span>
          {isCollapsedDesktop ? <span className={NAV_TOOLTIP}>Logout</span> : null}
        </button>

        {!isCollapsedDesktop && (
          <div className="mt-4 rounded-xl bg-white/10 px-3 py-2 text-[11px] leading-tight text-blue-50">
            <p className="truncate font-medium">{displayName}</p>
            <p className="truncate text-blue-100/70">{email ?? ""}</p>
            <p className="mt-1 inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider">
              {roleLabel(role)}
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "min-h-screen bg-slate-50 transition-[padding] duration-300 ease-out dark:bg-slate-950",
        collapsed ? "lg:pl-20" : "lg:pl-64"
      )}
    >
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Deschide meniul"
          className="hidden size-10 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900 md:inline-flex"
        >
          <Menu className="size-5" />
        </button>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">QuizHub Admin</p>
        <div className="flex items-center gap-1">
          <Link
            href="/profile"
            aria-label="Profilul meu"
            className="inline-flex size-10 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <User className="size-5" />
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Schimbă tema"
            className="inline-flex size-10 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            {mounted && theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer backdrop — always rendered, opacity-toggled for smooth perf */}
      <button
        type="button"
        aria-label="Închide meniul"
        aria-hidden={!drawerOpen}
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => setDrawerOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/45 transition-opacity duration-200 ease-out lg:hidden",
          drawerOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
      />
      {/* Mobile drawer — always rendered, transform-toggled */}
      <aside
        aria-hidden={!drawerOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-gradient-to-b from-blue-700 via-blue-600 to-blue-700 text-white shadow-xl transition-transform ease-out lg:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ willChange: "transform", transitionDuration: "220ms" }}
      >
        <div className="flex items-center justify-between pr-3">
          {renderHeader("drawer")}
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Închide meniul"
            className="inline-flex size-9 items-center justify-center rounded-lg text-blue-100 transition hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 pt-2">
          {items.map((item) => renderNavLink(item, "drawer"))}
          {renderBackToQuizLink("drawer")}
        </nav>
        {renderFooter("drawer")}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col bg-gradient-to-b from-blue-700 via-blue-600 to-blue-700 text-white shadow-xl transition-[width] duration-300 ease-out lg:flex",
          collapsed ? "w-20" : "w-64"
        )}
      >
        {renderHeader("desktop")}
        <div className={cn("flex items-center justify-end px-3 pb-2", collapsed ? "justify-center" : "")}>
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "Extinde meniul" : "Restrânge meniul"}
            className="inline-flex size-8 items-center justify-center rounded-lg text-blue-100 transition hover:bg-white/10 hover:text-white"
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {items.map((item) => renderNavLink(item, "desktop"))}
          {renderBackToQuizLink("desktop")}
        </nav>
        {renderFooter("desktop")}
      </aside>

      <main className="min-h-screen pb-20 md:pb-0">
        <SwipeNavigator>{children}</SwipeNavigator>
      </main>
      <AdminBottomTabBar isSuperAdmin={isSuperAdmin} />
      <ReConsentModal />
    </div>
  )
}
