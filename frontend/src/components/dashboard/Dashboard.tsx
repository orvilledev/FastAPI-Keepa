import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import VendorRunCard from './VendorRunCard'
import WelcomePopup from './WelcomePopup'
import { schedulerApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'

type VendorCategory = 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'
const VENDOR_ORDER: VendorCategory[] = ['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha']
const VENDOR_LABELS: Record<VendorCategory, string> = {
  dnk: 'DNK',
  clk: 'CLK',
  obz: 'OBZ',
  ref: 'REF',
  bor: 'BOR',
  sff: 'SFF',
  tev: 'TEV',
  cha: 'CHA',
}
type CalendarResponse = Awaited<ReturnType<typeof schedulerApi.getCalendar>>
type CalendarVendor = CalendarResponse['vendors'][number]

function FallbackVendorCard({ category }: { category: VendorCategory }) {
  return (
    <div className="card p-6">
      <div className="text-center text-gray-500">Loading {category.toUpperCase()} scheduler status...</div>
    </div>
  )
}

export default function Dashboard() {
  const { hasKeepaAccess, displayName, userInfoLoading } = useUser()
  const [greeting, setGreeting] = useState('')
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [activeCategories, setActiveCategories] = useState<Set<VendorCategory>>(new Set())
  const [vendorData, setVendorData] = useState<Record<string, CalendarVendor>>({})
  const [nowMs, setNowMs] = useState(Date.now())

  // Set greeting from context
  useEffect(() => {
    if (!userInfoLoading && displayName) {
      const capitalizedName = displayName.charAt(0).toUpperCase() + displayName.slice(1)
      setGreeting(`Welcome, ${capitalizedName}!`)
    }
  }, [displayName, userInfoLoading])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

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
          const nextRunMs = vendor.next_run_time ? new Date(vendor.next_run_time).getTime() : null
          const hasActiveCountdown = Boolean(
            vendor.enabled &&
            vendor.next_run_time &&
            nextRunMs !== null &&
            nextRunMs > Date.now()
          )
          if (VENDOR_ORDER.includes(category) && hasActiveCountdown) {
            active.add(category)
          }
        }
        setActiveCategories(active)
        const byCategory: Record<string, CalendarVendor> = {}
        for (const vendor of calendar.vendors || []) {
          const category = String(vendor.category || '').toLowerCase()
          if (category) byCategory[category] = vendor
        }
        setVendorData(byCategory)
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
      dnk: vendorData.dnk ? <VendorRunCard vendor={vendorData.dnk} nowMs={nowMs} /> : <FallbackVendorCard category="dnk" />,
      clk: vendorData.clk ? <VendorRunCard vendor={vendorData.clk} nowMs={nowMs} /> : <FallbackVendorCard category="clk" />,
      obz: vendorData.obz ? <VendorRunCard vendor={vendorData.obz} nowMs={nowMs} /> : <FallbackVendorCard category="obz" />,
      ref: vendorData.ref ? <VendorRunCard vendor={vendorData.ref} nowMs={nowMs} /> : <FallbackVendorCard category="ref" />,
      bor: vendorData.bor ? <VendorRunCard vendor={vendorData.bor} nowMs={nowMs} /> : <FallbackVendorCard category="bor" />,
      sff: vendorData.sff ? <VendorRunCard vendor={vendorData.sff} nowMs={nowMs} /> : <FallbackVendorCard category="sff" />,
      tev: vendorData.tev ? <VendorRunCard vendor={vendorData.tev} nowMs={nowMs} /> : <FallbackVendorCard category="tev" />,
      cha: vendorData.cha ? <VendorRunCard vendor={vendorData.cha} nowMs={nowMs} /> : <FallbackVendorCard category="cha" />,
    }),
    [vendorData, nowMs]
  )

  const activeVendorOrder = VENDOR_ORDER.filter((category) => activeCategories.has(category))
  const inactiveVendorOrder = VENDOR_ORDER.filter((category) => !activeCategories.has(category))

  return (
    <div className="space-y-6">
      <WelcomePopup />
      {/* Greeting */}
      {!userInfoLoading && greeting && (
        <div>
          <h1 className="text-5xl font-bold text-gray-900">{greeting}</h1>
          <p className="mt-3 text-lg text-gray-600">Stop overthinking and start building.</p>
        </div>
      )}

      {hasKeepaAccess && (
        <>
          {statusError && (
            <div className="card p-4 border border-[#81B81D]/40 bg-[#81B81D]/10 text-[#111827] text-sm">
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
              <div className="flex flex-wrap gap-3">
                {inactiveVendorOrder.map((category) => (
                  <Link
                    key={`inactive-${category}`}
                    to={`/daily-run/${category}`}
                    className="inline-flex items-center rounded-[16px] bg-[#81B81D] text-white font-bold text-lg px-6 py-2 shadow-sm"
                  >
                    {VENDOR_LABELS[category]}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

