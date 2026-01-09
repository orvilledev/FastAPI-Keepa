import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useUser } from '../../contexts/UserContext'

// SVG Icon components that inherit text color via currentColor
const Icons = {
  home: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
  notes: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  tasks: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  toolbox: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  resources: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  globe: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
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
  chevronDown: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
  chevronRight: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  ),
}

export default function Sidebar() {
  const location = useLocation()
  const { hasKeepaAccess, isSuperadmin } = useUser()
  const [isDashboardMenuOpen, setIsDashboardMenuOpen] = useState(true)
  const [isKeepaMenuOpen, setIsKeepaMenuOpen] = useState(true)
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false)
  const [isMySpaceMenuOpen, setIsMySpaceMenuOpen] = useState(false)

  const isActive = (path: string) => {
    const currentPath = location.pathname
    
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

  const keepaMenuItems = [
    { path: '/jobs', label: 'Express Jobs', icon: 'package' as const },
    { path: '/upcs', label: 'Manage UPCs', icon: 'barcode' as const },
    { path: '/map', label: 'Manage MAP', icon: 'dollar' as const },
    { path: '/daily-run', label: 'Daily Run', icon: 'refresh' as const },
  ]

  const toolsMenuItems = [
    { path: '/tools/public', label: 'Public Tools', icon: 'globe' as const },
    { path: '/tools/job-aids', label: 'Job Aids', icon: 'wrench' as const },
  ]

  const mySpaceMenuItems = [
    { path: '/my-space/notes', label: 'My Notes', icon: 'notes' as const },
    { path: '/team-tasks', label: 'Tasks', icon: 'tasks' as const },
    { path: '/tools/my-toolbox', label: 'My Toolbox', icon: 'toolbox' as const },
  ]

  const dashboardMenuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' as const },
    { 
      label: 'Keepa Alert Services', 
      icon: 'settings' as const,
      children: keepaMenuItems
    },
  ]

  // Check if any sub-item is active to keep menu open
  const hasActiveSubItem = keepaMenuItems.some(item => isActive(item.path))
  const hasActiveToolsSubItem = toolsMenuItems.some(item => isActive(item.path))
  const hasActiveMySpaceSubItem = mySpaceMenuItems.some(item => isActive(item.path))
  const hasActiveDashboardSubItem = isActive('/dashboard') || hasActiveSubItem

  // Auto-open menu if a sub-item is active
  useEffect(() => {
    if (hasActiveDashboardSubItem) {
      setIsDashboardMenuOpen(true)
      if (hasActiveSubItem) {
        setIsKeepaMenuOpen(true)
      }
    }
  }, [hasActiveDashboardSubItem, hasActiveSubItem])

  useEffect(() => {
    if (hasActiveToolsSubItem) {
      setIsToolsMenuOpen(true)
    }
  }, [hasActiveToolsSubItem])

  useEffect(() => {
    if (hasActiveMySpaceSubItem) {
      setIsMySpaceMenuOpen(true)
    }
  }, [hasActiveMySpaceSubItem])

  return (
    <aside className="w-64 bg-white/80 backdrop-blur-lg border-r border-gray-200/80 shadow-lg h-screen sticky top-0">
      <div className="p-6 border-b border-gray-200/80">
        <div className="flex items-center space-x-2">
          <img src="/orbit-logo.svg" alt="Orbit" className="w-8 h-8" />
          <div>
            <h2 className="text-lg font-bold text-[#0B1020]">
              Orbit Hub
            </h2>
            <p className="text-xs text-gray-500">Central Workspace</p>
          </div>
        </div>
      </div>
      <nav className="mt-6 px-4">
        <div className="space-y-1">
          {/* Home Dropdown */}
          <div>
            <button
              onClick={() => {
                setIsDashboardMenuOpen(!isDashboardMenuOpen)
              }}
              className="sidebar-link sidebar-link-inactive w-full text-left text-black"
            >
              <span className="mr-3">{Icons.home}</span>
              <span className="flex-1">Home</span>
              <span>
                {isDashboardMenuOpen ? Icons.chevronDown : Icons.chevronRight}
              </span>
            </button>
            
            {isDashboardMenuOpen && (
              <div className={`ml-4 mt-1 space-y-1 rounded-lg p-2 ${isKeepaMenuOpen ? 'bg-transparent' : 'bg-[#0B1020]'}`}>
                {/* Dashboard Link */}
                <Link
                  to="/dashboard"
                  className={`sidebar-link ${
                    isActive('/dashboard') ? 'sidebar-link-active' : 'sidebar-link-inactive'
                  }`}
                  style={{ color: isKeepaMenuOpen ? (isActive('/dashboard') ? 'white' : 'black') : 'white' }}
                >
                  <span className="mr-3">{Icons.dashboard}</span>
                  <span>Dashboard</span>
                </Link>
                
                {/* Keepa Alert Services Nested Dropdown - Only show if user has access */}
                {hasKeepaAccess && (
                  <div>
                    <button
                      onClick={() => {
                        setIsKeepaMenuOpen(!isKeepaMenuOpen)
                      }}
                      className={`sidebar-link sidebar-link-inactive w-full text-left ${
                        hasActiveSubItem ? 'sidebar-link-active' : ''
                      }`}
                      style={{ color: isKeepaMenuOpen ? (hasActiveSubItem ? 'white' : 'black') : 'white' }}
                    >
                      <span className="mr-3">{Icons.settings}</span>
                      <span className="flex-1">Keepa Alert Services</span>
                      <span>
                        {isKeepaMenuOpen ? Icons.chevronDown : Icons.chevronRight}
                      </span>
                    </button>
                    
                    {isKeepaMenuOpen && (
                      <div className="ml-4 mt-1 space-y-1 bg-[#0B1020] rounded-lg p-2 dark-dropdown">
                        {keepaMenuItems.map((item) => (
                          <Link
                            key={item.path}
                            to={item.path}
                            className={`sidebar-link ${
                              isActive(item.path) ? 'sidebar-link-active' : 'sidebar-link-inactive'
                            }`}
                          >
                            <span className="mr-3">{Icons[item.icon]}</span>
                            <span>{item.label}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* My Space Dropdown */}
          <div>
            <button
              onClick={() => {
                setIsMySpaceMenuOpen(!isMySpaceMenuOpen)
              }}
              className="sidebar-link sidebar-link-inactive w-full text-left text-black"
            >
              <span className="mr-3">{Icons.user}</span>
              <span className="flex-1">My Space</span>
              <span>
                {isMySpaceMenuOpen ? Icons.chevronDown : Icons.chevronRight}
              </span>
            </button>
            
            {isMySpaceMenuOpen && (
              <div className="ml-4 mt-1 space-y-1 bg-[#0B1020] rounded-lg p-2 dark-dropdown">
                {mySpaceMenuItems.length > 0 ? (
                  mySpaceMenuItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`sidebar-link ${
                        isActive(item.path) ? 'sidebar-link-active' : 'sidebar-link-inactive'
                      }`}
                    >
                      <span className="mr-3">{Icons[item.icon]}</span>
                      <span>{item.label}</span>
                    </Link>
                  ))
                ) : (
                  <div className="text-xs text-gray-400 px-3 py-2">No items yet</div>
                )}
              </div>
            )}
          </div>

          {/* Resources Dropdown */}
          <div>
            <button
              onClick={() => {
                setIsToolsMenuOpen(!isToolsMenuOpen)
              }}
              className="sidebar-link sidebar-link-inactive w-full text-left text-black"
            >
              <span className="mr-3">{Icons.resources}</span>
              <span className="flex-1">Resources</span>
              <span>
                {isToolsMenuOpen ? Icons.chevronDown : Icons.chevronRight}
              </span>
            </button>
            
            {isToolsMenuOpen && (
              <div className="ml-4 mt-1 space-y-1 bg-[#0B1020] rounded-lg p-2 dark-dropdown">
                {toolsMenuItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`sidebar-link ${
                      isActive(item.path) ? 'sidebar-link-active' : 'sidebar-link-inactive'
                    }`}
                  >
                    <span className="mr-3">{Icons[item.icon]}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* User Management (Superadmin only) */}
          {isSuperadmin && (
            <Link
              to="/admin/users"
              className={`sidebar-link ${
                isActive('/admin/users') ? 'sidebar-link-active' : 'sidebar-link-inactive'
              }`}
            >
              <span className="mr-3">{Icons.users}</span>
              <span>User Management</span>
            </Link>
          )}
        </div>
      </nav>
    </aside>
  )
}

