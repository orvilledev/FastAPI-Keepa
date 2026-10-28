import JSZip from 'jszip'
import XLSX from 'xlsx-js-style'
import { NS_TOOL_STYLES_XML, NS_TOOL_THEME_XML } from './nsToolWorkbookParts'

/**
 * NS Tool: one output sheet with every External ID and its month totals.
 *
 * Mirrors the Excel workflow the BC team does by hand:
 *   C..F = IFERROR(VLOOKUP(External ID, <totals sheet>!A:B, 2, FALSE), "")
 *   G    = SUM(FBA sales, MFN sales)                 (gross)
 *   H    = gross - SUM(FBA returns, MFN returns)     (net)
 * pasted as values, with the reference workbook's fonts, fills, widths,
 * and conditional formatting.
 */

type CellValue = string | number | boolean
type LookupResult = CellValue | ''

type TotalsKind = 'fbaSales' | 'fbaReturns' | 'mfnSales' | 'mfnReturns'

const TOTALS_ORDER: TotalsKind[] = ['fbaSales', 'fbaReturns', 'mfnSales', 'mfnReturns']

const TOTALS_LABELS: Record<TotalsKind, string> = {
  fbaSales: 'FBA SALES TOTAL',
  fbaReturns: 'FBA RETURNS TOTAL',
  mfnSales: 'MFN SALES TOTAL',
  mfnReturns: 'MFN RETURNS TOTAL',
}

export type NsToolResult = {
  blob: Blob
  filename: string
  rowCount: number
  matched: Record<TotalsKind, number>
  headers: string[]
}

function classifyTotalsSheet(name: string): TotalsKind | null {
  const upper = name.toUpperCase()
  const channel = /\bFBA\b/.test(upper) ? 'fba' : /\bMFN\b/.test(upper) ? 'mfn' : null
  const kind = /\bRETURNS?\b/.test(upper) ? 'Returns' : /\bSALES?\b/.test(upper) ? 'Sales' : null
  if (!channel || !kind) return null
  return `${channel}${kind}` as TotalsKind
}

/** Excel exact-match lookups ignore text case and never match text to a number. */
function lookupKey(value: CellValue): string {
  if (typeof value === 'string') return `s:${value.toLowerCase()}`
  if (typeof value === 'number') return `n:${value}`
  return `b:${value}`
}

function cellAt(sheet: XLSX.WorkSheet, row: number, col: number): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined
}

function readValue(cell: XLSX.CellObject | undefined): CellValue | null {
  if (!cell || cell.t === 'z' || cell.t === 'e' || cell.v === undefined || cell.v === null) {
    return null
  }
  if (cell.t === 'n' || cell.t === 's' || cell.t === 'b') return cell.v as CellValue
  if (cell.t === 'd') return cell.v instanceof Date ? cell.v.toISOString() : String(cell.v)
  return String(cell.v)
}

function buildLookup(sheet: XLSX.WorkSheet): Map<string, LookupResult> {
  const lookup = new Map<string, LookupResult>()
  if (!sheet['!ref']) return lookup
  const range = XLSX.utils.decode_range(sheet['!ref'])
  let start = range.s.r
  for (let r = range.s.r; r <= range.e.r; r++) {
    const label = readValue(cellAt(sheet, r, 0))
    if (typeof label === 'string' && label.trim().toLowerCase() === 'row labels') {
      start = r + 1
      break
    }
  }
  for (let r = start; r <= range.e.r; r++) {
    const key = readValue(cellAt(sheet, r, 0))
    if (key === null || key === '') continue
    if (typeof key === 'string' && key.trim().toLowerCase() === 'grand total') continue
    const id = lookupKey(key)
    if (lookup.has(id)) continue
    const qtyCell = cellAt(sheet, r, 1)
    if (qtyCell?.t === 'e') {
      lookup.set(id, '')
      continue
    }
    // VLOOKUP returns 0 when the matched quantity cell is blank.
    const qty = readValue(qtyCell)
    lookup.set(id, qty === null ? 0 : qty)
  }
  return lookup
}

function numericOrZero(value: LookupResult): number {
  return typeof value === 'number' ? value : 0
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0'
}

class SharedStrings {
  private index = new Map<string, number>()
  private items: string[] = []
  count = 0

