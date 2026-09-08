import { useCallback, useEffect, useRef, useState } from 'react'
import { catalogShipToApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import type { CatalogShipToImportPreview, CatalogShipToRecord } from '../../types'

const PAGE_SIZE = 50
const ACCEPTED = '.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const TEMPLATE_NAME = 'Ship_To_Address_Template.xlsx'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function cellValue(rowData: Record<string, string> | undefined, column: string): string {
  if (!rowData) return ''
  const value = rowData[column]
  return value == null || value === '' ? '' : String(value)
}

function buildImportConfirmMessage(preview: CatalogShipToImportPreview): string {
  const parts = [
    `This upload has ${preview.valid_rows.toLocaleString()} valid row(s).`,
    `${preview.new_count.toLocaleString()} new code(s) will be added.`,
  ]
  if (preview.replace_count > 0) {
    const shown = preview.replace_codes.slice(0, 12)
    const sample = shown.join(', ')
    const remaining = preview.replace_count - shown.length
    const more = remaining > 0 ? ` (+${remaining.toLocaleString()} more)` : ''
    parts.push(
      `${preview.replace_count.toLocaleString()} existing code(s) will be replaced${sample ? `: ${sample}${more}` : ''}.`,
    )
  }
  if (preview.invalid > 0) {
    parts.push(`${preview.invalid.toLocaleString()} row(s) will be skipped.`)
  }
  parts.push('Continue?')
  return parts.join('\n\n')
}

function buildImportSuccessMessage(
  imported: number,
  inserted: number,
  replaced: number,
  invalid: number,
): string {
  let message = `Imported ${imported.toLocaleString()} row(s)`
  if (inserted > 0 || replaced > 0) {
    message += ` (${inserted.toLocaleString()} new`
    if (replaced > 0) {
      message += `, ${replaced.toLocaleString()} replaced`
    }
    message += ')'
  }
  if (invalid > 0) {
    message += ` · ${invalid.toLocaleString()} skipped`
  }
  return `${message}.`
}

export default function ShipToAddressesPage() {
  const { hasKeepaAccess, userInfoLoading } = useUser()
  const [columns, setColumns] = useState<string[]>([])
  const [items, setItems] = useState<CatalogShipToRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [deletingCode, setDeletingCode] = useState<string | null>(null)
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
      const response = await catalogShipToApi.list(PAGE_SIZE, page * PAGE_SIZE, search || undefined)
      if (requestId !== loadRequestId.current) return
      setColumns(response.columns)
      setItems(response.items)
      setTotal(response.total)
    } catch (err: unknown) {
      if (requestId !== loadRequestId.current) return
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to load ship-to addresses')
      setItems([])
      setTotal(0)
    } finally {
      if (requestId === loadRequestId.current) {
        setLoading(false)
      }
    }
  }, [page, search])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (userInfoLoading || !hasKeepaAccess) return
    void loadRecords()
  }, [userInfoLoading, hasKeepaAccess, loadRecords, refreshToken])

  const handleDownloadTemplate = async () => {
    setError(null)
    try {
      const blob = await catalogShipToApi.downloadTemplate()
      downloadBlob(blob, TEMPLATE_NAME)
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
      const preview = await catalogShipToApi.previewImport(file)
      if (preview.replace_count > 0) {
        const confirmed = window.confirm(buildImportConfirmMessage(preview))
        if (!confirmed) return
      }
      const result = await catalogShipToApi.importFile(file)
      setMessage(
        buildImportSuccessMessage(
          result.imported,
          result.inserted,
          result.replaced,
          result.invalid,
        ),
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

  const handleDelete = async (code: string) => {
    const normalized = code.trim()
    if (!normalized) return
    const confirmed = window.confirm(
      `Delete ship-to code "${normalized}"? This cannot be undone.`,
    )
    if (!confirmed) return

    setDeletingCode(normalized)
    setError(null)
    setMessage(null)
    try {
      await catalogShipToApi.delete(normalized)
      setMessage(`Deleted ship-to code ${normalized}.`)
      setRefreshToken((n) => n + 1)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Delete failed')
    } finally {
      setDeletingCode(null)
    }
  }

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading…</div>
      </div>
    )
  }

  if (!hasKeepaAccess) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">MSW Overwatch access is required for this page.</p>
        </div>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const colCount = Math.max(columns.length, 1) + 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Ship To Address Catalog</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-content-muted">
          Amazon FC ship-to codes and addresses. Upload a matching workbook to add new codes or
          replace existing ones. Existing codes in the file are confirmed before they are replaced.
        </p>
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
            {importing ? 'Importing…' : 'Upload address file'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          The template is the original Excel layout: sheet SHIP TO, all six columns, header row, and
          the first address row only. Full Address stays a formula of Address 1, City, State, and
          Postal Code.
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
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Addresses</h2>
            <p className="text-xs text-gray-500">
              {total.toLocaleString()} total
              {columns.length > 0 ? ` · ${columns.length} columns` : ''}
            </p>
          </div>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code, city, state, postal code…"
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
                <th className="px-3 py-3 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-gray-500">
                    Loading ship-to addresses…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-gray-500">
                    {search
                      ? 'No rows match your search.'
                      : 'No addresses yet. Upload the ship-to spreadsheet to populate this list.'}
                  </td>
                </tr>
              ) : (
                items.map((row) => {
                  const rowData = row.row_data || {}
                  const code = row.code || cellValue(rowData, 'Code')
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-surface-muted">
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-2 whitespace-nowrap text-gray-800 dark:text-slate-200">
                          {cellValue(rowData, col) || '—'}
                        </td>
                      ))}
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <button
                          type="button"
                          disabled={!code || deletingCode === code}
                          onClick={() => void handleDelete(code)}
                          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/30"
                        >
                          {deletingCode === code ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  )
                })
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
