/**
 * Shared warehouse stations that stay signed in on the floor.
 * They remain password-only. This schedule only signs them out.
 */
export const NIGHTLY_LOGOUT_EMAILS = [
  'warehouse1@metroshoewarehouse.com',
  'hello@warehouserepublic.com',
] as const

export const NIGHTLY_LOGOUT_TIME_ZONE = 'America/Chicago'
/** 1:00 AM Central, including daylight saving. */
export const NIGHTLY_LOGOUT_HOUR = 1
export const NIGHTLY_LOGOUT_REMINDER_MINUTES = [30, 15, 5, 1] as const

const FRESH_LOGIN_KEY = 'nightly_station_fresh_login'
const LOGIN_AT_PREFIX = 'nightly_station_login_at:'

export const NIGHTLY_LOGOUT_NOTICE =
  'This station was signed out at 1:00 AM Central. Sign in to continue.'

type CalendarDate = { year: number; month: number; day: number }

export function isNightlyLogoutEmail(email?: string | null): boolean {
  const value = (email || '').trim().toLowerCase()
  return NIGHTLY_LOGOUT_EMAILS.some((allowed) => allowed === value)
}

function chicagoParts(instant: Date): CalendarDate & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NIGHTLY_LOGOUT_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  let hour = read('hour')
  if (hour === 24) hour = 0
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  }
}

/** Milliseconds to add to a UTC instant to get the Chicago wall clock read as UTC. */
function chicagoOffsetMs(instant: Date): number {
  const wall = chicagoParts(instant)
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return wallAsUtc - instant.getTime()
}

/** UTC instant for a Chicago wall-clock time. 1:00 AM exists on both DST transition days. */
export function chicagoWallTime(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const first = new Date(guess - chicagoOffsetMs(new Date(guess)))
  return new Date(guess - chicagoOffsetMs(first))
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function logoutOnCalendarDay(date: CalendarDate): Date {
  return chicagoWallTime(date.year, date.month, date.day, NIGHTLY_LOGOUT_HOUR, 0)
}

/** The next 1:00 AM Central strictly after `instant`. */
export function nextNightlyLogoutAt(instant: Date): Date {
  const parts = chicagoParts(instant)
  const today = logoutOnCalendarDay(parts)
  if (instant.getTime() < today.getTime()) return today
  return logoutOnCalendarDay(addCalendarDays(parts, 1))
}

export function reminderLabel(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

function storageKey(email: string): string {
  return `${LOGIN_AT_PREFIX}${email.trim().toLowerCase()}`
}

export function markNightlyFreshLogin(email: string): void {
  if (!isNightlyLogoutEmail(email)) return
  try {
    sessionStorage.setItem(FRESH_LOGIN_KEY, email.trim().toLowerCase())
  } catch {
    // ignore
  }
}

/**
 * When this browser signed in. A fresh password login replaces the stored time.
 * An existing session seen for the first time (app update) starts the clock now,
 * so a midday update does not sign the station out immediately.
 */
export function resolveStationLoginAt(email: string, now = Date.now()): number {
  const key = storageKey(email)
  try {
    const fresh = (sessionStorage.getItem(FRESH_LOGIN_KEY) || '').trim().toLowerCase()
    if (fresh && fresh === email.trim().toLowerCase()) {
      sessionStorage.removeItem(FRESH_LOGIN_KEY)
      localStorage.setItem(key, String(now))
      return now
    }
    const stored = Number(localStorage.getItem(key))
    if (Number.isFinite(stored) && stored > 0) return stored
    localStorage.setItem(key, String(now))
    return now
  } catch {
    return now
  }
}

export function clearStationLoginAt(email: string): void {
  try {
    localStorage.removeItem(storageKey(email))
  } catch {
    // ignore
  }
}
