import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import VendorRunCard from './VendorRunCard'
import DancingCapybaraReminderModal, {
  useDailyRunCapybaraReminder,
} from './DancingCapybaraReminderModal'
import { schedulerApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import { getDevBypassCalendarVendors, isDevAuthBypass } from '../../lib/devAuth'
import {
  loadReminderVendors,
  setReminderVendorEnabled,
  type ReminderVendorCode,
} from '../../lib/dailyRunReminderPrefs'
import { ensureReminderNotificationPermission } from '../../lib/dailyRunReminderNotify'

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
  const { hasKeepaAccess, displayName, userInfoLoading, userInfo, authUser, refetchUserInfo } = useUser()
  const userId = userInfo?.id || authUser?.id || 'anonymous'
  const [greeting, setGreeting] = useState('')
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [activeCategories, setActiveCategories] = useState<Set<VendorCategory>>(new Set())
  const [vendorData, setVendorData] = useState<Record<string, CalendarVendor>>({})
  const [nowMs, setNowMs] = useState(Date.now())
  const [reminderVendors, setReminderVendors] = useState<Set<ReminderVendorCode>>(() =>
    loadReminderVendors(userId),
  )

  useEffect(() => {
    setReminderVendors(loadReminderVendors(userId))
  }, [userId])

  const handleReminderToggle = (category: VendorCategory, enabled: boolean) => {
    const next = setReminderVendorEnabled(userId, category, enabled)
    setReminderVendors(new Set(next))
    // Permission must be requested from a user gesture so minimized PWAs can get OS toasts.
    if (enabled) {
      void ensureReminderNotificationPermission()
    }
  }

  const { alert, dismiss, snooze, preview } = useDailyRunCapybaraReminder({
    userId,
    enabledVendors: reminderVendors,
    vendorData,
    nowMs,
  })

  // Instant demo via /dashboard?capybara=1 (or ?capybara=clk)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = (params.get('capybara') || '').trim().toLowerCase()
    if (!raw) return
    const vendor = (
      ['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha'].includes(raw) ? raw : 'clk'
    ) as ReminderVendorCode
    preview(vendor)
    params.delete('capybara')
    const next = params.toString()
    const path = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', path)
  }, [preview])

  // Load profile if MFA completed but context missed the API response
  useEffect(() => {
    if (!userInfoLoading && !userInfo) {
      void refetchUserInfo()
    }
  }, [userInfo, userInfoLoading, refetchUserInfo])

  // Set greeting from context
  useEffect(() => {
    if (!userInfoLoading && displayName) {
      const capitalizedName = displayName.charAt(0).toUpperCase() + displayName.slice(1)
      setGreeting(`Welcome, ${capitalizedName}!`)
    }
  }, [displayName, userInfoLoading])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    const bump = () => setNowMs(Date.now())
    document.addEventListener('visibilitychange', bump)
    window.addEventListener('focus', bump)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', bump)
      window.removeEventListener('focus', bump)
    }
  }, [])

  useEffect(() => {
    if (userInfoLoading || !hasKeepaAccess) {
      setStatusLoading(false)
      return
    }

    let cancelled = false
    const applyCalendar = (calendar: CalendarResponse) => {
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
    }

    const loadRunStatus = async () => {
      try {
        if (isDevAuthBypass()) {
          try {
            const calendar = await schedulerApi.getCalendar()
            if (cancelled) return
            const hasFuture = (calendar.vendors || []).some((vendor) => {
              const nextRunMs = vendor.next_run_time ? new Date(vendor.next_run_time).getTime() : null
              return Boolean(vendor.enabled && nextRunMs !== null && nextRunMs > Date.now())
            })
            if (hasFuture) {
              applyCalendar(calendar)
              return
            }
          } catch {
            // Fall through to local fixtures when the API is unreachable.
          }
          if (cancelled) return
          applyCalendar({
            generated_at: new Date().toISOString(),
            vendors: getDevBypassCalendarVendors(),
            ongoing_runs: [],
          })
          return
        }

        const calendar = await schedulerApi.getCalendar()
        if (cancelled) return
        applyCalendar(calendar)
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
      dnk: vendorData.dnk ? (
        <VendorRunCard
          vendor={vendorData.dnk}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('dnk')}
          onReminderToggle={(on) => handleReminderToggle('dnk', on)}
        />
      ) : (
        <FallbackVendorCard category="dnk" />
      ),
      clk: vendorData.clk ? (
        <VendorRunCard
          vendor={vendorData.clk}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('clk')}
          onReminderToggle={(on) => handleReminderToggle('clk', on)}
        />
      ) : (
        <FallbackVendorCard category="clk" />
      ),
      obz: vendorData.obz ? (
        <VendorRunCard
          vendor={vendorData.obz}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('obz')}
          onReminderToggle={(on) => handleReminderToggle('obz', on)}
        />
      ) : (
        <FallbackVendorCard category="obz" />
      ),
      ref: vendorData.ref ? (
        <VendorRunCard
          vendor={vendorData.ref}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('ref')}
          onReminderToggle={(on) => handleReminderToggle('ref', on)}
        />
      ) : (
        <FallbackVendorCard category="ref" />
      ),
      bor: vendorData.bor ? (
        <VendorRunCard
          vendor={vendorData.bor}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('bor')}
          onReminderToggle={(on) => handleReminderToggle('bor', on)}
        />
      ) : (
        <FallbackVendorCard category="bor" />
      ),
      sff: vendorData.sff ? (
        <VendorRunCard
          vendor={vendorData.sff}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('sff')}
          onReminderToggle={(on) => handleReminderToggle('sff', on)}
        />
      ) : (
        <FallbackVendorCard category="sff" />
      ),
      tev: vendorData.tev ? (
        <VendorRunCard
          vendor={vendorData.tev}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('tev')}
          onReminderToggle={(on) => handleReminderToggle('tev', on)}
        />
      ) : (
        <FallbackVendorCard category="tev" />
      ),
      cha: vendorData.cha ? (
        <VendorRunCard
          vendor={vendorData.cha}
          nowMs={nowMs}
          reminderEnabled={reminderVendors.has('cha')}
          onReminderToggle={(on) => handleReminderToggle('cha', on)}
        />
      ) : (
        <FallbackVendorCard category="cha" />
      ),
    }),
    [vendorData, nowMs, reminderVendors, userId],
  )

  const activeVendorOrder = VENDOR_ORDER.filter((category) => activeCategories.has(category))
  const inactiveVendorOrder = VENDOR_ORDER.filter((category) => !activeCategories.has(category))

  return (
    <div className="space-y-6">
      <DancingCapybaraReminderModal alert={alert} onDismiss={dismiss} onSnooze={snooze} />

      {userInfoLoading && (
        <p className="text-sm text-gray-500">Loading your profile…</p>
      )}
      {/* Greeting */}
      {!userInfoLoading && greeting && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{greeting}</h1>
          <p className="mt-2 text-base text-gray-600">Stop overthinking and start building.</p>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-gray-900">Active Runs</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => preview('clk')}
                  className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                  title="Show the dancing capybara reminder (demo only)"
                >
                  Preview capybara
                </button>
                <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded-full font-medium">
                  {activeVendorOrder.length} Running
                </span>
              </div>
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
                    className="inline-flex items-center rounded-[16px] bg-[#81B81D] text-white font-bold text-base px-5 py-2 shadow-sm"
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
