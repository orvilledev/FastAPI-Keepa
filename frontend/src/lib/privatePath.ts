const LAST_PRIVATE_PATH_KEY = 'last_private_path'

export function isElectronDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.desktop?.isElectron)
}

function pathStorage(): Storage {
  return isElectronDesktop() ? window.localStorage : window.sessionStorage
}

export function getLastPrivatePath(): string | null {
  try {
    return pathStorage().getItem(LAST_PRIVATE_PATH_KEY)
  } catch {
    return null
  }
}

export function setLastPrivatePath(path: string): void {
  try {
    pathStorage().setItem(LAST_PRIVATE_PATH_KEY, path)
  } catch {
    // ignore
  }
}