  add(text: string): number {
    this.count++
    const existing = this.index.get(text)
    if (existing !== undefined) return existing
    const next = this.items.length
    this.items.push(text)
    this.index.set(text, next)
    return next
  }

  toXml(): string {
    const parts = this.items.map((text) =>
      text === ''
        ? '<si><t/></si>'
        : /^\s|\s$/.test(text)
          ? `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`
          : `<si><t>${escapeXml(text)}</t></si>`,
    )
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.items.length}">` +
      parts.join('') +
      '</sst>'
    )
  }
}

function valueCell(ref: string, value: CellValue | '', style: number | null, sst: SharedStrings): string {
  const s = style === null ? '' : ` s="${style}"`
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${formatNumber(value)}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${ref}"${s} t="s"><v>${sst.add(value)}</v></c>`
}

const WORKBOOK_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<workbookPr defaultThemeVersion="166925"/>' +
  '<bookViews><workbookView xWindow="-108" yWindow="-108" windowWidth="23256" windowHeight="12456"/></bookViews>' +
  '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
  '<calcPr calcId="191029"/>' +
  '</workbook>'

const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
  '</Relationships>'

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '</Types>'

const APP_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
  '<Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
  '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
  '<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Sheet1</vt:lpstr></vt:vector></TitlesOfParts>' +
  '<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>' +
  '</Properties>'

function coreXml(now: Date): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:creator>MSW Overwatch</dc:creator><cp:lastModifiedBy>MSW Overwatch</cp:lastModifiedBy>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    '</cp:coreProperties>'
  )
}

/** Style ids from NS_TOOL_STYLES_XML cellXfs. */
const STYLE = {
  externalIdHeader: 5,
  totalsHeader: 1,
  grossHeader: 2,
  netHeader: 3,
  totalsCell: 4,
} as const

function outputFilename(inputName: string): string {
  const base = inputName.replace(/\.(xlsx|xlsm|xls)$/i, '')
  return `${base} - Output.xlsx`
}

