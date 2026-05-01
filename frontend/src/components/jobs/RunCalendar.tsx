import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { schedulerApi } from '../../services/api'

type CalendarResponse = Awaited<ReturnType<typeof schedulerApi.getCalendar>>
type CalendarVendor = CalendarResponse['vendors'][number]
type ViewMode = 'daily' | 'weekly' | 'monthly'

type ProjectedEvent = {
  category: string
  dateKey: string
  weekday: string
  hour: number
  minute: number
  timezone: string
  timezoneAbbrev: string
}

function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return 'N/A'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTimeOnly(hour: number, minute: number): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTimezoneAbbrevForDate(timezone: string, date: Date): string {
  const noonUtc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0))
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' }).formatToParts(noonUtc)
  return parts.find((part) => part.type === 'timeZoneName')?.value || ''
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map((part) => Number(part))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const WEEKDAY_TO_SHORT: Record<number, string> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
}

function shouldRunOnDate(vendor: CalendarVendor, date: Date): boolean {
  if (!vendor.enabled) return false

  if (vendor.run_mode === 'daily') return true

  if (vendor.run_mode === 'custom_days') {
    const dayToken = WEEKDAY_TO_SHORT[date.getDay()]
    return (vendor.custom_days || []).includes(dayToken)
  }

  if (vendor.run_mode === 'every_other_day') {
    const anchor = parseDateOnly(vendor.anchor_date) || (vendor.next_run_time ? startOfDay(new Date(vendor.next_run_time)) : null)
    if (!anchor) return false
    const diffMs = startOfDay(date).getTime() - startOfDay(anchor).getTime()
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))
    return diffDays >= 0 && diffDays % 2 === 0
  }

  return false
}

