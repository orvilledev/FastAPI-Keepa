/**
 * Feature gates that differ between web and Electron.
 * Electron builds use Vite mode "electron" and expose window.desktop.isElectron.
 */

import { isElectronDesktop } from './privatePath'

/**
 * Off-price Analytics is available on the web app (dev + production)
 * and hidden from the Electron desktop client.
 */
export function isWebAnalyticsEnabled(): boolean {
  if (import.meta.env.MODE === 'electron') return false
  if (isElectronDesktop()) return false
  return true
}

/** @deprecated Prefer isWebAnalyticsEnabled — kept for any leftover imports. */
export function isDevAnalyticsEnabled(): boolean {
  return isWebAnalyticsEnabled()
}
