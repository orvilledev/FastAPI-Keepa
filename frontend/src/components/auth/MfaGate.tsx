import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import {
  ensureMfaActivityInitialized,
  fetchMfaStatus,
  getMfaExemptEmails,
  isMfaExemptEmail,
  isMfaIdleReverifyDue,
  shouldShowMfaSetup,
  shouldShowMfaVerify,
  type MfaStatus,
} from '../../lib/mfa'

type MfaGateProps = {
  children: ReactNode
  requireFullAuth?: boolean
}

/**
 * Ensures MFA enrollment and verification are complete before rendering protected UI.
 * `requireFullAuth=false` allows the enrollment page while the user is at AAL1.
 * Accounts on the MFA-exempt list (shared warehouse stations) skip this gate.
 */
export default function MfaGate({ children, requireFullAuth = true }: MfaGateProps) {
  const { authUser, authLoading, userInfo } = useUser()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [exemptEmails, setExemptEmails] = useState<string[] | null>(null)
  const [checking, setChecking] = useState(true)

  const userEmail = authUser?.email ?? userInfo?.email
  const isExempt =
    Boolean(userInfo?.mfa_exempt) ||
    (exemptEmails !== null && isMfaExemptEmail(userEmail, exemptEmails))

  useEffect(() => {
    let cancelled = false
    void getMfaExemptEmails().then((emails) => {
      if (!cancelled) setExemptEmails(emails)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      if (!authUser) {
        if (!cancelled) {
          setStatus(null)
          setChecking(false)
        }
        return
      }

      if (exemptEmails === null) return

      if (isMfaExemptEmail(authUser.email, exemptEmails) || userInfo?.mfa_exempt) {
        if (!cancelled) {
          setStatus(null)
          setChecking(false)
        }
        return
      }

      if (!cancelled && status === null) setChecking(true)
      try {
        const nextStatus = await fetchMfaStatus()
        if (nextStatus.isFullyAuthenticated) ensureMfaActivityInitialized()
        if (!cancelled) setStatus(nextStatus)
      } catch {
        if (!cancelled) {
          setStatus({
            hasVerifiedTotp: false,
            needsEnrollment: true,
            needsMfaVerify: false,
            isFullyAuthenticated: false,
            verifiedFactorId: null,
          })
        }
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    if (!authLoading) {
      void check()
    }

    return () => {
      cancelled = true
    }
  }, [authUser?.id, authUser?.email, authLoading, exemptEmails, userInfo?.mfa_exempt])

  if (authLoading || exemptEmails === null || (checking && status === null && !isExempt)) {
    return (
      <div className="min-h-app-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
        <div className="w-10 h-10 border-4 border-[#404040] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!authUser) {
    return <Navigate to="/login" replace />
  }

  if (isExempt) {
    return <>{children}</>
  }

  if (requireFullAuth) {
    if (shouldShowMfaSetup(status)) {
      return <Navigate to="/mfa/setup" replace />
    }
    if (shouldShowMfaVerify(status)) {
      return <Navigate to="/mfa/verify" replace />
    }
    // Fully authenticated but idle past the limit — force a fresh TOTP code.
    if (status?.isFullyAuthenticated && isMfaIdleReverifyDue()) {
      return <Navigate to="/mfa/verify?reason=idle" replace />
    }
  } else if (status?.isFullyAuthenticated && !isMfaIdleReverifyDue()) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
