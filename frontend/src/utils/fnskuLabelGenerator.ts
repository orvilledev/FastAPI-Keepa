import XLSX from 'xlsx-js-style'

/**
 * FNSKU Labels Generator
 *
 * Converts an Amazon FBA "Send to Amazon" shipment plan export (the per-shipment
 * `Individual units` table, available as either CSV or XLSX) into the
 * `WR FNSKU LABELS <ShipmentID>.xlsx` workbook used by the warehouse label
 * tooling.
 *
 * Output layout (single sheet named `Products`):
 *   header:  Number of Labels* | Fnsku | Title | Condition | Msku | DynamicText - 2
 *   then, for each box in the source's "Box N units" column order:
 *     [BOX_MARKER]                                      // open marker row
 *     [PRODUCT row per FNSKU allocated to this box]
 *     [BOX_MARKER]                                      // close marker row
 *
 * Box marker: Number of Labels=1, Fnsku=BoxID, Title=BoxName,
 *             Condition=<1-based box sequence number>, Msku=blank,
 *             DynamicText - 2=blank.
 * Product row: Number of Labels=units in this box, Fnsku=FNSKU, Title=Title,
 *             Condition=source Condition (e.g. "New"), Msku=source SKU,
 *             DynamicText - 2=blank.
 *
 * Cell types match the reference output: `Number of Labels*` and box-row
 * `Condition` are numeric; everything else is text. Blank trailing cells
 * (Msku/DynamicText on box rows, DynamicText on product rows) are omitted as
 * `null` so the workbook stores no cell at those coordinates — matching the
 * original byte for byte.
 */

const PRODUCTS_SHEET = 'Products'
const HEADER: readonly string[] = [
  'Number of Labels*',
  'Fnsku',
  'Title',
  'Condition',
  'Msku',
  'DynamicText - 2',
]
/** Reference workbook ships with Calibri 12 default. Set explicitly so output matches the original sample. */
const CELL_FONT = { name: 'Calibri', sz: 12 } as const
/** Column widths copied directly from the reference workbook (in Excel character units). */
const COLUMN_WIDTHS: readonly number[] = [25.25, 13, 13, 13, 13, 13]

export type FnskuItem = {
  sku: string
  title: string
  asin: string
  fnsku: string
  condition: string
  prepType: string
  totalUnits: number
  /** Unit allocation across boxes, indexed by the same order as `FnskuShipment.boxes`. */
  perBoxUnits: number[]
}

export type FnskuBoxMeta = {
  boxId: string
  boxName: string
  weight: string
  length: string
  width: string
  height: string
}

export type FnskuShipment = {
  workflowName: string
  shipmentId: string
  shipmentName: string
  shipTo: string
  boxCount: number
  skuCount: number
  unitCount: number
  items: FnskuItem[]
  /** In the same order as the source CSV's `Box N units` columns. */
  boxes: FnskuBoxMeta[]
}

type RawValue = string | number | boolean | null | undefined
type RawRow = RawValue[]

export class FnskuParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FnskuParseError'
  }
}

/** Read an FBA shipment export (CSV or XLSX) and produce a normalized shipment object. */
export async function parseFnskuSource(file: File): Promise<FnskuShipment> {
  const lowered = file.name.toLowerCase()
  if (lowered.endsWith('.csv') || lowered.endsWith('.txt')) {
    const text = await file.text()
    return parseFnskuRows(parseCsvText(text))
  }
  if (
    lowered.endsWith('.xlsx') ||
    lowered.endsWith('.xls') ||
    lowered.endsWith('.xlsm') ||
    lowered.endsWith('.xlsb')
  ) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: false })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) throw new FnskuParseError('The workbook has no sheets.')
    const sheet = wb.Sheets[sheetName]
    const aoa = XLSX.utils.sheet_to_json<RawRow>(sheet, {
      header: 1,
      blankrows: true,
      raw: true,
      defval: '',
    })
    return parseFnskuRows(aoa)
  }
  throw new FnskuParseError(
    `Unsupported file type "${file.name}". Upload the Amazon shipment CSV or XLSX.`
  )
}

