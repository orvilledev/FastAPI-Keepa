import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { jobsApi } from '../../services/api'

export default function CreateJob() {
  const [jobName, setJobName] = useState('')
  const [upcs, setUpcs] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Parse UPCs from textarea (one per line)
      const upcList = upcs
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (upcList.length === 0) {
        setError('Please enter at least one UPC')
        setLoading(false)
        return
      }

      if (upcList.length > 2500) {
        setError('Maximum 2500 UPCs allowed')
        setLoading(false)
        return
      }

      const job = await jobsApi.createJob({
        job_name: jobName || `Job ${new Date().toLocaleString()}`,
        upcs: upcList,
      })

      navigate(`/jobs/${job.id}`)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create job')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Create New Job</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter UPCs to process (one per line, up to 2500 UPCs)
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 lg:p-8 space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <div className="text-sm text-red-800 font-medium">{error}</div>
          </div>
        )}

        <div>
          <label htmlFor="jobName" className="block text-sm font-medium text-gray-700 mb-2">
            Job Name (optional)
          </label>
          <input
            type="text"
            id="jobName"
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            placeholder="Enter job name"
          />
        </div>

        <div>
          <label htmlFor="upcs" className="block text-sm font-medium text-gray-700 mb-2">
            UPCs <span className="text-gray-500 font-normal">(one per line)</span>
          </label>
          <textarea
            id="upcs"
            rows={20}
            value={upcs}
            onChange={(e) => setUpcs(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono text-sm"
            placeholder="Enter UPCs, one per line..."
          />
          <p className="mt-2 text-sm text-gray-500">
            <span className="font-semibold text-gray-700">{upcs.split('\n').filter((line) => line.trim().length > 0).length}</span> UPCs entered
          </p>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => navigate('/jobs')}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  )
}

