/**
 * Playground runner for Manifest Generator.
 * Uses the same packing-sheet → STA zip API as the live tool (no history writes).
 */

import { manifestGeneratorApi } from '../../services/api'
import type { PlaygroundLastRun, PlaygroundOutputFile } from './storage'

export const MANIFEST_PLAYGROUND_APP_ID = 'manifest-generator'

export const MANIFEST_PLAYGROUND_ACCEPT =
  '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12'

const ZIP_MIME = 'application/zip'

export function isManifestPlaygroundFileAllowed(file: File): boolean {
  return /\.(xlsx|xlsm)$/i.test(file.name)
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  const ax = err as { response?: { data?: { detail?: string } }; message?: string }
  const detail = ax.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (typeof ax.message === 'string' && ax.message.trim()) return ax.message
  return 'Manifest Generator test failed.'
}

export async function runManifestGeneratorPlayground(
  file: File,
): Promise<PlaygroundLastRun> {
  const ranAt = new Date().toISOString()
  try {
    if (!isManifestPlaygroundFileAllowed(file)) {
      throw new Error('Only .xlsx Excel files are supported.')
    }

    const result = await manifestGeneratorApi.generate(file)
    const outputs: PlaygroundOutputFile[] = [
      {
        kind: 'other',
        label: 'ZIP (.zip)',
        filename: result.filename,
        mimeType: ZIP_MIME,
        bytes: await result.blob.arrayBuffer(),
      },
    ]

    return {
      ok: true,
      message: 'Testing successful',
      ranAt,
      summaryLines: [
        `Test time: ${new Date(ranAt).toLocaleString()}`,
        `Source file: ${file.name}`,
        `Primary vendor: ${result.primaryVendor || '—'}`,
        `Pack group files: ${result.fileCount}`,
        `SKUs: ${result.skuCount}`,
        `Total units: ${result.totalUnits}`,
        `Output: ${result.filename}`,
      ],
      outputs,
    }
  } catch (err) {
    return {
      ok: false,
      message: extractErrorMessage(err),
      ranAt,
      summaryLines: [
        `Test time: ${new Date(ranAt).toLocaleString()}`,
        `Source file: ${file.name}`,
      ],
      outputs: [],
    }
  }
}
