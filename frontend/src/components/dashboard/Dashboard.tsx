import { useEffect, useMemo, useState } from 'react'
import DNKSchedulerCountdown from './DNKSchedulerCountdown'
import CLKSchedulerCountdown from './CLKSchedulerCountdown'
import OBZSchedulerCountdown from './OBZSchedulerCountdown'
import REFSchedulerCountdown from './REFSchedulerCountdown'
import BORSchedulerCountdown from './BORSchedulerCountdown'
import SFFSchedulerCountdown from './SFFSchedulerCountdown'
import TEVSchedulerCountdown from './TEVSchedulerCountdown'
import CHASchedulerCountdown from './CHASchedulerCountdown'
import { schedulerApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'

type VendorCategory = 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'
const VENDOR_ORDER: VendorCategory[] = ['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha']

export default function Dashboard() {
  const { hasKeepaAccess, displayName, userInfoLoading } = useUser()
  const [greeting, setGreeting] = useState('')
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [activeCategories, setActiveCategories] = useState<Set<VendorCategory>>(new Set())

  // Set greeting from context
  useEffect(() => {
    if (!userInfoLoading && displayName) {
      const capitalizedName = displayName.charAt(0).toUpperCase() + displayName.slice(1)
      setGreeting(`Welcome, ${capitalizedName}!`)
    }
  }, [displayName, userInfoLoading])

  useEffect(() => {
    if (userInfoLoading || !hasKeepaAccess) {
      setStatusLoading(false)
      return
    }

    let cancelled = false
    const loadRunStatus = async () => {
      try {
        const calendar = await schedulerApi.getCalendar()
        if (cancelled) return
        const active = new Set<VendorCategory>()
        for (const vendor of calendar.vendors || []) {
          const category = String(vendor.category || '').toLowerCase() as VendorCategory
          if (VENDOR_ORDER.includes(category) && vendor.is_ongoing) {
            active.add(category)
          }
        }
        setActiveCategories(active)
        setStatusError(null)
      } catch (err: any) {
        if (cancelled) return
        console.error('Failed to load scheduler calendar:', err)
        setStatusError(err?.response?.data?.detail || err?.message || 'Could not refresh run status')
      } finally {
        if (!cancelled) {
          setStatusLoading(false)
        }
      }
    }

    loadRunStatus()
    const interval = setInterval(loadRunStatus, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [hasKeepaAccess, userInfoLoading])

  const vendorWidgetsByCategory = useMemo<Record<VendorCategory, React.ReactNode>>(
    () => ({
      dnk: <DNKSchedulerCountdown />,
      clk: <CLKSchedulerCountdown />,
      obz: <OBZSchedulerCountdown />,
      ref: <REFSchedulerCountdown />,
      bor: <BORSchedulerCountdown />,
      sff: <SFFSchedulerCountdown />,
      tev: <TEVSchedulerCountdown />,
      cha: <CHASchedulerCountdown />,
    }),
    []
  )

  const activeVendorOrder = VENDOR_ORDER.filter((category) => activeCategories.has(category))
  const inactiveVendorOrder = VENDOR_ORDER.filter((category) => !activeCategories.has(category))

  return (
    <div className="space-y-6">
      {/* Greeting */}
      {!userInfoLoading && greeting && (
        <div>
          <h1 className="text-5xl font-bold text-gray-900">{greeting}</h1>
          <p className="mt-3 text-lg text-gray-600">Let's get started and make today productive!</p>
        </div>
      )}

      {hasKeepaAccess && (
        <>
          {statusError && (
            <div className="card p-4 border border-amber-200 bg-amber-50 text-amber-800 text-sm">
              Could not refresh active run status. Showing the most recent known grouping.
            </div>
          )}

          {/* Active Runs Container */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Active Runs</h2>
              <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded-full font-medium">
                {activeVendorOrder.length} Running
              </span>
            </div>
            {statusLoading ? (
              <div className="text-sm text-gray-500">Refreshing run status...</div>
            ) : activeVendorOrder.length === 0 ? (
              <div className="text-sm text-gray-500">No vendors are actively running right now.</div>
            ) : (
              <div className="space-y-4">
                {activeVendorOrder.map((category) => (
                  <div key={`active-${category}`}>{vendorWidgetsByCategory[category]}</div>
                ))}
              </div>
            )}
          </div>

          {/* Inactive Runs Container */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Inactive Runs</h2>
              <span className="text-xs text-gray-700 bg-gray-100 px-2 py-1 rounded-full font-medium">
                {inactiveVendorOrder.length} Not Running
              </span>
            </div>
            {inactiveVendorOrder.length === 0 ? (
              <div className="text-sm text-gray-500">All vendors are currently running.</div>
            ) : (
              <div className="space-y-4">
                {inactiveVendorOrder.map((category) => (
                  <div key={`inactive-${category}`}>{vendorWidgetsByCategory[category]}</div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

