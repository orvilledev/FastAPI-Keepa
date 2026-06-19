import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'

/**
 * Canonical label geometry: 3" × 1.5" at Zebra 203 dpi (the industry-standard
 * resolution for FNSKU / shipping label printers such as the Zebra GK420d,
 * GX430, ZD420, etc.). Everything below is drawn ONCE into a monochrome canvas
 * at this exact pixel grid, then shipped to BOTH outputs:
 *   - the PDF preview (the canvas is embedded as an image), and
 *   - the printer (the same canvas is sent as a ZPL ^GFA raster graphic).
 *
 * Because both paths consume the identical thresholded bitmap, the preview is a
 * pixel-for-pixel match of what prints, on every Zebra model — there are no
 * device fonts to substitute and no ^FB word-wrap that varies by firmware.
 */
const LABEL_W_DOTS = 609 // 3.0" × 203 dpi
const LABEL_H_DOTS = 305 // 1.5" × 203 dpi (rounded)

/** PDF page size in points (72 pt/in): 3" × 1.5". */
export const LABEL_WIDTH_PT = 216
export const LABEL_HEIGHT_PT = 108

const PAD = 12
/** Pixels darker than this become solid black; lighter become white. */
const MONO_THRESHOLD = 150
const MAX_TITLE_LINES = 3
const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

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

/** Code 128 module width (dots) chosen so the barcode fits within the label margins. */
function barcodeModuleWidth(value: string): number {
  const len = Math.max(1, value.trim().length)
  // Code 128 ≈ 11 modules/char + ~35 modules of start/checksum/stop/quiet zones.
  const estimatedModules = 11 * len + 35
  const maxWidth = LABEL_W_DOTS - PAD * 2
  return Math.max(2, Math.min(4, Math.floor(maxWidth / estimatedModules)))
}

function renderBarcodeCanvas(value: string): HTMLCanvasElement | null {
  if (!value || typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: barcodeModuleWidth(value),
      height: 84,
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
 * Draw the label into a 609×305 monochrome canvas, then threshold to pure
 * black/white so the preview and the thermal print are identical. This is the
 * single source of truth for the label layout.
 */
export function renderWarehouseLabelCanvas(product: WarehouseLabelProduct): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = LABEL_W_DOTS
  canvas.height = LABEL_H_DOTS
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const W = LABEL_W_DOTS
  const H = LABEL_H_DOTS

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Thin label border (matches the preview's framed look).
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'alphabetic'

  // FNSKU (bold, centered, top).
  ctx.textAlign = 'center'
  ctx.font = `bold 24px ${FONT_FAMILY}`
  ctx.fillText(product.fnsku || '', W / 2, 26)

  // Barcode (centered).
  const barcodeTop = 34
  let barcodeBottom = barcodeTop + 84
  const barcode = renderBarcodeCanvas(product.fnsku)
  if (barcode) {
    ctx.imageSmoothingEnabled = false
    const bx = Math.round((W - barcode.width) / 2)
    ctx.drawImage(barcode, bx, barcodeTop)
    barcodeBottom = barcodeTop + barcode.height
  }

  // UPC (centered) + condition (right) on a shared baseline.
  const metaY = barcodeBottom + 36
  ctx.font = `30px ${FONT_FAMILY}`
  const upcLine = formatUpcFnskuLine(product.upc)
  if (upcLine) {
    ctx.textAlign = 'center'
    ctx.fillText(upcLine, W / 2, metaY)
  }
  if (product.condition) {
    ctx.textAlign = 'right'
    ctx.fillText(product.condition, W - PAD - 2, metaY)
  }

  // Title (centered, wrapped, bottom).
  ctx.textAlign = 'center'
  ctx.font = `26px ${FONT_FAMILY}`
  const titleLines = wrapLines(ctx, product.style_name || '', W - PAD * 2, MAX_TITLE_LINES)
  const lineHeight = 30
  let ty = metaY + 38
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
  copies = 1
): Blob {
  const count = Math.max(1, Math.min(copies, 99))
  const doc = new jsPDF({
    unit: 'pt',
    format: [LABEL_WIDTH_PT, LABEL_HEIGHT_PT],
    orientation: 'landscape',
    compress: true,
  })

  const dataUrl = renderWarehouseLabelCanvas(product).toDataURL('image/png')
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
 * ZPL for any Zebra 203 dpi printer. The label is sent as a single raster
 * graphic (^GFA) so it prints exactly like the preview regardless of printer
 * model/firmware. ^PQ asks the printer for `copies` prints of the one graphic.
 */
export function buildWarehouseLabelZpl(product: WarehouseLabelProduct, copies = 1): string {
  const count = Math.max(1, Math.min(copies, 99))
  const canvas = renderWarehouseLabelCanvas(product)
  const { hex, totalBytes, bytesPerRow } = canvasToZplGraphic(canvas)

  return `^XA
^LH0,0
^PW${LABEL_W_DOTS}
^LL${LABEL_H_DOTS}
^FO0,0^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex}^FS
^PQ${count},0,0,N
^XZ`
}

export function suggestedWarehouseLabelPdfFilename(product: WarehouseLabelProduct): string {
  const safe = (product.fnsku || product.upc || 'label').replace(/[^A-Z0-9_-]+/gi, '')
  return `warehouse-label-${safe}.pdf`
}

export const PRINTER_NAME_KEY = 'warehouse_printer_name'

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
