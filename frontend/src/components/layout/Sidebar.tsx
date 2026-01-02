import { Link, useLocation } from 'react-router-dom'

export default function Sidebar() {
  const location = useLocation()

  const isActive = (path: string) => location.pathname === path

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/jobs', label: 'Jobs', icon: '📦' },
  ]

  return (
    <aside className="w-64 bg-white shadow-md h-screen">
      <nav className="mt-8">
        <div className="px-4 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center px-4 py-2 text-gray-700 rounded-lg hover:bg-gray-100 ${
                isActive(item.path) ? 'bg-indigo-50 text-indigo-700' : ''
              }`}
            >
              <span className="mr-3">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </aside>
  )
}

