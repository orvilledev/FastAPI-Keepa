import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function Layout() {
  // Mobile-only: controls the off-canvas navigation drawer. On desktop
  // (lg+) the sidebar is always statically visible and this state is unused,
  // so the desktop / Electron experience is unchanged.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
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

  return (
    <div className="flex h-app-screen min-h-0 overflow-hidden app-shell-bg">
      {/* Backdrop for the mobile drawer — never rendered/visible on lg+. */}
      <div
        aria-hidden="true"
        onClick={closeMobileNav}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <Sidebar mobileOpen={mobileNavOpen} onNavigate={closeMobileNav} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Navbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-2 sm:px-6 sm:pt-6 sm:pb-3 lg:px-8 lg:pt-8 lg:pb-4">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
