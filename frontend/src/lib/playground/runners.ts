/**
 * Registry of playground tool runners.
 * Every testable tool: same input file types as the live app → run → report → typed downloads.
 */

import type { PlaygroundToolDef } from './catalog'
import {
  FNSKU_PLAYGROUND_ACCEPT,
  FNSKU_PLAYGROUND_APP_ID,
  isFnskuPlaygroundFileAllowed,
  runFnskuLabelsPlayground,
} from './fnskuLabelsRunner'
import type { PlaygroundLastRun } from './storage'
import {
  TRACKING_PLAYGROUND_ACCEPT,
  TRACKING_PLAYGROUND_APP_ID,
  isTrackingPlaygroundFileAllowed,
  runTrackingExtractorPlayground,
} from './trackingExtractorRunner'

export type PlaygroundRunProgress = {
  percent: number
  detail?: string
}

export type PlaygroundToolRunner = {
  appId: string
  description: string
  accept: string
  acceptHint: string
  isFileAllowed: (file: File) => boolean
  run: (
    file: File,
    onProgress?: (progress: PlaygroundRunProgress) => void,
  ) => Promise<PlaygroundLastRun>
}

export const PLAYGROUND_RUNNERS: Record<string, PlaygroundToolRunner> = {
  [FNSKU_PLAYGROUND_APP_ID]: {
    appId: FNSKU_PLAYGROUND_APP_ID,
    description:
      'Same parse → Excel + PDF pipeline as the live tool, without writing label history.',
    accept: FNSKU_PLAYGROUND_ACCEPT,
    acceptHint: '.csv, .xlsx, or .zip',
    isFileAllowed: isFnskuPlaygroundFileAllowed,
    run: async (file) => runFnskuLabelsPlayground(file),
  },
  [TRACKING_PLAYGROUND_APP_ID]: {
    appId: TRACKING_PLAYGROUND_APP_ID,
    description:
      'Same PDF/ZIP scan → Excel pipeline as the live tool, without saving scan history.',
    accept: TRACKING_PLAYGROUND_ACCEPT,
    acceptHint: '.pdf or .zip',
    isFileAllowed: isTrackingPlaygroundFileAllowed,
    run: async (file, onProgress) =>
      runTrackingExtractorPlayground(file, (p) => {
        onProgress?.({
          percent: p.percent,
          detail: p.current_file
            ? `${p.percent}% — ${p.current_file}`
            : `${p.percent}%`,
        })
      }),
  },
}

export function getPlaygroundRunner(
  tool: PlaygroundToolDef | string,
): PlaygroundToolRunner | null {
  const id = typeof tool === 'string' ? tool : tool.id
  return PLAYGROUND_RUNNERS[id] ?? null
}
