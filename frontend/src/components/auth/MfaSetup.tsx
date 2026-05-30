import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { APP_ICON_URL } from '../../constants/app'
import { authApi } from '../../services/api'
import { enrollTotpFactor, fetchMfaStatus, verifyEnrollmentCode } from '../../lib/mfa'
import { supabase } from '../../lib/supabase'

export default function MfaSetup() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
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

        if (status.hasVerifiedTotp && status.needsMfaVerify) {
          navigate('/login', { replace: true, state: { mfaStep: true } })
          return
        }

        const enrollment = await enrollTotpFactor()
        if (cancelled) return
        setFactorId(enrollment.id)
        setQrCode(enrollment.totp.qr_code)
        setSecret(enrollment.totp.secret)
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to start authenticator setup'
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

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!factorId) return

    setError('')
    setSubmitting(true)
    try {
      await verifyEnrollmentCode(factorId, code)
      await authApi.confirmMfaEnrollment()
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid verification code'
      setError(message)
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
      <div className="max-w-lg w-full">
        <div className="card p-8 shadow-xl">
          <div className="text-center mb-6">
            <img src={APP_ICON_URL} alt="MSW Overwatch" className="w-16 h-16 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-[#404040]">Set up two-factor authentication</h1>
            <p className="mt-2 text-sm text-gray-600">
              Scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password, etc.),
              then enter the 6-digit code to finish.
            </p>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">Preparing your authenticator setup…</div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {error}
                </div>
              )}

              {qrCode && (
                <div className="flex flex-col items-center gap-4">
                  <div
                    className="rounded-lg border border-gray-200 bg-white p-4"
                    dangerouslySetInnerHTML={{ __html: qrCode }}
                  />
                  {secret && (
                    <p className="text-xs text-gray-500 text-center break-all">
                      Manual entry key: <span className="font-mono text-gray-800">{secret}</span>
                    </p>
                  )}
                </div>
              )}

              <form className="mt-6 space-y-4" onSubmit={handleVerify}>
                <div>
                  <label htmlFor="mfa-setup-code" className="block text-sm font-medium text-gray-700 mb-2">
                    Verification code
                  </label>
                  <input
                    id="mfa-setup-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="000000"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || code.length !== 6}
                  className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Verifying…' : 'Enable two-factor authentication'}
                </button>
              </form>
            </>
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
