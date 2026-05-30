import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { fetchMfaStatus, type MfaStatus } from '../../lib/mfa'

type MfaGateProps = {
  children: ReactNode
  requireFullAuth?: boolean
}

/**
 * Ensures MFA enrollment and verification are complete before rendering protected UI.
 * `requireFullAuth=false` allows the enrollment page while the user is at AAL1.
 */
export default function MfaGate({ children, requireFullAuth = true }: MfaGateProps) {
  const { authUser, authLoading } = useUser()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [checking, setChecking] = useState(true)

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

      setChecking(true)
      try {
        const nextStatus = await fetchMfaStatus()
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
  }, [authUser, authLoading])

  if (authLoading || checking) {
    return (
      <div className="min-h-app-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#404040] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!authUser) {
    return <Navigate to="/login" replace />
  }

  if (requireFullAuth) {
    if (status?.needsEnrollment) {
      return <Navigate to="/mfa/setup" replace />
    }
    if (status?.needsMfaVerify) {
      return <Navigate to="/mfa/verify" replace />
    }
    if (!status?.isFullyAuthenticated) {
      return <Navigate to="/mfa/verify" replace />
    }
  } else if (status?.isFullyAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
