import { Link } from 'react-router-dom'
import { APP_COPYRIGHT_OWNER, APP_NAME, APP_VERSION_LABEL } from '../constants/app'
import ThemeSelector from './common/ThemeSelector'
import AppLogo from './common/AppLogo'

export default function Landing() {
  const features = [
    {
      icon: (
        <svg className="w-10 h-10 text-[#F97316]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        </svg>
      ),
      title: 'Keepa Alert Services',
      description:
        'Fast, focused workflows built for clear action.',
    },
    {
      icon: (
        <svg className="w-10 h-10 text-[#3B82F6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
      title: 'MAP Management',
      description:
        'Simple controls for accurate, reliable pricing inputs.',
    },
    {
      icon: (
        <svg className="w-10 h-10 text-[#6366F1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
        </svg>
      ),
      title: 'and many more',
      description: 'More focused tools built to support daily execution.',
    },
  ]

  return (
    <div className="min-h-screen app-page-bg">
      {/* Navigation */}
      <nav className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AppLogo alt="MSW Overwatch" className="w-10 h-10" />
            <span className="text-2xl font-bold text-[#404040] dark:text-slate-100">
              {APP_NAME}
            </span>
            <span className="text-sm font-semibold text-gray-500">{APP_VERSION_LABEL}</span>
          </div>
          <div className="flex items-center space-x-2">
            <ThemeSelector />
            <Link
              to="/login"
              className="text-gray-700 hover:text-[#404040] dark:text-slate-300 dark:hover:text-slate-100 font-medium transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-5xl lg:text-6xl font-extrabold text-gray-900 mb-6">
            Your Central
            <span className="block text-[#404040]">
              {APP_NAME}
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-4 max-w-2xl mx-auto">
            {APP_NAME} is your team workspace for focused execution: one place to monitor what matters,
            coordinate quickly, and move from insight to action with less noise.
          </p>
          <div className="mb-8 max-w-2xl mx-auto">
            <p className="text-lg font-semibold text-gray-800 mb-2">
              💼 <strong>Free for MetroShoe Warehouse employees</strong>
            </p>
            <p className="text-sm text-gray-600">
              Non-MetroShoe Warehouse users: $1,000,000/month subscription required
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              to="/login"
              className="btn-secondary text-lg px-8 py-4"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            What&apos;s in {APP_NAME}
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            A simple set of essentials designed to keep teams focused and moving
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="card p-6 card-hover"
            >
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-gray-600">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-600">
            <p>&copy; {new Date().getFullYear()} {APP_NAME} {APP_VERSION_LABEL}. All rights reserved.</p>
            <p className="mt-1 text-sm">{APP_COPYRIGHT_OWNER}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

