import { createWorker, PSM } from 'tesseract.js'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'

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

export type TrackingScannerAggregateResponse = {
  source_count: number
  file_count: number
  page_count_estimate: number
  pair_count: number
  matched_count: number
  needs_review_count: number
  rows: TrackingScannerRow[]
}

export type TrackingScanProgress = {
  completed: number
  total: number
  percent: number
  current_file: string
}

type SingleFileProgress = {
  file_percent: number
  pair_index: number
  pair_count: number
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>

type OcrRegion = {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

const RE_SHIPMENT_PRIMARY = /\bFBADN[A-Z0-9-]+\b/
const RE_SHIPMENT_FALLBACK = /\bFBA[A-Z0-9-]{8,}\b/
const RE_BOX_CODE = /\bFBA[A-Z0-9]{8,}U\d{4,}\b/i
const RE_TRACKING_LINE = /TRACKING\s*#?\s*:?\s*([A-Z0-9\s:-]{10,48})/i
const RE_UPS_GENERIC = /\b1\s*Z[\s:-]*[0-9A-Z][0-9A-Z\s:-]{13,35}\b/i

const TRACKING_OCR_REGIONS: OcrRegion[] = [
  { x: 0.1, y: 0.45, width: 0.74, height: 0.13, scale: 4 },
  { x: 0.08, y: 0.39, width: 0.84, height: 0.22, scale: 3 },
  { x: 0.04, y: 0.32, width: 0.92, height: 0.34, scale: 2 },
]

// Narrow strips targeted at the "TRACKING #: 1Z..." line. The text on a typical
// UPS Ground label is small, sits between the QR/barcode blocks above and the
// large 1D barcode below, and can be at slightly different vertical positions
// across label templates.
const TRACKING_STRIP_REGIONS: OcrRegion[] = [
  { x: 0.06, y: 0.475, width: 0.78, height: 0.07, scale: 6 },
  { x: 0.06, y: 0.44, width: 0.82, height: 0.08, scale: 6 },
  { x: 0.04, y: 0.515, width: 0.84, height: 0.07, scale: 6 },
  { x: 0.04, y: 0.40, width: 0.86, height: 0.10, scale: 5 },
]

const TRACKING_STRIP_PSM = PSM.SINGLE_LINE
const TRACKING_STRIP_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#: '
const TRACKING_DEFAULT_PSM = PSM.AUTO
const TRACKING_DEFAULT_WHITELIST = ''

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

function cropOcrRegion(canvas: HTMLCanvasElement, region: OcrRegion): HTMLCanvasElement {
  const sx = Math.max(0, Math.floor(canvas.width * region.x))
  const sy = Math.max(0, Math.floor(canvas.height * region.y))
  const sw = Math.min(canvas.width - sx, Math.floor(canvas.width * region.width))
  const sh = Math.min(canvas.height - sy, Math.floor(canvas.height * region.height))
  const scale = Math.max(1, region.scale)
  const cropped = document.createElement('canvas')
  cropped.width = Math.max(1, Math.floor(sw * scale))
  cropped.height = Math.max(1, Math.floor(sh * scale))

  const ctx = cropped.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cropped.width, cropped.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, cropped.width, cropped.height)
  return toHighContrastCanvas(cropped)
}

function cropOcrStrip(canvas: HTMLCanvasElement, region: OcrRegion): HTMLCanvasElement {
  const sx = Math.max(0, Math.floor(canvas.width * region.x))
  const sy = Math.max(0, Math.floor(canvas.height * region.y))
  const sw = Math.min(canvas.width - sx, Math.floor(canvas.width * region.width))
  const sh = Math.min(canvas.height - sy, Math.floor(canvas.height * region.height))
  const scale = Math.max(1, region.scale)
  const cropped = document.createElement('canvas')
  cropped.width = Math.max(1, Math.floor(sw * scale))
  cropped.height = Math.max(1, Math.floor(sh * scale))

  const ctx = cropped.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cropped.width, cropped.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, cropped.width, cropped.height)
  return cropped
}

function toHighContrastCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const value = luminance < 170 ? 0 : 255
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

