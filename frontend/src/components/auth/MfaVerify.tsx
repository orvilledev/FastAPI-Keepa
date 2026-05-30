import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { APP_ICON_URL } from '../../constants/app'
import { authApi, invalidateAuthTokenCache } from '../../services/api'
import {
  createMfaChallenge,
  fetchMfaStatus,
  shouldShowMfaSetup,
  shouldShowMfaVerify,
  verifyMfaCode,
} from '../../lib/mfa'
import { supabase } from '../../lib/supabase'
import { useUser } from '../../contexts/UserContext'

export default function MfaVerify() {
  const navigate = useNavigate()
  const { refetchUserInfo } = useUser()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      setError('')
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        if (!sessionData.session) {
          navigate('/login', { replace: true })
          return
        }

        const status = await fetchMfaStatus()
        if (status.isFullyAuthenticated) {
          navigate('/dashboard', { replace: true })
          return
        }
        if (shouldShowMfaSetup(status)) {
          navigate('/mfa/setup', { replace: true })
          return
        }
        if (!shouldShowMfaVerify(status) || !status.verifiedFactorId) {
          navigate('/mfa/setup', { replace: true })
          return
        }

        const nextChallengeId = await createMfaChallenge(status.verifiedFactorId)
        if (cancelled) return
        setFactorId(status.verifiedFactorId)
        setChallengeId(nextChallengeId)
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to start verification'
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const finishSignIn = async () => {
    invalidateAuthTokenCache()
    await supabase.auth.getSession()
    try {
      await authApi.confirmMfaEnrollment()
    } catch {
      // Profile may already be marked enrolled.
    }
    try {
      await authApi.getCurrentUser()
    } catch (authError: unknown) {
      const status = (authError as { response?: { status?: number; data?: { detail?: string } } })?.response?.status
      const detail = (authError as { response?: { status?: number; data?: { detail?: string } } })?.response?.data?.detail
      if (status === 403 && typeof detail === 'string' && detail.toLowerCase().includes('pending superadmin approval')) {
        await supabase.auth.signOut()
        sessionStorage.setItem('auth_notice', 'Your account is pending superadmin approval.')
        navigate('/login', { replace: true })
        return
      }
      throw authError
    }
    await refetchUserInfo()
    navigate('/dashboard', { replace: true })
  }

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!factorId || !challengeId) return

    setError('')
    setSubmitting(true)
    try {
      await verifyMfaCode(factorId, challengeId, code)
      await finishSignIn()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid verification code'
      setError(message)
      try {
        const nextChallengeId = await createMfaChallenge(factorId)
        setChallengeId(nextChallengeId)
        setCode('')
      } catch {
        // Keep existing challenge if refresh fails.
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-app-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="card p-8 shadow-xl">
          <div className="text-center mb-6">
            <img src={APP_ICON_URL} alt="MSW Overwatch" className="w-16 h-16 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-[#404040]">Two-factor verification</h1>
            <p className="mt-2 text-sm text-gray-600">
              Enter the 6-digit code from your authenticator app to finish signing in.
            </p>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">Starting verification…</div>
          ) : (
            <form className="space-y-4" onSubmit={handleVerify}>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {error}
                </div>
              )}
              <div>
                <label htmlFor="mfa-verify-code" className="block text-sm font-medium text-gray-700 mb-2">
                  Authenticator code
                </label>
                <input
                  id="mfa-verify-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="000000"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || code.length !== 6 || !challengeId}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Verifying…' : 'Verify and continue'}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="mt-6 w-full text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
