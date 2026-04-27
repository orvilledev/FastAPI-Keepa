import { Link } from 'react-router-dom'

const VENDORS = ['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha'] as const

export default function DailyRunsMenu() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Daily Runs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose a vendor to manage its daily run. Each vendor page now hosts both
          modes: API runs (Keepa token-based) and Upload runs (Keepa file upload).
          Use the toggle on the vendor page to switch between them.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {VENDORS.map((vendor) => (
          <Link
            key={vendor}
            to={`/daily-run/${vendor}`}
            className="card p-5 hover:shadow-md transition-shadow"
          >
            <h2 className="text-lg font-semibold text-gray-900">{vendor.toUpperCase()} Daily Run</h2>
            <p className="mt-1 text-sm text-gray-500">
              Open scheduler, run history, and API/Upload toggle
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
