/**
 * Compares playground run outputs against user-uploaded "correct output" files.
 *
 * Generated xlsx/pdf/zip files embed creation timestamps, generator metadata and
 * archive mtimes, so a raw byte diff of two otherwise-identical exports always
 * reports a mismatch. Each format is therefore decoded to its content before being
 * compared: spreadsheets down to sheets/columns/rows/cells, PDFs down to per-page
 * text lines and embedded image counts, archives entry by entry.
 */

import JSZip from 'jszip'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist'
import XLSX from 'xlsx-js-style'
import type { PlaygroundExpectedFile, PlaygroundOutputFile } from './storage'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

/** Keeps the failure report readable when two files diverge completely. */
const MAX_DIFFERENCES = 25
const MAX_ZIP_DEPTH = 3

const WORKBOOK_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xls'])
const TABLE_EXTENSIONS = new Set(['csv', 'tsv'])
const TEXT_EXTENSIONS = new Set(['txt', 'json', 'xml', 'html', 'md'])

export const PLAYGROUND_EXPECTED_ACCEPT =
  '.xlsx,.xlsm,.xls,.pdf,.zip,.csv,.tsv,.txt,.json,.xml'

export type PlaygroundComparisonEntry = {
  expectedFilename: string
  /** Output the expected file was matched to, or null when nothing matched. */
  actualFilename: string | null
  /** What was compared, e.g. "sheets, columns, rows and cell values". */
  method: string
  matched: boolean
  differences: string[]
}

export type PlaygroundComparisonReport = {
  status: 'pass' | 'fail'
  checkedAt: string
  entries: PlaygroundComparisonEntry[]
  /** Produced files with no expected counterpart uploaded — reported, not failed. */
  uncheckedOutputs: string[]
}

type ComparableFile = {
  filename: string
  bytes: ArrayBuffer
}

type DiffResult = {
  method: string
  differences: string[]
}

/** Collects differences up to the cap so a wildly different file stays readable. */
function createCollector() {
  const differences: string[] = []
  return {
    differences,
    add(line: string) {
      if (differences.length < MAX_DIFFERENCES) differences.push(line)
    },
    full() {
      return differences.length >= MAX_DIFFERENCES
    },
  }
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim())
  return match ? match[1].toLowerCase() : ''
}

export function isComparableExpectedFile(file: File): boolean {
  const ext = extensionOf(file.name)
  return (
    WORKBOOK_EXTENSIONS.has(ext) ||
    TABLE_EXTENSIONS.has(ext) ||
    TEXT_EXTENSIONS.has(ext) ||
    ext === 'pdf' ||
    ext === 'zip'
  )
}

function quote(value: string): string {
  if (!value) return '(empty)'
  const clipped = value.length > 60 ? `${value.slice(0, 60)}…` : value
  return `"${clipped}"`
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'unknown error'
}

