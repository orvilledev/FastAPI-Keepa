import type { DimensionerScan } from '../services/api'

/** Barcodes like TO123456_1 share TO123456; bare barcodes stay alone; empty → Ungrouped. */
export function dimensionerToGroupKey(barcode: string): string {
  const value = (barcode || '').trim()
  if (!value) return 'Ungrouped'
  const match = /^(.+)_(\d+)$/.exec(value)
  return match ? match[1] : value
}

export type DimensionerToGroup = {
  key: string
  scans: DimensionerScan[]
}

/** Group scans by TO (barcode prefix before _N). Groups sorted by key; boxes by barcode. */
export function groupDimensionerScansByTo(scans: DimensionerScan[]): DimensionerToGroup[] {
  const buckets = new Map<string, DimensionerScan[]>()
  for (const scan of scans) {
    const key = dimensionerToGroupKey(scan.barcode)
    const list = buckets.get(key)
    if (list) list.push(scan)
    else buckets.set(key, [scan])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([key, groupScans]) => ({
      key,
      scans: [...groupScans].sort((left, right) =>
        (left.barcode || '').localeCompare(right.barcode || '', undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      ),
    }))
}