async function recognizeTrackingNumber(
  worker: OcrWorker,
  fullCanvas: HTMLCanvasElement
): Promise<{ raw: string; normalized: string } | null> {
  // Single-line strip pass first: scaled high, smooth, with a tight whitelist.
  // This handles small `TRACKING #: 1Z ...` lines that broader passes miss.
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: TRACKING_STRIP_PSM,
      tessedit_char_whitelist: TRACKING_STRIP_WHITELIST,
    })
    for (const region of TRACKING_STRIP_REGIONS) {
      const result = await worker.recognize(cropOcrStrip(fullCanvas, region))
      const hit = extractTrackingFromText(result.data.text || '')
      if (hit) return hit
    }
  } finally {
    await worker.setParameters({
      tessedit_pageseg_mode: TRACKING_DEFAULT_PSM,
      tessedit_char_whitelist: TRACKING_DEFAULT_WHITELIST,
    })
  }

  const bottomResult = await worker.recognize(cropBottomLabel(fullCanvas))
  const bottomHit = extractTrackingFromText(bottomResult.data.text || '')
  if (bottomHit) return bottomHit

  for (const region of TRACKING_OCR_REGIONS) {
    const result = await worker.recognize(cropOcrRegion(fullCanvas, region))
    const hit = extractTrackingFromText(result.data.text || '')
    if (hit) return hit
  }

  return null
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

function isPdfFile(file: File): boolean {
  return /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
}

function isZipFile(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
}

async function unzipPdfFiles(file: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const entries = Object.values(zip.files)
  const pdfEntries = entries.filter((entry) => !entry.dir && /\.pdf$/i.test(entry.name))
  const extracted = await Promise.all(
    pdfEntries.map(async (entry) => {
      const buffer = await entry.async('arraybuffer')
      const leafName = entry.name.split('/').pop() || entry.name
      return new File([buffer], leafName, { type: 'application/pdf' })
    })
  )
  return extracted
}

export async function expandInputFiles(files: File[]): Promise<{ pdfFiles: File[]; skippedFiles: string[] }> {
  const pdfFiles: File[] = []
  const skippedFiles: string[] = []
  for (const file of files) {
    if (isPdfFile(file)) {
      pdfFiles.push(file)
      continue
    }
    if (isZipFile(file)) {
      const extracted = await unzipPdfFiles(file)
      if (extracted.length === 0) {
        skippedFiles.push(`${file.name} (no PDFs found in ZIP)`)
      } else {
        pdfFiles.push(...extracted)
      }
      continue
    }
    skippedFiles.push(file.name)
  }
  return { pdfFiles, skippedFiles }
}