function count(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`
}

/* ------------------------------------------------- Spreadsheets and tables */

type SheetGrid = {
  name: string
  rows: string[][]
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

/** Drops trailing empty cells and rows so padding differences are not failures. */
function trimGrid(rows: string[][]): string[][] {
  const trimmed = rows.map((row) => {
    const copy = [...row]
    while (copy.length > 0 && copy[copy.length - 1] === '') copy.pop()
    return copy
  })
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0) trimmed.pop()
  return trimmed
}

function columnCount(rows: string[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0)
}

/** Reads xlsx/xlsm/xls/csv/tsv into plain string grids, one per sheet. */
function readSheetGrids(bytes: ArrayBuffer): SheetGrid[] {
  const workbook = XLSX.read(new Uint8Array(bytes), { type: 'array' })
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const raw = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
    }) as unknown[][]
    return { name, rows: trimGrid(raw.map((row) => row.map(normalizeCell))) }
  })
}

function diffSheet(
  prefix: string,
  where: string,
  expected: SheetGrid,
  actual: SheetGrid,
  out: ReturnType<typeof createCollector>,
): void {
  const expectedHeaders = expected.rows[0] ?? []
  const actualHeaders = actual.rows[0] ?? []
  const missingColumns = expectedHeaders.filter((h) => h && !actualHeaders.includes(h))
  const extraColumns = actualHeaders.filter((h) => h && !expectedHeaders.includes(h))
  const orderChanged =
    missingColumns.length === 0 &&
    extraColumns.length === 0 &&
    expectedHeaders.join('\u0000') !== actualHeaders.join('\u0000')

  for (const header of missingColumns) out.add(`${prefix}${where}missing column ${quote(header)}`)
  for (const header of extraColumns) {
    out.add(`${prefix}${where}unexpected extra column ${quote(header)}`)
  }
  if (orderChanged) {
    out.add(
      `${prefix}${where}column order differs: expected ${expectedHeaders.join(' | ')}; got ${actualHeaders.join(' | ')}`,
    )
  }

  if (expected.rows.length !== actual.rows.length) {
    out.add(
      `${prefix}${where}expected ${count(expected.rows.length, 'row')}, got ${actual.rows.length}`,
    )
  }
  const expectedColumns = columnCount(expected.rows)
  const actualColumns = columnCount(actual.rows)
  if (expectedColumns !== actualColumns) {
    out.add(
      `${prefix}${where}expected ${count(expectedColumns, 'column')}, got ${actualColumns}`,
    )
  }

  // Header differences are already reported by name above; re-reporting row 1 cell
  // by cell would just duplicate them.
  const headerReported = missingColumns.length > 0 || extraColumns.length > 0 || orderChanged
  const rowCount = Math.max(expected.rows.length, actual.rows.length)
  for (let r = headerReported ? 1 : 0; r < rowCount; r += 1) {
    if (out.full()) return
    const expectedRow = expected.rows[r] ?? []
    const actualRow = actual.rows[r] ?? []
    const colCount = Math.max(expectedRow.length, actualRow.length)
    for (let c = 0; c < colCount; c += 1) {
      const expectedValue = expectedRow[c] ?? ''
      const actualValue = actualRow[c] ?? ''
      if (expectedValue === actualValue) continue
      const column = expectedHeaders[c] || actualHeaders[c]
      const columnNote = column ? ` (${column})` : ''
      out.add(
        `${prefix}${where}cell ${XLSX.utils.encode_cell({ r, c })}${columnNote}: expected ${quote(expectedValue)}, got ${quote(actualValue)}`,
      )
      if (out.full()) return
    }
  }
}

function diffGrids(
  prefix: string,
  method: string,
  expectedBytes: ArrayBuffer,
  actualBytes: ArrayBuffer,
): DiffResult {
  const out = createCollector()
  const expectedSheets = readSheetGrids(expectedBytes)
  const actualSheets = readSheetGrids(actualBytes)
  const expectedNames = expectedSheets.map((s) => s.name)
  const actualNames = actualSheets.map((s) => s.name)

  for (const name of expectedNames) {
    if (!actualNames.includes(name)) out.add(`${prefix}missing sheet ${quote(name)}`)
  }
  for (const name of actualNames) {
    if (!expectedNames.includes(name)) {
      out.add(`${prefix}unexpected extra sheet ${quote(name)}`)
    }
  }
  if (
    out.differences.length === 0 &&
    expectedNames.join('\u0000') !== actualNames.join('\u0000')
  ) {
    out.add(
      `${prefix}sheet order differs: expected ${expectedNames.join(', ')}; got ${actualNames.join(', ')}`,
    )
  }

  for (const sheet of expectedSheets) {
    if (out.full()) break
    const other = actualSheets.find((s) => s.name === sheet.name)
    if (!other) continue
    // Naming the sheet only helps when there is more than one to tell apart.
    const where = expectedSheets.length > 1 ? `sheet ${quote(sheet.name)} ` : ''
    diffSheet(prefix, where, sheet, other, out)
  }

  return { method, differences: out.differences }
}

/* -------------------------------------------------------------------- PDF */

type PdfPage = {
  lines: string[]
  imageCount: number
}

async function readPdfPages(bytes: ArrayBuffer): Promise<PdfPage[]> {
  // pdf.js detaches the buffer it is handed, so pass it a copy.
  const doc = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
  const pages: PdfPage[] = []
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()

      const lines: string[] = []
      let current = ''
      const flush = () => {
        const line = current.replace(/\s+/g, ' ').trim()
        if (line) lines.push(line)
        current = ''
      }
      for (const item of content.items) {
        if (!('str' in item)) continue
        current += item.str
        if (item.hasEOL) flush()
      }
      flush()

      const { fnArray } = await page.getOperatorList()
      const imageCount = fnArray.filter(
        (fn) =>
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintImageMaskXObject,
      ).length

      pages.push({ lines, imageCount })
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return pages
}

async function diffPdfs(
  prefix: string,
  expectedBytes: ArrayBuffer,
  actualBytes: ArrayBuffer,
): Promise<DiffResult> {
  const method = 'pages, text lines and embedded images'
  const out = createCollector()
  const expectedPages = await readPdfPages(expectedBytes)
  const actualPages = await readPdfPages(actualBytes)

  if (expectedPages.length !== actualPages.length) {
    out.add(`${prefix}expected ${count(expectedPages.length, 'page')}, got ${actualPages.length}`)
  }

  const pageCount = Math.max(expectedPages.length, actualPages.length)
  for (let p = 0; p < pageCount; p += 1) {
    if (out.full()) break
    const expectedPage = expectedPages[p]
    const actualPage = actualPages[p]
    if (!expectedPage) {
      out.add(`${prefix}page ${p + 1}: unexpected extra page`)
      continue
    }
    if (!actualPage) {
      out.add(`${prefix}page ${p + 1}: missing from the produced output`)
      continue
    }

    if (expectedPage.imageCount !== actualPage.imageCount) {
      out.add(
        `${prefix}page ${p + 1}: expected ${count(expectedPage.imageCount, 'embedded image')} (barcodes/logos), got ${actualPage.imageCount}`,
      )
    }
    if (expectedPage.lines.length !== actualPage.lines.length) {
      out.add(
        `${prefix}page ${p + 1}: expected ${count(expectedPage.lines.length, 'text line')}, got ${actualPage.lines.length}`,
      )
    }

    const lineCount = Math.max(expectedPage.lines.length, actualPage.lines.length)
    for (let l = 0; l < lineCount; l += 1) {
      const expectedLine = expectedPage.lines[l] ?? ''
      const actualLine = actualPage.lines[l] ?? ''
      if (expectedLine === actualLine) continue
      out.add(
        `${prefix}page ${p + 1} line ${l + 1}: expected ${quote(expectedLine)}, got ${quote(actualLine)}`,
      )
      if (out.full()) break
    }
  }

  return { method, differences: out.differences }
}

/* -------------------------------------------------------------- Text/bytes */

function readTextLines(bytes: ArrayBuffer): string[] {
  const lines = new TextDecoder('utf-8')
    .decode(bytes)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function diffText(
  prefix: string,
  expectedBytes: ArrayBuffer,
  actualBytes: ArrayBuffer,
): DiffResult {
  const method = 'text lines'
  const out = createCollector()
  const expectedLines = readTextLines(expectedBytes)
  const actualLines = readTextLines(actualBytes)

  if (expectedLines.length !== actualLines.length) {
    out.add(`${prefix}expected ${count(expectedLines.length, 'line')}, got ${actualLines.length}`)
  }

  const lineCount = Math.max(expectedLines.length, actualLines.length)
  for (let i = 0; i < lineCount; i += 1) {
    const expectedLine = expectedLines[i] ?? ''
    const actualLine = actualLines[i] ?? ''
    if (expectedLine === actualLine) continue
    out.add(`${prefix}line ${i + 1}: expected ${quote(expectedLine)}, got ${quote(actualLine)}`)
    if (out.full()) break
  }

  return { method, differences: out.differences }
}

function diffBytes(
  prefix: string,
  expectedBytes: ArrayBuffer,
  actualBytes: ArrayBuffer,
): DiffResult {
  const method = 'raw bytes'
  const out = createCollector()
  const expected = new Uint8Array(expectedBytes)
  const actual = new Uint8Array(actualBytes)

  if (expected.length !== actual.length) {
    out.add(`${prefix}expected ${count(expected.length, 'byte')}, got ${actual.length}`)
  }

  const limit = Math.min(expected.length, actual.length)
  for (let i = 0; i < limit; i += 1) {
    if (expected[i] === actual[i]) continue
    out.add(`${prefix}first byte difference at offset ${i}`)
    break
  }

  return { method, differences: out.differences }
}

/* -------------------------------------------------------------------- ZIP */

async function readZipEntries(bytes: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
  const zip = await JSZip.loadAsync(bytes)
  const entries = new Map<string, ArrayBuffer>()
  const names: string[] = []
  zip.forEach((path, entry) => {
    if (!entry.dir) names.push(path)
  })
  for (const name of names.sort()) {
    const file = zip.file(name)
    if (file) entries.set(name, await file.async('arraybuffer'))
  }
  return entries
}

async function diffZips(
  prefix: string,
  expectedBytes: ArrayBuffer,
  actualBytes: ArrayBuffer,
  depth: number,
): Promise<DiffResult> {
  const method = 'archive entries and their contents'
  const out = createCollector()
  const expectedEntries = await readZipEntries(expectedBytes)
  const actualEntries = await readZipEntries(actualBytes)

  for (const name of expectedEntries.keys()) {
    if (!actualEntries.has(name)) out.add(`${prefix}missing file ${quote(name)}`)
  }
  for (const name of actualEntries.keys()) {
    if (!expectedEntries.has(name)) out.add(`${prefix}unexpected extra file ${quote(name)}`)
  }

  for (const [name, expectedEntry] of expectedEntries) {
    if (out.full()) break
    const actualEntry = actualEntries.get(name)
    if (!actualEntry) continue
    const nested = await diffFiles(
      `${prefix}${name}: `,
      { filename: name, bytes: expectedEntry },
      { filename: name, bytes: actualEntry },
      depth + 1,
    )
    for (const line of nested.differences) out.add(line)
  }

  return { method, differences: out.differences }
}

/* ---------------------------------------------------------------- Dispatch */

async function diffFiles(
  prefix: string,
  expected: ComparableFile,
  actual: ComparableFile,
  depth = 0,
): Promise<DiffResult> {
  const ext = extensionOf(expected.filename) || extensionOf(actual.filename)
  try {
    if (WORKBOOK_EXTENSIONS.has(ext)) {
      return diffGrids(
        prefix,
        'sheets, columns, rows and cell values',
        expected.bytes,
        actual.bytes,
      )
    }
    if (TABLE_EXTENSIONS.has(ext)) {
      return diffGrids(prefix, 'columns, rows and cell values', expected.bytes, actual.bytes)
    }
    if (ext === 'pdf') {
      return await diffPdfs(prefix, expected.bytes, actual.bytes)
    }
    if (ext === 'zip' && depth < MAX_ZIP_DEPTH) {
      return await diffZips(prefix, expected.bytes, actual.bytes, depth)
    }
    if (TEXT_EXTENSIONS.has(ext)) {
      return diffText(prefix, expected.bytes, actual.bytes)
    }
    return diffBytes(prefix, expected.bytes, actual.bytes)
  } catch (err) {
    return {
      method: ext ? `.${ext} content` : 'file content',
      differences: [`${prefix}could not be read for comparison (${errorText(err)})`],
    }
  }
}

/** Pairs an expected file with a produced output by exact name, then by extension. */
function pickOutputIndex(
  expectedFilename: string,
  outputs: PlaygroundOutputFile[],
  used: Set<number>,
): number {
  const name = expectedFilename.trim().toLowerCase()
  const exact = outputs.findIndex(
    (o, i) => !used.has(i) && o.filename.trim().toLowerCase() === name,
  )
  if (exact >= 0) return exact
  const ext = extensionOf(expectedFilename)
  return outputs.findIndex((o, i) => !used.has(i) && extensionOf(o.filename) === ext)
}

/**
 * Compares every uploaded expected file against the matching run output.
 * Passes only when at least one file was checked and all checked files matched.
 */
export async function comparePlaygroundOutputs(
  outputs: PlaygroundOutputFile[],
  expectedFiles: PlaygroundExpectedFile[],
): Promise<PlaygroundComparisonReport> {
  const checkedAt = new Date().toISOString()
  const entries: PlaygroundComparisonEntry[] = []
  const used = new Set<number>()

  for (const expected of expectedFiles) {
    const index = pickOutputIndex(expected.filename, outputs, used)
    if (index < 0) {
      entries.push({
        expectedFilename: expected.filename,
        actualFilename: null,
        method: 'file match',
        matched: false,
        differences: [
          outputs.length === 0
            ? 'The test run produced no output file to compare against.'
            : `The test run produced no .${extensionOf(expected.filename)} output to compare against.`,
        ],
      })
      continue
    }
    used.add(index)
    const actual = outputs[index]
    const { method, differences } = await diffFiles(
      '',
      { filename: expected.filename, bytes: expected.bytes },
      { filename: actual.filename, bytes: actual.bytes },
    )
    entries.push({
      expectedFilename: expected.filename,
      actualFilename: actual.filename,
      method,
      matched: differences.length === 0,
      differences,
    })
  }

  return {
    status: entries.length > 0 && entries.every((e) => e.matched) ? 'pass' : 'fail',
    checkedAt,
    entries,
    uncheckedOutputs: outputs.filter((_, i) => !used.has(i)).map((o) => o.filename),
  }
}
