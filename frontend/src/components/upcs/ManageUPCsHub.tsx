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

export default function ManageUPCsHub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Manage UPCs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Select a vendor to view, add, or remove UPCs for its daily scheduler processing.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {VENDORS.map(({ code, label }) => (
          <Link
            key={code}
            to={`/upcs?category=${code}`}
            className="vendor-hub-card"
          >
            <div className="flex items-center gap-3">
              <div className="vendor-hub-card-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#404040] text-white transition-colors duration-300">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </div>
              <div>
                <h2 className="vendor-hub-card-title text-base font-semibold text-gray-900 transition-colors duration-300">{label}</h2>
                <p className="vendor-hub-card-subtitle text-xs text-gray-500 transition-colors duration-300">Manage UPCs</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
