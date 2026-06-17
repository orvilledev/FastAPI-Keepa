import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'

/** Label dimensions — matches FNSKU PDF labels (~3" × 1.5"). */
export const LABEL_WIDTH_PT = 216
export const LABEL_HEIGHT_PT = 108
const MARGIN_PT = 6
const BARCODE_WIDTH_PT = 196
const BARCODE_HEIGHT_PT = 30
const BARCODE_CANVAS_SCALE = 4

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

function escapeZplText(value: string): string {
  return (value || '').replace(/\\/g, '\\\\').replace(/\^/g, '').replace(/~/g, '').slice(0, 200)
}

/** Human-readable line under the barcode: UPC/SKU exactly as stored (no forced suffix). */
export function formatUpcFnskuLine(upc: string): string {
  return (upc || '').trim()
}

/** ZPL for Zebra 203 dpi, ~3×1.5 inch label. Repeat ^XA…^XZ per copy. */
export function buildWarehouseLabelZpl(product: WarehouseLabelProduct, copies = 1): string {
  const count = Math.max(1, Math.min(copies, 99))
  const fnsku = escapeZplText(product.fnsku)
  const upcLine = escapeZplText(formatUpcFnskuLine(product.upc))
  const style = escapeZplText(product.style_name)
  const condition = escapeZplText(product.condition || 'New')

  const single = `^XA
^CI28
^FO30,15^A0N,26,26^FD${fnsku}^FS
^FO30,48^BY2^BCN,65,N,N,N^FD${fnsku}^FS
^FO30,128^A0N,24,24^FB550,1,0,C^FD${upcLine}^FS
^FO320,128^A0N,20,20^FB280,1,0,R^FD${condition}^FS
^FO30,154^A0N,20,20^FB550,3,0,C^FD${style}^FS
^XZ`

  return Array.from({ length: count }, () => single).join('\n')
}

function renderBarcodeDataUrl(value: string): string | null {
  if (!value || typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: BARCODE_CANVAS_SCALE,
      height: BARCODE_HEIGHT_PT * BARCODE_CANVAS_SCALE,
      displayValue: false,
      margin: 0,
      background: '#ffffff',
      lineColor: '#000000',
    })
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function drawLabelPage(doc: jsPDF, product: WarehouseLabelProduct) {
  const contentWidth = LABEL_WIDTH_PT - MARGIN_PT * 2 - 4
  const centerX = LABEL_WIDTH_PT / 2

  doc.setDrawColor(210, 210, 210)
  doc.setLineWidth(0.5)
  doc.rect(0.5, 0.5, LABEL_WIDTH_PT - 1, LABEL_HEIGHT_PT - 1)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text(product.fnsku, centerX, 9, { align: 'center' })

  const barcodeY = 13
  const barcode = renderBarcodeDataUrl(product.fnsku)
  if (barcode) {
    const barcodeX = centerX - BARCODE_WIDTH_PT / 2
    doc.addImage(barcode, 'PNG', barcodeX, barcodeY, BARCODE_WIDTH_PT, BARCODE_HEIGHT_PT)
  }

  const metaY = barcodeY + BARCODE_HEIGHT_PT + 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11.5)
  const upcLine = formatUpcFnskuLine(product.upc)
  if (upcLine) {
    doc.text(upcLine, centerX, metaY, { align: 'center' })
  }
  if (product.condition) {
    doc.text(product.condition, LABEL_WIDTH_PT - MARGIN_PT - 1, metaY, { align: 'right' })
  }

  doc.setFontSize(9)
  const titleLines = doc.splitTextToSize(product.style_name || '', contentWidth) as string[]
  let y = metaY + 11
  for (const line of titleLines.slice(0, 4)) {
    doc.text(line, centerX, y, { align: 'center' })
    y += 9.5
  }
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

  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      doc.addPage([LABEL_WIDTH_PT, LABEL_HEIGHT_PT], 'landscape')
    }
    drawLabelPage(doc, product)
  }

  return doc.output('blob')
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
