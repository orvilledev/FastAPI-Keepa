import { Link } from 'react-router-dom'

const UPLOAD_VENDORS = ['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha'] as const

export default function UploadedRunsMenu() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Uploaded Runs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose a vendor for file-upload based daily runs.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {UPLOAD_VENDORS.map((vendor) => (
          <Link
            key={vendor}
            to={`/daily-run/uploaded/${vendor}`}
            className="card p-5 hover:shadow-md transition-shadow"
          >
            <h2 className="text-lg font-semibold text-gray-900">{vendor.toUpperCase()} Uploaded Run</h2>
            <p className="mt-1 text-sm text-gray-500">Upload Keepa file and run daily check</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
