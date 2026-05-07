import { createWorker } from 'tesseract.js'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export type TrackingScannerRow = {
  source_file: string
  odd_page: number | null
  even_page: number | null
  vendor: string
  shipment_id: string
  box_code: string
  tracking_number: string
  tracking_number_raw: string
  carrier: string
  status: string
  notes: string
}

export type TrackingScannerScanResponse = {
  filename: string
  page_count_estimate: number
  pair_count: number
  matched_count: number
  needs_review_count: number
  rows: TrackingScannerRow[]
}

const RE_SHIPMENT_PRIMARY = /\bFBADN[A-Z0-9-]+\b/
const RE_SHIPMENT_FALLBACK = /\bFBA[A-Z0-9-]{8,}\b/
const RE_BOX_CODE = /\bFBA[A-Z0-9]{8,}U\d{4,}\b/i
const RE_TRACKING_LINE = /TRACKING\s*#?\s*:?\s*([A-Z0-9 ]{10,40})/i
const RE_UPS_GENERIC = /\b1Z[0-9A-Z ]{14,25}\b/i

function normalizeAlnumUpper(value: string): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function isValidUpsTracking(value: string): boolean {
  return /^1Z[0-9A-Z]{16}$/.test(value)
}

function extractVendor(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const idx = lines.findIndex((line) => /^SHIP FROM:?$/i.test(line) || /^SHIP FROM/i.test(line))
  if (idx >= 0 && idx + 1 < lines.length) return lines[idx + 1]
  return ''
}

function extractShipmentId(text: string): string {
  const primary = text.match(RE_SHIPMENT_PRIMARY)?.[0]
  if (primary && !RE_BOX_CODE.test(primary)) return primary

  const fallback = text.match(RE_SHIPMENT_FALLBACK)?.[0]
  if (fallback && !RE_BOX_CODE.test(fallback)) return fallback
  return ''
}

function extractBoxCode(text: string): string {
  return text.match(RE_BOX_CODE)?.[0] ?? ''
}

function extractTrackingFromText(text: string): { raw: string; normalized: string } | null {
  const lineMatch = text.match(RE_TRACKING_LINE)
  if (lineMatch?.[1]) {
    const raw = lineMatch[1].trim()
    const normalized = normalizeAlnumUpper(raw)
    if (isValidUpsTracking(normalized)) return { raw, normalized }
  }

  const genericMatch = text.match(RE_UPS_GENERIC)
  if (genericMatch?.[0]) {
    const raw = genericMatch[0].trim()
    const normalized = normalizeAlnumUpper(raw)
    if (isValidUpsTracking(normalized)) return { raw, normalized }
  }

  return null
}

function cropBottomLabel(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const cropped = document.createElement('canvas')
  cropped.width = canvas.width
  cropped.height = Math.floor(canvas.height * 0.58)
  const ctx = cropped.getContext('2d')
  if (!ctx) return canvas
  const srcY = canvas.height - cropped.height
  ctx.drawImage(canvas, 0, srcY, canvas.width, cropped.height, 0, 0, cropped.width, cropped.height)
  return cropped
}

function buildCsv(rows: TrackingScannerRow[]): string {
  const headers = [
    'source_file',
    'odd_page',
    'even_page',
    'vendor',
    'shipment_id',
    'box_code',
    'tracking_number',
    'tracking_number_raw',
    'carrier',
    'status',
    'notes',
  ]

  const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const body = rows.map((row) =>
    [
      row.source_file,
      row.odd_page,
      row.even_page,
      row.vendor,
      row.shipment_id,
      row.box_code,
      row.tracking_number,
      row.tracking_number_raw,
      row.carrier,
      row.status,
      row.notes,
    ]
      .map(escapeCsv)
      .join(',')
  )
  return [headers.join(','), ...body].join('\n')
}

export async function scanPdfInBrowser(file: File): Promise<TrackingScannerScanResponse> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({ data: bytes }).promise
  const worker = await createWorker('eng')
  const rows: TrackingScannerRow[] = []

  try {
    for (let oddPage = 1; oddPage <= pdf.numPages; oddPage += 2) {
      const evenPage = oddPage + 1 <= pdf.numPages ? oddPage + 1 : null
      const odd = await pdf.getPage(oddPage)
      const oddTextContent = await odd.getTextContent()
      const oddText = oddTextContent.items.map((item) => ('str' in item ? item.str : '')).join('\n')

      let trackingRaw = ''
      let trackingNumber = ''
      let notes = ''

      if (evenPage) {
        const even = await pdf.getPage(evenPage)
        const viewport = even.getViewport({ scale: 2 })
        const fullCanvas = document.createElement('canvas')
        fullCanvas.width = viewport.width
        fullCanvas.height = viewport.height
        const ctx = fullCanvas.getContext('2d')
        if (ctx) {
          await even.render({ canvasContext: ctx, viewport }).promise
          const labelCanvas = cropBottomLabel(fullCanvas)
          const result = await worker.recognize(labelCanvas)
          const hit = extractTrackingFromText(result.data.text || '')
          if (hit) {
            trackingRaw = hit.raw
            trackingNumber = hit.normalized
          } else {
            notes = 'OCR completed but no UPS 1Z tracking number was found.'
          }
        } else {
          notes = 'Could not create canvas context for OCR.'
        }
      } else {
        notes = 'Missing paired even page for OCR.'
      }

      const shipmentId = extractShipmentId(oddText)
      const row: TrackingScannerRow = {
        source_file: file.name,
        odd_page: oddPage,
        even_page: evenPage,
        vendor: extractVendor(oddText),
        shipment_id: shipmentId,
        box_code: extractBoxCode(oddText),
        tracking_number: trackingNumber,
        tracking_number_raw: trackingRaw,
        carrier: evenPage ? 'UPS' : '',
        status: shipmentId && trackingNumber ? 'ok' : 'needs_review',
        notes,
      }
      rows.push(row)
    }
  } finally {
    await worker.terminate()
  }

  const matchedCount = rows.filter((row) => row.shipment_id && row.tracking_number).length
  const needsReviewCount = rows.filter((row) => row.status === 'needs_review').length

  return {
    filename: file.name,
    page_count_estimate: pdf.numPages,
    pair_count: rows.length,
    matched_count: matchedCount,
    needs_review_count: needsReviewCount,
    rows,
  }
}

export function exportRowsToCsvBlob(rows: TrackingScannerRow[]): Blob {
  return new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' })
}
