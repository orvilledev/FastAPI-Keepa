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
            className="vendor-hub-card"
          >
            <div className="flex items-center gap-3">
              <div className="vendor-hub-card-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#404040] text-white transition-colors duration-300">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="17" cy="4" r="2" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 6.5l-1.5 3 1.5 1-2.5 7" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.5 12l-1 5" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.5 12l3-1.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 10.5l2.5-1.5 2-3.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.5 5.5l-1 2" />
                </svg>
              </div>
              <div>
                <h2 className="vendor-hub-card-title text-base font-semibold text-gray-900 transition-colors duration-300">{label}</h2>
                <p className="vendor-hub-card-subtitle text-xs text-gray-500 transition-colors duration-300">Scheduler &amp; run history</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
