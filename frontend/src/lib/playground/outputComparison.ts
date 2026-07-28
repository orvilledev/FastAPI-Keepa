/**
 * Compares playground run outputs against user-uploaded "correct output" files.
 *
 * Generated xlsx/pdf/zip files embed creation timestamps, generator metadata and
 * archive mtimes, so a raw byte diff of two otherwise-identical exports always
 * reports a mismatch. Each format is therefore decoded to a stable content-only
 * shape (cell values / page text / archive entries) before being compared.
 */

import JSZip from 'jszip'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
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
const TEXT_EXTENSIONS = new Set(['csv', 'txt', 'json', 'xml', 'html', 'md', 'tsv'])

export const PLAYGROUND_EXPECTED_ACCEPT =
  '.xlsx,.xlsm,.xls,.pdf,.zip,.csv,.txt,.json,.xml'

export type PlaygroundComparisonEntry = {
  expectedFilename: string
  /** Output the expected file was matched to, or null when nothing matched. */
  actualFilename: string | null
  /** How the two files were compared, e.g. "Excel cell values". */
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

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim())
  return match ? match[1].toLowerCase() : ''
}

export function isComparableExpectedFile(file: File): boolean {
  const ext = extensionOf(file.name)
  return (
    WORKBOOK_EXTENSIONS.has(ext) ||
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

/* ------------------------------------------------------------------ Excel */

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

function diffWorkbooks(
  prefix: string,
  expected: ArrayBuffer,
  actual: ArrayBuffer,
): DiffResult {
  const method = 'Excel cell values'
  const differences: string[] = []
  const expectedSheets = readSheetGrids(expected)
  const actualSheets = readSheetGrids(actual)
  const actualNames = actualSheets.map((s) => s.name)

  for (const sheet of expectedSheets) {
    if (!actualNames.includes(sheet.name)) {
      differences.push(`${prefix}missing sheet ${quote(sheet.name)}`)
    }
  }
  for (const name of actualNames) {
    if (!expectedSheets.some((s) => s.name === name)) {
      differences.push(`${prefix}unexpected extra sheet ${quote(name)}`)
    }
  }

  for (const sheet of expectedSheets) {
    const other = actualSheets.find((s) => s.name === sheet.name)
    if (!other) continue
    if (sheet.rows.length !== other.rows.length) {
      differences.push(
        `${prefix}sheet ${quote(sheet.name)}: expected ${sheet.rows.length} rows, got ${other.rows.length}`,
      )
    }
    const rowCount = Math.max(sheet.rows.length, other.rows.length)
    for (let r = 0; r < rowCount; r += 1) {
      const expectedRow = sheet.rows[r] ?? []
      const actualRow = other.rows[r] ?? []
      const colCount = Math.max(expectedRow.length, actualRow.length)
      for (let c = 0; c < colCount; c += 1) {
        const expectedValue = expectedRow[c] ?? ''
        const actualValue = actualRow[c] ?? ''
        if (expectedValue === actualValue) continue
        differences.push(
          `${prefix}sheet ${quote(sheet.name)} cell ${XLSX.utils.encode_cell({ r, c })}: expected ${quote(expectedValue)}, got ${quote(actualValue)}`,
        )
        if (differences.length >= MAX_DIFFERENCES) return { method, differences }
      }
    }
  }

  return { method, differences }
}

/* -------------------------------------------------------------------- PDF */

async function readPdfPages(bytes: ArrayBuffer): Promise<string[]> {
  // pdf.js detaches the buffer it is handed, so pass it a copy.
  const doc = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
  const pages: string[] = []
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return pages
}

function firstTextDifference(expected: string, actual: string): string {
  const limit = Math.min(expected.length, actual.length)
  let at = 0
  while (at < limit && expected[at] === actual[at]) at += 1
  const from = Math.max(0, at - 20)
  return `expected …${quote(expected.slice(from, at + 40))}, got …${quote(actual.slice(from, at + 40))}`
}

async function diffPdfs(
  prefix: string,
  expected: ArrayBuffer,
  actual: ArrayBuffer,
): Promise<DiffResult> {
  const method = 'PDF page text'
  const differences: string[] = []
  const expectedPages = await readPdfPages(expected)
  const actualPages = await readPdfPages(actual)

  if (expectedPages.length !== actualPages.length) {
    differences.push(
      `${prefix}expected ${expectedPages.length} pages, got ${actualPages.length}`,
    )
  }

  const pageCount = Math.max(expectedPages.length, actualPages.length)
  for (let i = 0; i < pageCount; i += 1) {
    const expectedPage = expectedPages[i]
    const actualPage = actualPages[i]
    if (expectedPage === undefined) {
      differences.push(`${prefix}page ${i + 1}: unexpected extra page`)
    } else if (actualPage === undefined) {
      differences.push(`${prefix}page ${i + 1}: missing from the produced output`)
    } else if (expectedPage !== actualPage) {
      differences.push(
        `${prefix}page ${i + 1} text differs — ${firstTextDifference(expectedPage, actualPage)}`,
      )
    }
    if (differences.length >= MAX_DIFFERENCES) break
  }

  return { method, differences }
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

function diffText(prefix: string, expected: ArrayBuffer, actual: ArrayBuffer): DiffResult {
  const method = 'text content'
  const differences: string[] = []
  const expectedLines = readTextLines(expected)
  const actualLines = readTextLines(actual)

  if (expectedLines.length !== actualLines.length) {
    differences.push(
      `${prefix}expected ${expectedLines.length} lines, got ${actualLines.length}`,
    )
  }

  const lineCount = Math.max(expectedLines.length, actualLines.length)
  for (let i = 0; i < lineCount; i += 1) {
    const expectedLine = expectedLines[i] ?? ''
    const actualLine = actualLines[i] ?? ''
    if (expectedLine === actualLine) continue
    differences.push(
      `${prefix}line ${i + 1}: expected ${quote(expectedLine)}, got ${quote(actualLine)}`,
    )
    if (differences.length >= MAX_DIFFERENCES) break
  }

  return { method, differences }
}

function diffBytes(prefix: string, expected: ArrayBuffer, actual: ArrayBuffer): DiffResult {
  const method = 'raw bytes'
  const differences: string[] = []
  const expectedBytes = new Uint8Array(expected)
  const actualBytes = new Uint8Array(actual)

  if (expectedBytes.length !== actualBytes.length) {
    differences.push(
      `${prefix}expected ${expectedBytes.length} bytes, got ${actualBytes.length}`,
    )
  }

  const limit = Math.min(expectedBytes.length, actualBytes.length)
  for (let i = 0; i < limit; i += 1) {
    if (expectedBytes[i] === actualBytes[i]) continue
    differences.push(`${prefix}first byte difference at offset ${i}`)
    break
  }

  return { method, differences }
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
  expected: ArrayBuffer,
  actual: ArrayBuffer,
  depth: number,
): Promise<DiffResult> {
  const method = 'ZIP entries'
  const differences: string[] = []
  const expectedEntries = await readZipEntries(expected)
  const actualEntries = await readZipEntries(actual)

  for (const name of expectedEntries.keys()) {
    if (!actualEntries.has(name)) differences.push(`${prefix}missing file ${quote(name)}`)
  }
  for (const name of actualEntries.keys()) {
    if (!expectedEntries.has(name)) {
      differences.push(`${prefix}unexpected extra file ${quote(name)}`)
    }
  }

  for (const [name, expectedBytes] of expectedEntries) {
    const actualBytes = actualEntries.get(name)
    if (!actualBytes) continue
    const nested = await diffFiles(
      `${prefix}${name}: `,
      { filename: name, bytes: expectedBytes },
      { filename: name, bytes: actualBytes },
      depth + 1,
    )
    differences.push(...nested.differences)
    if (differences.length >= MAX_DIFFERENCES) break
  }

  return { method, differences: differences.slice(0, MAX_DIFFERENCES) }
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
      return diffWorkbooks(prefix, expected.bytes, actual.bytes)
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
