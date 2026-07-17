/**
 * Local Vite-only auth bypass for UI testing (themes, layout) without login.
 * Enabled when `npm run dev` AND `VITE_DEV_BYPASS_AUTH` is not explicitly "false".
 * Never active in production builds.
 */

export function isDevAuthBypass(): boolean {
  if (!import.meta.env.DEV) return false
  const flag = String(import.meta.env.VITE_DEV_BYPASS_AUTH ?? 'true').toLowerCase()
  return flag !== 'false' && flag !== '0' && flag !== 'off'
}

export const DEV_BYPASS_AUTH_USER = {
  id: 'dev-bypass-user',
  email: 'dev@localhost',
  app_metadata: {},
  user_metadata: { display_name: 'Dev Tester' },
  aud: 'authenticated',
  created_at: new Date().toISOString(),
} as const

export const DEV_BYPASS_USER_INFO = {
  id: 'dev-bypass-user',
  email: 'dev@localhost',
  role: 'superadmin',
  display_name: 'Dev Tester',
  has_keepa_access: true,
  is_warehouse_only: false,
  has_label_station_access: true,
  can_manage_tools: true,
  is_superadmin: true,
  mfa_enabled: true,
  mfa_exempt: true,
  created_at: new Date().toISOString(),
}

type DevCalendarVendor = {
  category: string
  enabled: boolean
  timezone: string
  hour: number
  minute: number
  input_mode?: 'api' | 'uploaded'
  run_mode: string
  custom_days: string[]
  anchor_date?: string | null
  scheduled_time: string
  next_run_time: string | null
  scheduler_job_present: boolean
  latest_job?: null
  is_ongoing: boolean
}

/** Fixture Active Runs for local UI/theme testing when the calendar API is unavailable. */
export function getDevBypassCalendarVendors(nowMs: number = Date.now()): DevCalendarVendor[] {
  const hoursFromNow = (h: number) => new Date(nowMs + h * 3600_000).toISOString()
  const fixtures: Array<{
    category: string
    hour: number
    minute: number
    input_mode: 'api' | 'uploaded'
    hoursAhead: number
  }> = [
    { category: 'dnk', hour: 6, minute: 0, input_mode: 'uploaded', hoursAhead: 2.5 },
    { category: 'clk', hour: 2, minute: 0, input_mode: 'uploaded', hoursAhead: 5.1 },
    { category: 'obz', hour: 2, minute: 0, input_mode: 'uploaded', hoursAhead: 5.1 },
    { category: 'ref', hour: 23, minute: 0, input_mode: 'uploaded', hoursAhead: 8.25 },
    { category: 'bor', hour: 23, minute: 0, input_mode: 'api', hoursAhead: 8.5 },
  ]

  return fixtures.map((f) => {
    const timeLabel = `${String(f.hour).padStart(2, '0')}:${String(f.minute).padStart(2, '0')} America/Los_Angeles`
    return {
      category: f.category,
      enabled: true,
      timezone: 'America/Los_Angeles',
      hour: f.hour,
      minute: f.minute,
      input_mode: f.input_mode,
      run_mode: 'daily',
      custom_days: [],
      anchor_date: null,
      scheduled_time: timeLabel,
      next_run_time: hoursFromNow(f.hoursAhead),
      scheduler_job_present: true,
      latest_job: null,
      is_ongoing: false,
    }
  })
}
