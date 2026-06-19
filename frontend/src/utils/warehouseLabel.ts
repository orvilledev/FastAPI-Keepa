import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'

/**
 * The label is designed once on a base 203-dpi grid (3" × 1.5") and then
 * rendered at the printer's NATIVE resolution. Everything is drawn into a
 * monochrome canvas at the target dpi, then shipped to BOTH outputs:
 *   - the PDF preview (the canvas is embedded, page stays a physical 3" × 1.5"), and
 *   - the printer (the same canvas is sent as a ZPL ^GFA raster graphic).
 *
 * Because the bitmap is generated at the printer's own dpi, a 3" × 1.5" label
 * comes out 3" × 1.5" on a 203, 300, or 600 dpi Zebra — no shrinking, no
 * clipping — and the preview is a pixel-for-pixel match of the print.
 */

/** Base design grid: 3" × 1.5" at 203 dpi. All layout numbers below are in these units. */
const BASE_DPI = 203
const BASE_W = 609 // 3.0" × 203 dpi
const BASE_H = 305 // 1.5" × 203 dpi (rounded)

const PAD = 12
/** Pixels darker than this become solid black; lighter become white. */
const MONO_THRESHOLD = 150
const MAX_TITLE_LINES = 3
const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

/** PDF page size in points (72 pt/in): 3" × 1.5". Physical size is dpi-independent. */
export const LABEL_WIDTH_PT = 216
export const LABEL_HEIGHT_PT = 108

/** Supported Zebra print-head resolutions. */
export const SUPPORTED_DPIS = [203, 300, 600] as const
export type LabelDpi = (typeof SUPPORTED_DPIS)[number]
export const DEFAULT_LABEL_DPI: LabelDpi = 203

function normalizeDpi(dpi: number | undefined): LabelDpi {
  return (SUPPORTED_DPIS as readonly number[]).includes(dpi ?? NaN)
    ? (dpi as LabelDpi)
    : DEFAULT_LABEL_DPI
}

export type WarehouseLabelProduct = {
  upc: string
  fnsku: string
  style_name: string
  condition: string
}

export type ScanPrintStatus = 'awaiting' | 'looking_up' | 'not_found' | 'ready'

export function computeScanStatus(
  upc: string,
  product: WarehouseLabelProduct | null,
  lookupError: boolean,
  isLookingUp = false
): ScanPrintStatus {
  const trimmed = upc.trim()
  if (!trimmed) return 'awaiting'
  if (isLookingUp) return 'looking_up'
  if (lookupError || !product || product.upc !== trimmed) return 'not_found'
  return 'ready'
}

export function scanStatusLabel(status: ScanPrintStatus): string {
  switch (status) {
    case 'awaiting':
      return 'Awaiting scan'
    case 'looking_up':
      return 'Looking up…'
    case 'not_found':
      return 'UPC not found'
    case 'ready':
      return 'Ready to print'
  }
}

/** Human-readable line under the barcode: UPC/SKU exactly as stored (no forced suffix). */
function formatUpcFnskuLine(upc: string): string {
  return (upc || '').trim()
}

/**
 * Best-effort detection of a Windows/ZDesigner printer's dpi from its name,
 * e.g. "ZDesigner ZD420-300dpi ZPL" or "ZDesigner GX430t". Returns null when
 * the name gives no hint so the caller can fall back to a default/manual value.
 */
export function detectPrinterDpi(name: string | undefined | null): LabelDpi | null {
  const n = (name || '').toLowerCase()
  if (!n) return null
  if (/600\s*dpi|24\s*dpmm/.test(n)) return 600
  if (/300\s*dpi|12\s*dpmm|-?300\b|gx430|gk430|gt800-300|zt230-300|zd420-300|zd620-300/.test(n)) {
    return 300
  }
  if (/203\s*dpi|8\s*dpmm|-?203\b/.test(n)) return 203
  return null
}

