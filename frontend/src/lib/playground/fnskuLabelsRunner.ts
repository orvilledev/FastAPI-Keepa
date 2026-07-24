/**
 * Playground runner for FNSKU Labels.
 * Reuses production parsers/generators without writing to production history or APIs.
 */

import {
  FnskuParseError,
  buildFnskuLabelsWorkbookBlob,
  parseFnskuSource,
  suggestedFnskuLabelFilename,
  summarizeFnskuShipment,
} from '../../utils/fnskuLabelGenerator'
import type { PlaygroundLastRun } from './storage'

export const FNSKU_PLAYGROUND_APP_ID = 'fnsku-labels'

export const FNSKU_PLAYGROUND_ACCEPT =
  '.csv,.xlsx,.xls,.xlsm,.zip,application/zip,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function isFnskuPlaygroundFileAllowed(file: File): boolean {
  return /\.(csv|xlsx|xls|xlsm|zip)$/i.test(file.name)
}

export async function runFnskuLabelsPlayground(file: File): Promise<PlaygroundLastRun> {
  const ranAt = new Date().toISOString()
  try {
    const shipment = await parseFnskuSource(file)
    const summary = summarizeFnskuShipment(shipment)
    const blob = buildFnskuLabelsWorkbookBlob(shipment)
    const outputBytes = await blob.arrayBuffer()
    const outputFilename = suggestedFnskuLabelFilename(shipment)

    return {
      ok: true,
      message: 'Testing successful',
      ranAt,
      summaryLines: [
        `Shipment: ${summary.shipmentId || '—'}`,
        `Name: ${summary.shipmentName || '—'}`,
        `Boxes: ${summary.boxCount}`,
        `SKUs / FNSKUs: ${summary.skuCount}`,
        `Total units: ${summary.computedUnits}`,
        `Source file: ${file.name}`,
        `Output: ${outputFilename}`,
      ],
      outputFilename,
      outputBytes,
      outputMimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
  } catch (err) {
    const message =
      err instanceof FnskuParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'FNSKU Labels test failed.'
    return {
      ok: false,
      message,
      ranAt,
      summaryLines: [`Source file: ${file.name}`],
      outputFilename: null,
    }
  }
}
