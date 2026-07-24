/**
 * Playground runner for Tracking Extractor.
 * Uses the same browser scan + Excel export as the live tool, without writing scan history.
 */

import {
  exportRowsToExcelBlob,
  scanFilesInBrowser,
  type TrackingScanProgress,
} from '../../utils/trackingExtractor'
import type { PlaygroundLastRun, PlaygroundOutputFile } from './storage'

export const TRACKING_PLAYGROUND_APP_ID = 'tracking-scanner'

export const TRACKING_PLAYGROUND_ACCEPT =
  '.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed'

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function isTrackingPlaygroundFileAllowed(file: File): boolean {
  return /\.(pdf|zip)$/i.test(file.name)
}

function suggestedTrackingExcelFilename(): string {
  return `tracking_extract_${new Date().toISOString().slice(0, 10)}.xlsx`
}

export async function runTrackingExtractorPlayground(
  file: File,
  onProgress?: (progress: TrackingScanProgress) => void,
): Promise<PlaygroundLastRun> {
  const ranAt = new Date().toISOString()
  try {
    if (!isTrackingPlaygroundFileAllowed(file)) {
      throw new Error('Only PDF and ZIP files are supported.')
    }

    const result = await scanFilesInBrowser([file], (progress) => {
      onProgress?.(progress)
    })

    const summaryLines = [
      `Test time: ${new Date(ranAt).toLocaleString()}`,
      `Source upload: ${file.name}`,
      `PDF files: ${result.file_count}`,
      `Page pairs: ${result.pair_count}`,
      `Matched: ${result.matched_count}`,
      `Needs review: ${result.needs_review_count}`,
      `Rows: ${result.rows.length}`,
    ]

    const outputs: PlaygroundOutputFile[] = []
    if (result.rows.length > 0) {
      const excelBlob = exportRowsToExcelBlob(result.rows)
      const excelFilename = suggestedTrackingExcelFilename()
      outputs.push({
        kind: 'excel',
        label: 'Excel (.xlsx)',
        filename: excelFilename,
        mimeType: EXCEL_MIME,
        bytes: await excelBlob.arrayBuffer(),
      })
      summaryLines.push(`Output: ${excelFilename}`)
    } else {
      summaryLines.push('Output: none (no rows to export)')
    }

    const message =
      result.rows.length === 0
        ? 'Testing successful — scan finished, but no rows were extracted to export.'
        : result.matched_count === 0
          ? 'Testing successful — scan finished with rows that need review before use.'
          : 'Testing successful'

    return {
      ok: true,
      message,
      ranAt,
      summaryLines,
      outputs,
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Tracking Extractor test failed.'
    return {
      ok: false,
      message,
      ranAt,
      summaryLines: [
        `Test time: ${new Date(ranAt).toLocaleString()}`,
        `Source file: ${file.name}`,
      ],
      outputs: [],
    }
  }
}
