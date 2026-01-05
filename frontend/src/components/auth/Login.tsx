import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false)
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error
      navigate('/dashboard')
    } catch (error: any) {
      setError(error.message || 'Failed to login')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setForgotPasswordLoading(true)
    setForgotPasswordSuccess(false)

    if (!forgotPasswordEmail) {
      setError('Please enter your email address')
      setForgotPasswordLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotPasswordEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (error) throw error
      setForgotPasswordSuccess(true)
      setError('')
    } catch (error: any) {
      setError(error.message || 'Failed to send password reset email')
      setForgotPasswordSuccess(false)
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="card p-8 shadow-xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mb-4 shadow-lg">
              <span className="text-white font-bold text-2xl">K</span>
            </div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Welcome Back
            </h2>
            <p className="mt-2 text-sm text-gray-500">Sign in to your Keepa Dashboard</p>
          </div>
          <form className="space-y-6" onSubmit={handleLogin}>
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
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(true)
                      setForgotPasswordEmail(email)
                      setError('')
                      setForgotPasswordSuccess(false)
                    }}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>

            <div className="text-center">
              <Link
                to="/signup"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
              >
                Don't have an account? <span className="font-semibold">Sign up</span>
              </Link>
            </div>
          </form>

          {/* Forgot Password Modal/Form */}
          {showForgotPassword && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Reset Password</h3>
                <p className="text-sm text-gray-600">
                  Enter your email address and we'll send you a link to reset your password.
                </p>
              </div>
              
              {forgotPasswordSuccess ? (
                <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                  <div className="text-sm text-green-800 font-medium">
                    Password reset email sent! Please check your inbox and follow the instructions to reset your password.
                  </div>
                  <button
                    onClick={() => {
                      setShowForgotPassword(false)
                      setForgotPasswordSuccess(false)
                      setForgotPasswordEmail('')
                    }}
                    className="mt-3 text-sm text-green-700 hover:text-green-800 font-medium"
                  >
                    Back to login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label htmlFor="forgotPasswordEmail" className="block text-sm font-medium text-gray-700 mb-2">
                      Email address
                    </label>
                    <input
                      id="forgotPasswordEmail"
                      name="forgotPasswordEmail"
                      type="email"
                      autoComplete="email"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                      placeholder="you@example.com"
                      value={forgotPasswordEmail}
                      onChange={(e) => setForgotPasswordEmail(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={forgotPasswordLoading}
                      className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {forgotPasswordLoading ? 'Sending...' : 'Send Reset Link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(false)
                        setForgotPasswordEmail('')
                        setError('')
                        setForgotPasswordSuccess(false)
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

