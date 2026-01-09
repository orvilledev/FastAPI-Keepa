import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Landing() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSignup, setShowSignup] = useState(false)
  const navigate = useNavigate()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      })

      if (error) throw error
      navigate('/dashboard')
    } catch (error: any) {
      setError(error.message || 'Failed to sign up')
    } finally {
      setLoading(false)
    }
  }

  const features = [
    {
      icon: '🚀',
      title: 'Central Workspace',
      description: 'Your unified hub for all productivity tools and resources in one place',
    },
    {
      icon: '✅',
      title: 'Task Management',
      description: 'Create, organize, and track tasks with priorities, due dates, and team collaboration',
    },
    {
      icon: '📝',
      title: 'Notes & Documentation',
      description: 'Keep your ideas organized with rich-text notes and documentation',
    },
    {
      icon: '🔧',
      title: 'Custom Tools',
      description: 'Access shared tools, job aids, and build your personal toolbox',
    },
    {
      icon: '📊',
      title: 'Dashboard Widgets',
      description: 'Personalize your dashboard with drag-and-drop widgets',
    },
    {
      icon: '👥',
      title: 'Team Collaboration',
      description: 'Work together with your team on shared tasks and resources',
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      {/* Navigation */}
      <nav className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img src="/orbit-logo.svg" alt="Orbit" className="w-10 h-10" />
            <span className="text-2xl font-bold text-[#0B1020]">
              Orbit
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <Link
              to="/login"
              className="text-gray-700 hover:text-[#0B1020] font-medium transition-colors"
            >
              Sign In
            </Link>
            <button
              onClick={() => setShowSignup(true)}
              className="btn-primary"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-5xl lg:text-6xl font-extrabold text-gray-900 mb-6">
            Your Central
            <span className="block text-[#0B1020]">
              Workspace Hub
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-4 max-w-2xl mx-auto">
            Orbit Hub brings together all your productivity tools in one place.
            Manage tasks, organize notes, access resources, and collaborate with your team.
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
            <button
              onClick={() => {
                setShowSignup(true)
                document.getElementById('signup-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="btn-primary text-lg px-8 py-4"
            >
              Get Started
            </button>
            <Link
              to="/login"
              className="btn-secondary text-lg px-8 py-4"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Pricing
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Simple, transparent pricing for everyone
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Free Plan for MetroShoe Warehouse Employees */}
          <div className="card p-8 border-2 border-green-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-green-500 text-white px-4 py-1 text-sm font-semibold">
              FREE
            </div>
            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                MetroShoe Warehouse Employees
              </h3>
              <div className="text-4xl font-extrabold text-green-600 mb-2">
                $0
                <span className="text-lg font-normal text-gray-600">/month</span>
              </div>
              <p className="text-gray-600 text-sm">
                Free access for all MetroShoe Warehouse team members
              </p>
            </div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Full access to Orbit Hub</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Unlimited tasks & notes</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Priority support</span>
              </li>
            </ul>
            <button
              onClick={() => {
                setShowSignup(true)
                document.getElementById('signup-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-3 rounded-lg transition-colors"
            >
              Get Started Free
            </button>
          </div>

          {/* Paid Plan for Non-Employees */}
          <div className="card p-8 border-2 border-[#0B1020]/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[#0B1020] text-white px-4 py-1 text-sm font-semibold">
              PREMIUM
            </div>
            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                Non-MetroShoe Warehouse
              </h3>
              <div className="text-4xl font-extrabold text-[#0B1020] mb-2">
                $1,000,000
                <span className="text-lg font-normal text-gray-600">/month</span>
              </div>
              <p className="text-gray-600 text-sm">
                For external users and organizations
              </p>
            </div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-start">
                <svg className="w-5 h-5 text-[#0B1020] mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Full access to Orbit Hub</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 text-[#0B1020] mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Unlimited tasks & notes</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 text-[#0B1020] mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Dedicated account manager</span>
              </li>
            </ul>
            <button
              onClick={() => {
                setShowSignup(true)
                document.getElementById('signup-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="w-full btn-primary"
            >
              Contact Sales
            </button>
          </div>
        </div>
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600">
            <strong>Note:</strong> MetroShoe Warehouse employees receive free access to Orbit Hub. 
            All other users are subject to the monthly subscription fee.
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Everything You Need
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            All the tools you need to stay productive and collaborate with your team
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

      {/* Signup Section */}
      <section
        id="signup-section"
        className="container mx-auto px-4 sm:px-6 lg:px-8 py-20"
      >
        <div className="max-w-md mx-auto">
          <div className="card p-8 shadow-xl">
            <div className="text-center mb-8">
              <img src="/orbit-logo.svg" alt="Orbit" className="w-16 h-16 mx-auto mb-4" />
              <h2 className="text-3xl font-bold text-[#0B1020]">
                Join Orbit Hub
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Get started with your central workspace
              </p>
            </div>
            <form className="space-y-6" onSubmit={handleSignup}>
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                  <div className="text-sm text-red-800 font-medium">{error}</div>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm Password
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </div>

              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-[#0B1020] hover:text-[#1a2235] font-medium transition-colors"
                >
                  Already have an account? <span className="font-semibold">Sign in</span>
                </Link>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-600">
            <p>&copy; {new Date().getFullYear()} Orbit. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

