export const APP_NAME = 'MSW Overwatch'
export const APP_ICON_URL = `${import.meta.env.BASE_URL}app-icon.svg`
export const APP_VERSION = '1.0.0'
export const APP_VERSION_LABEL = `v${APP_VERSION}`

/** Short git SHA for the built bundle (e.g. 35c26a2); "unknown" when not built from git. */
export const APP_GIT_COMMIT_SHORT = __GIT_COMMIT_SHORT__

export const APP_COPYRIGHT_OWNER =
  'Owned and managed by MetroShoe Warehouse.'

/**
 * Build-time fallback for the Windows installer URL. The navbar also loads
 * `GET /api/v1/public/client-config` and prefers `desktop_app_download_url` from the
 * backend (set `DESKTOP_APP_DOWNLOAD_URL` on the API host) so production can change
 * the link without rebuilding the frontend.
 */
export const DESKTOP_APP_DOWNLOAD_URL = (
  import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL ?? ''
).trim()
