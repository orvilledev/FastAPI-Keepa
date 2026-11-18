import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'
import XLSX from 'xlsx-js-style'
import {
  canvasToZplGraphic,
  DEFAULT_LABEL_DPI,
  DEFAULT_LABEL_PRINT_MODE,
  LABEL_PRINT_MODES,
  PRINTER_DPI_KEY,
  PRINTER_NAME_KEY,
  SUPPORTED_DPIS,
  type LabelDpi,
  type LabelPrintMode,
} from './warehouseLabel'

/**
 * Label Station II label: 2.25" × 1.25" stock (the same stock as Label Station's
 * Medium size). Layout, top to bottom:
 *
 *   Vendor Name
 *   DESCRIPTION (bold)              SIZE (bold, large, right)
 *   COLOR (bold)
 *   MPN
 *   |||||||||||||||| (Code 128 of the UPC)
 *      UPC
 *
 * Drawn on a 203-dpi base grid and rendered at the printer's native dpi, then
 * thresholded to pure black/white. The same canvas feeds the PDF and the ZPL
 * ^GFA raster, so the preview matches the print.
 */

const BASE_DPI = 203
const MONO_THRESHOLD = 150
const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

export const LS2_LABEL_WIDTH_IN = 2.25
export const LS2_LABEL_HEIGHT_IN = 1.25
const BASE_W = 457
const BASE_H = 254
const PAGE_W_PT = 162
const PAGE_H_PT = 90

const LAYOUT = {
  pad: 14,
  lineGap: 5,
  vendor: { max: 18, min: 11, bold: false, maxLines: 1, wrapBelow: 0 },
  /** Wraps onto a second line rather than shrinking below `wrapBelow`. */
  description: { max: 24, min: 13, bold: true, maxLines: 2, wrapBelow: 18 },
  color: { max: 19, min: 11, bold: true, maxLines: 1, wrapBelow: 0 },
  mpn: { max: 17, min: 11, bold: false, maxLines: 1, wrapBelow: 0 },
  wrapLineGap: 3,
  sizeMaxFont: 46,
  sizeMinFont: 20,
  /** Size column never takes more than this share of the inner width. */
  sizeMaxShare: 0.42,
  gapTextSize: 12,
  gapTextBarcode: 10,
  barcodeHeight: 66,
  /** Barcode gives up height (down to this) when a wrapped description needs the room. */
  barcodeMinHeight: 40,
  /** Barcode may use up to this share of the inner width. */
  barcodeMaxShare: 0.78,
  gapBarcodeUpc: 5,
  upcFont: 18,
}

export type LabelStation2LabelProduct = {
  upc: string
  external_id?: string
  description: string
  vendor_name: string
  size: string
  color: string
  mpn: string
  fnsku?: string
}

function normalizeDpi(dpi: number | undefined): LabelDpi {
  return (SUPPORTED_DPIS as readonly number[]).includes(dpi ?? NaN)
    ? (dpi as LabelDpi)
    : DEFAULT_LABEL_DPI
}

