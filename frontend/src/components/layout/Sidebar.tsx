import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect, type MouseEvent } from 'react'
import { useUser } from '../../contexts/UserContext'
import { APP_NAME } from '../../constants/app'
import AppLogo from '../common/AppLogo'
import { isUserHiddenFromFeedbackPage } from '../../constants/feedbackAccess'
import { canAccessWebAnalytics } from '../../lib/devFeatures'
import { canAccessPlayground } from '../../lib/playground/access'

// SVG Icon components that inherit text color via currentColor
const Icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  package: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  barcode: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
    </svg>
  ),
  dollar: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  biking: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="17.5" cy="5" r="1.75" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 6.5L12 10l-1.5 7" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10l-4 1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 17l2 2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 10.5h4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12l2.5 6M12 10l4.5 8" />
      <circle cx="7" cy="18" r="2.25" strokeWidth={2} />
      <circle cx="17" cy="18" r="2.25" strokeWidth={2} />
    </svg>
  ),
  user: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  toolbox: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  wrench: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  mail: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 8h18a2 2 0 002-2V8a2 2 0 00-2-2H3a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  ),
  feedback: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.018c8.836 0 16 8.058 16 9.036v7.964a1 1 0 01-1.618.794L17 21" />
    </svg>
  ),
  scanner: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7V5a1 1 0 011-1h2m10 0h2a1 1 0 011 1v2M4 17v2a1 1 0 001 1h2m10 0h2a1 1 0 001-1v-2M7 8v8m3-8v8m3-8v8m3-8v8" />
    </svg>
  ),
  trackingExtractor: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  fnskuLabels: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  manifestGenerator: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M9 8h1m5 0h.01M7 3h8l4 4v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  ),
  download: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  ),
  chart: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  playground: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
}

interface SidebarProps {
  /** Mobile-only: whether the off-canvas drawer is open. Ignored on lg+ where the sidebar is always static. */
  mobileOpen?: boolean
  /** Mobile-only: called when a navigation link is tapped so the drawer can close. */
  onNavigate?: () => void
}

