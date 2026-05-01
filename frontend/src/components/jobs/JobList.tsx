import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { jobsApi, schedulerApi } from '../../services/api'
import type { BatchJob } from '../../types'
import { getStatusColor } from '../../utils/statusColors'
import { formatRunDuration } from '../../utils/timeUtils'

const JOBS_PER_PAGE = 15

type SchedulerCalendar = Awaited<ReturnType<typeof schedulerApi.getCalendar>>
type SchedulerVendor = SchedulerCalendar['vendors'][number]
type SyntheticScheduledJob = BatchJob & {
  is_synthetic: true
  synthetic_type: 'daily_scheduled'
  scheduler_category: string
  scheduler_input_mode: 'api' | 'uploaded'
}

const SCHEDULED_STATUS_CLASS = 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200'

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

export default function JobList() {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [stats, setStats] = useState({
    total: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  })
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const loadAllJobsForStats = useCallback(async () => {
    try {
      const data = await jobsApi.getJobStats()
      setStats(data)
    } catch (error) {
      console.error('Failed to load jobs for stats:', error)
    }
  }, [])

  const loadJobs = useCallback(async (page: number) => {
    try {
      setLoading(true)
      const offset = page * JOBS_PER_PAGE
      const [data, calendar] = await Promise.all([
        jobsApi.listJobs(JOBS_PER_PAGE, offset),
        schedulerApi.getCalendar(),
      ])

      // Keep placeholders only on the first page to avoid pagination duplication.
      if (page > 0) {
        setJobs(data)
        return
      }

      const nowMs = Date.now()
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
      setLoading(false)
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
    
    // Auto-refresh stats + rows: Poll every 5 seconds if there are processing jobs,
    // otherwise every 30 seconds so row progress stays aligned with details view.
    const pollInterval = stats.processing > 0 ? 5000 : 30000
    intervalRef.current = setInterval(() => {
      loadAllJobsForStats()
      loadJobs(currentPage)
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
      // Reload jobs and stats
      loadJobs(currentPage)
      loadAllJobsForStats()
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to delete job'
      alert(`Error: ${errorMessage}`)
      console.error('Failed to delete job:', error)
    }
  }


  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Express Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">Manage and monitor your batch processing jobs</p>
        </div>
        <Link
          to="/jobs/new"
          className="btn-primary"
        >
          + Create New Job
        </Link>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="text-sm font-medium text-gray-500 mb-1">Total Jobs</div>
          <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
        </div>
        <div className="stat-card border-blue-200/50 bg-gradient-to-br from-blue-50/50 to-white">
          <div className="text-sm font-medium text-gray-500 mb-1">Processing</div>
          <div className="text-3xl font-bold text-[#81B81D]">{stats.processing}</div>
        </div>
        <div className="stat-card border-green-200/50 bg-gradient-to-br from-green-50/50 to-white">
          <div className="text-sm font-medium text-gray-500 mb-1">Completed</div>
          <div className="text-3xl font-bold text-green-600">{stats.completed}</div>
        </div>
        <div className="stat-card border-red-200/50 bg-gradient-to-br from-red-50/50 to-white">
          <div className="text-sm font-medium text-gray-500 mb-1">Failed</div>
          <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto lg:overflow-x-visible">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
            <tr>
              <th className="w-[38%] px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Job Name
              </th>
              <th className="w-[14%] px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Status
              </th>
              <th className="w-[14%] px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Run Method
              </th>
              <th className="w-[20%] px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Progress
              </th>
              <th className="w-[14%] px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                  Loading jobs...
                </td>
              </tr>
            ) : jobs.map((job) => {
              const syntheticJob = job as BatchJob & Partial<SyntheticScheduledJob>
              const isSynthetic = syntheticJob.is_synthetic === true
              const displayStatus = isSynthetic ? 'scheduled' : job.status
              const runMethod = isSynthetic
                ? syntheticJob.scheduler_input_mode === 'uploaded'
                  ? 'import'
                  : 'api'
                : getRunMethod(job.job_name || '')
              const isImportRun = runMethod === 'import'
              return (
              <tr
                key={job.id}
                className={`transition-colors duration-150 ${isSynthetic ? 'bg-amber-50/30 hover:bg-amber-50/40' : 'hover:bg-gray-50/50'}`}
              >
                <td className="px-4 py-3">
                  <div className={`text-sm font-semibold truncate ${isImportRun ? 'text-[#2F6F0F]' : 'text-[#0B3D91]'}`}>
                    {job.job_name}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 truncate">
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
                        ? 'bg-[#81B81D]/20 text-[#111827]'
                        : 'bg-blue-100 text-[#81B81D]'
                    }`}
                  >
                    {isImportRun ? 'Import Mode' : 'API Mode'}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                  {isSynthetic
                    ? 'Waiting for countdown'
                    : `${job.completed_batches} / ${job.total_batches} batches`}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm font-medium">
                  {isSynthetic ? (
                    <span className="text-xs text-amber-700 font-medium">Auto-run placeholder</span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="text-[#404040] hover:text-[#3B3B3B] font-semibold hover:underline transition-colors"
                      >
                        View →
                      </Link>
                      <button
                        onClick={() => handleDeleteJob(job.id, job.job_name)}
                        disabled={job.status === 'processing'}
                        className={`text-red-600 hover:text-red-700 font-medium transition-colors ${
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
        {jobs.length === 0 && !loading && (
          <div className="text-center py-8 text-gray-500">No jobs found</div>
        )}
      </div>

      {/* Pagination Controls */}
      {jobs.length > 0 && (
        <div className="card px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Page <span className="font-semibold text-gray-900">{currentPage + 1}</span> • Showing {currentPage * JOBS_PER_PAGE + 1}-
              {currentPage * JOBS_PER_PAGE + jobs.length} job{jobs.length !== 1 ? 's' : ''}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreviousPage}
                disabled={currentPage === 0 || loading}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
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
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
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
    </div>
  )
}

