/**
 * Tools selectable in the Playground dropdown.
 * Currently only tools that accept file uploads for sandbox testing:
 * FNSKU Labels and Tracking Extractor.
 */

export type PlaygroundToolDef = {
  id: string
  label: string
  path: string
  /** When true, only show if the user has Keepa / Label Station access. */
  requiresKeepaAccess?: boolean
  /**
   * True when a real sandbox runner exists for this tool.
   * Tools without a runner can still be added; the card explains they are not wired yet.
   */
  runnerReady: boolean
  accept?: string
  acceptHint?: string
}

/** Only these Tools-category apps are offered for playground testing right now. */
export const PLAYGROUND_TOOLS: PlaygroundToolDef[] = [
  {
    id: 'fnsku-labels',
    label: 'FNSKU Labels',
    path: '/fnsku-labels',
    runnerReady: true,
    accept:
      '.csv,.xlsx,.xls,.xlsm,.zip,application/zip,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptHint: '.csv, .xlsx, or .zip',
  },
  {
    id: 'tracking-scanner',
    label: 'Tracking Extractor',
    path: '/tracking-scanner',
    runnerReady: false,
    accept: '.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed',
    acceptHint: '.pdf or .zip',
  },
]

export function getPlaygroundTool(id: string): PlaygroundToolDef | undefined {
  return PLAYGROUND_TOOLS.find((t) => t.id === id)
}

export function listPlaygroundToolsForUser(hasKeepaAccess: boolean): PlaygroundToolDef[] {
  return PLAYGROUND_TOOLS.filter(
    (t) => !t.requiresKeepaAccess || hasKeepaAccess,
  )
}

const SELECTED_KEY_PREFIX = 'msw-playground-selected-tools-v1:'

function selectedToolsStorageKey(userScope: string): string {
  return `${SELECTED_KEY_PREFIX}${userScope.trim().toLowerCase()}`
}

export function loadSelectedPlaygroundToolIds(userScope: string): string[] {
  const scope = (userScope || '').trim().toLowerCase()
  if (!scope.includes('@')) return []
  try {
    const raw = localStorage.getItem(selectedToolsStorageKey(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const allowed = new Set(PLAYGROUND_TOOLS.map((t) => t.id))
    return parsed.filter(
      (id): id is string => typeof id === 'string' && allowed.has(id),
    )
  } catch {
    return []
  }
}

export function saveSelectedPlaygroundToolIds(
  userScope: string,
  ids: string[],
): void {
  const scope = (userScope || '').trim().toLowerCase()
  if (!scope.includes('@')) return
  try {
    const allowed = new Set(PLAYGROUND_TOOLS.map((t) => t.id))
    const cleaned = ids.filter((id) => allowed.has(id))
    localStorage.setItem(selectedToolsStorageKey(scope), JSON.stringify(cleaned))
  } catch {
    /* ignore quota / private mode */
  }
}
