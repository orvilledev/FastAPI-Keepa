import { isInstalledPwa, shouldShowWebReleaseAnnouncement } from './privatePath'

/** Per browser tab / PWA window — cleared when that client is fully closed. */
const SESSION_DISMISS_KEY = 'msw_web_release_v3_0_0_announcement_dismissed'

/** Legacy permanent dismiss key — cleared so reopen-after-close works as expected. */
const LEGACY_DISMISS_KEY = 'msw_web_release_v3_0_0_announcement_dismissed'

/** Written by an open browser tab so the PWA knows not to show the popup. */
export const WEB_BROWSER_HEARTBEAT_KEY = 'msw_web_browser_client_heartbeat'

const HEARTBEAT_INTERVAL_MS = 3_000
const HEARTBEAT_STALE_MS = 8_000

export function isWebBrowserTab(): boolean {
  return shouldShowWebReleaseAnnouncement() && !isInstalledPwa()
}

function readHeartbeatTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(WEB_BROWSER_HEARTBEAT_KEY)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

/** True when a normal browser tab (not PWA) is currently open. */
export function isWebBrowserClientActive(): boolean {
  const ts = readHeartbeatTimestamp()
  if (ts === null) return false
  return Date.now() - ts < HEARTBEAT_STALE_MS
}

export function writeWebBrowserHeartbeat(): void {
  try {
    localStorage.setItem(WEB_BROWSER_HEARTBEAT_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

export function clearWebBrowserHeartbeat(): void {
  try {
    localStorage.removeItem(WEB_BROWSER_HEARTBEAT_KEY)
  } catch {
    // ignore
  }
}

export function clearLegacyPermanentDismiss(): void {
  try {
    localStorage.removeItem(LEGACY_DISMISS_KEY)
  } catch {
    // ignore
  }
}

export function isReleaseAnnouncementDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissReleaseAnnouncementThisSession(): void {
  try {
    sessionStorage.setItem(SESSION_DISMISS_KEY, '1')
  } catch {
    // ignore
  }
}

/**
 * Whether this client should show the v3 release popup right now.
 *
 * - Browser tab: show unless dismissed this session.
 * - PWA: show unless dismissed this session AND no browser tab is open.
 * - Electron: never.
 *
 * Dismissal is per client session; closing all MSW Overwatch windows clears it.
 */
export function shouldShowReleaseAnnouncementPopup(): boolean {
  if (!shouldShowWebReleaseAnnouncement()) return false
  if (isReleaseAnnouncementDismissedThisSession()) return false
  if (isInstalledPwa() && isWebBrowserClientActive()) return false
  return true
}

export { HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS }
