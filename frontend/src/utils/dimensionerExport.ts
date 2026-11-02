import XLSX from 'xlsx-js-style'
import type { DimensionerScan } from '../services/api'

const HEADERS = [
  'Received',
  'Barcode',
  'Length',
  'Width',
  'Height',
  'Weight (lb)',
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

/** Excel of the scans currently shown (respects barcode search / filter). */
export function buildDimensionerScansExcelBlob(scans: DimensionerScan[]): Blob {
  const rows: (string | number)[][] = [
    [...HEADERS],
    ...scans.map((scan) => [
      formatWhen(scan.received_at),
      scan.barcode || '',
      formatInches(scan.length_in),
      formatInches(scan.width_in),
      formatInches(scan.height_in),
      formatPounds(scan.weight_lb),
      scan.shape || '',
      scan.device || '',
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: false })
  ws['!cols'] = [
    { wch: 22 },
    { wch: 16 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 20 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dimensioner Scans')
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
