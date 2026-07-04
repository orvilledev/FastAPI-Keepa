type VendorCategory = 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'

type CalendarVendor = {
  category: string
  enabled: boolean
  timezone: string
  hour: number
  minute: number
  run_mode: string
  custom_days: string[]
  anchor_date?: string | null
  input_mode?: 'api' | 'uploaded' | string
  scheduled_time: string
  next_run_time: string | null
  scheduler_job_present: boolean
  latest_job?: {
    id: string
    job_name: string
    status: string
    created_at: string
    completed_at?: string | null
  } | null
  is_ongoing: boolean
}

const LABELS: Record<VendorCategory, string> = {
  dnk: 'DNK',
  clk: 'CLK',
  obz: 'OBZ',
  ref: 'REF',
  bor: 'BOR',
  sff: 'SFF',
  tev: 'TEV',
  cha: 'CHA',
}

export default function VendorRunCard({ vendor, nowMs }: { vendor: CalendarVendor; nowMs: number }) {
  const category = (vendor.category || '').toLowerCase() as VendorCategory
  const code = LABELS[category] || String(vendor.category || '').toUpperCase()
  const inputMode = (vendor.input_mode || 'api') === 'uploaded' ? 'uploaded' : 'api'

  if (!vendor.enabled) {
    return (
      <div className="bg-gray-100 rounded-xl shadow p-6 border border-gray-300">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold mb-2 text-gray-900">{code} Keepa Off Price Daily Run</h3>
            <p className="text-gray-500 text-sm">Daily run is currently stopped.</p>
            <div className="mt-2">
              <span
                className={`inline-flex w-fit items-center rounded-md px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ring-2 sm:px-3 sm:py-1.5 sm:text-sm ${
                  inputMode === 'uploaded'
                    ? 'bg-[#81B81D]/20 text-[#DDF5B0] ring-[#81B81D]/80'
                    : 'bg-[#F97316]/20 text-[#FFD8B0] ring-[#F97316]/80'
                }`}
              >
                {inputMode === 'uploaded' ? 'Import Mode' : 'API Mode'}
              </span>
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#81B81D]/20 text-[#111827]">
              Stopped
            </span>
          </div>
        </div>
      </div>
    )
  }

  const nextRunMs = vendor.next_run_time ? new Date(vendor.next_run_time).getTime() : null
  const secondsUntil = nextRunMs ? Math.max(0, Math.floor((nextRunMs - nowMs) / 1000)) : null
  const timeLeft = secondsUntil !== null
    ? {
        hours: Math.floor(secondsUntil / 3600),
        minutes: Math.floor((secondsUntil % 3600) / 60),
        seconds: secondsUntil % 60,
      }
    : null
  const hasActiveCountdown = Boolean(vendor.enabled && secondsUntil !== null && secondsUntil > 0)

  if (!vendor.next_run_time) {
    return (
      <div className="card p-6">
        <div className="text-center text-gray-500">{code} Scheduler not configured</div>
      </div>
    )
  }

  const nextRunText = new Date(vendor.next_run_time).toLocaleString()

  return (
    <div
      className={`rounded-xl shadow-xl p-4 sm:p-5 text-white border ${
        inputMode === 'uploaded'
          ? 'bg-[#404040] border-white/20'
          : 'bg-[#404040] border-white/20'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold mb-2">{code} Keepa Off Price Daily Run</h3>
          <div className="mb-4 space-y-2">
            <p className="text-sm leading-relaxed text-white/70 break-words">
              Scheduled for {vendor.scheduled_time}
            </p>
            <span
              className={`inline-flex w-fit items-center rounded-md px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ring-2 sm:px-3 sm:py-1.5 sm:text-sm ${
                inputMode === 'uploaded'
                  ? 'bg-[#81B81D]/30 text-[#E8F8C8] ring-[#81B81D]/85'
                  : 'bg-[#F97316]/30 text-[#FFE7CC] ring-[#F97316]/85'
              }`}
            >
              {inputMode === 'uploaded' ? 'Import Mode' : 'API Mode'}
            </span>
          </div>
          {timeLeft && secondsUntil !== null && secondsUntil > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="text-center">
                <div className={`text-2xl font-bold sm:text-3xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>{String(timeLeft.hours).padStart(2, '0')}</div>
                <div className="text-xs text-white/70 mt-1">Hours</div>
              </div>
              <div className={`text-xl font-bold sm:text-2xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>:</div>
              <div className="text-center">
                <div className={`text-2xl font-bold sm:text-3xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>{String(timeLeft.minutes).padStart(2, '0')}</div>
                <div className="text-xs text-white/70 mt-1">Minutes</div>
              </div>
              <div className={`text-xl font-bold sm:text-2xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>:</div>
              <div className="text-center">
                <div className={`text-2xl font-bold sm:text-3xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>{String(timeLeft.seconds).padStart(2, '0')}</div>
                <div className="text-xs text-white/70 mt-1">Seconds</div>
              </div>
            </div>
          ) : (
            <div className="text-base font-semibold sm:text-lg">Email will be sent soon...</div>
          )}
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-sm text-white/70 mb-1">Next Run</div>
          <div className="text-base font-semibold sm:text-lg">{nextRunText}</div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                hasActiveCountdown ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
            >
              {hasActiveCountdown ? '● Active' : '○ Inactive'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