export async function buildNsToolWorkbook(file: File): Promise<NsToolResult> {
  const data = await file.arrayBuffer()
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: false, cellStyles: false })

  const totalsSheets = new Map<TotalsKind, string>()
  let externalIdSheetName: string | null = null
  for (const name of wb.SheetNames) {
    const kind = classifyTotalsSheet(name)
    if (kind) {
      if (!totalsSheets.has(kind)) totalsSheets.set(kind, name)
    } else if (!externalIdSheetName && /external\s*id/i.test(name)) {
      externalIdSheetName = name
    }
  }
  if (!externalIdSheetName) {
    externalIdSheetName = wb.SheetNames.find((name) => !classifyTotalsSheet(name)) ?? null
  }

  const missing = TOTALS_ORDER.filter((kind) => !totalsSheets.has(kind)).map((kind) => TOTALS_LABELS[kind])
  if (missing.length > 0) {
    throw new Error(`The workbook is missing these sheets: ${missing.join(', ')}.`)
  }
  if (!externalIdSheetName) {
    throw new Error('The workbook needs an External ID sheet with the IDs in column A.')
  }

  const idSheet = wb.Sheets[externalIdSheetName]
  if (!idSheet?.['!ref']) {
    throw new Error(`Sheet "${externalIdSheetName}" is empty.`)
  }

  const lookups = TOTALS_ORDER.map((kind) => buildLookup(wb.Sheets[totalsSheets.get(kind) as string]))
  const totalsHeaders = TOTALS_ORDER.map((kind) => totalsSheets.get(kind) as string)
  const fbaSalesName = totalsSheets.get('fbaSales') as string
  const prefix = fbaSalesName.replace(/\bFBA\s+SALES?\b[\s\S]*$/i, '').trim()
  const grossHeader = prefix ? `${prefix} GROSS SALES TOTAL` : 'GROSS SALES TOTAL'
  const netHeader = prefix ? `${prefix} NET SALES TOTAL` : 'NET SALES TOTAL'

  const idRange = XLSX.utils.decode_range(idSheet['!ref'])
  let lastIdRow = -1
  for (let r = idRange.e.r; r >= 0; r--) {
    const v = readValue(cellAt(idSheet, r, 0))
    if (v !== null && v !== '') {
      lastIdRow = r
      break
    }
  }
  if (lastIdRow < 1) {
    throw new Error(`Sheet "${externalIdSheetName}" has no External IDs below the header in column A.`)
  }

  const ids: Array<CellValue | null> = []
  for (let r = 0; r <= lastIdRow; r++) ids.push(readValue(cellAt(idSheet, r, 0)))

  const sst = new SharedStrings()
  // Column A strings are registered first, as in the reference workbook.
  const idCells = ids.map((value, r) =>
    value === null ? '' : valueCell(`A${r + 1}`, value, r === 0 ? STYLE.externalIdHeader : null, sst),
  )

  const rows: string[] = []
  const headerCells =
    idCells[0] +
    totalsHeaders.map((h, i) => valueCell(`${'CDEF'[i]}1`, h, STYLE.totalsHeader, sst)).join('') +
    valueCell('G1', grossHeader, STYLE.grossHeader, sst) +
    valueCell('H1', netHeader, STYLE.netHeader, sst)
  rows.push(`<row r="1" spans="1:8" ht="81.599999999999994" x14ac:dyDescent="0.3">${headerCells}</row>`)

  const matched: Record<TotalsKind, number> = { fbaSales: 0, fbaReturns: 0, mfnSales: 0, mfnReturns: 0 }
  for (let r = 1; r <= lastIdRow; r++) {
    const id = ids[r]
    const found: LookupResult[] = lookups.map((lookup, i) => {
      if (id === null) return ''
      const hit = lookup.get(lookupKey(id))
      if (hit === undefined) return ''
      matched[TOTALS_ORDER[i]]++
      return hit
    })
    const gross = numericOrZero(found[0]) + numericOrZero(found[2])
    const net = gross - (numericOrZero(found[1]) + numericOrZero(found[3]))
    const rowNum = r + 1
    rows.push(
      `<row r="${rowNum}" spans="1:8" x14ac:dyDescent="0.3">` +
        idCells[r] +
        found.map((v, i) => valueCell(`${'CDEF'[i]}${rowNum}`, v, STYLE.totalsCell, sst)).join('') +
        valueCell(`G${rowNum}`, gross, STYLE.totalsCell, sst) +
        valueCell(`H${rowNum}`, net, STYLE.totalsCell, sst) +
        '</row>',
    )
  }

  const lastRow = lastIdRow + 1
  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">' +
    `<dimension ref="A1:H${lastRow}"/>` +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="14.4" x14ac:dyDescent="0.3"/>' +
    '<cols>' +
    '<col min="1" max="1" width="13.109375" bestFit="1" customWidth="1"/>' +
    '<col min="3" max="6" width="4" style="4" customWidth="1"/>' +
    '<col min="7" max="7" width="10.21875" style="4" bestFit="1" customWidth="1"/>' +
    '<col min="8" max="8" width="4" style="4" customWidth="1"/>' +
    '</cols>' +
    `<sheetData>${rows.join('')}</sheetData>` +
    `<conditionalFormatting sqref="C2:F${lastRow}">` +
    '<cfRule type="cellIs" dxfId="2" priority="2" operator="between"><formula>1</formula><formula>1000</formula></cfRule>' +
    '<cfRule type="cellIs" dxfId="1" priority="3" operator="between"><formula>1</formula><formula>1000</formula></cfRule>' +
    '</conditionalFormatting>' +
    `<conditionalFormatting sqref="G2:H${lastRow}">` +
    '<cfRule type="cellIs" dxfId="0" priority="1" operator="between"><formula>1</formula><formula>100</formula></cfRule>' +
    '</conditionalFormatting>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '</worksheet>'

  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('docProps/app.xml', APP_XML)
  zip.file('docProps/core.xml', coreXml(new Date()))
  zip.file('xl/workbook.xml', WORKBOOK_XML)
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS_XML)
  zip.file('xl/theme/theme1.xml', NS_TOOL_THEME_XML)
  zip.file('xl/styles.xml', NS_TOOL_STYLES_XML)
  zip.file('xl/sharedStrings.xml', sst.toXml())
  zip.file('xl/worksheets/sheet1.xml', sheetXml)

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  })

  return {
    blob,
    filename: outputFilename(file.name),
    rowCount: lastIdRow,
    matched,
    headers: [...totalsHeaders, grossHeader, netHeader],
  }
}
