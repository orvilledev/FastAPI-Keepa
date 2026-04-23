import { useEffect, useMemo, useState } from 'react'
import { schedulerApi } from '../../services/api'

type CalendarResponse = Awaited<ReturnType<typeof schedulerApi.getCalendar>>

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

export default function RunCalendar() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily')

  useEffect(() => {
    const load = async () => {
      try {
        setError('')
        const response = await schedulerApi.getCalendar()
        setData(response)
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to load run calendar')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const upcomingDays = useMemo(() => {
    const days: Date[] = []
    const now = new Date()
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() + i)
      days.push(d)
    }
    return days
  }, [])

  const eventsByDay = useMemo(() => {
    const buckets: Record<string, Array<{
      category: string
      next_run_time: string
      scheduled_time: string
      is_ongoing: boolean
    }>> = {}
    for (const vendor of data?.vendors || []) {
      if (!vendor.next_run_time) continue
      const date = new Date(vendor.next_run_time)
      if (Number.isNaN(date.getTime())) continue
      const key = dayKey(date)
      if (!buckets[key]) buckets[key] = []
      buckets[key].push({
        category: vendor.category,
        next_run_time: vendor.next_run_time,
        scheduled_time: vendor.scheduled_time,
        is_ongoing: vendor.is_ongoing,
      })
    }
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => new Date(a.next_run_time).getTime() - new Date(b.next_run_time).getTime())
    }
    return buckets
  }, [data])

  const upcomingWeeks = useMemo(() => {
    const weeks: Date[] = []
    const now = new Date()
    const day = now.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() + diffToMonday)
    for (let i = 0; i < 4; i += 1) {
      const weekStart = new Date(start)
      weekStart.setDate(start.getDate() + (i * 7))
      weeks.push(weekStart)
    }
    return weeks
  }, [])

  const eventsByWeek = useMemo(() => {
    const buckets: Record<string, Array<{
      category: string
      next_run_time: string
      scheduled_time: string
      is_ongoing: boolean
    }>> = {}

    for (const vendor of data?.vendors || []) {
      if (!vendor.next_run_time) continue
      const date = new Date(vendor.next_run_time)
      if (Number.isNaN(date.getTime())) continue
      const weekStart = new Date(date)
      const day = weekStart.getDay()
      const diffToMonday = day === 0 ? -6 : 1 - day
      weekStart.setHours(0, 0, 0, 0)
      weekStart.setDate(weekStart.getDate() + diffToMonday)
      const key = dayKey(weekStart)
      if (!buckets[key]) buckets[key] = []
      buckets[key].push({
        category: vendor.category,
        next_run_time: vendor.next_run_time,
        scheduled_time: vendor.scheduled_time,
        is_ongoing: vendor.is_ongoing,
      })
    }

    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => new Date(a.next_run_time).getTime() - new Date(b.next_run_time).getTime())
    }
    return buckets
  }, [data])

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
                <p className="text-sm font-semibold text-blue-900">{run.category.toUpperCase()} - {run.status}</p>
                <p className="text-xs text-blue-800">{run.job_name}</p>
                <p className="text-xs text-blue-700 mt-1">Started: {formatLocalDateTime(run.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-gray-900">
            Upcoming Schedule ({viewMode === 'daily' ? 'Daily View' : 'Weekly View'})
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
                        <div key={`${event.category}-${event.next_run_time}`} className="rounded border border-gray-200 p-2">
                          <p className="text-xs font-semibold text-gray-900">{event.category.toUpperCase()}</p>
                          <p className="text-xs text-gray-700">{formatLocalDateTime(event.next_run_time)}</p>
                          <p className="text-[11px] text-gray-500">{event.scheduled_time}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcomingWeeks.map((weekStart) => {
              const key = dayKey(weekStart)
              const events = eventsByWeek[key] || []
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
                    <div className="mt-2 space-y-2">
                      {events.map((event) => (
                        <div key={`${event.category}-${event.next_run_time}`} className="rounded border border-gray-200 p-2">
                          <p className="text-xs font-semibold text-gray-900">{event.category.toUpperCase()}</p>
                          <p className="text-xs text-gray-700">{formatLocalDateTime(event.next_run_time)}</p>
                          <p className="text-[11px] text-gray-500">{event.scheduled_time}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
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
