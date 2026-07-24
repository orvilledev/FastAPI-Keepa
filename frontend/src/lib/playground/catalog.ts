/**
 * Tools available in the Playground dropdown — mirrors the sidebar TOOLS section
 * (excluding Playground itself).
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

export const PLAYGROUND_TOOLS: PlaygroundToolDef[] = [
  {
    id: 'micro-tools',
    label: 'Micro Tools',
    path: '/micro-tools',
    runnerReady: false,
  },
  {
    id: 'tracking-scanner',
    label: 'Tracking Extractor',
    path: '/tracking-scanner',
    runnerReady: false,
    accept: '.pdf,application/pdf',
    acceptHint: '.pdf',
  },
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
    id: 'keepa-import-export',
    label: 'Keepa Import File',
    path: '/keepa-import-export',
    requiresKeepaAccess: true,
    runnerReady: false,
  },
  {
    id: 'label-station',
    label: 'Label Station',
    path: '/label-station',
    requiresKeepaAccess: true,
    runnerReady: false,
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

export function loadSelectedPlaygroundToolIds(userScope: string): string[] {
  try {
    const raw = localStorage.getItem(`${SELECTED_KEY_PREFIX}${userScope}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

export function saveSelectedPlaygroundToolIds(
  userScope: string,
  ids: string[],
): void {
  try {
    localStorage.setItem(
      `${SELECTED_KEY_PREFIX}${userScope}`,
      JSON.stringify(ids),
    )
  } catch {
    /* ignore quota / private mode */
  }
}
