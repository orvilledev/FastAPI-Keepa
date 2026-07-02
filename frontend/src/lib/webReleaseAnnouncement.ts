import { isInstalledPwa, shouldShowWebReleaseAnnouncement } from './privatePath'

const SESSION_DISMISS_PREFIX = 'msw_web_release_v3_0_0_announcement_dismissed_'
const LEGACY_DISMISS_KEY = 'msw_web_release_v3_0_0_announcement_dismissed'
const WEB_BROWSER_HEARTBEAT_PREFIX = 'msw_web_browser_client_heartbeat_'

const HEARTBEAT_INTERVAL_MS = 3_000
const HEARTBEAT_STALE_MS = 8_000

function sessionDismissKey(userId: string): string {
  return `${SESSION_DISMISS_PREFIX}${userId}`
}

export function webBrowserHeartbeatKey(userId: string): string {
  return `${WEB_BROWSER_HEARTBEAT_PREFIX}${userId}`
}

export function isWebBrowserTab(): boolean {
  return shouldShowWebReleaseAnnouncement() && !isInstalledPwa()
}

function readHeartbeatTimestamp(userId: string): number | null {
  try {
    const raw = localStorage.getItem(webBrowserHeartbeatKey(userId))
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

/** True when a normal browser tab (not PWA) is currently open for this user. */
export function isWebBrowserClientActive(userId: string): boolean {
  const ts = readHeartbeatTimestamp(userId)
  if (ts === null) return false
  return Date.now() - ts < HEARTBEAT_STALE_MS
}

export function writeWebBrowserHeartbeat(userId: string): void {
  try {
    localStorage.setItem(webBrowserHeartbeatKey(userId), String(Date.now()))
  } catch {
    // ignore
  }
}

export function clearWebBrowserHeartbeat(userId: string): void {
  try {
    localStorage.removeItem(webBrowserHeartbeatKey(userId))
  } catch {
    // ignore
  }
}

export function clearLegacyPermanentDismiss(userId: string): void {
  try {
    localStorage.removeItem(LEGACY_DISMISS_KEY)
    localStorage.removeItem(sessionDismissKey(userId))
  } catch {
    // ignore
  }
}

export function isReleaseAnnouncementDismissedThisSession(userId: string): boolean {
  try {
    return sessionStorage.getItem(sessionDismissKey(userId)) === '1'
  } catch {
    return false
  }
}

export function dismissReleaseAnnouncementThisSession(userId: string): void {
  try {
    sessionStorage.setItem(sessionDismissKey(userId), '1')
  } catch {
    // ignore
  }
}

/**
 * Whether this client should show the v3 release popup for the signed-in user.
 *
 * - Browser tab: show unless this user dismissed it this session.
 * - PWA: show unless dismissed AND no browser tab is open for the same user.
 * - Electron: never.
 *
 * Dismissal is per user and per client session; closing all MSW Overwatch
 * windows clears it so the same user sees it again on next open.
 */
export function shouldShowReleaseAnnouncementPopup(userId: string): boolean {
  if (!shouldShowWebReleaseAnnouncement()) return false
  if (isReleaseAnnouncementDismissedThisSession(userId)) return false
  if (isInstalledPwa() && isWebBrowserClientActive(userId)) return false
  return true
}

export { HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS }
