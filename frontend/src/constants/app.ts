export const APP_NAME = 'MSW Overwatch'
export const APP_VERSION = '1.0.0'
export const APP_VERSION_LABEL = `v${APP_VERSION}`

/** Short git SHA for the built bundle (e.g. 35c26a2); "unknown" when not built from git. */
export const APP_GIT_COMMIT_SHORT = __GIT_COMMIT_SHORT__

export const APP_COPYRIGHT_OWNER =
  'Owned and managed by MetroShoe Warehouse.'

/** Set `VITE_DESKTOP_APP_DOWNLOAD_URL` at build time; empty string hides the navbar download control. */
export const DESKTOP_APP_DOWNLOAD_URL = (
  import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL ?? ''
).trim()
