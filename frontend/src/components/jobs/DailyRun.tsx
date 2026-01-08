import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { jobsApi, authApi, schedulerApi } from '../../services/api'

interface DailyRunJob {
  id: string
  job_name: string
  status: string
  total_batches: number
  completed_batches: number
  created_at: string
  completed_at?: string
  error_message?: string
}

export default function DailyRun() {
  const [loading, setLoading] = useState(true)
  const [hasKeepaAccess, setHasKeepaAccess] = useState(false)
  const [dailyRuns, setDailyRuns] = useState<DailyRunJob[]>([])
  const [nextRun, setNextRun] = useState<any>(null)
  const [schedulerSettings, setSchedulerSettings] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    checkKeepaAccess()
    loadNextRun()
    loadSchedulerSettings()
  }, [])

  useEffect(() => {
    if (hasKeepaAccess) {
      loadDailyRuns()
    }
  }, [hasKeepaAccess])

  const checkKeepaAccess = async () => {
    try {
      const userInfo = await authApi.getCurrentUser()
      setHasKeepaAccess(userInfo.has_keepa_access || false)
      setLoading(false)
    } catch (error) {
      console.error('Failed to check Keepa access:', error)
      setHasKeepaAccess(false)
      setLoading(false)
    }
  }

  const loadNextRun = async () => {
    try {
      const data = await schedulerApi.getNextRun()
      setNextRun(data)
    } catch (err: any) {
      console.error('Failed to load next run:', err)
    }
  }

  const loadSchedulerSettings = async () => {
    try {
      const settings = await schedulerApi.getSettings()
      setSchedulerSettings(settings)
    } catch (err: any) {
      console.error('Failed to load scheduler settings:', err)
      // Use defaults if loading fails
      setSchedulerSettings({ timezone: 'Asia/Taipei', hour: 20, minute: 0 })
    }
  }

  const formatScheduledTime = () => {
    if (!schedulerSettings) {
      return '8:00 PM Taipei time'
    }
    const hour12 = schedulerSettings.hour % 12 || 12
    const ampm = schedulerSettings.hour >= 12 ? 'PM' : 'AM'
    const minuteStr = schedulerSettings.minute.toString().padStart(2, '0')
    const timezoneName = schedulerSettings.timezone.split('/').pop() || schedulerSettings.timezone
    return `${hour12}:${minuteStr} ${ampm} ${timezoneName} time`
  }

  const loadDailyRuns = async () => {
    try {
      setError('')
      const allJobs = await jobsApi.listJobs(100, 0)
      // Filter for daily runs (jobs that start with "Daily Keepa Report -")
      const dailyJobs = allJobs.filter((job: any) => 
        job.job_name && job.job_name.startsWith('Daily Keepa Report -')
      )
      // Sort by created_at descending (most recent first)
      dailyJobs.sort((a: any, b: any) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      setDailyRuns(dailyJobs)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load daily runs')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (!hasKeepaAccess) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">You don't have access to Keepa Alert Service features.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Daily Run</h1>
        <p className="mt-1 text-sm text-gray-500">Manage and view Keepa Daily Off Price Email Runs</p>
      </div>

      {/* Next Scheduled Run */}
      {nextRun && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Next Scheduled Run</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Scheduled Time:</span>
              <span className="font-medium text-gray-900">{nextRun.scheduled_time}</span>
            </div>
            {nextRun.next_run_time_taipei && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Next Run:</span>
                <span className="font-medium text-gray-900">{nextRun.next_run_time_taipei}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Timezone:</span>
              <span className="font-medium text-gray-900">{nextRun.timezone}</span>
            </div>
            {nextRun.seconds_until && nextRun.seconds_until > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Time Until Next Run:</span>
                <span className="font-medium text-indigo-600">
                  {Math.floor(nextRun.seconds_until / 3600)}h {Math.floor((nextRun.seconds_until % 3600) / 60)}m
                </span>
              </div>
            )}
            {nextRun.message && (
              <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">{nextRun.message}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      {/* Daily Runs List */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Daily Run History</h2>
        {dailyRuns.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-gray-500 mb-4">No daily runs found yet.</div>
            <p className="text-sm text-gray-400">
              Daily runs are automatically executed at {formatScheduledTime()}.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {dailyRuns.map((run) => (
              <div key={run.id} className="card p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{run.job_name}</h3>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(run.status)}`}>
                        {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Created:</span>
                        <p className="font-medium text-gray-900">{formatDate(run.created_at)}</p>
                      </div>
                      {run.completed_at && (
                        <div>
                          <span className="text-gray-500">Completed:</span>
                          <p className="font-medium text-gray-900">{formatDate(run.completed_at)}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500">Progress:</span>
                        <p className="font-medium text-gray-900">
                          {run.completed_batches} / {run.total_batches} batches
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Completion:</span>
                        <p className="font-medium text-gray-900">
                          {run.total_batches > 0 
                            ? Math.round((run.completed_batches / run.total_batches) * 100)
                            : 0}%
                        </p>
                      </div>
                    </div>
                    {run.error_message && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-800">
                          <span className="font-medium">Error:</span> {run.error_message}
                        </p>
                      </div>
                    )}
                  </div>
                  <Link
                    to={`/jobs/${run.id}`}
                    className="ml-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                  >
                    View Details →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

