import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'

/** One printed label page. 6 in × 4 in, matching a wide carton label. */
const PAGE_WIDTH_PT = 432
const PAGE_HEIGHT_PT = 288

export const MAX_TO_BOX_LABELS = 200

export function normalizeToNumber(raw: string): string {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!value) {
    throw new Error('Enter a TO number.')
  }
  if (!/^[A-Z0-9-]+$/.test(value)) {
    throw new Error('TO number can only use letters, numbers, and hyphens.')
  }
  if (value.length > 32) {
    throw new Error('TO number is too long.')
  }
  return value
}

/**
 * One box (`1`) or an inclusive range (`1-10`).
 * Returns box numbers in print order.
 */
export function parseBoxNumbers(raw: string): number[] {
  const text = raw.trim().replace(/[–—]/g, '-').replace(/\s+/g, '')
  if (!text) {
    throw new Error('Enter a box number, or a range such as 1-10.')
  }

  const range = /^(\d+)-(\d+)$/.exec(text)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
      throw new Error('Box numbers must be 1 or greater.')
    }
    if (end < start) {
      throw new Error('A range must start with the lower box number, such as 1-10.')
    }
    const count = end - start + 1
    if (count > MAX_TO_BOX_LABELS) {
      throw new Error(`A single run can print at most ${MAX_TO_BOX_LABELS} labels.`)
    }
    return Array.from({ length: count }, (_, index) => start + index)
  }

  if (!/^\d+$/.test(text)) {
    throw new Error('Use a box number like 1, or a range like 1-10.')
  }
  const box = Number(text)
  if (!Number.isSafeInteger(box) || box < 1) {
    throw new Error('Box numbers must be 1 or greater.')
  }
  return [box]
}

export function suggestedToBoxLabelFilename(toNumber: string, boxes: number[]): string {
  if (boxes.length === 1) return `${toNumber}-box-${boxes[0]}.pdf`
  return `${toNumber}-boxes-${boxes[0]}-${boxes[boxes.length - 1]}.pdf`
}

function renderBarcodeDataUrl(value: string): string {
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, value, {
    format: 'CODE128',
    width: 3,
    height: 220,
    displayValue: false,
    margin: 0,
    background: '#ffffff',
    lineColor: '#000000',
  })
  return canvas.toDataURL('image/png')
}

/** Helvetica cap height, so the gaps are measured from the ink, not the baseline. */
const CAP_HEIGHT = 0.718

function drawToBoxLabel(doc: jsPDF, toNumber: string, boxNumber: number, barcode: string) {
  const inset = 10
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(2.4)
  doc.roundedRect(inset, inset, PAGE_WIDTH_PT - inset * 2, PAGE_HEIGHT_PT - inset * 2, 16, 16)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  let toFontSize = 58
  doc.setFontSize(toFontSize)
  while (toFontSize > 22 && doc.getTextWidth(toNumber) > PAGE_WIDTH_PT - 56) {
    toFontSize -= 2
    doc.setFontSize(toFontSize)
  }
  const toBaseline = 72
  doc.text(toNumber, PAGE_WIDTH_PT / 2, toBaseline, { align: 'center' })

  const boxFontSize = 46
  const boxBaseline = 246
  const barcodeHeight = 104
  const boxInkTop = boxBaseline - CAP_HEIGHT * boxFontSize
  const gap = (boxInkTop - toBaseline - barcodeHeight) / 2
  const barcodeY = toBaseline + gap
  const barcodeX = 20
  const barcodeWidth = PAGE_WIDTH_PT - 40
  doc.addImage(barcode, 'PNG', barcodeX, barcodeY, barcodeWidth, barcodeHeight)

  const boxLabel = 'Box'
  doc.setFontSize(boxFontSize)
  const numberText = String(boxNumber)
  const numberWidth = doc.getTextWidth(numberText)
  const underlineWidth = Math.max(92, numberWidth + 20)
  const right = PAGE_WIDTH_PT - 30
  const numberX = right - underlineWidth
  doc.text(boxLabel, numberX - 14, boxBaseline, { align: 'right' })
  doc.text(numberText, numberX + underlineWidth / 2, boxBaseline, { align: 'center' })
  doc.setLineWidth(2.6)
  doc.line(numberX, boxBaseline + 7, numberX + underlineWidth, boxBaseline + 7)
}

/** One PDF page per box. The barcode encodes the TO number on every page. */
export function buildToBoxLabelsPdf(toNumber: string, boxes: number[]): Uint8Array {
  if (boxes.length === 0) {
    throw new Error('Enter a box number, or a range such as 1-10.')
  }
  const barcode = renderBarcodeDataUrl(toNumber)
  const doc = new jsPDF({
    unit: 'pt',
    format: [PAGE_WIDTH_PT, PAGE_HEIGHT_PT],
    orientation: 'landscape',
    compress: true,
  })
  boxes.forEach((boxNumber, index) => {
    if (index > 0) {
      doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT], 'landscape')
    }
    drawToBoxLabel(doc, toNumber, boxNumber, barcode)
  })
  return new Uint8Array(doc.output('arraybuffer'))
}
