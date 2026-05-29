import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useUser } from '../../contexts/UserContext'
import { APP_ICON_URL, APP_NAME, APP_VERSION_LABEL } from '../../constants/app'
import { isUserHiddenFromFeedbackPage } from '../../constants/feedbackAccess'

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
  refresh: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
  chevronRight: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
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
  fnskuLabels: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
}

export default function Sidebar() {
  const location = useLocation()
  const { hasKeepaAccess, isSuperadmin, userInfo, authUser, userInfoLoading } = useUser()
  const isElectron = Boolean(window.desktop?.isElectron)
  const [isDailyRunsMenuOpen, setIsDailyRunsMenuOpen] = useState(false)
  const [isManageUPCsMenuOpen, setIsManageUPCsMenuOpen] = useState(false)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  /** Only one sidebar row shows “highlight” while hovering; route highlight defers to hover target. */
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)

  const dailyRunsButtonRef = useRef<HTMLButtonElement>(null)
  const manageUPCsButtonRef = useRef<HTMLButtonElement>(null)
  const dailyRunsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const manageUPCsTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

    // Exact match - always check this first
    if (currentPath === path) return true
    
    // For parent routes that can have children (e.g., /jobs should match /jobs/123)
    // But NOT for sibling routes at the same level
    // Check if this path is a parent route that should match children
    const parentRoutes = ['/jobs'] // Routes that can have nested children
    
    if (parentRoutes.includes(path)) {
      // Allow matching child routes (e.g., /jobs/123 matches /jobs)
      return currentPath.startsWith(path + '/')
    }
    
    // For all other routes (specific menu items like /dashboard, /upcs, etc.), only exact match
    // This ensures Dashboard is only active when on /dashboard, not on other pages
    return false
  }

  const navHighlighted = (id: string, routeActive: boolean) =>
    (hoveredNav === null && routeActive) || hoveredNav === id

  // Daily Runs no longer has an API/Upload split — each vendor's page hosts
  // both modes via a toggle. The flyout lists vendors directly.
  const dailyRunsMenuItems = [
    { path: '/daily-run/dnk', label: 'DNK', icon: 'refresh' as const },
    { path: '/daily-run/clk', label: 'CLK', icon: 'refresh' as const },
    { path: '/daily-run/obz', label: 'OBZ', icon: 'refresh' as const },
    { path: '/daily-run/ref', label: 'REF', icon: 'refresh' as const },
    { path: '/daily-run/bor', label: 'BOR', icon: 'refresh' as const },
    { path: '/daily-run/sff', label: 'SFF', icon: 'refresh' as const },
    { path: '/daily-run/tev', label: 'TEV', icon: 'refresh' as const },
    { path: '/daily-run/cha', label: 'CHA', icon: 'refresh' as const },
  ]

  const manageUPCsMenuItems = [
    { path: '/upcs?category=dnk', label: 'DNK', icon: 'barcode' as const },
    { path: '/upcs?category=clk', label: 'CLK', icon: 'barcode' as const },
    { path: '/upcs?category=obz', label: 'OBZ', icon: 'barcode' as const },
    { path: '/upcs?category=ref', label: 'REF', icon: 'barcode' as const },
    { path: '/upcs?category=bor', label: 'BOR', icon: 'barcode' as const },
    { path: '/upcs?category=sff', label: 'SFF', icon: 'barcode' as const },
    { path: '/upcs?category=tev', label: 'TEV', icon: 'barcode' as const },
    { path: '/upcs?category=cha', label: 'CHA', icon: 'barcode' as const },
  ]

  const keepaMenuItems = [
    { path: '/jobs', label: 'Express Jobs', icon: 'package' as const },
    {
      label: 'Manage UPCs',
      icon: 'barcode' as const,
      children: manageUPCsMenuItems
    },
    { path: '/map', label: 'Manage MAP', icon: 'dollar' as const },
    { path: '/seller-list', label: 'Seller List', icon: 'users' as const },
    { path: '/email-list', label: 'Email List', icon: 'mail' as const },
    {
      label: 'Daily Runs',
      icon: 'refresh' as const,
      children: dailyRunsMenuItems
    },
  ]

  const hasActiveDailyRunsSubItem = dailyRunsMenuItems.some(item => isActive(item.path))
  const hasActiveManageUPCsSubItem = manageUPCsMenuItems.some(item => isActive(item.path))

  /** Blocklist hides nav item entirely once user profile / session is resolved. */
  const showFeedbackNav =
    authUser !== null &&
    !userInfoLoading &&
    !isUserHiddenFromFeedbackPage(
      userInfo?.display_name,
      userInfo?.email,
      authUser?.email,
    )

  // Auto-open flyouts when a child route is active
  useEffect(() => {
    if (hasActiveDailyRunsSubItem) {
      setIsDailyRunsMenuOpen(true)
    }
    if (hasActiveManageUPCsSubItem) {
      setIsManageUPCsMenuOpen(true)
    }
  }, [hasActiveDailyRunsSubItem, hasActiveManageUPCsSubItem])

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

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-gray-200/80 bg-white/80 shadow-lg backdrop-blur-lg">
      <div className="shrink-0 border-b border-gray-200/80 p-4">
        <div className="flex items-center gap-2.5">
          <img src={APP_ICON_URL} alt="MSW Overwatch" className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-[#404040]">
              {APP_NAME}
            </h2>
            <p className="truncate text-xs text-gray-500">Central Workspace • {APP_VERSION_LABEL}</p>
          </div>
        </div>
      </div>
      <nav
        className="flex min-h-0 flex-1 flex-col px-3 py-3"
        onMouseLeave={() => setHoveredNav(null)}
      >
        <div className="min-h-0 shrink overflow-y-auto overscroll-y-contain">
          <div className="space-y-0.5">
          {/* Dashboard - top level */}
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

          {hasKeepaAccess &&
            keepaMenuItems.map((item) => {
              if (item.children) {
                const isOpen =
                  (item.label === 'Daily Runs' && isDailyRunsMenuOpen) ||
                  (item.label === 'Manage UPCs' && isManageUPCsMenuOpen)
                const hasActiveChild =
                  (item.label === 'Daily Runs' && hasActiveDailyRunsSubItem) ||
                  (item.label === 'Manage UPCs' && hasActiveManageUPCsSubItem)
                const buttonRef =
                  item.label === 'Daily Runs' ? dailyRunsButtonRef : manageUPCsButtonRef
                const timeoutRef =
                  item.label === 'Daily Runs' ? dailyRunsTimeoutRef : manageUPCsTimeoutRef

                const flyoutParentId =
                  item.label === 'Daily Runs' ? 'daily-runs' : 'manage-upcs'

                const handleMouseEnter = () => {
                  setHoveredNav(flyoutParentId)
                  if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current)
                    timeoutRef.current = null
                  }
                  if (item.label === 'Daily Runs') {
                    setIsDailyRunsMenuOpen(true)
                  } else if (item.label === 'Manage UPCs') {
                    setIsManageUPCsMenuOpen(true)
                  }
                }

                const handleMouseLeave = () => {
                  timeoutRef.current = setTimeout(() => {
                    if (item.label === 'Daily Runs') {
                      setIsDailyRunsMenuOpen(false)
                    } else if (item.label === 'Manage UPCs') {
                      setIsManageUPCsMenuOpen(false)
                    }
                  }, 200)
                }

                return (
                  <div key={item.label} className="relative group">
                    <button
                      ref={buttonRef}
                      type="button"
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                      className={`sidebar-link w-full text-left ${
                        navHighlighted(flyoutParentId, hasActiveChild)
                          ? 'sidebar-link-active'
                          : 'sidebar-link-inactive'
                      }`}
                    >
                      <span className="shrink-0">{Icons[item.icon]}</span>
                      <span className="sidebar-link-label">{item.label}</span>
                      <span className="shrink-0">{Icons.chevronRight}</span>
                    </button>

                    {isOpen && (
                      <div
                        className="flyout-menu absolute left-full top-0 ml-2 bg-[#3B3B3B] rounded-lg shadow-2xl border border-white/20 min-w-[200px] z-[9999]"
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      >
                        <div className="p-2 space-y-1">
                          {item.children.map((childItem) => (
                            <Link
                              key={childItem.path}
                              to={childItem.path}
                              onMouseEnter={() =>
                                setHoveredNav(
                                  `${item.label === 'Daily Runs' ? 'flyout-daily' : 'flyout-upcs'}-${childItem.path}`
                                )
                              }
                              className={`sidebar-link ${
                                navHighlighted(
                                  `${item.label === 'Daily Runs' ? 'flyout-daily' : 'flyout-upcs'}-${childItem.path}`,
                                  isActive(childItem.path)
                                )
                                  ? 'sidebar-link-active'
                                  : 'sidebar-link-inactive'
                              }`}
                              onClick={() => {
                                if (dailyRunsTimeoutRef.current) {
                                  clearTimeout(dailyRunsTimeoutRef.current)
                                  dailyRunsTimeoutRef.current = null
                                }
                                if (manageUPCsTimeoutRef.current) {
                                  clearTimeout(manageUPCsTimeoutRef.current)
                                  manageUPCsTimeoutRef.current = null
                                }
                                setIsDailyRunsMenuOpen(false)
                                setIsManageUPCsMenuOpen(false)
                              }}
                            >
                              <span className="shrink-0">{Icons[childItem.icon]}</span>
                              <span className="sidebar-link-label">{childItem.label}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              const linkId =
                item.path === '/jobs'
                  ? 'jobs'
                  : item.path === '/map'
                    ? 'map'
                    : item.path === '/seller-list'
                      ? 'seller-list'
                      : item.path === '/email-list'
                        ? 'email-list'
                        : 'keepa-other'

              return (
                <Link
                  key={item.path}
                  to={item.path!}
                  onMouseEnter={() => setHoveredNav(linkId)}
                  className={`sidebar-link ${
                    navHighlighted(linkId, isActive(item.path!))
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

        <div className="flex min-h-0 flex-1 flex-col justify-center py-2">
          <div className="space-y-0.5 border-t-2 border-b-2 border-gray-300/80 py-3">
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
            <span className="shrink-0">{Icons.scanner}</span>
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
          </div>
        </div>

        <div className="mt-auto shrink-0 space-y-0.5 border-t-2 border-gray-300/80 pt-3 pb-1">
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

          {showFeedbackNav ? (
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
          ) : null}

          {/* User Management (Superadmin only) */}
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
      </nav>
      {isElectron && (
        <div className="mx-4 mb-4 mt-3 shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-700">Desktop</p>
          <p className="mt-1 text-xs text-gray-600">
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
          {updateMessage && <p className="mt-2 text-[11px] text-gray-600">{updateMessage}</p>}
        </div>
      )}
    </aside>
  )
}

