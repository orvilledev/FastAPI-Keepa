import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { jobsApi, batchesApi, schedulerApi, authApi } from '../../services/api'
import type { BatchJob, JobStatus } from '../../types'
import BatchStatus from '../dashboard/BatchStatus'
import { getStatusColor } from '../../utils/statusColors'

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<BatchJob | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editJobName, setEditJobName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editEmailRecipients, setEditEmailRecipients] = useState('')
  const [saving, setSaving] = useState(false)
  const [isDailyRun, setIsDailyRun] = useState(false)
  const [schedulerInfo, setSchedulerInfo] = useState<any>(null)
  const [schedulerSettings, setSchedulerSettings] = useState<any>(null)
  const [editTimezone, setEditTimezone] = useState('Asia/Taipei')
  const [editHour, setEditHour] = useState(20)
  const [editMinute, setEditMinute] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (jobId) {
      loadJob()
      loadStatus()
      checkAdminStatus()
    }
  }, [jobId])

  const checkAdminStatus = async () => {
    try {
      const userInfo = await authApi.getCurrentUser()
      const isAdminUser = userInfo?.role === 'admin'
      setIsAdmin(isAdminUser)
      console.log('Admin status checked:', { role: userInfo?.role, isAdmin: isAdminUser })
    } catch (error) {
      console.error('Failed to check admin status:', error)
      setIsAdmin(false)
    }
  }

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
      // Check if this is a daily run - check for "Daily" in job name or if it matches daily run pattern
      const isDaily = data.job_name && (
        data.job_name.startsWith('Daily Keepa Report -') ||
        data.job_name.startsWith('Daily ') ||
        /Daily.*Report/i.test(data.job_name)
      )
      setIsDailyRun(isDaily)
      console.log('Daily run check:', { jobName: data.job_name, isDaily })
      
      // Always load scheduler settings if it's a daily run (or if we're on the daily run page)
      if (isDaily) {
        // Load scheduler info and settings for daily runs
        try {
          const [schedulerData, settings] = await Promise.all([
            schedulerApi.getNextRun(),
            schedulerApi.getSettings()
          ])
          setSchedulerInfo(schedulerData)
          setSchedulerSettings(settings)
          setEditTimezone(settings.timezone || 'Asia/Taipei')
          setEditHour(settings.hour || 20)
          setEditMinute(settings.minute || 0)
        } catch (err) {
          console.error('Failed to load scheduler info:', err)
          // Set defaults even if loading fails
          setEditTimezone('Asia/Taipei')
          setEditHour(20)
          setEditMinute(0)
        }
      }
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

  const handleEdit = async () => {
    if (!job) return
    setEditJobName(job.job_name)
    setEditDescription(job.description || '')
    setEditEmailRecipients(job.email_recipients || '')
    
    // Load scheduler settings if it's a daily run and settings haven't been loaded
    if (isDailyRun && !schedulerSettings) {
      try {
        const settings = await schedulerApi.getSettings()
        setSchedulerSettings(settings)
        setEditTimezone(settings.timezone || 'Asia/Taipei')
        setEditHour(settings.hour || 20)
        setEditMinute(settings.minute || 0)
      } catch (err) {
        console.error('Failed to load scheduler settings:', err)
        // Use defaults
        setEditTimezone('Asia/Taipei')
        setEditHour(20)
        setEditMinute(0)
      }
    } else if (schedulerSettings) {
      // Update edit values from current settings
      setEditTimezone(schedulerSettings.timezone || 'Asia/Taipei')
      setEditHour(schedulerSettings.hour || 20)
      setEditMinute(schedulerSettings.minute || 0)
    }
    
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!jobId || !editJobName.trim()) return
    
    setSaving(true)
    try {
      // Update job
      const updatedJob = await jobsApi.updateJob(jobId, { 
        job_name: editJobName.trim(),
        description: editDescription.trim() || undefined,
        email_recipients: editEmailRecipients.trim() || undefined
      })
      setJob(updatedJob)
      
      // Update scheduler settings if admin and settings changed
      if (isAdmin && isDailyRun && schedulerSettings) {
        const settingsChanged = 
          editTimezone !== schedulerSettings.timezone ||
          editHour !== schedulerSettings.hour ||
          editMinute !== schedulerSettings.minute
        
        if (settingsChanged) {
          try {
            await schedulerApi.updateSettings({
              timezone: editTimezone,
              hour: editHour,
              minute: editMinute
            })
            // Reload scheduler info
            const schedulerData = await schedulerApi.getNextRun()
            setSchedulerInfo(schedulerData)
            const updatedSettings = await schedulerApi.getSettings()
            setSchedulerSettings(updatedSettings)
          } catch (err: any) {
            console.error('Failed to update scheduler settings:', err)
            // Don't fail the whole operation if scheduler update fails
            alert(`Job updated, but scheduler settings update failed: ${err?.response?.data?.detail || err?.message}`)
          }
        }
      }
      
      setShowEditModal(false)
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to update job'
      alert(`Error: ${errorMessage}`)
      console.error('Failed to update job:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteJob = async () => {
    if (!jobId || !job) return
    
    if (!window.confirm(`Are you sure you want to delete "${job.job_name}"? This action cannot be undone and will delete all related batches, items, and alerts.`)) {
      return
    }

    try {
      await jobsApi.deleteJob(jobId)
      // Redirect to jobs list after successful deletion
      navigate('/jobs')
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to delete job'
      alert(`Error: ${errorMessage}`)
      console.error('Failed to delete job:', error)
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
            ← Back to Express Jobs
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">{job.job_name}</h1>
        </div>
        <div className="flex space-x-3">
          {job.status !== 'processing' && (
            <>
              <button
                onClick={handleEdit}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Edit
              </button>
              <button
                onClick={handleTrigger}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Trigger Job
              </button>
            </>
          )}
          {job.status === 'completed' && (
            <Link
              to={`/reports/${job.id}`}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              View Report
            </Link>
          )}
          {job.status !== 'processing' && (
            <button
              onClick={handleDeleteJob}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Delete Job
            </button>
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

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">Edit Daily Run</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="space-y-4">
                {/* Job Name / Report Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Report Name *
                  </label>
                  <input
                    type="text"
                    value={editJobName}
                    onChange={(e) => setEditJobName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Enter report name"
                  />
                  <p className="text-xs text-gray-500 mt-1">This is the name that will appear in the email subject and report</p>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    rows={3}
                    placeholder="Optional description or notes for this daily run"
                  />
                </div>

                {/* Email Recipients */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email Recipients (Optional)
                  </label>
                  <input
                    type="text"
                    value={editEmailRecipients}
                    onChange={(e) => setEditEmailRecipients(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="email1@example.com, email2@example.com"
                  />
                  <p className="text-xs text-gray-500 mt-1">Comma-separated email addresses. If empty, uses default system email settings.</p>
                </div>

                {/* Scheduler Settings (for daily runs) */}
                {isDailyRun && (
                  <div className="border-t pt-4 mt-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Scheduler Settings</h3>
                    {isAdmin ? (
                      <div className="space-y-4">
                        {/* Timezone */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Timezone *
                          </label>
                          <select
                            value={editTimezone}
                            onChange={(e) => setEditTimezone(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            <optgroup label="US Timezones">
                              <option value="America/New_York">Eastern Time (UTC-5/-4)</option>
                              <option value="America/Chicago">Central Time (UTC-6/-5)</option>
                              <option value="America/Denver">Mountain Time (UTC-7/-6)</option>
                              <option value="America/Los_Angeles">Pacific Time (UTC-8/-7)</option>
                              <option value="America/Anchorage">Alaska Time (UTC-9/-8)</option>
                              <option value="Pacific/Honolulu">Hawaii Time (UTC-10)</option>
                            </optgroup>
                            <optgroup label="Asia">
                              <option value="Asia/Taipei">Asia/Taipei (UTC+8)</option>
                              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                              <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                              <option value="Asia/Hong_Kong">Asia/Hong_Kong (UTC+8)</option>
                              <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                              <option value="Asia/Seoul">Asia/Seoul (UTC+9)</option>
                              <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
                              <option value="Asia/Kolkata">Asia/Kolkata (UTC+5:30)</option>
                            </optgroup>
                            <optgroup label="Europe">
                              <option value="Europe/London">Europe/London (UTC+0/+1)</option>
                              <option value="Europe/Paris">Europe/Paris (UTC+1/+2)</option>
                              <option value="Europe/Berlin">Europe/Berlin (UTC+1/+2)</option>
                              <option value="Europe/Rome">Europe/Rome (UTC+1/+2)</option>
                              <option value="Europe/Madrid">Europe/Madrid (UTC+1/+2)</option>
                              <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
                            </optgroup>
                            <optgroup label="Australia & Pacific">
                              <option value="Australia/Sydney">Australia/Sydney (UTC+10/+11)</option>
                              <option value="Australia/Melbourne">Australia/Melbourne (UTC+10/+11)</option>
                              <option value="Australia/Brisbane">Australia/Brisbane (UTC+10)</option>
                              <option value="Pacific/Auckland">Pacific/Auckland (UTC+12/+13)</option>
                            </optgroup>
                            <optgroup label="Americas (Other)">
                              <option value="America/Toronto">Canada Eastern (UTC-5/-4)</option>
                              <option value="America/Vancouver">Canada Pacific (UTC-8/-7)</option>
                              <option value="America/Mexico_City">Mexico City (UTC-6/-5)</option>
                              <option value="America/Sao_Paulo">Sao Paulo (UTC-3)</option>
                              <option value="America/Buenos_Aires">Buenos Aires (UTC-3)</option>
                            </optgroup>
                            <optgroup label="Other">
                              <option value="UTC">UTC (UTC+0)</option>
                              <option value="Africa/Johannesburg">Africa/Johannesburg (UTC+2)</option>
                              <option value="Asia/Jerusalem">Asia/Jerusalem (UTC+2/+3)</option>
                            </optgroup>
                          </select>
                          <p className="text-xs text-gray-500 mt-1">Timezone for the scheduled daily run</p>
                        </div>

                        {/* Time */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Hour (0-23) *
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="23"
                              value={editHour}
                              onChange={(e) => setEditHour(parseInt(e.target.value) || 0)}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Minute (0-59) *
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="59"
                              value={editMinute}
                              onChange={(e) => setEditMinute(parseInt(e.target.value) || 0)}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                          </div>
                        </div>

                        {/* Next Run Info */}
                        {schedulerInfo?.next_run_time_taipei && (
                          <div className="bg-blue-50 rounded-lg p-3">
                            <p className="text-sm text-blue-800">
                              <span className="font-medium">Next Run:</span> {schedulerInfo.next_run_time_taipei}
                            </p>
                          </div>
                        )}
                        
                        {!schedulerSettings && (
                          <div className="bg-yellow-50 rounded-lg p-3">
                            <p className="text-sm text-yellow-800">
                              Loading scheduler settings...
                            </p>
                          </div>
                        )}

                        <p className="text-xs text-gray-500">
                          Note: Scheduler settings are global and affect all future daily runs. Changes will take effect immediately.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Scheduled Time:</span>
                          <span className="font-medium text-gray-900">{schedulerInfo?.scheduled_time || `${schedulerSettings.hour}:${schedulerSettings.minute.toString().padStart(2, '0')} ${schedulerSettings.timezone}`}</span>
                        </div>
                        {schedulerInfo?.next_run_time_taipei && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">Next Run:</span>
                            <span className="font-medium text-gray-900">{schedulerInfo.next_run_time_taipei}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Timezone:</span>
                          <span className="font-medium text-gray-900">{schedulerSettings.timezone}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Note: Scheduler settings are global and affect all future daily runs. Only administrators can change the schedule.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <button
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving || !editJobName.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

