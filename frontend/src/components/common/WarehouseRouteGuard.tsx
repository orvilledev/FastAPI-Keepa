import { Navigate, useLocation } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { isWarehouseAllowedPath, WAREHOUSE_HOME_PATH } from '../../constants/warehouseAccess'

/** Redirect warehouse-only users away from routes outside Label Station + General. */
export default function WarehouseRouteGuard({ children }: { children: React.ReactNode }) {
  const { isWarehouseOnly, userInfo, userInfoLoading } = useUser()
  const location = useLocation()

  if (!isWarehouseOnly) {
    return <>{children}</>
  }

  if (!userInfo || userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#404040] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isWarehouseAllowedPath(location.pathname)) {
    return <Navigate to={WAREHOUSE_HOME_PATH} replace />
  }

  return <>{children}</>
}