function setFont(ctx: CanvasRenderingContext2D, px: number, bold: boolean) {
  ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT_FAMILY}`
}

/** Shrink to fit `maxWidth` (down to `minFont`), then ellipsize if still too wide. */
function fitLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxFont: number,
  minFont: number,
  bold: boolean
): { text: string; font: number } {
  setFont(ctx, maxFont, bold)
  const width = ctx.measureText(text).width
  if (width <= maxWidth || width <= 0) return { text, font: maxFont }
  const font = Math.max(minFont, Math.floor((maxFont * maxWidth) / width))
  setFont(ctx, font, bold)
  if (ctx.measureText(text).width <= maxWidth) return { text, font }
  return { text: ellipsize(ctx, text, maxWidth), font }
}

/** Current ctx font must already be set. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/** Greedy word wrap at the current ctx font. */
function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

type LineSpec = { max: number; min: number; bold: boolean; maxLines: number; wrapBelow: number }

/**
 * One line, shrunk to fit. Specs with `maxLines > 1` wrap instead once a single
 * line would need a font smaller than `wrapBelow`; the last line is ellipsized.
 */
function fitBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  spec: LineSpec,
  d: (value: number) => number
): { lines: string[]; font: number } {
  const maxFont = d(spec.max)
  const minFont = d(spec.min)
  const wrapBelow = d(spec.wrapBelow)
  setFont(ctx, maxFont, spec.bold)
  const width = ctx.measureText(text).width
  const singleFont = width > 0 ? Math.floor((maxFont * maxWidth) / width) : maxFont
  if (spec.maxLines <= 1 || singleFont >= wrapBelow) {
    const single = fitLine(ctx, text, maxWidth, maxFont, minFont, spec.bold)
    return { lines: [single.text], font: single.font }
  }
  for (let font = wrapBelow; font >= minFont; font -= 1) {
    setFont(ctx, font, spec.bold)
    const lines = wrapWords(ctx, text, maxWidth)
    if (lines.length <= spec.maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { lines, font }
    }
  }
  setFont(ctx, minFont, spec.bold)
  const wrapped = wrapWords(ctx, text, maxWidth)
  const lines = wrapped.slice(0, spec.maxLines)
  const last = lines.length - 1
  lines[last] = ellipsize(ctx, wrapped.length > spec.maxLines ? `${lines[last]}…` : lines[last], maxWidth)
  for (let i = 0; i < last; i += 1) lines[i] = ellipsize(ctx, lines[i], maxWidth)
  return { lines, font: minFont }
}

/** Code 128 at the widest module (device dots) that still fits `maxWidth`. */
function renderBarcode(
  value: string,
  maxWidth: number,
  height: number,
  scale: number
): HTMLCanvasElement | null {
  if (!value || typeof document === 'undefined') return null
  const upper = Math.max(1, Math.round(3 * scale))
  for (let module = upper; module >= 1; module -= 1) {
    try {
      const canvas = document.createElement('canvas')
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: module,
        height: Math.max(1, height),
        displayValue: false,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      })
      if (canvas.width <= maxWidth || module === 1) return canvas
    } catch {
      return null
    }
  }
  return null
}

function barcodeValue(product: LabelStation2LabelProduct): string {
  return (product.upc || product.external_id || '').trim()
}

export function renderLabelStation2Canvas(
  product: LabelStation2LabelProduct,
  dpi: number = DEFAULT_LABEL_DPI
): HTMLCanvasElement {
  const scale = normalizeDpi(dpi) / BASE_DPI
  const d = (value: number) => Math.round(value * scale)
  const W = Math.round(BASE_W * scale)
  const H = Math.round(BASE_H * scale)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Thin label edge, same as Label Station's standard sizes.
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = Math.max(1, d(1))
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'alphabetic'

  const pad = d(LAYOUT.pad)
  const innerWidth = W - pad * 2

  // Size first: it decides how much width the left text column gets.
  const sizeText = (product.size || '').trim()
  let sizeFit: { text: string; font: number } | null = null
  let sizeWidth = 0
  if (sizeText) {
    sizeFit = fitLine(
      ctx,
      sizeText,
      Math.round(innerWidth * LAYOUT.sizeMaxShare),
      d(LAYOUT.sizeMaxFont),
      d(LAYOUT.sizeMinFont),
      true
    )
    setFont(ctx, sizeFit.font, true)
    sizeWidth = Math.ceil(ctx.measureText(sizeFit.text).width)
  }
  const textWidth = sizeFit ? innerWidth - sizeWidth - d(LAYOUT.gapTextSize) : innerWidth

  const specs: { value: string; spec: LineSpec }[] = [
    { value: product.vendor_name, spec: LAYOUT.vendor },
    { value: product.description, spec: LAYOUT.description },
    { value: product.color, spec: LAYOUT.color },
    { value: product.mpn, spec: LAYOUT.mpn },
  ]
  const wrapGap = d(LAYOUT.wrapLineGap)
  const blocks = specs
    .map(({ value, spec }) => ({ value: (value || '').trim(), spec }))
    .filter((block) => block.value)
    .map(({ value, spec }) => {
      const fit = fitBlock(ctx, value, textWidth, spec, d)
      return {
        ...fit,
        bold: spec.bold,
        height: fit.font * fit.lines.length + wrapGap * (fit.lines.length - 1),
      }
    })

  const textBlockH =
    blocks.reduce((sum, block) => sum + block.height, 0) +
    Math.max(0, blocks.length - 1) * d(LAYOUT.lineGap)

  const sizeBlockH = sizeFit ? sizeFit.font : 0
  const topBlockH = Math.max(textBlockH, sizeBlockH)

  const code = barcodeValue(product)
  const upcFont = d(LAYOUT.upcFont)
  const gapMiddle = topBlockH > 0 && code ? d(LAYOUT.gapTextBarcode) : 0
  const barcodeRoom = H - pad * 2 - topBlockH - gapMiddle - d(LAYOUT.gapBarcodeUpc) - upcFont
  const barcode = renderBarcode(
    code,
    Math.round(innerWidth * LAYOUT.barcodeMaxShare),
    Math.max(d(LAYOUT.barcodeMinHeight), Math.min(d(LAYOUT.barcodeHeight), barcodeRoom)),
    scale
  )
  const barcodeH = barcode ? barcode.height : 0
  const barcodeBlockH = code ? barcodeH + d(LAYOUT.gapBarcodeUpc) + upcFont : 0
  const contentH = topBlockH + gapMiddle + barcodeBlockH

  const top = Math.max(pad, Math.round((H - contentH) / 2))

  // Left column: vendor, description, color, MPN.
  ctx.textAlign = 'left'
  let y = top + Math.round((topBlockH - textBlockH) / 2)
  blocks.forEach((block, index) => {
    if (index > 0) y += d(LAYOUT.lineGap)
    setFont(ctx, block.font, block.bold)
    block.lines.forEach((text, lineIndex) => {
      if (lineIndex > 0) y += wrapGap
      y += block.font
      ctx.fillText(text, pad, y)
    })
  })

  // Size on the right, vertically centred on the text block (cap height ≈ 0.72em).
  if (sizeFit) {
    ctx.textAlign = 'right'
    setFont(ctx, sizeFit.font, true)
    const baseline = top + Math.round(topBlockH / 2 + sizeFit.font * 0.36)
    ctx.fillText(sizeFit.text, W - pad, baseline)
  }

  // Barcode (left-aligned with the text) and the UPC centred beneath it.
  if (code) {
    let by = top + topBlockH + gapMiddle
    const barcodeW = barcode ? barcode.width : Math.round(innerWidth * LAYOUT.barcodeMaxShare)
    if (barcode) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(barcode, pad, by)
    }
    by += barcodeH + d(LAYOUT.gapBarcodeUpc) + upcFont
    ctx.textAlign = 'center'
    const upcFit = fitLine(ctx, code, innerWidth, upcFont, d(11), false)
    setFont(ctx, upcFit.font, false)
    const centre = Math.min(
      Math.max(pad + barcodeW / 2, pad + ctx.measureText(upcFit.text).width / 2),
      W - pad - ctx.measureText(upcFit.text).width / 2
    )
    ctx.fillText(upcFit.text, centre, by)
  }

  const image = ctx.getImageData(0, 0, W, H)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const opaque = data[i + 3] > 10
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const value = opaque && luminance < MONO_THRESHOLD ? 0 : 255
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export type LabelStation2PrintItem = {
  product: LabelStation2LabelProduct
  copies: number
}

function clampCopies(copies: number): number {
  return Math.max(1, Math.min(Number.isFinite(copies) ? copies : 1, 99))
}

export function buildLabelStation2Zpl(
  product: LabelStation2LabelProduct,
  copies = 1,
  dpi: number = DEFAULT_LABEL_DPI
): string {
  const canvas = renderLabelStation2Canvas(product, dpi)
  const { hex, totalBytes, bytesPerRow } = canvasToZplGraphic(canvas)
  return `^XA
