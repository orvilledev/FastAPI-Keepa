import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { schedulerApi } from '../../services/api'
import { getDevBypassCalendarVendors, isDevAuthBypass } from '../../lib/devAuth'

const VENDORS = [
  { code: 'dnk', label: 'DNK (Dansko)' },
  { code: 'clk', label: 'CLK (Clarks)' },
  { code: 'obz', label: 'OBZ (Oboz)' },
  { code: 'ref', label: 'REF (Reef)' },
  { code: 'bor', label: 'BOR (Born)' },
  { code: 'sff', label: 'SFF (Sofft)' },
  { code: 'tev', label: 'TEV (Teva)' },
  { code: 'cha', label: 'CHA (Chaco)' },
  { code: 'jfs', label: 'JFS (Josef Siebel)' },
] as const

type VendorCode = (typeof VENDORS)[number]['code']

type CalendarVendor = Awaited<ReturnType<typeof schedulerApi.getCalendar>>['vendors'][number]

function isVendorActive(vendor: CalendarVendor | undefined, nowMs: number): boolean {
  if (!vendor?.enabled || !vendor.next_run_time) return false
  const nextRunMs = new Date(vendor.next_run_time).getTime()
  return Number.isFinite(nextRunMs) && nextRunMs > nowMs
}

function VendorCard({ code, label, active }: { code: VendorCode; label: string; active: boolean }) {
  return (
    <Link to={`/daily-run/${code}`} className="vendor-hub-card">
      <div className="flex items-center gap-3">
        <div className="vendor-hub-card-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#404040] text-white transition-colors duration-300">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="17" cy="4" r="2" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 6.5l-1.5 3 1.5 1-2.5 7" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.5 12l-1 5" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.5 12l3-1.5" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 10.5l2.5-1.5 2-3.5" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.5 5.5l-1 2" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="vendor-hub-card-title text-base font-semibold text-gray-900 transition-colors duration-300">
              {label}
            </h2>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                active
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="vendor-hub-card-subtitle text-xs text-gray-500 transition-colors duration-300">
            Scheduler &amp; run history
          </p>
        </div>
      </div>
    </Link>
  )
}

export default function DailyRunsMenu() {
  const [vendorByCode, setVendorByCode] = useState<Partial<Record<VendorCode, CalendarVendor>>>({})
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())

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
    let cancelled = false

    const applyCalendar = (vendors: CalendarVendor[]) => {
      const next: Partial<Record<VendorCode, CalendarVendor>> = {}
      for (const vendor of vendors) {
        const code = String(vendor.category || '').toLowerCase() as VendorCode
        if (VENDORS.some((v) => v.code === code)) {
          next[code] = vendor
        }
      }
      setVendorByCode(next)
      setStatusError(null)
    }

    const loadStatus = async () => {
      try {
        if (isDevAuthBypass()) {
          try {
            const calendar = await schedulerApi.getCalendar()
            if (cancelled) return
            const hasFuture = (calendar.vendors || []).some((vendor) =>
              isVendorActive(vendor, Date.now()),
            )
            if (hasFuture) {
              applyCalendar(calendar.vendors || [])
              return
            }
          } catch {
            // Fall through to local fixtures when the API is unreachable.
          }
          if (cancelled) return
          applyCalendar(getDevBypassCalendarVendors() as CalendarVendor[])
          return
        }

        const calendar = await schedulerApi.getCalendar()
        if (cancelled) return
        applyCalendar(calendar.vendors || [])
      } catch (err: any) {
        if (cancelled) return
        console.error('Failed to load daily-run calendar:', err)
        setStatusError(err?.response?.data?.detail || err?.message || 'Could not refresh run status')
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    }

    loadStatus()
    const interval = setInterval(loadStatus, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const { activeVendors, inactiveVendors } = useMemo(() => {
    const active: typeof VENDORS[number][] = []
    const inactive: typeof VENDORS[number][] = []
    for (const vendor of VENDORS) {
      if (isVendorActive(vendorByCode[vendor.code], nowMs)) {
        active.push(vendor)
      } else {
        inactive.push(vendor)
      }
    }
    return { activeVendors: active, inactiveVendors: inactive }
  }, [vendorByCode, nowMs])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Daily Runs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Select a vendor to open its scheduler, run history, and API/Upload toggle.
        </p>
      </div>

      {statusError && (
        <div className="card border border-[#81B81D]/40 bg-[#81B81D]/10 p-4 text-sm text-[#111827]">
          Could not refresh active run status. Showing the most recent known grouping.
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Active</h2>
          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
            {activeVendors.length} Running
          </span>
        </div>
        {statusLoading ? (
          <p className="text-sm text-gray-500">Refreshing run status…</p>
        ) : activeVendors.length === 0 ? (
          <p className="text-sm text-gray-500">No vendors are actively scheduled right now.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {activeVendors.map(({ code, label }) => (
              <VendorCard key={`active-${code}`} code={code} label={label} active />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Inactive</h2>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
            {inactiveVendors.length} Not Running
          </span>
        </div>
        {statusLoading ? (
          <p className="text-sm text-gray-500">Refreshing run status…</p>
        ) : inactiveVendors.length === 0 ? (
          <p className="text-sm text-gray-500">All vendors are currently active.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {inactiveVendors.map(({ code, label }) => (
              <VendorCard key={`inactive-${code}`} code={code} label={label} active={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