/** RFC 4180-ish CSV parser. Handles quoted fields, escaped quotes, and CRLF. */
export function parseCsvText(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\r') {
      continue
    }
    if (ch === '\n') {
      row.push(field)
      out.push(row)
      row = []
      field = ''
      continue
    }
    field += ch
  }
  row.push(field)
  out.push(row)
  while (out.length > 0 && out[out.length - 1].every((v) => v === '')) {
    out.pop()
  }
  return out
}

function asString(v: RawValue): string {
  if (v == null) return ''
  return String(v).trim()
}

function asInt(v: RawValue): number {
  const s = asString(v).replace(/,/g, '')
  if (!s) return 0
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : 0
}

function parseFnskuRows(rows: RawRow[]): FnskuShipment {
  const meta = new Map<string, string>()
  /** Scan the leading metadata block (key/value pairs before the items table). */
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const r = rows[i] || []
    const key = asString(r[0]).toLowerCase()
    const value = asString(r[1])
    if (key) meta.set(key, value)
  }

  const headerIdx = rows.findIndex((r) => {
    if (!r) return false
    return (
      asString(r[0]) === 'SKU' &&
      asString(r[1]) === 'Title' &&
      asString(r[3]) === 'FNSKU'
    )
  })
  if (headerIdx < 0) {
    throw new FnskuParseError(
      'Could not find the "Individual units" table header (SKU / Title / ASIN / FNSKU / ...). Is this the correct shipment export?'
    )
  }

  const header = rows[headerIdx]
  const boxColCount = Math.max(0, header.length - 7)
  if (boxColCount === 0) {
    throw new FnskuParseError(
      'The items table has no "Box N units" columns. The shipment plan must include per-box allocations.'
    )
  }

  let endIdx = rows.length
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i] || []
    const fnsku = asString(r[3])
    const sku = asString(r[0])
    if (!sku && !fnsku) {
      endIdx = i
      break
    }
  }

  const items: FnskuItem[] = []
  for (let i = headerIdx + 1; i < endIdx; i += 1) {
    const r = rows[i]
    if (!r) continue
    const totalUnits = asInt(r[6])
    const perBoxUnits: number[] = []
    for (let b = 0; b < boxColCount; b += 1) {
      perBoxUnits.push(asInt(r[7 + b]))
    }
    items.push({
      sku: asString(r[0]),
      title: asString(r[1]),
      asin: asString(r[2]),
      fnsku: asString(r[3]),
      condition: asString(r[4]),
      prepType: asString(r[5]),
      totalUnits,
      perBoxUnits,
    })
  }

  const boxes: FnskuBoxMeta[] = Array.from({ length: boxColCount }, () => ({
    boxId: '',
    boxName: '',
    weight: '',
    length: '',
    width: '',
    height: '',
  }))

  /** Each metadata row has the label in column G (index 6) and per-box values from column H onward. */
  for (let i = endIdx; i < rows.length; i += 1) {
    const r = rows[i] || []
    const label = asString(r[6]).toLowerCase()
    if (!label) continue
    const values: string[] = []
    for (let b = 0; b < boxColCount; b += 1) values.push(asString(r[7 + b]))
    if (label.startsWith('box id')) {
      values.forEach((v, b) => {
        boxes[b].boxId = v
      })
    } else if (label.startsWith('box name')) {
      values.forEach((v, b) => {
        boxes[b].boxName = v
      })
    } else if (label.startsWith('box weight')) {
      values.forEach((v, b) => {
        boxes[b].weight = v
      })
    } else if (label.startsWith('box length')) {
      values.forEach((v, b) => {
        boxes[b].length = v
      })
    } else if (label.startsWith('box width')) {
      values.forEach((v, b) => {
        boxes[b].width = v
      })
    } else if (label.startsWith('box height')) {
      values.forEach((v, b) => {
        boxes[b].height = v
      })
    }
  }

  if (boxes.every((box) => !box.boxId && !box.boxName)) {
    throw new FnskuParseError(
      'Could not find the box metadata block (Box ID / Box name) below the items table.'
    )
  }

  const shipment: FnskuShipment = {
    workflowName: meta.get('workflow name') ?? '',
    shipmentId: meta.get('shipment id') ?? '',
    shipmentName: meta.get('shipment name') ?? '',
    shipTo: meta.get('ship to') ?? '',
    boxCount: asInt(meta.get('boxes') ?? '') || boxColCount,
    skuCount: asInt(meta.get('skus') ?? '') || items.length,
    unitCount: asInt(meta.get('units') ?? '') || items.reduce((acc, it) => acc + it.totalUnits, 0),
    items,
    boxes,
  }
  return shipment
}

