/**
 * Feature gates that differ between web and Electron.
 * Electron builds use Vite mode "electron" and expose window.desktop.isElectron.
 */

import { isElectronDesktop } from './privatePath'

/** Emails allowed to open Off-Price Analytics on the web app. */
export const ANALYTICS_ALLOWED_EMAILS = [
  'remote@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'sunshine@metroshoewarehouse.com',
  'orvillebarba@gmail.com',
] as const

const ANALYTICS_ALLOWED_SET = new Set(
  ANALYTICS_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/**
 * Off-price Analytics shell is web-only (hidden from Electron).
 */
export function isWebAnalyticsEnabled(): boolean {
  if (import.meta.env.MODE === 'electron') return false
  if (isElectronDesktop()) return false
  return true
}

/** True when this email may use Analytics on the web app. */
export function canAccessWebAnalytics(email?: string | null): boolean {
  if (!isWebAnalyticsEnabled()) return false
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && ANALYTICS_ALLOWED_SET.has(normalized)
}

/** @deprecated Prefer isWebAnalyticsEnabled / canAccessWebAnalytics. */
export function isDevAnalyticsEnabled(): boolean {
  return isWebAnalyticsEnabled()
}
