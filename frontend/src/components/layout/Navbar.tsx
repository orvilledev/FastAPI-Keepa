import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useEffect, useState, useCallback, useRef } from 'react'
import { notificationsApi } from '../../services/api'
import { resetTotpEnrollment } from '../../lib/mfa'
import NavbarSearch from './NavbarSearch'

export default function Navbar() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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


  // Close the user menu when clicking outside of it.
  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleResetAuthenticator = async () => {
    const confirmed = window.confirm(
      'Reset two-factor authentication?\n\n' +
        'This removes your current authenticator entry. You will scan a new QR code ' +
        '(shown as "MSW Overwatch") and enter a code to finish setup.'
    )
    if (!confirmed) return

    setResetting(true)
    try {
      await resetTotpEnrollment()
      setMenuOpen(false)
      navigate('/mfa/setup', { replace: true })
    } catch (err) {
      console.error('Failed to reset authenticator:', err)
      window.alert('Could not reset the authenticator. Please try again.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <nav className="sticky top-0 z-50 shrink-0 border-b border-gray-200/80 bg-white/80 shadow-sm backdrop-blur-lg">
      <div className="px-6 lg:px-8">
        <div className="flex h-20 items-center gap-4">
          <div className="min-w-0 w-full max-w-sm lg:max-w-md">
            <NavbarSearch />
          </div>
          <div className="flex shrink-0 items-center space-x-4 ml-auto">
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
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="hidden sm:flex items-center space-x-3 px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors duration-200"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <div className="w-8 h-8 bg-[#404040] rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-semibold">
                    {user?.display_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {user?.display_name || user?.email}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg z-50"
                >
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-xs text-gray-500">Signed in as</p>
                    <p className="truncate text-sm font-medium text-gray-800">{user?.email}</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleResetAuthenticator}
                    disabled={resetting}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {resetting ? 'Resetting…' : 'Reset authenticator'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <svg className="w-4 h-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleSignOut}
              className="sm:hidden px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors duration-200"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}

