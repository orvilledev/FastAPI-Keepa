import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import MaintenanceScheduleBanner from './MaintenanceScheduleBanner'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

const SIDEBAR_COLLAPSED_KEY = 'msw-sidebar-collapsed'

export default function Layout() {
  // Mobile-only: controls the off-canvas navigation drawer.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const location = useLocation()

  const closeMobileNav = () => setMobileNavOpen(false)

  // Close the drawer whenever the route changes (e.g. after tapping a link).
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, location.search])

  // Allow Escape to dismiss the drawer, and lock body scroll while it's open.
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [mobileNavOpen])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // Ignore storage failures; the toggle still works for this session.
    }
  }, [sidebarCollapsed])

  return (
    <div className="flex h-app-screen min-h-0 flex-col overflow-hidden app-shell-bg">
      <MaintenanceScheduleBanner />
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* Backdrop for the mobile drawer — never rendered/visible on lg+. */}
      <div
        aria-hidden="true"
        onClick={closeMobileNav}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <Sidebar
        mobileOpen={mobileNavOpen}
        onNavigate={closeMobileNav}
        collapsed={sidebarCollapsed}
      />
      <button
        type="button"
        onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        aria-expanded={!sidebarCollapsed}
        className={`absolute top-1/2 z-30 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-md transition-[left] duration-300 hover:bg-gray-50 hover:text-[#404040] dark:border-border dark:bg-surface dark:text-slate-200 dark:hover:bg-surface-hover lg:flex ${
          sidebarCollapsed ? 'left-1' : 'left-[14.25rem]'
        }`}
      >
        {sidebarCollapsed ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        )}
      </button>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Navbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-2 sm:px-6 sm:pt-6 sm:pb-3 lg:px-8 lg:pt-8 lg:pb-4">
            <Outlet />
          </div>
        </main>
      </div>
      </div>
    </div>
  )
}
