import { Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { authApi } from '../../services/api'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireKeepaAccess?: boolean
}

export default function ProtectedRoute({ children, requireKeepaAccess = false }: ProtectedRouteProps) {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkAccess = async () => {
      try {
        if (requireKeepaAccess) {
          const userInfo = await authApi.getCurrentUser()
          setHasAccess(userInfo.has_keepa_access || false)
        } else {
          setHasAccess(true)
        }
      } catch (error) {
        console.error('Failed to check access:', error)
        setHasAccess(false)
      } finally {
        setLoading(false)
      }
    }
    checkAccess()
  }, [requireKeepaAccess])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (requireKeepaAccess && !hasAccess) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

