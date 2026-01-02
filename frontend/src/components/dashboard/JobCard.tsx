import { Link } from 'react-router-dom'
import type { BatchJob } from '../../types'

interface JobCardProps {
  job: BatchJob
}

export default function JobCard({ job }: JobCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{job.job_name}</h3>
          <p className="mt-1 text-sm text-gray-500">
            Created: {new Date(job.created_at).toLocaleDateString()}
          </p>
        </div>
        <span
          className={`px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(
            job.status
          )}`}
        >
          {job.status}
        </span>
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Progress:</span>
          <span>
            {job.completed_batches} / {job.total_batches} batches
          </span>
        </div>
        <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-indigo-600 h-2 rounded-full"
            style={{
              width: `${(job.completed_batches / job.total_batches) * 100}%`,
            }}
          />
        </div>
      </div>
      <div className="mt-4">
        <Link
          to={`/jobs/${job.id}`}
          className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
        >
          View Details →
        </Link>
      </div>
    </div>
  )
}