export default function Sidebar({ mobileOpen = false, onNavigate }: SidebarProps = {}) {
  const location = useLocation()
  const { hasKeepaAccess, isWarehouseOnly, isSuperadmin, userInfo, authUser, userInfoLoading } = useUser()
  const isElectron = Boolean(window.desktop?.isElectron)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  /** Only one sidebar row shows "highlight" while hovering; route highlight defers to hover target. */
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)

  const isActive = (path: string) => {
    const currentPath = location.pathname
    const currentSearch = location.search || ''

    if (path.includes('?')) {
      const [pathname, query] = path.split('?', 2)
      if (currentPath !== pathname) return false
      const want = new URLSearchParams(query)
      const have = new URLSearchParams(currentSearch)
      for (const key of want.keys()) {
        if (want.get(key) !== have.get(key)) return false
      }
      return true
    }

    if (currentPath === path) return true

    // /jobs matches /jobs/123, /jobs/new, etc.
    const parentRoutes = ['/jobs']
    if (parentRoutes.includes(path)) {
      return currentPath.startsWith(path + '/')
    }

    // /daily-run matches any /daily-run/xxx vendor page
    if (path === '/daily-run') {
      return currentPath.startsWith('/daily-run/')
    }

    // /manage-upcs or /upcs hub highlights when on any /upcs?category=xxx page
    if (path === '/manage-upcs') {
      return currentPath === '/upcs' || currentPath === '/manage-upcs'
    }

    return false
  }

  const navHighlighted = (id: string, routeActive: boolean) =>
    (hoveredNav === null && routeActive) || hoveredNav === id

  const keepaMenuItems = [
    { path: '/jobs',         label: 'Express Jobs', icon: 'package'  as const },
    { path: '/daily-run',    label: 'Daily Runs',   icon: 'biking'   as const },
    { path: '/keepa-import-export', label: 'Keepa Import File', icon: 'download' as const },
    { path: '/manage-upcs', label: 'Manage UPCs',  icon: 'barcode'  as const },
    { path: '/map',          label: 'Manage MAP',   icon: 'dollar'   as const },
    { path: '/seller-list',  label: 'Seller List',  icon: 'users'    as const },
    { path: '/email-list',   label: 'Email List',   icon: 'mail'     as const },
    ...(canAccessWebAnalytics(userInfo?.email || authUser?.email)
      ? [{ path: '/analytics', label: 'Analytics', icon: 'chart' as const }]
      : []),
  ]

  /** Blocklist hides nav item entirely once user profile / session is resolved. */
  const showFeedbackNav =
    authUser !== null &&
    !userInfoLoading &&
    !isUserHiddenFromFeedbackPage(
      userInfo?.display_name,
      userInfo?.email,
      authUser?.email,
    )

  useEffect(() => {
    if (!isElectron || !window.desktop?.getVersion) return
    window.desktop
      .getVersion()
      .then((version) => setDesktopVersion(version))
      .catch(() => setDesktopVersion(null))
  }, [isElectron])

  const handleCheckUpdates = async () => {
    if (!window.desktop?.checkForUpdates) return
    setIsCheckingUpdates(true)
    setUpdateMessage('')
    try {
      const result = await window.desktop.checkForUpdates()
      setUpdateMessage(result.message)
    } catch {
      setUpdateMessage('Failed to check for updates.')
    } finally {
      setIsCheckingUpdates(false)
    }
  }

  // Event-delegated close: on mobile, tapping any nav link closes the drawer.
  // Harmless on desktop where `onNavigate` is not provided.
  const handleNavClick = (event: MouseEvent<HTMLElement>) => {
    if (!onNavigate) return
    if ((event.target as HTMLElement).closest('a')) {
      onNavigate()
    }
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-app-screen w-60 shrink-0 flex-col border-r border-gray-200/80 bg-white/80 shadow-lg backdrop-blur-lg transition-transform duration-300 ease-in-out dark:border-border/80 dark:bg-surface/90 lg:static lg:z-auto lg:translate-x-0 lg:shadow-lg lg:transition-none ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex h-20 shrink-0 items-center px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AppLogo alt="MSW Overwatch" className="h-11 w-11 shrink-0" />
          <h2 className="min-w-0 truncate text-lg font-bold tracking-tight text-[#404040] dark:text-slate-100">
            {APP_NAME}
          </h2>
        </div>
        {/* Close button — mobile drawer only. */}
        <button
          type="button"
          onClick={onNavigate}
          aria-label="Close menu"
          className="ml-2 shrink-0 rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-content-secondary dark:hover:bg-surface-hover lg:hidden"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <nav
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3"
        onMouseLeave={() => setHoveredNav(null)}
        onClick={handleNavClick}
      >
        {isWarehouseOnly ? (
          <>
            <div className="shrink-0 space-y-0.5">
              <Link
                to="/label-station"
                onMouseEnter={() => setHoveredNav('label-station')}
                className={`sidebar-link ${
                  navHighlighted('label-station', isActive('/label-station'))
                    ? 'sidebar-link-active'
                    : 'sidebar-link-inactive'
                }`}
              >
                <span className="shrink-0">{Icons.barcode}</span>
                <span className="sidebar-link-label">Label Station</span>
              </Link>
            </div>

            <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

            <div className="shrink-0 space-y-0.5 pb-1 pt-1">
              <p className="sidebar-section-label">GENERAL</p>
              <Link
                to="/about"
                onMouseEnter={() => setHoveredNav('about')}
                className={`sidebar-link ${
                  navHighlighted('about', isActive('/about'))
                    ? 'sidebar-link-active'
                    : 'sidebar-link-inactive'
                }`}
              >
                <span className="shrink-0">{Icons.info}</span>
                <span className="sidebar-link-label">About</span>
              </Link>

              <Link
                to="/faq"
                onMouseEnter={() => setHoveredNav('faq')}
                className={`sidebar-link ${
                  navHighlighted('faq', isActive('/faq'))
                    ? 'sidebar-link-active'
                    : 'sidebar-link-inactive'
                }`}
              >
                <span className="shrink-0">{Icons.wrench}</span>
                <span className="sidebar-link-label">FAQ</span>
              </Link>

              {showFeedbackNav && (
                <Link
                  to="/feedback"
                  onMouseEnter={() => setHoveredNav('feedback')}
                  className={`sidebar-link ${
                    navHighlighted('feedback', isActive('/feedback'))
                      ? 'sidebar-link-active'
                      : 'sidebar-link-inactive'
                  }`}
                >
                  <span className="shrink-0">{Icons.feedback}</span>
                  <span className="sidebar-link-label">Feedback From Users</span>
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
        {/* MENU: Dashboard + Keepa */}
        <div className="shrink-0">
          <p className="sidebar-section-label">MENU</p>
          <div className="space-y-0.5">
            <Link
              to="/dashboard"
              onMouseEnter={() => setHoveredNav('dashboard')}
              className={`sidebar-link ${
                navHighlighted('dashboard', isActive('/dashboard'))
                  ? 'sidebar-link-active'
                  : 'sidebar-link-inactive'
              }`}
            >
              <span className="shrink-0">{Icons.dashboard}</span>
              <span className="sidebar-link-label">Dashboard</span>
            </Link>

            {hasKeepaAccess && keepaMenuItems.map((item) => {
              const linkId =
                item.path === '/jobs'         ? 'jobs'        :
                item.path === '/manage-upcs'  ? 'manage-upcs' :
                item.path === '/map'          ? 'map'         :
                item.path === '/seller-list'  ? 'seller-list' :
                item.path === '/email-list'   ? 'email-list'  :
                item.path === '/daily-run'    ? 'daily-runs'  :
                item.path === '/keepa-import-export' ? 'keepa-import-export' :
                item.path === '/analytics'    ? 'analytics'   :
                'keepa-other'

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onMouseEnter={() => setHoveredNav(linkId)}
                  className={`sidebar-link ${
                    navHighlighted(linkId, isActive(item.path))
                      ? 'sidebar-link-active'
                      : 'sidebar-link-inactive'
                  }`}
                >
                  <span className="shrink-0">{Icons[item.icon]}</span>
                  <span className="sidebar-link-label">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

        {/* TOOLS */}
        <div className="shrink-0 space-y-0.5 pb-1 pt-1">
          <p className="sidebar-section-label">TOOLS</p>
            <Link
              to="/micro-tools"
              onMouseEnter={() => setHoveredNav('micro-tools')}
              className={`sidebar-link ${
                navHighlighted('micro-tools', isActive('/micro-tools'))
                  ? 'sidebar-link-active'
                  : 'sidebar-link-inactive'
              }`}
            >
              <span className="shrink-0">{Icons.toolbox}</span>
              <span className="sidebar-link-label">Micro Tools</span>
            </Link>

            <Link
              to="/tracking-scanner"
              onMouseEnter={() => setHoveredNav('tracking-scanner')}
              className={`sidebar-link ${
                navHighlighted('tracking-scanner', isActive('/tracking-scanner'))
                  ? 'sidebar-link-active'
                  : 'sidebar-link-inactive'
              }`}
            >
              <span className="shrink-0">{Icons.trackingExtractor}</span>
              <span className="sidebar-link-label">Tracking Extractor</span>
            </Link>

            <Link
              to="/fnsku-labels"
              onMouseEnter={() => setHoveredNav('fnsku-labels')}
              className={`sidebar-link ${
                navHighlighted('fnsku-labels', isActive('/fnsku-labels'))
                  ? 'sidebar-link-active'
                  : 'sidebar-link-inactive'
              }`}
            >
              <span className="shrink-0">{Icons.fnskuLabels}</span>
              <span className="sidebar-link-label">FNSKU Labels</span>
            </Link>

            <Link
              to="/manifest-generator"
              onMouseEnter={() => setHoveredNav('manifest-generator')}
              className={`sidebar-link ${
                navHighlighted('manifest-generator', isActive('/manifest-generator'))
                  ? 'sidebar-link-active'
                  : 'sidebar-link-inactive'
              }`}
            >
              <span className="shrink-0">{Icons.manifestGenerator}</span>
              <span className="sidebar-link-label">Manifest Generator</span>
            </Link>

            {hasKeepaAccess && (
              <Link
                to="/label-station"
                onMouseEnter={() => setHoveredNav('label-station')}
                className={`sidebar-link ${
                  navHighlighted('label-station', isActive('/label-station'))
                    ? 'sidebar-link-active'
                    : 'sidebar-link-inactive'
                }`}
              >
                <span className="shrink-0">{Icons.scanner}</span>
                <span className="sidebar-link-label">Label Station</span>
              </Link>
            )}
        </div>

        {canAccessPlayground(userInfo?.email || authUser?.email, isSuperadmin) && (
          <>
            <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

            <div className="shrink-0 space-y-0.5 pb-1 pt-1">
              <p className="sidebar-section-label">TESTING</p>
              <Link
                to="/playground"
                onMouseEnter={() => setHoveredNav('playground')}
                className={`sidebar-link ${
                  navHighlighted('playground', isActive('/playground'))
                    ? 'sidebar-link-active'
                    : 'sidebar-link-inactive'
                }`}
              >
                <span className="shrink-0">{Icons.playground}</span>
                <span className="sidebar-link-label">Playground</span>
              </Link>
            </div>
          </>
        )}

        <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

        {/* GENERAL */}
        <div className="shrink-0 space-y-0.5 pb-1 pt-1">
          <p className="sidebar-section-label">GENERAL</p>
          <Link
            to="/about"
            onMouseEnter={() => setHoveredNav('about')}
            className={`sidebar-link ${
              navHighlighted('about', isActive('/about'))
                ? 'sidebar-link-active'
                : 'sidebar-link-inactive'
            }`}
          >
            <span className="shrink-0">{Icons.info}</span>
            <span className="sidebar-link-label">About</span>
          </Link>

          <Link
            to="/faq"
            onMouseEnter={() => setHoveredNav('faq')}
            className={`sidebar-link ${
              navHighlighted('faq', isActive('/faq'))
                ? 'sidebar-link-active'
                : 'sidebar-link-inactive'
            }`}
          >
            <span className="shrink-0">{Icons.wrench}</span>
            <span className="sidebar-link-label">FAQ</span>
          </Link>

          {showFeedbackNav && (
            <Link
              to="/feedback"
              onMouseEnter={() => setHoveredNav('feedback')}
              className={`sidebar-link ${
                navHighlighted('feedback', isActive('/feedback'))
                  ? 'sidebar-link-active'
                  : 'sidebar-link-inactive'
              }`}
            >
              <span className="shrink-0">{Icons.feedback}</span>
              <span className="sidebar-link-label">Feedback From Users</span>
            </Link>
          )}

          {isSuperadmin && (
            <Link
              to="/admin/users"
              onMouseEnter={() => setHoveredNav('admin-users')}
              className={`sidebar-link ${
                navHighlighted('admin-users', isActive('/admin/users'))
                  ? 'sidebar-link-active'
                  : 'sidebar-link-inactive'
              }`}
            >
              <span className="shrink-0">{Icons.users}</span>
              <span className="sidebar-link-label">User Management</span>
            </Link>
          )}
        </div>
          </>
        )}
      </nav>
      {isElectron && (
        <div className="mx-4 mb-4 mt-3 shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-border dark:bg-surface-muted">
          <p className="text-xs font-semibold text-gray-700 dark:text-content-secondary">Desktop</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-content-muted">
            Version: <span className="font-mono text-[11px]">{desktopVersion ?? 'loading...'}</span>
          </p>
          <button
            type="button"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates}
            className="mt-2 w-full rounded-md bg-[#F97316] px-2 py-1.5 text-xs font-medium text-white hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCheckingUpdates ? 'Checking...' : 'Check for Updates'}
          </button>
          {updateMessage && <p className="mt-2 text-[11px] text-gray-600 dark:text-content-muted">{updateMessage}</p>}
        </div>
      )}
    </aside>
  )
}
