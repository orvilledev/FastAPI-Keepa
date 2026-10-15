import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import {
  fbaShipmentLibraryApi,
  type FbaShipmentLine,
  type FbaShipmentUpload,
} from '../../services/api'

const PAGE_SIZE = 50
const LINE_PAGE_SIZE = 100

function errorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function externalId(value: string): string {
  return value.replace(/^UPC:\s*/i, '').trim()
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export default function FbaShipmentLibrary() {
  const [uploads, setUploads] = useState<FbaShipmentUpload[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [mine, setMine] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<FbaShipmentUpload | null>(null)
  const [lines, setLines] = useState<FbaShipmentLine[]>([])
  const [lineTotal, setLineTotal] = useState(0)
  const [lineOffset, setLineOffset] = useState(0)
  const [lineSearchInput, setLineSearchInput] = useState('')
  const [lineSearch, setLineSearch] = useState('')
  const [linesLoading, setLinesLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadUploads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fbaShipmentLibraryApi.list(PAGE_SIZE, offset, search, mine)
      setUploads(result.items)
      setTotal(result.total)
    } catch (err) {
      setError(errorMessage(err, 'Failed to load stored shipments.'))
    } finally {
      setLoading(false)
    }
  }, [mine, offset, refreshKey, search])

  useEffect(() => {
    void loadUploads()
  }, [loadUploads])

  const loadLines = useCallback(async () => {
    if (!selectedId) {
      setSelected(null)
      setLines([])
      setLineTotal(0)
      return
    }
    setLinesLoading(true)
    setError(null)
    try {
      const result = await fbaShipmentLibraryApi.get(
        selectedId,
        LINE_PAGE_SIZE,
        lineOffset,
        lineSearch,
      )
      setSelected(result.upload)
      setLines(result.lines)
      setLineTotal(result.total)
    } catch (err) {
      setError(errorMessage(err, 'Failed to open that shipment.'))
    } finally {
      setLinesLoading(false)
    }
  }, [lineOffset, lineSearch, selectedId])

  useEffect(() => {
    void loadLines()
  }, [loadLines])

  const acceptFile = (incoming: File | null | undefined) => {
    if (!incoming) return
    const name = incoming.name.toLowerCase()
    if (!name.endsWith('.tsv') && !name.endsWith('.txt') && !name.endsWith('.csv')) {
      setError('Upload the official FBA shipment file as .tsv.')
      setFile(null)
      return
    }
    setError(null)
    setFile(incoming)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    acceptFile(event.dataTransfer.files?.[0])
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await fbaShipmentLibraryApi.importFile(file)
      setNotice(
        `Stored ${result.upload.shipment_id} (${result.upload.line_count} SKUs, ${result.upload.total_shipped} units). Earlier uploads were left in place.`,
      )
      setFile(null)
      setOffset(0)
      setMine(false)
      setSearch('')
      setSearchInput('')
      setSelectedId(result.upload.id)
      setLineOffset(0)
      setLineSearch('')
      setLineSearchInput('')
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to store this shipment.'))
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (upload: FbaShipmentUpload) => {
    const ok = window.confirm(
      `Remove the ${upload.shipment_id} upload from ${upload.created_by_name || 'this user'}? Other uploads stay.`,
    )
    if (!ok) return
    setDeletingId(upload.id)
    setError(null)
    try {
      await fbaShipmentLibraryApi.remove(upload.id)
      if (selectedId === upload.id) setSelectedId(null)
      setNotice(`Removed ${upload.shipment_id}.`)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to remove that upload.'))
    } finally {
      setDeletingId(null)
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const linePage = Math.floor(lineOffset / LINE_PAGE_SIZE) + 1
  const linePageCount = Math.max(1, Math.ceil(lineTotal / LINE_PAGE_SIZE))

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">FBA Shipment Library</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          Upload the official FBA shipment <strong>.tsv</strong>. The tool stores the yellow fields only:{' '}
          <strong>Shipment ID</strong>, <strong>Merchant SKU</strong>, <strong>external-id</strong>, and{' '}
          <strong>Shipped</strong>. Each upload stays in the system. Everyone with access can see every upload,
          and a new upload does not remove one created by someone else.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Upload official template</h2>
        <div
          className={`mt-3 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'
          }`}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <p className="text-sm text-gray-600">
            Drag and drop the shipment <strong>.tsv</strong> here, or
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".tsv,.txt,.csv,text/tab-separated-values,text/plain"
            className="hidden"
            onChange={(event) => {
              acceptFile(event.target.files?.[0])
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
          <button
            type="button"
            className="mt-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </button>
          <p className="mt-2 truncate text-xs text-gray-600">
            {file ? (
              <>
                Selected: <strong>{file.name}</strong>
              </>
            ) : (
              'No file selected'
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={!file || uploading}
          onClick={() => void handleUpload()}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Storing…' : 'Store shipment'}
        </button>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Stored shipments</h2>
            <p className="text-xs text-gray-500">{total} upload{total === 1 ? '' : 's'} visible</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
              <button
                type="button"
                className={`rounded-md px-3 py-1 ${!mine ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600'}`}
                onClick={() => {
                  setMine(false)
                  setOffset(0)
                }}
              >
                All
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1 ${mine ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600'}`}
                onClick={() => {
                  setMine(true)
                  setOffset(0)
                }}
              >
                Mine
              </button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setOffset(0)
                setSearch(searchInput.trim())
              }}
            >
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Shipment, SKU, external-id, or name"
                className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Search
              </button>
            </form>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-2">Shipment ID</th>
                <th className="px-2 py-2">SKUs</th>
                <th className="px-2 py-2">Shipped</th>
                <th className="px-2 py-2">Uploaded by</th>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">File</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-gray-500">
                    Loading stored shipments…
                  </td>
                </tr>
              ) : uploads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-gray-500">
                    No shipments stored yet.
                  </td>
                </tr>
              ) : (
                uploads.map((upload) => (
                  <tr
                    key={upload.id}
                    className={`border-b border-gray-100 ${selectedId === upload.id ? 'bg-amber-50' : ''}`}
                  >
                    <td className="px-2 py-2 font-medium text-gray-900">{upload.shipment_id}</td>
                    <td className="px-2 py-2">{upload.line_count}</td>
                    <td className="px-2 py-2">{upload.total_shipped.toLocaleString()}</td>
                    <td className="px-2 py-2">{upload.created_by_name || upload.created_by_email || '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatWhen(upload.created_at)}</td>
                    <td className="max-w-[12rem] truncate px-2 py-2 text-gray-600" title={upload.source_filename}>
                      {upload.source_filename || '—'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
                        onClick={() => {
                          setSelectedId(upload.id)
                          setLineOffset(0)
                          setLineSearch('')
                          setLineSearchInput('')
                        }}
                      >
                        View
                      </button>
                      {upload.owned_by_me && (
                        <button
                          type="button"
                          disabled={deletingId === upload.id}
                          className="ml-3 text-sm font-medium text-red-700 hover:text-red-900 disabled:opacity-50"
                          onClick={() => void handleDelete(upload)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-end gap-3 text-sm text-gray-600">
            <button
              type="button"
              disabled={offset === 0}
              className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        )}
      </section>

      {selected && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{selected.shipment_id}</h2>
              <p className="text-xs text-gray-500">
                {selected.created_by_name || selected.created_by_email || 'Unknown'} ·{' '}
                {formatWhen(selected.created_at)} · {lineTotal} matching row{lineTotal === 1 ? '' : 's'}
              </p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setLineOffset(0)
                setLineSearch(lineSearchInput.trim())
              }}
            >
              <input
                value={lineSearchInput}
                onChange={(event) => setLineSearchInput(event.target.value)}
                placeholder="Merchant SKU or external-id"
                className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Filter
              </button>
            </form>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="bg-amber-100 px-2 py-2">Merchant SKU</th>
                  <th className="bg-amber-100 px-2 py-2">external-id</th>
                  <th className="bg-amber-100 px-2 py-2">Shipped</th>
                </tr>
              </thead>
              <tbody>
                {linesLoading ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-6 text-gray-500">
                      Loading lines…
                    </td>
                  </tr>
                ) : lines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-6 text-gray-500">
                      No matching lines.
                    </td>
                  </tr>
                ) : (
                  lines.map((line) => (
                    <tr key={line.id} className="border-b border-gray-100">
                      <td className="px-2 py-2 font-medium text-gray-900">{line.merchant_sku}</td>
                      <td className="px-2 py-2">{externalId(line.external_id) || '—'}</td>
                      <td className="px-2 py-2">{line.shipped}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {lineTotal > LINE_PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-end gap-3 text-sm text-gray-600">
              <button
                type="button"
                disabled={lineOffset === 0}
                className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
                onClick={() => setLineOffset(Math.max(0, lineOffset - LINE_PAGE_SIZE))}
              >
                Previous
              </button>
              <span>
                {linePage} / {linePageCount}
              </span>
              <button
                type="button"
                disabled={lineOffset + LINE_PAGE_SIZE >= lineTotal}
                className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
                onClick={() => setLineOffset(lineOffset + LINE_PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
