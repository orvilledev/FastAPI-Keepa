import { useCallback, useEffect, useRef, useState } from 'react'
import { catalogDimsApi, catalogUpcApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import type { CatalogImportResult } from '../../types'

const PAGE_SIZE = 50
const ACCEPTED = '.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type CatalogKind = 'upc' | 'dims'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function cellValue(rowData: Record<string, string> | undefined, column: string): string {
  if (!rowData) return ''
  const value = rowData[column]
  return value == null || value === '' ? '' : String(value)
}

type CatalogRecordsPageProps = {
  kind: CatalogKind
}

export default function CatalogRecordsPage({ kind }: CatalogRecordsPageProps) {
  const { isSuperadmin, userInfoLoading } = useUser()
  const isUpc = kind === 'upc'
  const title = isUpc ? 'UPC' : 'DIMS'
  const sheetHint = isUpc
    ? 'Upload the workbook with a UPC sheet (same columns as UPC DIMS.xlsx). Import replaces all UPC records.'
    : 'Upload the workbook with a DIMS sheet (same columns as UPC DIMS.xlsx). Import replaces all DIMS records.'
  const searchPlaceholder = isUpc
    ? 'Search UPC, S/C/S, vendor, style…'
    : 'Search UPC, SKU, brand, description…'
  const templateName = isUpc ? 'UPC_Template.xlsx' : 'DIMS_Template.xlsx'

  const [columns, setColumns] = useState<string[]>([])
  const [items, setItems] = useState<Record<string, string>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadRequestId = useRef(0)

  const loadRecords = useCallback(async () => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setError(null)
    try {
      const response = isUpc
        ? await catalogUpcApi.list(PAGE_SIZE, page * PAGE_SIZE, search || undefined)
        : await catalogDimsApi.list(PAGE_SIZE, page * PAGE_SIZE, search || undefined)
      if (requestId !== loadRequestId.current) return
      setColumns(response.columns)
      setItems(response.items.map((row) => row.row_data || {}))
      setTotal(response.total)
    } catch (err: unknown) {
      if (requestId !== loadRequestId.current) return
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : `Failed to load ${title} records`)
      setItems([])
      setTotal(0)
    } finally {
      if (requestId === loadRequestId.current) {
        setLoading(false)
      }
    }
  }, [isUpc, page, search, title])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (userInfoLoading || !isSuperadmin) return
    void loadRecords()
  }, [userInfoLoading, isSuperadmin, loadRecords, refreshToken])

  const handleDownloadTemplate = async () => {
    setError(null)
    try {
      const blob = isUpc
        ? await catalogUpcApi.downloadTemplate()
        : await catalogDimsApi.downloadTemplate()
      downloadBlob(blob, templateName)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to download template')
    }
  }

  const handleImport = async (file: File) => {
    setImporting(true)
    setError(null)
    setMessage(null)
    try {
      const result: CatalogImportResult = isUpc
        ? await catalogUpcApi.importFile(file)
        : await catalogDimsApi.importFile(file)
      setMessage(
        `Imported ${result.imported.toLocaleString()} rows` +
          (result.invalid ? ` (${result.invalid.toLocaleString()} skipped)` : '') +
          '. Previous records were replaced.'
      )
      setPage(0)
      setSearch('')
      setSearchInput('')
      setRefreshToken((n) => n + 1)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading…</div>
      </div>
    )
  }

  if (!isSuperadmin) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">Only superadmin can access this page.</p>
        </div>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const colCount = Math.max(columns.length, 1)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{title}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-content-muted">{sheetHint}</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-surface">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
          }}
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-border dark:bg-surface-muted dark:text-slate-100"
          >
            Download template
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importing ? 'Importing…' : `Upload ${title} file`}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Template columns match the {title} tab from UPC DIMS.xlsx. You can upload that full workbook;
          only the {title} sheet is imported.
        </p>
      </section>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-border dark:bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100">
              {title} records
            </h2>
            <p className="text-xs text-gray-500">
              {total.toLocaleString()} total
              {columns.length > 0 ? ` · ${columns.length} columns` : ''}
            </p>
          </div>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#404040] focus:ring-1 focus:ring-[#404040] sm:w-80 dark:border-border dark:bg-surface-muted"
          />
        </div>

        <div className="app-table-scroll overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-white text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                {columns.map((col) => (
                  <th key={col} className="px-3 py-3 whitespace-nowrap">
                    {col}
                  </th>
                ))}
                {columns.length === 0 && (
                  <th className="px-3 py-3 whitespace-nowrap">Columns</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-gray-500">
                    Loading {title} records…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-gray-500">
                    {search
                      ? 'No rows match your search.'
                      : `No ${title} records yet. Upload the spreadsheet to populate this list.`}
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => (
                  <tr key={`${page}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-surface-muted">
                    {columns.map((col) => (
                      <td key={col} className="px-3 py-2 whitespace-nowrap text-gray-800 dark:text-slate-200">
                        {cellValue(row, col) || '—'}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm">
            <button
              type="button"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