export default function RunCalendar() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('daily')
  const isFetchingRef = useRef(false)

  const loadCalendar = useCallback(async (showLoading: boolean = false) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    if (showLoading) setLoading(true)
    try {
      setError('')
      const response = await schedulerApi.getCalendar()
      setData(response)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load run calendar')
    } finally {
      setLoading(false)
      isFetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    void loadCalendar(true)

    const refreshIntervalMs = 30000
    const intervalId = window.setInterval(() => {
      void loadCalendar()
    }, refreshIntervalMs)

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void loadCalendar()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    window.addEventListener('focus', handleVisibilityOrFocus)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      window.removeEventListener('focus', handleVisibilityOrFocus)
    }
  }, [loadCalendar])

  const today = useMemo(() => startOfDay(new Date()), [])

  const projectedEvents = useMemo(() => {
    const events: ProjectedEvent[] = []
    const rangeEnd = addDays(today, 62)
    for (let cursor = new Date(today); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
      for (const vendor of data?.vendors || []) {
        if (!shouldRunOnDate(vendor, cursor)) continue
        events.push({
          category: vendor.category.toUpperCase(),
          dateKey: dayKey(cursor),
          weekday: cursor.toLocaleDateString('en-US', { weekday: 'long' }),
          hour: vendor.hour,
          minute: vendor.minute,
          timezone: vendor.timezone,
          timezoneAbbrev: formatTimezoneAbbrevForDate(vendor.timezone, cursor),
        })
      }
    }
    return events
  }, [data, today])

  const upcomingDays = useMemo(() => {
    const days: Date[] = []
    for (let i = 0; i < 14; i += 1) {
      const d = addDays(today, i)
      days.push(d)
    }
    return days
  }, [today])

  const eventsByDay = useMemo(() => {
    const buckets: Record<string, ProjectedEvent[]> = {}
    for (const event of projectedEvents) {
      const key = event.dateKey
      if (!buckets[key]) buckets[key] = []
      buckets[key].push(event)
    }
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute))
    }
    return buckets
  }, [projectedEvents])

  const upcomingWeeks = useMemo(() => {
    const weeks: Date[] = []
    const day = today.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const start = addDays(today, diffToMonday)
    for (let i = 0; i < 4; i += 1) {
      const weekStart = addDays(start, i * 7)
      weeks.push(weekStart)
    }
    return weeks
  }, [today])

  const eventsByWeek = useMemo(() => {
    const buckets: Record<string, ProjectedEvent[]> = {}
    for (const event of projectedEvents) {
      const date = parseDateOnly(event.dateKey)
      if (!date) continue
      const day = date.getDay()
      const diffToMonday = day === 0 ? -6 : 1 - day
      const weekStart = addDays(startOfDay(date), diffToMonday)
      const key = dayKey(weekStart)
      if (!buckets[key]) buckets[key] = []
      buckets[key].push(event)
    }

    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute))
    }
    return buckets
  }, [projectedEvents])

  const weeklyRowsByWeek = useMemo(() => {
    const rows: Record<string, Array<{ label: string; isHeader: boolean }>> = {}

    for (const weekStart of upcomingWeeks) {
      const key = dayKey(weekStart)
      const events = eventsByWeek[key] || []
      const byDay: Record<string, Array<{ category: string; tz: string }>> = {}

      for (const event of events) {
        const weekday = event.weekday
        if (!byDay[weekday]) byDay[weekday] = []
        byDay[weekday].push({
          category: event.category,
          tz: event.timezoneAbbrev,
        })
      }

      const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      const lines: Array<{ label: string; isHeader: boolean }> = []

      for (const weekday of dayOrder) {
        const dayEvents = byDay[weekday] || []
        if (dayEvents.length === 0) {
          lines.push({ label: weekday, isHeader: true })
          continue
        }

        const first = dayEvents[0]
        lines.push({
          label: `${weekday} - ${first.category}${first.tz ? ` (${first.tz})` : ''}`,
          isHeader: true,
        })

        for (let i = 1; i < dayEvents.length; i += 1) {
          const current = dayEvents[i]
          lines.push({
            label: `- ${current.category}${current.tz ? ` (${current.tz})` : ''}`,
            isHeader: false,
          })
        }
      }

      rows[key] = lines
    }

    return rows
  }, [eventsByWeek, upcomingWeeks])

  const monthDays = useMemo(() => {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const startDay = monthStart.getDay()
    const diffToMonday = startDay === 0 ? -6 : 1 - startDay
    const gridStart = addDays(monthStart, diffToMonday)
    const cells: Date[] = []
    for (let i = 0; i < 42; i += 1) {
      cells.push(addDays(gridStart, i))
    }
    return { monthStart, monthEnd, cells }
  }, [today])

  if (loading) {
    return (
      <div className="card p-6">
        <div className="text-gray-600">Loading run calendar...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6 bg-red-50 border-red-200">
        <div className="text-red-800">{error}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Run Calendar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Shared view of ongoing and upcoming daily runs across vendors.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Last updated: {formatLocalDateTime(data?.generated_at)}
        </p>
      </div>

      <div className="card p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Ongoing Daily Runs</h2>
        {(data?.ongoing_runs || []).length === 0 ? (
          <p className="text-sm text-gray-500">No daily runs are currently processing.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data?.ongoing_runs.map((run) => (
              <div key={run.id} className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-sm font-semibold text-[#81B81D]">{run.category.toUpperCase()} - {run.status}</p>
                <p className="text-xs text-[#81B81D]">{run.job_name}</p>
                <p className="text-xs text-[#81B81D] mt-1">Started: {formatLocalDateTime(run.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-gray-900">
            Upcoming Schedule (
            {viewMode === 'daily' ? 'Daily View' : viewMode === 'weekly' ? 'Weekly View' : 'Monthly View'}
            )
          </h2>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setViewMode('daily')}
              className={`px-3 py-1.5 text-sm rounded-md ${viewMode === 'daily' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => setViewMode('weekly')}
              className={`px-3 py-1.5 text-sm rounded-md ${viewMode === 'weekly' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setViewMode('monthly')}
              className={`px-3 py-1.5 text-sm rounded-md ${viewMode === 'monthly' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
            >
              Monthly
            </button>
          </div>
        </div>

        {viewMode === 'daily' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {upcomingDays.map((d) => {
              const key = dayKey(d)
              const events = eventsByDay[key] || []
              return (
                <div key={key} className="rounded-lg border border-gray-200 p-3 bg-white">
                  <p className="text-sm font-semibold text-gray-900">
                    {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {events.length === 0 ? (
                    <p className="text-xs text-gray-400 mt-2">No runs scheduled</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {events.map((event) => (
                        <div key={`${event.category}-${event.dateKey}-${event.hour}-${event.minute}`} className="rounded border border-gray-200 p-2">
                          <p className="text-xs font-semibold text-gray-900">
                            {formatTimeOnly(event.hour, event.minute)} - {event.category}
                            {event.timezoneAbbrev ? ` (${event.timezoneAbbrev})` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : viewMode === 'weekly' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcomingWeeks.map((weekStart) => {
              const key = dayKey(weekStart)
              const events = eventsByWeek[key] || []
              const lines = weeklyRowsByWeek[key] || []
              const weekEnd = new Date(weekStart)
              weekEnd.setDate(weekStart.getDate() + 6)
              return (
                <div key={key} className="rounded-lg border border-gray-200 p-3 bg-white">
                  <p className="text-sm font-semibold text-gray-900">
                    {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' - '}
                    {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                  {events.length === 0 ? (
                    <p className="text-xs text-gray-400 mt-2">No runs scheduled</p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {lines.map((line, idx) => (
                        <p
                          key={`${key}-${idx}-${line.label}`}
                          className={`text-xs ${line.isHeader ? 'font-semibold text-gray-900' : 'pl-5 text-gray-700'}`}
                        >
                          {line.label}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              {monthDays.monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => (
                <p key={name} className="text-xs font-semibold text-gray-500">{name}</p>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {monthDays.cells.map((cellDate) => {
                const key = dayKey(cellDate)
                const inCurrentMonth = cellDate.getMonth() === monthDays.monthStart.getMonth()
                const events = eventsByDay[key] || []
                return (
                  <div
                    key={key}
                    className={`min-h-[92px] rounded border p-2 ${inCurrentMonth ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <p className={`text-xs font-semibold ${inCurrentMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                      {cellDate.getDate()}
                    </p>
                    <div className="mt-1 space-y-1">
                      {events.slice(0, 3).map((event) => (
                        <p key={`${event.category}-${event.dateKey}-${event.hour}-${event.minute}`} className="text-[11px] text-gray-700 truncate">
                          {event.category} {event.timezoneAbbrev ? `(${event.timezoneAbbrev})` : ''}
                        </p>
                      ))}
                      {events.length > 3 && (
                        <p className="text-[11px] text-gray-500">+{events.length - 3} more</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Vendor Schedule Snapshot</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Enabled</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Next Run</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Latest Job</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(data?.vendors || []).map((vendor) => (
                <tr key={vendor.category}>
                  <td className="px-4 py-2 text-sm font-semibold text-gray-900">{vendor.category.toUpperCase()}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{vendor.enabled ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{formatLocalDateTime(vendor.next_run_time)}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{vendor.latest_job?.status || 'No runs yet'}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{vendor.is_ongoing ? 'Ongoing' : 'Idle'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
