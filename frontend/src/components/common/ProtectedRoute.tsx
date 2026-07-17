import { Navigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { canAccessWebAnalytics } from '../../lib/devFeatures'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireKeepaAccess?: boolean
  requireLabelStationAccess?: boolean
  requireAnalyticsAccess?: boolean
}

export default function ProtectedRoute({
  children,
  requireKeepaAccess = false,
  requireLabelStationAccess = false,
  requireAnalyticsAccess = false,
}: ProtectedRouteProps) {
  const {
    hasKeepaAccess,
    hasLabelStationAccess,
    isWarehouseOnly,
    userInfoLoading,
    userInfo,
    authUser,
  } = useUser()

  // Wait for profile bootstrap before enforcing access checks on refresh.
  // Without this guard, Keepa-protected routes can briefly redirect to
  // /dashboard before userInfo arrives.
  if (!userInfo || userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#404040] border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (requireKeepaAccess && !hasKeepaAccess) {
    return <Navigate to={isWarehouseOnly ? '/label-station' : '/dashboard'} replace />
  }

  if (requireLabelStationAccess && !hasLabelStationAccess) {
    return <Navigate to="/dashboard" replace />
  }

  if (requireAnalyticsAccess) {
    const email = userInfo.email || authUser?.email || null
    if (!canAccessWebAnalytics(email)) {
      return <Navigate to="/dashboard" replace />
    }
  }

  return <>{children}</>
}

