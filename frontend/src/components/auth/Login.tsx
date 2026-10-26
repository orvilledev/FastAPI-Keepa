import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchMfaStatus, shouldSkipMfaForEmail, shouldShowMfaSetup, shouldShowMfaVerify } from '../../lib/mfa'
import { recordWebAuditEvent } from '../../lib/auditEvents'
import ThemeSelector from '../common/ThemeSelector'
import AppLogo from '../common/AppLogo'
import { WAREHOUSE_HOME_PATH } from '../../constants/warehouseAccess'
import { markNightlyFreshLogin } from '../../lib/nightlyStationLogout'
import { forgetLoginEmail, listSavedLoginEmails, rememberLoginEmail } from '../../lib/savedLoginEmails'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false)
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false)
  const [notice, setNotice] = useState('')
  const [savedEmails, setSavedEmails] = useState<string[]>(() => listSavedLoginEmails())
  const [emailSuggestionsOpen, setEmailSuggestionsOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const passwordRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const storedNotice = sessionStorage.getItem('auth_notice')
    if (storedNotice) {
      setNotice(storedNotice)
      sessionStorage.removeItem('auth_notice')
    }
  }, [])

  const completeSignIn = async () => {
    const status = await fetchMfaStatus()
    if (!status.isFullyAuthenticated) {
      if (shouldShowMfaSetup(status)) {
        navigate('/mfa/setup')
      } else {
        navigate('/mfa/verify')
      }
      return false
    }
    void recordWebAuditEvent('login')
    navigate('/dashboard')
    return true
  }

  const routeAfterPasswordSignIn = async () => {
    if (await shouldSkipMfaForEmail(email)) {
      void recordWebAuditEvent('login', 'Warehouse MFA-exempt sign-in')
      navigate(WAREHOUSE_HOME_PATH)
      return
    }

    const status = await fetchMfaStatus()
    if (shouldShowMfaSetup(status)) {
      navigate('/mfa/setup')
      return
    }
    if (shouldShowMfaVerify(status)) {
      navigate('/mfa/verify')
      return
    }
    await completeSignIn()
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError
      setSavedEmails(rememberLoginEmail(email))
      markNightlyFreshLogin(email)
      await routeAfterPasswordSignIn()
    } catch (loginError: unknown) {
      const message = loginError instanceof Error ? loginError.message : 'Failed to login'
      setError(message)
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
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotPasswordEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) throw resetError
      setForgotPasswordSuccess(true)
      setError('')
    } catch (resetError: unknown) {
      const message = resetError instanceof Error ? resetError.message : 'Failed to send password reset email'
      setError(message)
      setForgotPasswordSuccess(false)
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  const emailSuggestions = useMemo(() => {
    const query = email.trim().toLowerCase()
    if (!query) return savedEmails
    return savedEmails.filter((item) => item.toLowerCase().includes(query))
  }, [email, savedEmails])

  const showEmailSuggestions = emailSuggestionsOpen && emailSuggestions.length > 0
  const highlightedIndex = showEmailSuggestions
    ? Math.min(activeSuggestion, emailSuggestions.length - 1)
    : 0

  const chooseEmail = (value: string) => {
    setEmail(value)
    setEmailSuggestionsOpen(false)
    requestAnimationFrame(() => passwordRef.current?.focus())
  }

  return (
    <div className="relative min-h-app-screen flex items-center justify-center app-page-bg py-12 px-4 sm:px-6 lg:px-8">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeSelector />
      </div>
      <div className="max-w-md w-full">
        <div className="card p-8 shadow-xl">
          <div className="text-center mb-8">
            <AppLogo alt="MSW Overwatch" className="w-16 h-16 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-[#404040] dark:text-slate-100">
              Welcome to MSW Overwatch
            </h2>
            <p className="mt-2 text-sm text-gray-500">Sign in to MSW Overwatch</p>
          </div>
          <form className="space-y-6" onSubmit={handleLogin}>
            {notice && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                <div className="text-sm text-[#81B81D] font-medium">{notice}</div>
              </div>
            )}
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
                <div className="relative">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showEmailSuggestions}
                    aria-controls="saved-login-emails"
                    aria-activedescendant={
                      showEmailSuggestions ? `saved-login-email-${highlightedIndex}` : undefined
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setEmailSuggestionsOpen(true)
                      setActiveSuggestion(0)
                    }}
                    onFocus={() => {
                      setSavedEmails(listSavedLoginEmails())
                      setEmailSuggestionsOpen(true)
                      setActiveSuggestion(0)
                    }}
                    onBlur={() => setEmailSuggestionsOpen(false)}
                    onKeyDown={(e) => {
                      if (!showEmailSuggestions) return
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setActiveSuggestion((index) => (index + 1) % emailSuggestions.length)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setActiveSuggestion(
                          (index) => (index - 1 + emailSuggestions.length) % emailSuggestions.length,
                        )
                      } else if (e.key === 'Escape') {
                        setEmailSuggestionsOpen(false)
                      } else if (
                        e.key === 'Enter' &&
                        email.trim().toLowerCase() !== emailSuggestions[highlightedIndex]?.toLowerCase()
                      ) {
                        e.preventDefault()
                        chooseEmail(emailSuggestions[highlightedIndex])
                      }
                    }}
                  />
                  {showEmailSuggestions && (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                      <p className="px-4 pb-1 pt-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                        Previous sign-ins
                      </p>
                      <ul
                        id="saved-login-emails"
                        role="listbox"
                        className="max-h-56 overflow-auto py-1"
                      >
                        {emailSuggestions.map((item, index) => (
                          <li
                            key={item}
                            id={`saved-login-email-${index}`}
                            role="option"
                            aria-selected={index === highlightedIndex}
                            className={`flex items-center ${
                              index === highlightedIndex
                                ? 'bg-gray-100 dark:bg-slate-700'
                                : 'bg-white dark:bg-slate-800'
                            }`}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setActiveSuggestion(index)}
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate px-4 py-2 text-left text-sm text-gray-800 dark:text-slate-100"
                              onClick={() => chooseEmail(item)}
                            >
                              {item}
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${item}`}
                              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"
                              onClick={() => {
                                const next = forgetLoginEmail(item)
                                setSavedEmails(next)
                                setActiveSuggestion(0)
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
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
                    className="text-sm text-[#404040] hover:text-[#3B3B3B] font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  name="password"
                  ref={passwordRef}
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
