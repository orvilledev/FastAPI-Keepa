import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useEffect, useState, useCallback } from 'react'
import { notificationsApi } from '../../services/api'

export default function Navbar() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)

  // Memoize loadUnreadCount to prevent recreating intervals on every render
  const loadUnreadCount = useCallback(async () => {
    try {
      const count = await notificationsApi.getUnreadCount()
      setUnreadCount(count)
    } catch (err) {
      console.error('Failed to load unread count:', err)
    }
  }, [])

  useEffect(() => {
    if (user) {
      loadUnreadCount()
      // Refresh every 30 seconds to reduce server load
      const interval = setInterval(loadUnreadCount, 30000)
      return () => clearInterval(interval)
    }
  }, [user, loadUnreadCount])
  
  // Also refresh when window regains focus
  useEffect(() => {
    if (user) {
      const handleFocus = () => {
        loadUnreadCount()
      }
      window.addEventListener('focus', handleFocus)
      return () => window.removeEventListener('focus', handleFocus)
    }
  }, [user, loadUnreadCount])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <nav className="bg-white/80 backdrop-blur-lg border-b border-gray-200/80 shadow-sm sticky top-0 z-50">
      <div className="px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-[#0B1020]">
              Orbit
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            {/* Notifications Bell */}
            <Link
              to="/notifications"
              className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors duration-200"
              title="Notifications"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            <div className="hidden sm:flex items-center space-x-3 px-4 py-2 bg-gray-50 rounded-lg">
              <div className="w-8 h-8 bg-[#0B1020] rounded-full flex items-center justify-center">
                <span className="text-white text-xs font-semibold">
                  {user?.display_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-700">
                {user?.display_name || user?.email}
              </span>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors duration-200"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}