export async function scanPdfInBrowser(
  file: File,
  onProgress?: (progress: SingleFileProgress) => void
): Promise<TrackingScannerScanResponse> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({ data: bytes }).promise
  const pairCount = Math.ceil(pdf.numPages / 2)
  let activePairIndex = 0
  let latestOcrProgress = 0
  const emitSingleFileProgress = () => {
    const normalized = pairCount > 0 ? (activePairIndex + latestOcrProgress) / pairCount : 1
    onProgress?.({
      file_percent: Math.max(0, Math.min(100, Math.round(normalized * 100))),
      pair_index: Math.min(activePairIndex + 1, Math.max(pairCount, 1)),
      pair_count: pairCount,
    })
  }
  const worker = await createWorker('eng', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        latestOcrProgress = Math.max(latestOcrProgress, Math.max(0, Math.min(1, message.progress)))
        emitSingleFileProgress()
      }
    },
  })
  const rows: TrackingScannerRow[] = []

  try {
    if (pairCount > 0) emitSingleFileProgress()
    for (let oddPage = 1; oddPage <= pdf.numPages; oddPage += 2) {
      activePairIndex = Math.floor((oddPage - 1) / 2)
      latestOcrProgress = 0
      emitSingleFileProgress()
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
          await even.render({ canvas: fullCanvas, canvasContext: ctx, viewport }).promise
          const hit = await recognizeTrackingNumber(worker, fullCanvas)
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
      activePairIndex += 1
      latestOcrProgress = 0
      emitSingleFileProgress()
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

export async function scanFilesInBrowser(
  files: File[],
  onProgress?: (progress: TrackingScanProgress) => void
): Promise<TrackingScannerAggregateResponse> {
  const { pdfFiles, skippedFiles } = await expandInputFiles(files)
  if (pdfFiles.length === 0) {
    const hint =
      skippedFiles.length > 0
        ? ` Skipped: ${skippedFiles.join(', ')}.`
        : ''
    throw new Error(`No PDF files found to scan.${hint}`)
  }

  const scans: TrackingScannerScanResponse[] = []
  const total = pdfFiles.length
  const emitOverallProgress = (completedUnits: number, currentFileName: string) => {
    onProgress?.({
      completed: Math.floor(completedUnits),
      total,
      percent: Math.max(0, Math.min(100, Math.round((completedUnits / total) * 100))),
      current_file: currentFileName,
    })
  }
  emitOverallProgress(0, '')
  for (let idx = 0; idx < pdfFiles.length; idx += 1) {
    const file = pdfFiles[idx]
    const scan = await scanPdfInBrowser(file, (singleFileProgress) => {
      emitOverallProgress(idx + singleFileProgress.file_percent / 100, file.name)
    })
    scans.push(scan)
    emitOverallProgress(idx + 1, file.name)
  }
  const rows = scans.flatMap((result) => result.rows)

  const pageCountEstimate = scans.reduce((sum, scan) => sum + scan.page_count_estimate, 0)
  const pairCount = scans.reduce((sum, scan) => sum + scan.pair_count, 0)
  const matchedCount = scans.reduce((sum, scan) => sum + scan.matched_count, 0)
  const needsReviewCount = scans.reduce((sum, scan) => sum + scan.needs_review_count, 0)

  return {
    source_count: files.length,
    file_count: pdfFiles.length,
    page_count_estimate: pageCountEstimate,
    pair_count: pairCount,
    matched_count: matchedCount,
    needs_review_count: needsReviewCount,
    rows,
  }
}

export function exportRowsToCsvBlob(rows: TrackingScannerRow[]): Blob {
  return new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' })
}

const EXPORT_HEADER_LABELS = [
  'Source File',
  'Odd Page',
  'Even Page',
  'Vendor',
  'Shipment ID',
  'Box Code',
  'Carrier',
  'Tracking Number',
  'Raw Tracking Number',
  'Status',
  'Notes',
] as const

/** ARGB for Excel */
const RGB_BLACK = 'FF000000'
const RGB_WHITE = 'FFFFFFFF'
const RGB_HEADER_FILL = 'FF46A5B5'

function excelThinBorder() {
  const c = { rgb: RGB_BLACK }
  return {
    top: { style: 'thin' as const, color: c },
    left: { style: 'thin' as const, color: c },
    bottom: { style: 'thin' as const, color: c },
    right: { style: 'thin' as const, color: c },
  }
}

function excelHeaderStyle() {
  return {
    font: { bold: true, color: { rgb: RGB_BLACK }, sz: 11, name: 'Calibri' },
    fill: {
      patternType: 'solid' as const,
      fgColor: { rgb: RGB_HEADER_FILL },
    },
    alignment: {
      horizontal: 'center' as const,
      vertical: 'center' as const,
      wrapText: true,
    },
    border: excelThinBorder(),
  }
}

function excelDataStyle(horizontal: 'left' | 'right') {
  return {
    font: { color: { rgb: RGB_BLACK }, sz: 11, name: 'Calibri' },
    fill: {
      patternType: 'solid' as const,
      fgColor: { rgb: RGB_WHITE },
    },
    alignment: {
      horizontal,
      vertical: 'center' as const,
      wrapText: true,
    },
    border: excelThinBorder(),
  }
}

/** Column widths in character units so text is visible immediately on open */
function columnCharWidths(header: readonly string[], body: (string | number)[][]): { wch: number }[] {
  const n = header.length
  const maxLen = Array(n).fill(0)
  header.forEach((h, i) => {
    maxLen[i] = Math.max(maxLen[i], h.length)
  })
  for (const row of body) {
    for (let i = 0; i < n; i += 1) {
      const text = row[i] ?? ''
      maxLen[i] = Math.max(maxLen[i], String(text).length)
    }
  }
  return maxLen.map((len) => ({ wch: Math.min(Math.max(len + 2, 8), 64) }))
}

export function exportRowsToExcelBlob(rows: TrackingScannerRow[]): Blob {
  const bodyAoA: (string | number)[][] = rows.map((row) => [
    row.source_file,
    row.odd_page != null ? row.odd_page : '',
    row.even_page != null ? row.even_page : '',
    row.vendor,
    row.shipment_id,
    row.box_code,
    row.carrier,
    row.tracking_number,
    row.tracking_number_raw,
    row.status,
    row.notes,
  ])

  const aoa: (string | number)[][] = [[...EXPORT_HEADER_LABELS], ...bodyAoA]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  const aligns: ('left' | 'right')[] = [
    'left',
    'right',
    'right',
    'left',
    'left',
    'left',
    'left',
    'left',
    'left',
    'left',
    'left',
  ]

  const ref = ws['!ref']
  if (ref) {
    const rng = XLSX.utils.decode_range(ref)
    for (let r = rng.s.r; r <= rng.e.r; r += 1) {
      for (let c = rng.s.c; c <= rng.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (!cell) continue
        cell.s = r === 0 ? excelHeaderStyle() : excelDataStyle(aligns[c] ?? 'left')
      }
    }
  }
  ws['!cols'] = columnCharWidths(EXPORT_HEADER_LABELS, bodyAoA)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tracking Results')

  /** First sheet stays active; widths + wraps make data readable on open */
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