/** Code 128 module width (device dots) chosen so the barcode fits the label margins. */
function barcodeModuleWidth(value: string, deviceWidth: number, scale: number): number {
  const len = Math.max(1, value.trim().length)
  // Code 128 ≈ 11 modules/char + ~35 modules of start/checksum/stop/quiet zones.
  const estimatedModules = 11 * len + 35
  const maxWidth = deviceWidth - Math.round(PAD * scale) * 2
  const upper = Math.max(2, Math.round(4 * scale))
  return Math.max(2, Math.min(upper, Math.floor(maxWidth / estimatedModules)))
}

function renderBarcodeCanvas(
  value: string,
  deviceWidth: number,
  scale: number
): HTMLCanvasElement | null {
  if (!value || typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: barcodeModuleWidth(value, deviceWidth, scale),
      height: Math.round(84 * scale),
      displayValue: false,
      margin: 0,
      background: '#ffffff',
      lineColor: '#000000',
    })
    return canvas
  } catch {
    return null
  }
}

/** Greedy word-wrap against measured text width, capped at maxLines (last line ellipsized). */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
      if (lines.length === maxLines) break
    }
  }
  if (lines.length < maxLines && current) lines.push(current)

  // If text overflowed the allotted lines, ellipsize the final line.
  if (lines.length === maxLines) {
    const used = lines.join(' ').split(/\s+/).length
    if (used < words.length) {
      let last = lines[maxLines - 1]
      while (last && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.replace(/\s*\S+$|.$/, '').trim()
      }
      lines[maxLines - 1] = `${last}…`
    }
  }
  return lines
}

/**
 * Draw the label into a monochrome canvas sized for the target dpi, then
 * threshold to pure black/white so the preview and the thermal print match.
 * This is the single source of truth for the label layout.
 */
export function renderWarehouseLabelCanvas(
  product: WarehouseLabelProduct,
  dpi: number = DEFAULT_LABEL_DPI
): HTMLCanvasElement {
  const targetDpi = normalizeDpi(dpi)
  const scale = targetDpi / BASE_DPI
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

  // Thin label border (matches the preview's framed look).
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = Math.max(1, d(1))
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'alphabetic'

  // FNSKU (bold, centered, top).
  ctx.textAlign = 'center'
  ctx.font = `bold ${d(24)}px ${FONT_FAMILY}`
  ctx.fillText(product.fnsku || '', W / 2, d(26))

  // Barcode (centered).
  const barcodeTop = d(34)
  let barcodeBottom = barcodeTop + d(84)
  const barcode = renderBarcodeCanvas(product.fnsku, W, scale)
  if (barcode) {
    ctx.imageSmoothingEnabled = false
    const bx = Math.round((W - barcode.width) / 2)
    ctx.drawImage(barcode, bx, barcodeTop)
    barcodeBottom = barcodeTop + barcode.height
  }

  // UPC (centered) + condition (right) on a shared baseline.
  const metaY = barcodeBottom + d(36)
  ctx.font = `${d(30)}px ${FONT_FAMILY}`
  const upcLine = formatUpcFnskuLine(product.upc)
  if (upcLine) {
    ctx.textAlign = 'center'
    ctx.fillText(upcLine, W / 2, metaY)
  }
  if (product.condition) {
    ctx.textAlign = 'right'
    ctx.fillText(product.condition, W - d(PAD) - d(2), metaY)
  }

  // Title (centered, wrapped, bottom).
  ctx.textAlign = 'center'
  ctx.font = `${d(26)}px ${FONT_FAMILY}`
  const titleLines = wrapLines(ctx, product.style_name || '', W - d(PAD) * 2, MAX_TITLE_LINES)
  const lineHeight = d(30)
  let ty = metaY + d(38)
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, ty)
    ty += lineHeight
  }

  // Threshold to pure black/white so preview === thermal print.
  const image = ctx.getImageData(0, 0, W, H)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const opaque = data[i + 3] > 10
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const black = opaque && luminance < MONO_THRESHOLD
    const value = black ? 0 : 255
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)

  return canvas
}

