import XLSX from 'xlsx-js-style'
import type { DimensionerScan } from '../services/api'

/** Matches the Dimensioner Scans sheet: Weight before L/W/H. */
const SCAN_HEADERS = [
  'Received',
  'Barcode',
  'Weight (lb)',
  'Length',
  'Width',
  'Height',
  'Shape',
  'Device',
] as const

function formatInches(value: number | null): string | number {
  return value == null ? '' : Number(value.toFixed(2))
}

function formatPounds(value: number | null): string | number {
  return value == null ? '' : Number(value.toFixed(2))
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** _1 before _2 … _10; empty barcodes last. */
function compareBarcodes(a: string, b: string): number {
  const left = (a || '').trim()
  const right = (b || '').trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function sortScansByBarcode(scans: DimensionerScan[]): DimensionerScan[] {
  return [...scans].sort((a, b) => compareBarcodes(a.barcode, b.barcode))
}

function buildScansSheet(scans: DimensionerScan[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [...SCAN_HEADERS],
    ...scans.map((scan) => [
      formatWhen(scan.received_at),
      scan.barcode || '',
      formatPounds(scan.weight_lb),
      formatInches(scan.length_in),
      formatInches(scan.width_in),
      formatInches(scan.height_in),
      scan.shape || '',
      scan.device || '',
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: false })
  ws['!cols'] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 18 },
  ]
  return ws
}

/**
 * Pivot of the same filtered scans: columns are Box# 1..N in barcode order
 * (same top-to-bottom order as the Dimensioner Scans sheet).
 */
function buildDimensionSheet(scans: DimensionerScan[]): XLSX.WorkSheet {
  const header: (string | number)[] = ['Box#', ...scans.map((_, index) => index + 1)]
  const weightRow: (string | number)[] = [
    'Weight (lb)',
    ...scans.map((scan) => formatPounds(scan.weight_lb)),
  ]
  const lengthRow: (string | number)[] = [
    'Length',
    ...scans.map((scan) => formatInches(scan.length_in)),
  ]
  const widthRow: (string | number)[] = [
    'Width',
    ...scans.map((scan) => formatInches(scan.width_in)),
  ]
  const heightRow: (string | number)[] = [
    'Height',
    ...scans.map((scan) => formatInches(scan.height_in)),
  ]

  const ws = XLSX.utils.aoa_to_sheet(
    [header, weightRow, lengthRow, widthRow, heightRow],
    { cellDates: false },
  )
  ws['!cols'] = [
    { wch: 12 },
    ...scans.map(() => ({ wch: 10 })),
  ]
  return ws
}

/** Excel of the scans currently shown (respects barcode search / filter). */
export function buildDimensionerScansExcelBlob(scans: DimensionerScan[]): Blob {
  const ordered = sortScansByBarcode(scans)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildScansSheet(ordered), 'Dimensioner Scans')
  XLSX.utils.book_append_sheet(wb, buildDimensionSheet(ordered), 'Dimension')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function suggestedDimensionerExportFilename(search?: string): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  const q = (search || '').trim().replace(/[<>:"/\\|?*\s]+/g, '-').slice(0, 40)
  return q ? `dimensioner-scans-${q}-${stamp}.xlsx` : `dimensioner-scans-${stamp}.xlsx`
}
