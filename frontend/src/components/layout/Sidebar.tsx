import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { authApi } from '../../services/api'

export default function Sidebar() {
  const location = useLocation()
  const [isKeepaMenuOpen, setIsKeepaMenuOpen] = useState(true)
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false)
  const [isMySpaceMenuOpen, setIsMySpaceMenuOpen] = useState(false)
  const [hasKeepaAccess, setHasKeepaAccess] = useState(false)
  const [loading, setLoading] = useState(true)

  // Check user's Keepa access permission
  useEffect(() => {
    const checkKeepaAccess = async () => {
      try {
        const userInfo = await authApi.getCurrentUser()
        setHasKeepaAccess(userInfo.has_keepa_access || false)
      } catch (error) {
        console.error('Failed to check Keepa access:', error)
        setHasKeepaAccess(false)
      } finally {
        setLoading(false)
      }
    }
    checkKeepaAccess()
  }, [])

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
    { path: '/jobs', label: 'Express Jobs', icon: '📦' },
    { path: '/upcs', label: 'Manage UPCs', icon: '🔢' },
    { path: '/map', label: 'Manage MAP', icon: '💰' },
  ]

  const toolsMenuItems = [
    { path: '/tools/public', label: 'Public Tools', icon: '🌐' },
    { path: '/tools/my-toolbox', label: 'My Toolbox', icon: '📦' },
  ]

  const mySpaceMenuItems: Array<{ path: string; label: string; icon: string }> = [
    { path: '/my-space/notes', label: 'My Notes', icon: '📝' },
  ]

  // Check if any sub-item is active to keep menu open
  const hasActiveSubItem = keepaMenuItems.some(item => isActive(item.path))
  const hasActiveToolsSubItem = toolsMenuItems.some(item => isActive(item.path))
  const hasActiveMySpaceSubItem = mySpaceMenuItems.some(item => isActive(item.path))

  // Auto-open menu if a sub-item is active, and close the other menus
  useEffect(() => {
    if (hasActiveSubItem) {
      setIsKeepaMenuOpen(true)
      setIsToolsMenuOpen(false)
      setIsMySpaceMenuOpen(false)
    }
  }, [hasActiveSubItem])

  useEffect(() => {
    if (hasActiveToolsSubItem) {
      setIsToolsMenuOpen(true)
      setIsKeepaMenuOpen(false)
      setIsMySpaceMenuOpen(false)
    }
  }, [hasActiveToolsSubItem])

  useEffect(() => {
    if (hasActiveMySpaceSubItem) {
      setIsMySpaceMenuOpen(true)
      setIsKeepaMenuOpen(false)
      setIsToolsMenuOpen(false)
    }
  }, [hasActiveMySpaceSubItem])

  return (
    <aside className="w-64 bg-white/80 backdrop-blur-lg border-r border-gray-200/80 shadow-lg h-screen sticky top-0">
      <div className="p-6 border-b border-gray-200/80">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">K</span>
          </div>
          <div>
            <h2 className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Keepa
            </h2>
            <p className="text-xs text-gray-500">Price Alert Service</p>
          </div>
        </div>
      </div>
      <nav className="mt-6 px-4">
        <div className="space-y-1">
          {/* Dashboard */}
          <Link
            to="/dashboard"
            className={`sidebar-link ${
              location.pathname === '/dashboard' ? 'sidebar-link-active' : 'sidebar-link-inactive'
            }`}
          >
            <span className="mr-3 text-lg">📊</span>
            <span>Dashboard</span>
          </Link>

          {/* My Tasks */}
          <Link
            to="/tasks"
            className={`sidebar-link ${
              location.pathname === '/tasks' ? 'sidebar-link-active' : 'sidebar-link-inactive'
            }`}
          >
            <span className="mr-3 text-lg">✅</span>
            <span>My Tasks</span>
          </Link>

          {/* My Space Dropdown */}
          <div>
            <button
              onClick={() => {
                setIsMySpaceMenuOpen(!isMySpaceMenuOpen)
                if (!isMySpaceMenuOpen) {
                  setIsKeepaMenuOpen(false)
                  setIsToolsMenuOpen(false)
                }
              }}
              className={`sidebar-link w-full text-left ${
                hasActiveMySpaceSubItem ? 'sidebar-link-active' : 'sidebar-link-inactive'
              }`}
            >
              <span className="mr-3 text-lg">🏠</span>
              <span className="flex-1">My Space</span>
              <span className={`text-xs transition-transform duration-200 ${isMySpaceMenuOpen ? 'rotate-90' : ''}`}>
                ▶
              </span>
            </button>
            
            {isMySpaceMenuOpen && (
              <div className="ml-4 mt-1 space-y-1 bg-gray-50 rounded-lg p-2">
                {mySpaceMenuItems.length > 0 ? (
                  mySpaceMenuItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`sidebar-link ${
                        isActive(item.path) ? 'sidebar-link-active' : 'sidebar-link-inactive'
                      }`}
                    >
                      <span className="mr-3 text-lg">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  ))
                ) : (
                  <div className="text-xs text-gray-400 px-3 py-2">No items yet</div>
                )}
              </div>
            )}
          </div>

          {/* Keepa Alert Service Dropdown */}
          <div>
            <button
              onClick={() => {
                setIsKeepaMenuOpen(!isKeepaMenuOpen)
                if (!isKeepaMenuOpen) {
                  setIsToolsMenuOpen(false)
                  setIsMySpaceMenuOpen(false)
                }
              }}
              className={`sidebar-link w-full text-left ${
                hasActiveSubItem ? 'sidebar-link-active' : 'sidebar-link-inactive'
              }`}
            >
              <span className="mr-3 text-lg">⚙️</span>
              <span className="flex-1">Keepa Alert Service</span>
              <span className={`text-xs transition-transform duration-200 ${isKeepaMenuOpen ? 'rotate-90' : ''}`}>
                ▶
              </span>
            </button>
            
            {isKeepaMenuOpen && (
              <div className="ml-4 mt-1 space-y-1 bg-gray-50 rounded-lg p-2">
                {keepaMenuItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`sidebar-link ${
                      isActive(item.path) ? 'sidebar-link-active' : 'sidebar-link-inactive'
                    }`}
                  >
                    <span className="mr-3 text-lg">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Tools Dropdown */}
          <div>
            <button
              onClick={() => {
                setIsToolsMenuOpen(!isToolsMenuOpen)
                if (!isToolsMenuOpen) {
                  setIsKeepaMenuOpen(false)
                  setIsMySpaceMenuOpen(false)
                }
              }}
              className={`sidebar-link w-full text-left ${
                hasActiveToolsSubItem ? 'sidebar-link-active' : 'sidebar-link-inactive'
              }`}
            >
              <span className="mr-3 text-lg">🔧</span>
              <span className="flex-1">Tools</span>
              <span className={`text-xs transition-transform duration-200 ${isToolsMenuOpen ? 'rotate-90' : ''}`}>
                ▶
              </span>
            </button>
            
            {isToolsMenuOpen && (
              <div className="ml-4 mt-1 space-y-1 bg-gray-50 rounded-lg p-2">
                {toolsMenuItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`sidebar-link ${
                      isActive(item.path) ? 'sidebar-link-active' : 'sidebar-link-inactive'
                    }`}
                  >
                    <span className="mr-3 text-lg">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </nav>
    </aside>
  )
}

