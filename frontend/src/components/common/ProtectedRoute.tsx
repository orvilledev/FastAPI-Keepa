import { Navigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireKeepaAccess?: boolean
}

export default function ProtectedRoute({ children, requireKeepaAccess = false }: ProtectedRouteProps) {
  const { hasKeepaAccess, userInfoLoading, userInfo } = useUser()

  // Only show loading spinner on initial load, not on background re-fetches
  if (userInfoLoading && !userInfo) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#0B1020] border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (requireKeepaAccess && !hasKeepaAccess) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

