import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    // Check if we have hash fragments (Supabase uses hash for security)
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const hasHash = hashParams.has('access_token') || hashParams.has('type')
    
    // Check query params as fallback
    const hasQuery = searchParams.has('access_token') || searchParams.has('type')
    
    // If we have tokens in URL, Supabase will automatically process them
    // We just need to wait for the session to be established
    const checkSession = async () => {
      // Wait a moment for Supabase to process hash fragments
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError) {
        console.error('Session error:', sessionError)
        setError('Invalid or expired reset link. Please request a new password reset.')
        return
      }
      
      if (session) {
        setSessionReady(true)
        // Clear the hash/query params from URL for security
        if (hasHash || hasQuery) {
          window.history.replaceState(null, '', window.location.pathname)
        }
      } else if (hasHash || hasQuery) {
        // We have tokens but no session - try to extract and set manually
        const accessToken = hashParams.get('access_token') || searchParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token')
        const type = hashParams.get('type') || searchParams.get('type')
        
        if (accessToken && type === 'recovery') {
          try {
            const { data, error: setSessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            })
            
            if (setSessionError) {
              console.error('Set session error:', setSessionError)
              setError('Invalid or expired reset link. Please request a new password reset.')
              return
            }
            
            if (data.session) {
              setSessionReady(true)
              window.history.replaceState(null, '', window.location.pathname)
            } else {
              setError('Unable to establish session. Please request a new password reset.')
            }
          } catch (err: any) {
            console.error('Error setting session:', err)
            setError('Failed to process reset link. Please request a new password reset.')
          }
        } else {
          setError('Invalid reset link format. Please request a new password reset.')
        }
      } else {
        // No tokens in URL and no session
        setError('Invalid reset link. Please request a new password reset from the login page.')
      }
    }
    
    // Also listen to auth state changes in case Supabase processes the hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setSessionReady(true)
        window.history.replaceState(null, '', window.location.pathname)
      }
    })
    
    checkSession()
    
    return () => {
      subscription.unsubscribe()
    }
  }, [searchParams])

  const handleResetPassword = async (e: React.FormEvent) => {
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
      const { error } = await supabase.auth.updateUser({
        password: password,
      })

      if (error) throw error
      
      setSuccess(true)
      setTimeout(() => {
        navigate('/login')
      }, 2000)
    } catch (error: any) {
      setError(error.message || 'Failed to reset password')
    } finally {
      setLoading(false)
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
              Reset Password
            </h2>
            <p className="mt-2 text-sm text-gray-500">Enter your new password</p>
          </div>

          {!sessionReady && !error ? (
            <div className="text-center space-y-2">
              <div className="text-sm text-gray-600">Processing reset link...</div>
              <div className="text-xs text-gray-500">Please wait while we verify your reset link.</div>
            </div>
          ) : success ? (
            <div className="text-center space-y-4">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <div className="text-sm text-green-800 font-medium">
                  Password reset successfully! Redirecting to login...
                </div>
              </div>
              <Link
                to="/login"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
              >
                Go to login page
              </Link>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleResetPassword}>
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                  <div className="text-sm text-red-800 font-medium mb-2">{error}</div>
                  <div className="text-xs text-red-700 mb-2">
                    Make sure you're using the link from the most recent password reset email.
                  </div>
                  <Link
                    to="/login"
                    className="text-sm text-red-700 hover:text-red-800 font-medium underline"
                  >
                    Request a new password reset
                  </Link>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    New Password
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
                    Confirm New Password
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
                  disabled={loading || !sessionReady}
                  className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Resetting password...' : 'Reset Password'}
                </button>
              </div>

              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                >
                  Back to login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