^LH0,0
^PW${canvas.width}
^LL${canvas.height}
^FO0,0^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex}^FS
^PQ${clampCopies(copies)},0,0,N
^XZ`
}

export function buildLabelStation2BatchZpl(
  items: LabelStation2PrintItem[],
  dpi: number = DEFAULT_LABEL_DPI
): string {
  return items
    .filter((item) => item.copies > 0)
    .map((item) => buildLabelStation2Zpl(item.product, item.copies, dpi))
    .join('\n')
}

export function buildLabelStation2BatchPdfBlob(
  items: LabelStation2PrintItem[],
  dpi: number = DEFAULT_LABEL_DPI
): Blob {
  const doc = new jsPDF({
    unit: 'pt',
    format: [PAGE_W_PT, PAGE_H_PT],
    orientation: 'landscape',
    compress: true,
  })
  let pageIndex = 0
  for (const item of items) {
    const dataUrl = renderLabelStation2Canvas(item.product, dpi).toDataURL('image/png')
    for (let i = 0; i < clampCopies(item.copies); i += 1) {
      if (pageIndex > 0) doc.addPage([PAGE_W_PT, PAGE_H_PT], 'landscape')
      doc.addImage(dataUrl, 'PNG', 0, 0, PAGE_W_PT, PAGE_H_PT)
      pageIndex += 1
    }
  }
  return doc.output('blob')
}

export function buildLabelStation2PdfBlob(
  product: LabelStation2LabelProduct,
  copies = 1,
  dpi: number = DEFAULT_LABEL_DPI
): Blob {
  return buildLabelStation2BatchPdfBlob([{ product, copies }], dpi)
}

export function suggestedLabelStation2PdfFilename(product: LabelStation2LabelProduct): string {
  const safe = (product.upc || 'label').replace(/[^A-Z0-9_-]+/gi, '')
  return `label-station-ii-${safe}.pdf`
}

export const LABEL_STATION2_BATCH_PDF_FILENAME = 'label-station-ii-batch.pdf'

// --- Catalog template ------------------------------------------------------

export const LABEL_STATION2_TEMPLATE_HEADERS = [
  'UPC',
  'External ID',
  'Description',
  'Vendor Name',
  'Size',
  'Color',
  'MPN',
] as const

export const LABEL_STATION2_TEMPLATE_FILENAME = 'label-station-ii-template.xlsx'

const TEMPLATE_EXAMPLE_ROW = [
  '194715379404',
  '194715379404',
  'M-ASCOT',
  'UGG',
  '10 M',
  'GREY SUEDE',
  '1101110',
]

/** Empty Label Station II catalog sheet. FNSKU is omitted: it comes from Label Station. */
export function buildLabelStation2TemplateBlob(): Blob {
  const ws = XLSX.utils.aoa_to_sheet([[...LABEL_STATION2_TEMPLATE_HEADERS], TEMPLATE_EXAMPLE_ROW])
  LABEL_STATION2_TEMPLATE_HEADERS.forEach((_, col) => {
    const header = ws[XLSX.utils.encode_cell({ r: 0, c: col })]
    if (header) {
      header.s = {
        font: { bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'D9D9D9' } },
        border: { bottom: { style: 'thin', color: { rgb: '808080' } } },
      }
    }
    // Keep codes as text so Excel does not drop leading zeros or use scientific notation.
    const example = ws[XLSX.utils.encode_cell({ r: 1, c: col })]
    if (example) {
      example.t = 's'
      example.z = '@'
    }
  })
  ws['!cols'] = [
    { wch: 16 },
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
    { wch: 10 },
    { wch: 18 },
    { wch: 14 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'PRODUCTS')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// --- Saved station settings ------------------------------------------------
// Kept apart from Label Station's keys so changing one page never changes the other.
// Printer and dpi fall back to Label Station's saved choice the first time.

const LS2_PRINTER_NAME_KEY = 'label_station2_printer_name'
const LS2_PRINTER_DPI_KEY = 'label_station2_printer_dpi'
const LS2_PRINT_MODE_KEY = 'label_station2_print_mode'

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export function getLabelStation2Printer(): string {
  return (readKey(LS2_PRINTER_NAME_KEY) ?? readKey(PRINTER_NAME_KEY) ?? '').trim()
}

export function saveLabelStation2Printer(name: string): void {
  writeKey(LS2_PRINTER_NAME_KEY, name.trim())
}

export function getLabelStation2Dpi(): LabelDpi {
  return normalizeDpi(Number(readKey(LS2_PRINTER_DPI_KEY) ?? readKey(PRINTER_DPI_KEY)))
}

export function saveLabelStation2Dpi(dpi: number): void {
  writeKey(LS2_PRINTER_DPI_KEY, String(normalizeDpi(dpi)))
}

export function getLabelStation2PrintMode(): LabelPrintMode {
  const stored = readKey(LS2_PRINT_MODE_KEY) || ''
  return (LABEL_PRINT_MODES as readonly string[]).includes(stored)
    ? (stored as LabelPrintMode)
    : DEFAULT_LABEL_PRINT_MODE
}

export function saveLabelStation2PrintMode(mode: LabelPrintMode): void {
  writeKey(LS2_PRINT_MODE_KEY, mode)
}

// --- Scan matching -----------------------------------------------------------

export type LabelStation2ScanStatus = 'awaiting' | 'looking_up' | 'not_found' | 'ready'

/** True when the scanned value is the FNSKU, UPC, or External ID of `product`. */
export function scanMatchesLabelStation2Product(
  scanInput: string,
  product: LabelStation2LabelProduct
): boolean {
  const scan = scanInput.trim().toUpperCase()
  if (!scan) return false
  const candidates = [product.fnsku, product.upc, product.external_id]
    .map((value) => (value || '').trim().toUpperCase())
    .filter(Boolean)
  if (candidates.includes(scan)) return true
  // Scanned UPC may differ from the stored one only by leading zeros.
  if (/^\d+$/.test(scan)) {
    const bare = scan.replace(/^0+/, '')
    return candidates.some((value) => /^\d+$/.test(value) && value.replace(/^0+/, '') === bare)
  }
  return false
}

export function computeLabelStation2ScanStatus(
  scanInput: string,
  product: LabelStation2LabelProduct | null,
  lookupError: boolean,
  isLookingUp: boolean
): LabelStation2ScanStatus {
  const trimmed = scanInput.trim()
  if (!trimmed) return 'awaiting'
  if (isLookingUp) return 'looking_up'
  if (lookupError || !product || !scanMatchesLabelStation2Product(trimmed, product)) {
    return 'not_found'
  }
  return 'ready'
}

export function labelStation2ScanStatusLabel(status: LabelStation2ScanStatus): string {
  switch (status) {
    case 'awaiting':
      return 'Awaiting scan'
    case 'looking_up':
      return 'Looking up…'
    case 'not_found':
      return 'Not in catalog'
    case 'ready':
      return 'Ready to print'
  }
}
