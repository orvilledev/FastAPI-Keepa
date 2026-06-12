import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useUser } from '../../contexts/UserContext'
import { isUserHiddenFromFeedbackPage } from '../../constants/feedbackAccess'

type SearchItem = {
  label: string
  path: string
  section: string
}

function buildSearchItems(
  hasKeepaAccess: boolean,
  isSuperadmin: boolean,
  showFeedbackNav: boolean,
): SearchItem[] {
  const items: SearchItem[] = [
    { label: 'Dashboard', path: '/dashboard', section: 'Menu' },
    { label: 'Notifications', path: '/notifications', section: 'Menu' },
  ]

  if (hasKeepaAccess) {
    items.push(
      { label: 'Express Jobs', path: '/jobs', section: 'Menu' },
      { label: 'Daily Runs', path: '/daily-run', section: 'Menu' },
      { label: 'Manage UPCs', path: '/manage-upcs', section: 'Menu' },
      { label: 'Manage MAP', path: '/map', section: 'Menu' },
      { label: 'Seller List', path: '/seller-list', section: 'Menu' },
      { label: 'Email List', path: '/email-list', section: 'Menu' },
      { label: 'Label Station', path: '/label-station', section: 'Tools' },
    )
  }

  items.push(
    { label: 'Micro Tools', path: '/micro-tools', section: 'Tools' },
    { label: 'Tracking Extractor', path: '/tracking-scanner', section: 'Tools' },
    { label: 'FNSKU Labels', path: '/fnsku-labels', section: 'Tools' },
    { label: 'About', path: '/about', section: 'General' },
    { label: 'FAQ', path: '/faq', section: 'General' },
  )

  if (showFeedbackNav) {
    items.push({ label: 'Feedback From Users', path: '/feedback', section: 'General' })
  }

  if (isSuperadmin) {
    items.push({ label: 'User Management', path: '/admin/users', section: 'General' })
  }

  return items
}

export default function NavbarSearch() {
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const { hasKeepaAccess, isSuperadmin, userInfo, userInfoLoading } = useUser()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const showFeedbackNav =
    authUser !== null &&
    !userInfoLoading &&
    !isUserHiddenFromFeedbackPage(
      userInfo?.display_name,
      userInfo?.email,
      authUser?.email,
    )

  const searchItems = useMemo(
    () => buildSearchItems(hasKeepaAccess, isSuperadmin, showFeedbackNav),
    [hasKeepaAccess, isSuperadmin, showFeedbackNav],
  )

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return []

    return searchItems.filter(
      (item) =>
        item.label.toLowerCase().includes(trimmed) ||
        item.section.toLowerCase().includes(trimmed),
    )
  }, [query, searchItems])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const goTo = (path: string) => {
    navigate(path)
    setQuery('')
    setOpen(false)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (results.length > 0) {
      goTo(results[0].path)
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <form onSubmit={handleSubmit}>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <svg
            className="h-5 w-5 text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search pages..."
          aria-label="Search pages"
          aria-expanded={open && results.length > 0}
          aria-controls="navbar-search-results"
          className="block w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-500 transition-colors focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#404040]/15"
        />
      </form>

      {open && query.trim() && (
        <ul
          id="navbar-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-4 py-2.5 text-sm text-gray-500">No pages found</li>
          ) : (
            results.map((item) => (
              <li key={item.path} role="option">
                <button
                  type="button"
                  onClick={() => goTo(item.path)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">{item.label}</span>
                  <span className="shrink-0 text-xs text-gray-500">{item.section}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
