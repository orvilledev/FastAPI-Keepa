import { Link } from 'react-router-dom'

const VENDORS = [
  { code: 'dnk', label: 'DNK (Dansko)' },
  { code: 'clk', label: 'CLK (Clarks)' },
  { code: 'obz', label: 'OBZ (Oboz)' },
  { code: 'ref', label: 'REF (Reef)' },
  { code: 'bor', label: 'BOR (Born)' },
  { code: 'sff', label: 'SFF (Sofft)' },
  { code: 'tev', label: 'TEV (Teva)' },
  { code: 'cha', label: 'CHA (Chaco)' },
] as const

export default function DailyRunsMenu() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Daily Runs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Select a vendor to open its scheduler, run history, and API/Upload toggle.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {VENDORS.map(({ code, label }) => (
          <Link
            key={code}
            to={`/daily-run/${code}`}
            className="card card-hover p-5 flex flex-col gap-2"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#404040] text-white">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">{label}</h2>
                <p className="text-xs text-gray-500">Scheduler &amp; run history</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
