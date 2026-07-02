const LAST_PRIVATE_PATH_KEY = 'last_private_path'

export function isElectronDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.desktop?.isElectron)
}

/** True when the app is running as an installed PWA (home-screen / standalone). */
export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone) return true
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  )
}

/** Browser tab or installed PWA — never the Electron desktop shell. */
export function isWebOrPwaClient(): boolean {
  return !isElectronDesktop()
}

/** Whether the v3 web-release announcement should be shown in this client. */
export function shouldShowWebReleaseAnnouncement(): boolean {
  return isWebOrPwaClient()
}

function pathStorage(): Storage {
  return isElectronDesktop() ? window.localStorage : window.sessionStorage
}

/** Current in-app route (HashRouter on Electron `file:` builds). */
export function getCurrentAppRoute(): string {
  if (typeof window === 'undefined') return '/'
  if (window.location.protocol === 'file:') {
    const hash = window.location.hash.replace(/^#/, '')
    const route = hash.startsWith('/') ? hash : `/${hash}`
    return route.split('?')[0] || '/'
  }
  return window.location.pathname || '/'
}

/** Query string for the current route (browser path or hash on Electron). */
function getCurrentAppSearch(): string {
  if (typeof window === 'undefined') return ''
  if (window.location.protocol === 'file:') {
    const hash = window.location.hash.replace(/^#/, '')
    const q = hash.indexOf('?')
    return q >= 0 ? hash.slice(q) : ''
  }
  return window.location.search || ''
}

/** Path + search suitable for React Router `Navigate` / restore after refresh. */
export function getCurrentRememberedPath(): string {
  return `${getCurrentAppRoute()}${getCurrentAppSearch()}`
}

/** Reject corrupted Electron saves that accidentally included the filesystem path. */
export function isValidStoredRoute(path: string | null | undefined): path is string {
  if (!path || !path.startsWith('/')) return false
  if (path.includes('.html') || path.includes('\\')) return false
  // e.g. `/C:/Users/.../index.html#/dashboard`
  if (/^\/[A-Za-z]:\//.test(path)) return false
  return true
}

export function getLastPrivatePath(): string | null {
  try {
    const raw = pathStorage().getItem(LAST_PRIVATE_PATH_KEY)
    if (!isValidStoredRoute(raw)) {
      if (raw) pathStorage().removeItem(LAST_PRIVATE_PATH_KEY)
      return null
    }
    return raw
  } catch {
    return null
  }
}

export function setLastPrivatePath(path: string): void {
  if (!isValidStoredRoute(path)) return
  try {
    pathStorage().setItem(LAST_PRIVATE_PATH_KEY, path)
  } catch {
    // ignore
  }
}
