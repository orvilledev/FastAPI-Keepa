import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { jobsApi, batchesApi } from '../../services/api'
import type { BatchJob, JobStatus } from '../../types'
import BatchStatus from '../dashboard/BatchStatus'
import { getStatusColor } from '../../utils/statusColors'

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<BatchJob | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    if (jobId) {
      loadJob()
      loadStatus()
    }
  }, [jobId])

  useEffect(() => {
    if (job?.status === 'processing') {
      setPolling(true)
      const interval = setInterval(() => {
        loadStatus()
      }, 5000) // Poll every 5 seconds

      return () => {
        clearInterval(interval)
        setPolling(false)
      }
    }
  }, [job?.status])

  const loadJob = async () => {
    if (!jobId) return
    try {
      const data = await jobsApi.getJob(jobId)
      setJob(data)
    } catch (error) {
      console.error('Failed to load job:', error)
    }
  }

  const loadStatus = async () => {
    if (!jobId) return
    try {
      const data = await jobsApi.getJobStatus(jobId)
      setStatus(data)
      setLoading(false)
    } catch (error) {
      console.error('Failed to load job status:', error)
      setLoading(false)
    }
  }

  const handleTrigger = async () => {
    if (!jobId) return
    try {
      await jobsApi.triggerJob(jobId)
      loadJob()
      loadStatus()
    } catch (error) {
      console.error('Failed to trigger job:', error)
    }
  }


  const handleStopBatch = async (batchId: string) => {
    if (!window.confirm('Are you sure you want to stop this batch?')) {
      return
    }
    try {
      await batchesApi.stopBatch(batchId)
      loadStatus()
    } catch (error: any) {
      console.error('Failed to stop batch:', error)
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to stop batch. Please try again.'
      alert(errorMessage)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading...</div>
  }

  if (!job || !status) {
    return <div className="text-center py-8">Job not found</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <Link
            to="/jobs"
            className="text-indigo-600 hover:text-indigo-900 text-sm font-medium mb-2 inline-block"
          >
            ← Back to Jobs
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">{job.job_name}</h1>
        </div>
        <div className="flex space-x-3">
          {job.status !== 'processing' && (
            <button
              onClick={handleTrigger}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Trigger Job
            </button>
          )}
          {job.status === 'completed' && (
            <Link
              to={`/reports/${job.id}`}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              View Report
            </Link>
          )}
        </div>
      </div>

      {/* Job Info */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm font-medium text-gray-500">Status</div>
            <div className="mt-1">
              <span
                className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                  job.status
                )}`}
              >
                {job.status}
              </span>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">Total Batches</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {job.total_batches}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">Created</div>
            <div className="mt-1 text-sm text-gray-900">
              {new Date(job.created_at).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">Completed</div>
            <div className="mt-1 text-sm text-gray-900">
              {job.completed_at
                ? new Date(job.completed_at).toLocaleString()
                : '-'}
            </div>
          </div>
        </div>

        {job.error_message && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="text-sm text-red-800">{job.error_message}</div>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Progress</h2>
        <BatchStatus completed={status.completed_batches} total={status.total_batches} />
        {polling && (
          <div className="mt-4 text-sm text-gray-500">Auto-refreshing...</div>
        )}
      </div>

      {/* Batches */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Batches</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Batch #
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Progress
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {status.batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {batch.batch_number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                        batch.status
                      )}`}
                    >
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {batch.processed_count} / {batch.upc_count} UPCs
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    {(batch.status === 'processing' || batch.status === 'pending') && (
                      <button
                        onClick={() => handleStopBatch(batch.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium"
                      >
                        Stop
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

