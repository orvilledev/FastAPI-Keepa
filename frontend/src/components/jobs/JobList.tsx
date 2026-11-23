import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { jobsApi, schedulerApi } from '../../services/api'
import type { BatchJob } from '../../types'
import { getStatusColor } from '../../utils/statusColors'
import { formatRunDuration } from '../../utils/timeUtils'
import KeepaTokenBatteries from './KeepaTokenBatteries'
import ManualEmailModal from './ManualEmailModal'

const JOBS_PER_PAGE = 15
const POLL_INTERVAL_BUSY_MS = 10000
const POLL_INTERVAL_IDLE_MS = 30000
const CALENDAR_REFRESH_MS = 60000

type SchedulerCalendar = Awaited<ReturnType<typeof schedulerApi.getCalendar>>
type SchedulerVendor = SchedulerCalendar['vendors'][number]
type SyntheticScheduledJob = BatchJob & {
  is_synthetic: true
  synthetic_type: 'daily_scheduled'
  scheduler_category: string
  scheduler_input_mode: 'api' | 'uploaded'
}

const SCHEDULED_STATUS_CLASS =
  'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/40'

const getRunMethod = (jobName: string): 'import' | 'api' => {
  const normalized = (jobName || '').toLowerCase()
  return normalized.includes('uploaded report') ? 'import' : 'api'
}

const extractDailyCategory = (jobName: string): string | null => {
  const normalized = (jobName || '').trim().toLowerCase()
  const match = normalized.match(/^daily\s+([a-z0-9_-]+)/i)
  return match?.[1]?.toLowerCase() ?? null
}

const hasActiveDailyJobForCategory = (jobs: BatchJob[], category: string): boolean =>
  jobs.some((job) => {
    const parsedCategory = extractDailyCategory(job.job_name || '')
    return parsedCategory === category && (job.status === 'pending' || job.status === 'processing')
  })

const buildSyntheticScheduledJob = (vendor: SchedulerVendor): SyntheticScheduledJob => {
  const mode: 'api' | 'uploaded' = vendor.input_mode === 'uploaded' ? 'uploaded' : 'api'
  const nextRun = vendor.next_run_time || new Date().toISOString()
  const modeLabel = mode === 'uploaded' ? 'Import Mode' : 'API Mode'

  return {
    id: `scheduled-${vendor.category}-${nextRun}`,
    job_name: `Daily ${vendor.category.toUpperCase()} Scheduled Run`,
    status: 'pending',
    total_batches: 0,
    completed_batches: 0,
    total_upcs: 0,
    created_at: nextRun,
    initiated_by: 'Daily Run',
    description: `Auto-scheduled (${modeLabel}); countdown not yet over`,
    is_synthetic: true,
    synthetic_type: 'daily_scheduled',
    scheduler_category: vendor.category,
    scheduler_input_mode: mode,
  }
}

type JobRowMeta = {
  syntheticJob: BatchJob & Partial<SyntheticScheduledJob>
  isSynthetic: boolean
  displayStatus: string
  runMethod: 'import' | 'api'
  isImportRun: boolean
}

const getJobRowMeta = (job: BatchJob): JobRowMeta => {
  const syntheticJob = job as BatchJob & Partial<SyntheticScheduledJob>
  const isSynthetic = syntheticJob.is_synthetic === true
  const displayStatus = isSynthetic ? 'scheduled' : job.status
  const runMethod = isSynthetic
    ? syntheticJob.scheduler_input_mode === 'uploaded'
      ? 'import'
      : 'api'
    : getRunMethod(job.job_name || '')

  return {
    syntheticJob,
    isSynthetic,
    displayStatus,
    runMethod,
    isImportRun: runMethod === 'import',
  }
}

