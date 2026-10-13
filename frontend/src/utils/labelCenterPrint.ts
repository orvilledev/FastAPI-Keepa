import { getDocument } from 'pdfjs-dist'
import type { LabelPageSize } from './toBoxLabel'
import { DEFAULT_LABEL_DPI, SUPPORTED_DPIS, type LabelDpi } from './warehouseLabel'

/**
 * Label Center stock sizes. Every size keeps the 3:2 shape the TO/box and text
 * layouts were drawn for, so the artwork scales without reflowing.
 */
export const LABEL_CENTER_STOCKS = ['2.25x1.5', '3x2', '6x4'] as const
export type LabelCenterStock = (typeof LABEL_CENTER_STOCKS)[number]
export const DEFAULT_LABEL_CENTER_STOCK: LabelCenterStock = '2.25x1.5'

export const LABEL_CENTER_STOCK_INFO: Record<
  LabelCenterStock,
  { name: string; widthIn: number; heightIn: number; note: string }
> = {
  '2.25x1.5': { name: 'Small', widthIn: 2.25, heightIn: 1.5, note: 'Standard Label Center stock' },
  '3x2': { name: 'Medium', widthIn: 3, heightIn: 2, note: 'Same stock as the Apparel label' },
  '6x4': { name: 'Large', widthIn: 6, heightIn: 4, note: 'Prints sideways on 4×6 shipping stock' },
}

/** Zebra desktop print heads top out near 4.1 in, so wider artwork is turned 90° for the printer. */
const MAX_PRINT_WIDTH_IN = 4.1
const MONO_THRESHOLD = 150
/** Keep each spooler job well under the desktop bridge's 15 s print timeout. */
const MAX_ZPL_CHARS_PER_JOB = 3_000_000

export function labelCenterStockDimensions(stock: LabelCenterStock): string {
  const { widthIn, heightIn } = LABEL_CENTER_STOCK_INFO[stock]
  return `${widthIn}" × ${heightIn}"`
}

export function labelCenterPageSize(stock: LabelCenterStock): LabelPageSize {
  const { widthIn, heightIn } = LABEL_CENTER_STOCK_INFO[stock]
  return { width: widthIn * 72, height: heightIn * 72 }
}

function normalizeStock(value: string | null | undefined): LabelCenterStock {
  return LABEL_CENTER_STOCKS.includes(value as LabelCenterStock)
    ? (value as LabelCenterStock)
    : DEFAULT_LABEL_CENTER_STOCK
}

function normalizeDpi(value: number): LabelDpi {
  return SUPPORTED_DPIS.includes(value as LabelDpi) ? (value as LabelDpi) : DEFAULT_LABEL_DPI
}

/* Kept apart from Label Station's keys so each page remembers its own printer and stock. */
const PRINTER_KEY = 'label_center_printer_name'
const DPI_KEY = 'label_center_printer_dpi'
const STOCK_KEY = 'label_center_label_stock'

function readStorage(key: string): string {
  try {
    return (localStorage.getItem(key) || '').trim()
  } catch {
    return ''
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export const getLabelCenterPrinter = (): string => readStorage(PRINTER_KEY)
export const saveLabelCenterPrinter = (name: string): void => writeStorage(PRINTER_KEY, name.trim())
export const getLabelCenterDpi = (): LabelDpi => normalizeDpi(Number(readStorage(DPI_KEY)))
export const saveLabelCenterDpi = (dpi: number): void => writeStorage(DPI_KEY, String(normalizeDpi(dpi)))
export const getLabelCenterStock = (): LabelCenterStock => normalizeStock(readStorage(STOCK_KEY))
export const saveLabelCenterStock = (stock: LabelCenterStock): void => writeStorage(STOCK_KEY, stock)

function rotateQuarterTurn(source: HTMLCanvasElement): HTMLCanvasElement {
  const rotated = document.createElement('canvas')
  rotated.width = source.height
  rotated.height = source.width
  const ctx = rotated.getContext('2d')
  if (!ctx) throw new Error('Could not prepare the label for printing.')
  ctx.translate(rotated.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(source, 0, 0)
  return rotated
}

function canvasToZpl(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare the label for printing.')
  const { width, height } = canvas
  const bytesPerRow = Math.ceil(width / 8)
  const totalBytes = bytesPerRow * height
  const data = ctx.getImageData(0, 0, width, height).data
  const rows: string[] = []
  for (let y = 0; y < height; y += 1) {
    let rowHex = ''
    for (let b = 0; b < bytesPerRow; b += 1) {
      let byte = 0
      for (let bit = 0; bit < 8; bit += 1) {
        const x = b * 8 + bit
        if (x >= width) continue
        const idx = (y * width + x) * 4
        const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
        if (data[idx + 3] > 10 && luminance < MONO_THRESHOLD) byte |= 1 << (7 - bit)
      }
      rowHex += byte.toString(16).padStart(2, '0')
    }
    rows.push(rowHex)
  }
  const hex = rows.join('').toUpperCase()
  return `^XA
^LH0,0
^PW${width}
^LL${height}
^FO0,0^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex}^FS
^PQ1,0,0,N
^XZ`
}

/**
 * One ZPL job per PDF page, rendered at the printer's native dpi so the label
 * comes out at its real physical size and matches the on-screen preview.
 */
export async function labelCenterPdfToZpl(
  pdf: Uint8Array,
  stock: LabelCenterStock,
  dpi: LabelDpi,
): Promise<string[]> {
  const { widthIn, heightIn } = LABEL_CENTER_STOCK_INFO[stock]
  const loading = getDocument({
    data: pdf.slice(),
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    useWasm: false,
  })
  try {
    const doc = await loading.promise
    const jobs: string[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(widthIn * dpi)
      canvas.height = Math.round(heightIn * dpi)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not prepare the label for printing.')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const viewport = page.getViewport({ scale: canvas.width / page.getViewport({ scale: 1 }).width })
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      jobs.push(canvasToZpl(widthIn > MAX_PRINT_WIDTH_IN ? rotateQuarterTurn(canvas) : canvas))
    }
    await doc.destroy()
    return jobs
  } finally {
    void loading.destroy()
  }
}

/** Group label jobs into spooler-sized batches. Each batch is one printZpl call. */
export function batchZplJobs(jobs: string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let size = 0
  for (const job of jobs) {
    if (current.length > 0 && size + job.length > MAX_ZPL_CHARS_PER_JOB) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(job)
    size += job.length + 1
  }
  if (current.length > 0) batches.push(current)
  return batches
}
