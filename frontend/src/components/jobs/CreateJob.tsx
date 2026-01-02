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
        <p className="mt-2 text-sm text-gray-600">
          Enter UPCs to process (one per line, up to 2500 UPCs)
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-6">
        {error && (
          <div className="rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        <div>
          <label htmlFor="jobName" className="block text-sm font-medium text-gray-700">
            Job Name (optional)
          </label>
          <input
            type="text"
            id="jobName"
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
            placeholder="Enter job name"
          />
        </div>

        <div>
          <label htmlFor="upcs" className="block text-sm font-medium text-gray-700">
            UPCs <span className="text-gray-500">(one per line)</span>
          </label>
          <textarea
            id="upcs"
            rows={20}
            value={upcs}
            onChange={(e) => setUpcs(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono px-3 py-2 border"
            placeholder="Enter UPCs, one per line..."
          />
          <p className="mt-2 text-sm text-gray-500">
            {upcs.split('\n').filter((line) => line.trim().length > 0).length} UPCs entered
          </p>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => navigate('/jobs')}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  )
}

