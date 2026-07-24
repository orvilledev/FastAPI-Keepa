/**
 * Playground runner for FNSKU Labels.
 * Reuses production parsers/generators without writing to production history or APIs.
 * Live tool offers both Excel and PDF — playground produces both on success.
 */

import {
  FnskuParseError,
  buildFnskuLabelsPdfBlob,
  buildFnskuLabelsWorkbookBlob,
  parseFnskuSource,
  suggestedFnskuLabelFilename,
  suggestedFnskuLabelPdfFilename,
  summarizeFnskuShipment,
} from '../../utils/fnskuLabelGenerator'
import type { PlaygroundLastRun, PlaygroundOutputFile } from './storage'

export const FNSKU_PLAYGROUND_APP_ID = 'fnsku-labels'

export const FNSKU_PLAYGROUND_ACCEPT =
  '.csv,.xlsx,.xls,.xlsm,.zip,application/zip,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME = 'application/pdf'

export function isFnskuPlaygroundFileAllowed(file: File): boolean {
  return /\.(csv|xlsx|xls|xlsm|zip)$/i.test(file.name)
}

export async function runFnskuLabelsPlayground(file: File): Promise<PlaygroundLastRun> {
  const ranAt = new Date().toISOString()
  try {
    const shipment = await parseFnskuSource(file)
    const summary = summarizeFnskuShipment(shipment)

    const excelBlob = buildFnskuLabelsWorkbookBlob(shipment)
    const pdfBlob = buildFnskuLabelsPdfBlob(shipment)
    const excelFilename = suggestedFnskuLabelFilename(shipment)
    const pdfFilename = suggestedFnskuLabelPdfFilename(shipment)

    const outputs: PlaygroundOutputFile[] = [
      {
        kind: 'excel',
        label: 'Excel (.xlsx)',
        filename: excelFilename,
        mimeType: EXCEL_MIME,
        bytes: await excelBlob.arrayBuffer(),
      },
      {
        kind: 'pdf',
        label: 'PDF',
        filename: pdfFilename,
        mimeType: PDF_MIME,
        bytes: await pdfBlob.arrayBuffer(),
      },
    ]

    return {
      ok: true,
      message: 'Testing successful',
      ranAt,
      summaryLines: [
        `Test time: ${new Date(ranAt).toLocaleString()}`,
        `Shipment: ${summary.shipmentId || '—'}`,
        `Name: ${summary.shipmentName || '—'}`,
        `Boxes: ${summary.boxCount}`,
        `SKUs / FNSKUs: ${summary.skuCount}`,
        `Total units: ${summary.computedUnits}`,
        `Source file: ${file.name}`,
        `Outputs: ${excelFilename}; ${pdfFilename}`,
      ],
      outputs,
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
      summaryLines: [
        `Test time: ${new Date(ranAt).toLocaleString()}`,
        `Source file: ${file.name}`,
      ],
      outputs: [],
    }
  }
}
