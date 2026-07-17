/**
 * Per-user, per-vendor Daily Run T-30 reminders.
 * Client-only — does not touch scheduler settings, jobs, or emails.
 */

export type ReminderVendorCode =
  | 'dnk'
  | 'clk'
  | 'obz'
  | 'ref'
  | 'bor'
  | 'sff'
  | 'tev'
  | 'cha'

export const REMINDER_VENDOR_CODES: ReminderVendorCode[] = [
  'dnk',
  'clk',
  'obz',
  'ref',
  'bor',
  'sff',
  'tev',
  'cha',
]

/** Fire when countdown is at or under this many seconds (30 minutes). */
export const DAILY_RUN_REMINDER_LEAD_SECONDS = 30 * 60

const prefsKey = (userId: string) => `daily-run-reminder-vendors-v1-${userId}`
const firedKey = (userId: string) => `daily-run-reminder-fired-v1-${userId}`

function isVendorCode(value: string): value is ReminderVendorCode {
  return (REMINDER_VENDOR_CODES as string[]).includes(value)
}

export function loadReminderVendors(userId: string): Set<ReminderVendorCode> {
  try {
    const raw = localStorage.getItem(prefsKey(userId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is ReminderVendorCode => typeof v === 'string' && isVendorCode(v)))
  } catch {
    return new Set()
  }
}

export function saveReminderVendors(userId: string, vendors: Set<ReminderVendorCode>): void {
  try {
    localStorage.setItem(prefsKey(userId), JSON.stringify([...vendors]))
  } catch {
    /* ignore quota / private mode */
  }
}

export function setReminderVendorEnabled(
  userId: string,
  vendor: ReminderVendorCode,
  enabled: boolean,
): Set<ReminderVendorCode> {
  const next = loadReminderVendors(userId)
  if (enabled) next.add(vendor)
  else next.delete(vendor)
  saveReminderVendors(userId, next)
  return next
}

type FiredMap = Record<string, string[]>

function loadFiredMap(userId: string): FiredMap {
  try {
    const raw = localStorage.getItem(firedKey(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: FiredMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[k] = v.filter((x): x is string => typeof x === 'string')
      } else if (typeof v === 'string') {
        // migrate legacy single-iso shape
        out[k] = [v]
      }
    }
    return out
  } catch {
    return {}
  }
}

function saveFiredMap(userId: string, map: FiredMap): void {
  try {
    localStorage.setItem(firedKey(userId), JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/** One reminder per user + vendor + scheduled run timestamp (recurring or same-day). */
export function hasReminderFiredForRun(
  userId: string,
  vendor: ReminderVendorCode,
  nextRunIso: string,
): boolean {
  const map = loadFiredMap(userId)
  return (map[vendor] || []).includes(nextRunIso)
}

export function markReminderFiredForRun(
  userId: string,
  vendor: ReminderVendorCode,
  nextRunIso: string,
): void {
  const map = loadFiredMap(userId)
  const existing = map[vendor] || []
  if (!existing.includes(nextRunIso)) {
    map[vendor] = [...existing, nextRunIso].slice(-8)
  }
  saveFiredMap(userId, map)
}

export function clearReminderFiredForVendor(userId: string, vendor: ReminderVendorCode): void {
  const map = loadFiredMap(userId)
  delete map[vendor]
  saveFiredMap(userId, map)
}

/** Pending modal after OS notify while the PWA was minimized. */
export type PendingCapybaraReminder = {
  vendor: ReminderVendorCode
  label: string
  nextRunIso: string
  scheduledTime: string
  /** Seconds remaining when the reminder first fired */
  secondsUntilAtFire: number
  firedAtMs: number
}

const pendingKey = (userId: string) => `daily-run-reminder-pending-v1-${userId}`

export function savePendingCapybaraReminder(
  userId: string,
  pending: PendingCapybaraReminder,
): void {
  try {
    sessionStorage.setItem(pendingKey(userId), JSON.stringify(pending))
  } catch {
    /* ignore */
  }
}

export function loadPendingCapybaraReminder(userId: string): PendingCapybaraReminder | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingCapybaraReminder
    if (!parsed?.vendor || !parsed?.nextRunIso || !isVendorCode(parsed.vendor)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingCapybaraReminder(userId: string): void {
  try {
    sessionStorage.removeItem(pendingKey(userId))
  } catch {
    /* ignore */
  }
}