/** Quick sanity stats derived from a parsed shipment — used both by the UI and the verifier. */
export type FnskuShipmentSummary = {
  shipmentId: string
  shipmentName: string
  shipTo: string
  boxCount: number
  skuCount: number
  declaredUnits: number
  computedUnits: number
  perBoxLineCounts: number[]
  perBoxLabelCounts: number[]
  splitSkuCount: number
  outputRowCount: number
}

export function summarizeFnskuShipment(shipment: FnskuShipment): FnskuShipmentSummary {
  const perBoxLineCounts = shipment.boxes.map(
    (_, bi) => shipment.items.filter((it) => (it.perBoxUnits[bi] ?? 0) > 0).length
  )
  const perBoxLabelCounts = shipment.boxes.map((_, bi) =>
    shipment.items.reduce((acc, it) => acc + (it.perBoxUnits[bi] ?? 0), 0)
  )
  const computedUnits = shipment.items.reduce((acc, it) => acc + it.totalUnits, 0)
  const splitSkuCount = shipment.items.filter(
    (it) => it.perBoxUnits.filter((q) => q > 0).length > 1
  ).length
  const productRows = perBoxLineCounts.reduce((a, b) => a + b, 0)
  const outputRowCount = 1 + shipment.boxes.length * 2 + productRows
  return {
    shipmentId: shipment.shipmentId,
    shipmentName: shipment.shipmentName,
    shipTo: shipment.shipTo,
    boxCount: shipment.boxes.length,
    skuCount: shipment.items.length,
    declaredUnits: shipment.unitCount,
    computedUnits,
    perBoxLineCounts,
    perBoxLabelCounts,
    splitSkuCount,
    outputRowCount,
  }
}

type AoaCell = string | number | null
type AoaRow = AoaCell[]

/** Build the AoA matrix that becomes the `Products` sheet. Exported for testing. */
export function buildProductsAoa(shipment: FnskuShipment): AoaRow[] {
  const aoa: AoaRow[] = []
  aoa.push([...HEADER])
  for (let bi = 0; bi < shipment.boxes.length; bi += 1) {
    const box = shipment.boxes[bi]
    /** Boxes are emitted in the exact column order they appeared in the source export. */
    const marker: AoaRow = [1, box.boxId, box.boxName, bi + 1, null, null]
    aoa.push(marker)
    for (const item of shipment.items) {
      const qty = item.perBoxUnits[bi] ?? 0
      if (qty <= 0) continue
      aoa.push([qty, item.fnsku, item.title, item.condition, item.sku, null])
    }
    aoa.push([...marker])
  }
  return aoa
}

/** Generate the `WR FNSKU LABELS <ShipmentID>.xlsx` blob ready for download. */
export function buildFnskuLabelsWorkbookBlob(shipment: FnskuShipment): Blob {
  const aoa = buildProductsAoa(shipment)
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false })

  /** Apply Calibri 12 to every realized cell so the output matches the reference workbook's default font. */
  const ref = ws['!ref']
  if (ref) {
    const rng = XLSX.utils.decode_range(ref)
    for (let r = rng.s.r; r <= rng.e.r; r += 1) {
      for (let c = rng.s.c; c <= rng.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (!cell) continue
        cell.s = { font: { ...CELL_FONT } }
      }
    }
  }
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, PRODUCTS_SHEET)
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function suggestedFnskuLabelFilename(shipment: FnskuShipment): string {
  const id = (shipment.shipmentId || 'SHIPMENT').replace(/[^A-Z0-9_-]+/gi, '')
  return `WR FNSKU LABELS ${id}.xlsx`
}
