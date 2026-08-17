/**
 * Feature gates shared by web and Electron.
 */

/** Shared warehouse station accounts that should not see Off-Price Analytics. */
export const ANALYTICS_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
  'warehouse1@metroshoewarehouse.com',
] as const

const ANALYTICS_BLOCKED_SET = new Set(
  ANALYTICS_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** Off-price Analytics is available on web and Electron. */
export function isWebAnalyticsEnabled(): boolean {
  return true
}

/** True when this email may use Analytics. */
export function canAccessWebAnalytics(email?: string | null): boolean {
  if (!isWebAnalyticsEnabled()) return false
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && !ANALYTICS_BLOCKED_SET.has(normalized)
}

/** @deprecated Prefer isWebAnalyticsEnabled / canAccessWebAnalytics. */
export function isDevAnalyticsEnabled(): boolean {
  return isWebAnalyticsEnabled()
}
