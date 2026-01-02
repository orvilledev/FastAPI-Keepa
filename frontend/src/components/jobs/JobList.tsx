import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { jobsApi } from '../../services/api'
import type { BatchJob } from '../../types'
import { getStatusColor } from '../../utils/statusColors'

const JOBS_PER_PAGE = 15

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
      // Load all jobs to calculate statistics
      const allJobs = await jobsApi.listJobs(1000, 0) // Load a large number to get all jobs
      const newStats = {
        total: allJobs.length,
        processing: allJobs.filter((j) => j.status === 'processing').length,
        completed: allJobs.filter((j) => j.status === 'completed').length,
        failed: allJobs.filter((j) => j.status === 'failed').length,
      }
      setStats(newStats)
    } catch (error) {
      console.error('Failed to load jobs for stats:', error)
    }
  }, [])

  const loadJobs = useCallback(async (page: number) => {
    try {
      setLoading(true)
      const offset = page * JOBS_PER_PAGE
      const data = await jobsApi.listJobs(JOBS_PER_PAGE, offset)
      setJobs(data)
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
    
    // Auto-refresh stats: Poll every 5 seconds if there are processing jobs, otherwise every 30 seconds
    const pollInterval = stats.processing > 0 ? 5000 : 30000
    intervalRef.current = setInterval(() => {
      loadAllJobsForStats()
    }, pollInterval)
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.processing, loadAllJobsForStats])

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


  if (loading) {
    return <div className="text-center py-8">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Jobs</h1>
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
          <div className="text-3xl font-bold text-blue-600">{stats.processing}</div>
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
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Job Name
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Progress
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Completed
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50/50 transition-colors duration-150">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-semibold text-gray-900">{job.job_name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                      job.status
                    )}`}
                  >
                    {job.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {job.completed_batches} / {job.total_batches} batches
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {new Date(job.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {job.completed_at
                    ? new Date(job.completed_at).toLocaleDateString()
                    : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <Link
                    to={`/jobs/${job.id}`}
                    className="text-indigo-600 hover:text-indigo-700 font-semibold hover:underline transition-colors"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