export default function JobList() {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [stats, setStats] = useState({
    total: 0,
    processing: 0,
    completed: 0,
    express_completed: 0,
    failed: 0,
  })
  const [clearingCompleted, setClearingCompleted] = useState(false)
  const [emailDraftJob, setEmailDraftJob] = useState<{ id: string; name: string } | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const calendarCacheRef = useRef<SchedulerCalendar | null>(null)
  const lastCalendarFetchAtRef = useRef<number>(0)
  const jobsRequestInFlightRef = useRef(false)
  const statsRequestInFlightRef = useRef(false)

  const loadAllJobsForStats = useCallback(async () => {
    if (statsRequestInFlightRef.current) return
    statsRequestInFlightRef.current = true
    try {
      const data = await jobsApi.getJobStats()
      setStats(data)
    } catch (error) {
      console.error('Failed to load jobs for stats:', error)
    } finally {
      statsRequestInFlightRef.current = false
    }
  }, [])

  const loadJobs = useCallback(async (page: number, options?: { silent?: boolean }) => {
    if (jobsRequestInFlightRef.current) return
    jobsRequestInFlightRef.current = true
    const silent = options?.silent === true
    if (!silent) {
      setLoading(true)
    }
    try {
      const offset = page * JOBS_PER_PAGE
      const data = await jobsApi.listJobs(JOBS_PER_PAGE, offset, {
        includeEnrichment: !silent,
      })

      // Keep placeholders only on the first page to avoid pagination duplication.
      if (page > 0) {
        setJobs(data)
        return
      }

      const now = Date.now()
      const shouldRefreshCalendar =
        !calendarCacheRef.current || now - lastCalendarFetchAtRef.current >= CALENDAR_REFRESH_MS

      if (shouldRefreshCalendar) {
        try {
          calendarCacheRef.current = await schedulerApi.getCalendar()
          lastCalendarFetchAtRef.current = now
        } catch (calendarError) {
          console.error('Failed to load scheduler calendar:', calendarError)
        }
      }

      const calendar = calendarCacheRef.current
      if (!calendar) {
        setJobs(data)
        return
      }

      const nowMs = now
      const scheduledRows: SyntheticScheduledJob[] = calendar.vendors
        .filter((vendor) => {
          if (!vendor.enabled || !vendor.next_run_time) return false
          const nextRunMs = new Date(vendor.next_run_time).getTime()
          if (!Number.isFinite(nextRunMs) || nextRunMs <= nowMs) return false
          if (hasActiveDailyJobForCategory(data, vendor.category)) return false
          return true
        })
        .map(buildSyntheticScheduledJob)

      const mergedJobs: BatchJob[] = [...scheduledRows, ...data].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      setJobs(mergedJobs)
    } catch (error) {
      console.error('Failed to load jobs:', error)
    } finally {
      jobsRequestInFlightRef.current = false
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadAllJobsForStats()
    loadJobs(currentPage)
  }, [currentPage, loadJobs, loadAllJobsForStats])

  useEffect(() => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    
    // Auto-refresh stats + rows: poll faster while jobs are actively processing.
    const pollInterval = stats.processing > 0 ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_IDLE_MS
    intervalRef.current = setInterval(() => {
      loadAllJobsForStats()
      void loadJobs(currentPage, { silent: true })
    }, pollInterval)
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.processing, currentPage, loadAllJobsForStats, loadJobs])

  const handlePreviousPage = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (currentPage > 0 && !loading) {
      setCurrentPage(prev => prev - 1)
    }
  }

  const handleNextPage = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    // Check if there are more jobs beyond the current page
    const hasMoreJobs = (currentPage + 1) * JOBS_PER_PAGE < stats.total
    if (hasMoreJobs && !loading) {
      setCurrentPage(prev => prev + 1)
    }
  }

  const handleDeleteJob = async (jobId: string, jobName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${jobName}"? This action cannot be undone and will delete all related batches, items, and alerts.`)) {
      return
    }

    try {
      await jobsApi.deleteJob(jobId)
      // Reload jobs and stats (silent: avoid full-table loading flicker)
      void loadJobs(currentPage, { silent: true })
      void loadAllJobsForStats()
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to delete job'
      alert(`Error: ${errorMessage}`)
      console.error('Failed to delete job:', error)
    }
  }

  const listedCompleted = jobs.filter((job) => {
    const synthetic = (job as BatchJob & Partial<SyntheticScheduledJob>).is_synthetic === true
    return !synthetic && job.status === 'completed'
  }).length
  const completedCount = Math.max(stats.completed ?? 0, listedCompleted)

  const handleClearCompletedJobs = async () => {
    if (completedCount === 0) return

    const noun = completedCount === 1 ? 'run' : 'runs'
    if (
      !window.confirm(
        `Clear all ${completedCount} completed ${noun} at once? This removes Express Jobs and Daily Runs from the list. Off-Price Analytics archives are kept. This cannot be undone.`,
      )
    ) {
      return
    }

    setClearingCompleted(true)
    try {
      const result = await jobsApi.deleteCompletedJobs()
      setCurrentPage(0)
      await loadAllJobsForStats()
      await loadJobs(0, { silent: true })
      if (result.deleted_count === 0) {
        window.alert('No completed jobs were found to remove.')
      }
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.detail || error?.message || 'Failed to remove completed jobs'
      alert(`Error: ${errorMessage}`)
      console.error('Failed to remove completed jobs:', error)
    } finally {
      setClearingCompleted(false)
    }
  }


  const totalPages = Math.max(1, Math.ceil(stats.total / JOBS_PER_PAGE))

  return (
    <div className="space-y-4 pb-6 lg:space-y-6 lg:pb-0">
      <div className="app-page-header flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 sm:text-3xl">Express Jobs</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Manage and monitor your batch processing jobs</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Completed runs are removed automatically after 7 days. Use Clear all for an immediate cleanup.
          </p>
          {stats.processing > 0 && (
            <p
              className="mt-2 inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 border border-amber-200"
              title="While jobs are processing, list auto-refresh uses a lighter data path for better responsiveness. Open a job to see fully detailed live progress."
            >
              Live updates are optimized while processing; open a job for full-detail progress.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleClearCompletedJobs()}
            disabled={completedCount === 0 || clearingCompleted}
            className="inline-flex items-center rounded-lg border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:border-red-300 disabled:bg-red-300 disabled:text-white dark:disabled:border-red-900 dark:disabled:bg-red-950 max-lg:flex-1 max-lg:justify-center max-lg:px-3"
            title={
              completedCount === 0
                ? 'No completed runs to clear'
                : 'Clear every completed Express and Daily Run at once. Analytics archives are kept.'
            }
          >
            <span className="hidden lg:inline">
              {clearingCompleted
                ? 'Clearing…'
                : completedCount > 0
                  ? `Clear all completed runs (${completedCount})`
                  : 'Clear all completed runs'}
            </span>
            <span className="lg:hidden">
              {clearingCompleted
                ? 'Clearing…'
                : completedCount > 0
                  ? `Clear completed (${completedCount})`
                  : 'Clear completed'}
            </span>
          </button>
          <Link
            to="/jobs/new"
            className="btn-primary max-lg:flex-1 max-lg:px-3 max-lg:text-center"
          >
            <span className="hidden lg:inline">+ Create New Job</span>
            <span className="lg:hidden">+ New Job</span>
          </Link>
        </div>
      </div>

      <KeepaTokenBatteries />

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        <div className="stat-card max-lg:p-3">
          <div className="text-xs lg:text-sm font-medium text-gray-500 dark:text-slate-400 mb-1">Total Jobs</div>
          <div className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-slate-100">{stats.total}</div>
        </div>
        <div className="stat-card max-lg:p-3 border-blue-200/50 bg-gradient-to-br from-blue-50/50 to-white dark:border-blue-500/30 dark:from-blue-500/15 dark:to-surface">
          <div className="text-xs lg:text-sm font-medium text-gray-500 dark:text-slate-400 mb-1">Processing</div>
          <div className="text-2xl lg:text-3xl font-bold text-[#81B81D] dark:text-accent-bright">{stats.processing}</div>
        </div>
        <div className="stat-card max-lg:p-3 border-green-200/50 bg-gradient-to-br from-green-50/50 to-white dark:border-green-500/30 dark:from-green-500/15 dark:to-surface">
          <div className="text-xs lg:text-sm font-medium text-gray-500 dark:text-slate-400 mb-1">Completed</div>
          <div className="text-2xl lg:text-3xl font-bold text-green-600 dark:text-green-400">{stats.completed}</div>
          {completedCount > 0 && (
            <button
              type="button"
              onClick={() => void handleClearCompletedJobs()}
              disabled={clearingCompleted}
              className="mt-2 text-xs font-semibold text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400 max-lg:hidden"
            >
              {clearingCompleted ? 'Clearing completed runs…' : `Clear all ${completedCount} completed runs`}
            </button>
          )}
        </div>
        <div className="stat-card max-lg:p-3 border-red-200/50 bg-gradient-to-br from-red-50/50 to-white dark:border-red-500/30 dark:from-red-500/15 dark:to-surface">
          <div className="text-xs lg:text-sm font-medium text-gray-500 dark:text-slate-400 mb-1">Failed</div>
          <div className="text-2xl lg:text-3xl font-bold text-red-600 dark:text-red-400">{stats.failed}</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Desktop / Electron table — unchanged at lg+ */}
        <div className="app-table-scroll hidden lg:block lg:overflow-x-visible">
        <table className="w-full table-fixed divide-y divide-gray-200 dark:divide-border">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-surface-muted dark:to-surface-hover">
            <tr>
              <th className="w-[38%] px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wider">
                Job Name
              </th>
              <th className="w-[14%] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wider">
                Status
              </th>
              <th className="w-[14%] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wider">
                Run Method
              </th>
              <th className="w-[20%] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wider">
                Progress
              </th>
              <th className="w-[14%] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-surface divide-y divide-gray-100 dark:divide-border">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                  Loading jobs...
                </td>
              </tr>
            ) : jobs.map((job) => {
              const { isSynthetic, displayStatus, isImportRun } = getJobRowMeta(job)
              return (
              <tr
                key={job.id}
                className={`transition-colors duration-150 ${isSynthetic ? 'bg-amber-50/30 hover:bg-amber-50/40 dark:bg-amber-500/10 dark:hover:bg-amber-500/15' : 'hover:bg-gray-50/50 dark:hover:bg-surface-hover/50'}`}
              >
                <td className="px-4 py-3">
                  <div className={`text-sm font-semibold truncate ${isImportRun ? 'text-[#2F6F0F] dark:text-green-400' : 'text-[#0B3D91] dark:text-blue-400'}`}>
                    {job.job_name}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-slate-400 truncate">
                    UPCs: {job.total_upcs.toLocaleString()} • By: {job.initiated_by || 'Unknown'} • Done:{' '}
                    {job.completed_at ? new Date(job.completed_at).toLocaleDateString() : '-'} • Duration:{' '}
                    {isSynthetic ? '-' : formatRunDuration(job.created_at, job.completed_at)}
                  </div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span
                    className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      isSynthetic ? SCHEDULED_STATUS_CLASS : getStatusColor(job.status)
                    }`}
                    title={isSynthetic ? 'Scheduled daily run; waiting for countdown' : undefined}
                  >
                    {displayStatus}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span
                    className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      isImportRun
                        ? 'bg-[#81B81D]/20 text-[#111827] dark:bg-[#81B81D]/25 dark:text-green-200'
                        : 'bg-blue-100 text-[#81B81D] dark:bg-blue-500/20 dark:text-blue-300'
                    }`}
                  >
                    {isImportRun ? 'Import Mode' : 'API Mode'}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-slate-300">
                  {isSynthetic
                    ? 'Waiting for countdown'
                    : `${job.completed_batches} / ${job.total_batches} batches`}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm font-medium">
                  {isSynthetic ? (
                    <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">Auto-run placeholder</span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="text-[#404040] hover:text-[#3B3B3B] font-semibold hover:underline transition-colors"
                      >
                        View →
                      </Link>
                      <button
                        type="button"
                        onClick={() => setEmailDraftJob({ id: job.id, name: job.job_name })}
                        disabled={job.status !== 'completed'}
                        className={`font-semibold text-[#0B3D91] transition-colors dark:text-blue-400 ${
                          job.status !== 'completed'
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:underline hover:text-[#092E6E] dark:hover:text-blue-300'
                        }`}
                        title={
                          job.status !== 'completed'
                            ? 'The report email is only available once the run has completed'
                            : 'Open a prefilled Outlook compose window to send this report manually'
                        }
                      >
                        Email
                      </button>
                      <button
                        onClick={() => handleDeleteJob(job.id, job.job_name)}
                        disabled={job.status === 'processing'}
                        className={`text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors ${
                          job.status === 'processing'
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:underline'
                        }`}
                        title={job.status === 'processing' ? 'Cannot delete a job that is currently processing' : 'Delete job'}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        </div>

        {/* Mobile card list — stacked fields instead of cramped table columns */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/70 px-4 py-2.5 dark:border-border dark:bg-surface-muted/60">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Runs</h2>
            {!loading && jobs.length > 0 && (
              <span className="text-xs text-gray-500 dark:text-slate-400">
                {totalPages > 1 ? `Page ${currentPage + 1} of ${totalPages} • ` : ''}
                {jobs.length} shown
              </span>
            )}
          </div>

          <div className="divide-y divide-gray-100 dark:divide-border">
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="animate-pulse space-y-3 p-4">
                <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-surface-muted" />
                <div className="h-3 w-1/2 rounded bg-gray-100 dark:bg-surface-muted" />
                <div className="h-12 rounded-lg bg-gray-100 dark:bg-surface-muted" />
                <div className="grid grid-cols-3 gap-2">
                  <div className="h-10 rounded-lg bg-gray-100 dark:bg-surface-muted" />
                  <div className="h-10 rounded-lg bg-gray-100 dark:bg-surface-muted" />
                  <div className="h-10 rounded-lg bg-gray-100 dark:bg-surface-muted" />
                </div>
              </div>
            ))
          ) : jobs.map((job) => {
            const { isSynthetic, displayStatus, isImportRun } = getJobRowMeta(job)
            const progressPct =
              job.total_batches > 0
                ? Math.min(100, Math.round((job.completed_batches / job.total_batches) * 100))
                : 0
            const progressBarClass =
              job.status === 'completed'
                ? 'bg-green-500'
                : job.status === 'failed'
                  ? 'bg-red-500'
                  : job.status === 'processing'
                    ? 'bg-[#81B81D] animate-pulse'
                    : 'bg-gray-400 dark:bg-slate-500'
            return (
              <div
                key={job.id}
                className={`relative p-4 pl-5 ${isSynthetic ? 'bg-amber-50/40 dark:bg-amber-500/10' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${
                    isSynthetic ? 'bg-amber-400' : isImportRun ? 'bg-[#81B81D]' : 'bg-[#0B3D91] dark:bg-blue-400'
                  }`}
                />

                <h3 className={`text-[15px] font-semibold leading-snug break-words ${isImportRun ? 'text-[#2F6F0F] dark:text-green-400' : 'text-[#0B3D91] dark:text-blue-400'}`}>
                  {job.job_name}
                </h3>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      isSynthetic ? SCHEDULED_STATUS_CLASS : getStatusColor(job.status)
                    }`}
                  >
                    {displayStatus}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      isImportRun
                        ? 'bg-[#81B81D]/20 text-[#111827] dark:bg-[#81B81D]/25 dark:text-green-200'
                        : 'bg-blue-100 text-[#81B81D] dark:bg-blue-500/20 dark:text-blue-300'
                    }`}
                  >
                    {isImportRun ? 'Import Mode' : 'API Mode'}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-slate-400">
                    by {job.initiated_by || 'Unknown'}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-surface-muted/60">
                  <div className="min-w-0">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-slate-500">UPCs</dt>
                    <dd className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {job.total_upcs.toLocaleString()}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-slate-500">Done</dt>
                    <dd className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {job.completed_at ? new Date(job.completed_at).toLocaleDateString() : '-'}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-slate-500">Duration</dt>
                    <dd className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {isSynthetic ? '-' : formatRunDuration(job.created_at, job.completed_at)}
                    </dd>
                  </div>
                </dl>

                {isSynthetic ? (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                    Waiting for countdown • Auto-run placeholder
                  </p>
                ) : (
                  <>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-slate-300">
                        <span>Batches</span>
                        <span className="font-semibold">
                          {job.completed_batches} / {job.total_batches}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
                        <div
                          className={`h-full rounded-full transition-all ${progressBarClass}`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="inline-flex min-h-[2.75rem] items-center justify-center rounded-lg bg-[#404040] px-2 font-semibold text-white shadow-sm transition-colors hover:bg-[#3B3B3B]"
                      >
                        View →
                      </Link>
                      <button
                        type="button"
                        onClick={() => setEmailDraftJob({ id: job.id, name: job.job_name })}
                        disabled={job.status !== 'completed'}
                        className="inline-flex min-h-[2.75rem] items-center justify-center rounded-lg border border-blue-200 bg-white px-2 font-semibold text-[#0B3D91] transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white dark:border-blue-500/40 dark:bg-surface dark:text-blue-400 dark:hover:bg-blue-500/10"
                        title={
                          job.status !== 'completed'
                            ? 'The report email is only available once the run has completed'
                            : 'Open a prefilled Outlook compose window to send this report manually'
                        }
                      >
                        Email
                      </button>
                      <button
                        onClick={() => handleDeleteJob(job.id, job.job_name)}
                        disabled={job.status === 'processing'}
                        className="inline-flex min-h-[2.75rem] items-center justify-center rounded-lg border border-red-200 bg-white px-2 font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white dark:border-red-500/40 dark:bg-surface dark:text-red-400 dark:hover:bg-red-500/10"
                        title={job.status === 'processing' ? 'Cannot delete a job that is currently processing' : 'Delete job'}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          </div>
        </div>

        {jobs.length === 0 && !loading && (
          <div className="text-center py-8 text-gray-500">No jobs found</div>
        )}
      </div>

      {/* Pagination Controls — hidden on mobile when everything fits on one page */}
      {jobs.length > 0 && (
        <div className={`card px-4 py-4 sm:px-6 ${totalPages <= 1 ? 'max-lg:hidden' : ''}`}>
          <div className="app-pagination-bar flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-slate-400 max-lg:text-center">
              <span className="hidden lg:inline">
                Page <span className="font-semibold text-gray-900 dark:text-slate-100">{currentPage + 1}</span> • Showing {currentPage * JOBS_PER_PAGE + 1}-
                {currentPage * JOBS_PER_PAGE + jobs.length} job{jobs.length !== 1 ? 's' : ''}
              </span>
              <span className="lg:hidden">
                Page <span className="font-semibold text-gray-900 dark:text-slate-100">{currentPage + 1}</span> of{' '}
                <span className="font-semibold text-gray-900 dark:text-slate-100">{totalPages}</span>
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreviousPage}
                disabled={currentPage === 0 || loading}
                className={`px-4 py-2 max-lg:py-3 text-sm font-medium rounded-lg transition-all ${
                  currentPage === 0 || loading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'btn-secondary'
                }`}
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={(currentPage + 1) * JOBS_PER_PAGE >= stats.total || loading}
                className={`px-4 py-2 max-lg:py-3 text-sm font-medium rounded-lg transition-all ${
                  (currentPage + 1) * JOBS_PER_PAGE >= stats.total || loading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'btn-secondary'
                }`}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}

      {emailDraftJob && (
        <ManualEmailModal
          jobId={emailDraftJob.id}
          jobName={emailDraftJob.name}
          onClose={() => setEmailDraftJob(null)}
        />
      )}
    </div>
  )
}