export function buildWarehouseLabelPdfBlob(
  product: WarehouseLabelProduct,
  copies = 1,
  dpi: number = DEFAULT_LABEL_DPI
): Blob {
  const count = Math.max(1, Math.min(copies, 99))
  const doc = new jsPDF({
    unit: 'pt',
    format: [LABEL_WIDTH_PT, LABEL_HEIGHT_PT],
    orientation: 'landscape',
    compress: true,
  })

  const dataUrl = renderWarehouseLabelCanvas(product, dpi).toDataURL('image/png')
  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      doc.addPage([LABEL_WIDTH_PT, LABEL_HEIGHT_PT], 'landscape')
    }
    doc.addImage(dataUrl, 'PNG', 0, 0, LABEL_WIDTH_PT, LABEL_HEIGHT_PT)
  }

  return doc.output('blob')
}

/** Convert the thresholded label canvas into a ZPL ^GFA raster payload. */
function canvasToZplGraphic(canvas: HTMLCanvasElement): {
  hex: string
  totalBytes: number
  bytesPerRow: number
} {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const bytesPerRow = Math.ceil(width / 8)
  const totalBytes = bytesPerRow * height
  if (!ctx) return { hex: '', totalBytes, bytesPerRow }

  const data = ctx.getImageData(0, 0, width, height).data
  const rows: string[] = []
  for (let y = 0; y < height; y += 1) {
    let rowHex = ''
    for (let b = 0; b < bytesPerRow; b += 1) {
      let byte = 0
      for (let bit = 0; bit < 8; bit += 1) {
        const x = b * 8 + bit
        if (x < width) {
          const idx = (y * width + x) * 4
          // Canvas is already pure B/W: value 0 = black (print), 255 = white.
          if (data[idx + 3] > 10 && data[idx] < 128) {
            byte |= 1 << (7 - bit)
          }
        }
      }
      rowHex += byte.toString(16).padStart(2, '0')
    }
    rows.push(rowHex)
  }

  return { hex: rows.join('').toUpperCase(), totalBytes, bytesPerRow }
}

/**
 * ZPL for a Zebra printer at the given dpi. The label is rendered at the
 * printer's native resolution and sent as a single raster graphic (^GFA) so it
 * prints at the correct physical size and exactly matches the preview,
 * regardless of printer model/firmware. ^PQ requests `copies` prints.
 */
export function buildWarehouseLabelZpl(
  product: WarehouseLabelProduct,
  copies = 1,
  dpi: number = DEFAULT_LABEL_DPI
): string {
  const count = Math.max(1, Math.min(copies, 99))
  const canvas = renderWarehouseLabelCanvas(product, dpi)
  const { hex, totalBytes, bytesPerRow } = canvasToZplGraphic(canvas)

  return `^XA
^LH0,0
^PW${canvas.width}
^LL${canvas.height}
^FO0,0^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex}^FS
^PQ${count},0,0,N
^XZ`
}

export function suggestedWarehouseLabelPdfFilename(product: WarehouseLabelProduct): string {
  const safe = (product.fnsku || product.upc || 'label').replace(/[^A-Z0-9_-]+/gi, '')
  return `warehouse-label-${safe}.pdf`
}

export const PRINTER_NAME_KEY = 'warehouse_printer_name'
export const PRINTER_DPI_KEY = 'warehouse_printer_dpi'

/** Name of the OS printer the user last selected for direct ZPL printing. */
export function getSelectedPrinter(): string {
  try {
    return (localStorage.getItem(PRINTER_NAME_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function saveSelectedPrinter(name: string): void {
  try {
    localStorage.setItem(PRINTER_NAME_KEY, name.trim())
  } catch {
    // ignore
  }
}

/** Last dpi the user selected (or auto-detected) for the active printer. */
export function getSelectedDpi(): LabelDpi {
  try {
    return normalizeDpi(Number(localStorage.getItem(PRINTER_DPI_KEY)))
  } catch {
    return DEFAULT_LABEL_DPI
  }
}

export function saveSelectedDpi(dpi: number): void {
  try {
    localStorage.setItem(PRINTER_DPI_KEY, String(normalizeDpi(dpi)))
  } catch {
    // ignore
  }
}
