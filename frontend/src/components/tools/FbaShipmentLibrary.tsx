import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
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

function statusClass(status: string): string {
  if (status === 'All Accounted') return 'bg-emerald-600 text-white'
  if (status === 'Overage') return 'bg-orange-600 text-white'
  if (status === 'Not in the list') return 'bg-red-600 text-white'
  return 'bg-amber-500 text-white'
}

function rowClass(line: FbaShipmentLine): string {
  if (line.not_in_list || line.status === 'Not in the list') return 'border-b border-red-200 bg-red-100 text-red-950'
  if (line.status === 'All Accounted') return 'border-b border-emerald-200 bg-emerald-100 text-emerald-950'
  if (line.status === 'Overage') return 'border-b border-orange-200 bg-orange-100 text-orange-950'
  return 'border-b border-amber-200 bg-amber-50 text-amber-950'
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
  const [listView, setListView] = useState<'active' | 'archive' | 'trash'>('active')
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
  const [unknownLines, setUnknownLines] = useState<FbaShipmentLine[]>([])
  const [scanAlert, setScanAlert] = useState<string | null>(null)
  const [lineTotal, setLineTotal] = useState(0)
  const [lineOffset, setLineOffset] = useState(0)
  const [lineSearchInput, setLineSearchInput] = useState('')
  const [lineSearch, setLineSearch] = useState('')
  const [linesLoading, setLinesLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<
    { mode: 'trash' | 'purge'; upload: FbaShipmentUpload } | { mode: 'empty' } | null
  >(null)
  const [barcode, setBarcode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [activeLineId, setActiveLineId] = useState<string | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadUploads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fbaShipmentLibraryApi.list(PAGE_SIZE, offset, search, mine, listView)
      setUploads(result.items)
      setTotal(result.total)
    } catch (err) {
      setError(errorMessage(err, 'Failed to load stored shipments.'))
    } finally {
      setLoading(false)
    }
  }, [listView, mine, offset, refreshKey, search])

  useEffect(() => {
    void loadUploads()
  }, [loadUploads])

  const loadLines = useCallback(async () => {
    if (!selectedId) {
      setSelected(null)
      setLines([])
      setUnknownLines([])
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
      setUnknownLines(result.unknown_lines || [])
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

  useEffect(() => {
    setScanAlert(null)
    if (selectedId) scanRef.current?.focus()
  }, [selectedId])

  const handleScan = async (event: FormEvent) => {
    event.preventDefault()
    const code = barcode.trim()
    if (!selectedId || !code || scanning) return
    setScanning(true)
    setError(null)
    try {
      const result = await fbaShipmentLibraryApi.scan(selectedId, code)
      setActiveLineId(result.line.id)
      setBarcode('')
      if (result.line.not_in_list) {
        setNotice(null)
        setScanAlert(`${result.barcode} is not in the list.`)
        setUnknownLines((current) => [
          result.line,
          ...current.filter(
            (line) => line.id !== result.line.id && externalId(line.external_id) !== result.barcode,
          ),
        ])
      } else {
        setScanAlert(null)
        setLines((current) =>
          current.map((line) => (line.id === result.line.id ? result.line : line)),
        )
        setNotice(
          `${result.barcode}: counted ${result.line.counted} of ${result.line.shipped}. Missing ${result.line.missing}. ${result.line.status}.`,
        )
      }
      setSelected((current) =>
        current ? { ...current, fully_accounted: result.fully_accounted } : current,
      )
      window.setTimeout(() => {
        document.getElementById(`fba-line-${result.line.id}`)?.scrollIntoView({ block: 'nearest' })
      }, 0)
    } catch (err) {
      setError(errorMessage(err, 'That scan was not counted.'))
    } finally {
      setScanning(false)
      scanRef.current?.focus()
    }
  }

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

  const handleDelete = (upload: FbaShipmentUpload) => {
    setPendingRemove({ mode: upload.trashed_at ? 'purge' : 'trash', upload })
  }

  const confirmDelete = async () => {
    const pending = pendingRemove
    if (!pending) return
    setError(null)
    const busyId = pending.mode === 'empty' ? 'empty' : pending.upload.id
    setDeletingId(busyId)
    try {
      if (pending.mode === 'empty') {
        const result = await fbaShipmentLibraryApi.emptyTrash(mine)
        setNotice(result.deleted === 0 ? 'Trash is already empty.' : 'Trash is empty. Those shipments are gone.')
        setSelectedId(null)
      } else if (pending.mode === 'purge') {
        await fbaShipmentLibraryApi.purge(pending.upload.id)
        if (selectedId === pending.upload.id) setSelectedId(null)
        setNotice(`Permanently removed ${pending.upload.shipment_id}.`)
      } else {
        await fbaShipmentLibraryApi.remove(pending.upload.id)
        if (selectedId === pending.upload.id) setSelectedId(null)
        setNotice(`${pending.upload.shipment_id} is in Trash.`)
      }
      setPendingRemove(null)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to update Trash.'))
    } finally {
      setDeletingId(null)
    }
  }

  const handleRestore = async (upload: FbaShipmentUpload) => {
    setError(null)
    try {
      await fbaShipmentLibraryApi.restore(upload.id)
      if (selectedId === upload.id) setSelectedId(null)
      setNotice(
        upload.archived_at
          ? `${upload.shipment_id} is back in the completed archive.`
          : `${upload.shipment_id} is back in the active list.`,
      )
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to restore that shipment.'))
    }
  }

  const handleAccess = async (upload: FbaShipmentUpload, locked: boolean) => {
    setError(null)
    try {
      const saved = await fbaShipmentLibraryApi.setAccess(upload.id, locked)
      setUploads((current) => current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)))
      setSelected((current) =>
        current?.id === saved.id ? { ...current, ...saved, fully_accounted: current.fully_accounted } : current,
      )
      setNotice(
        locked
          ? `${saved.shipment_id} is locked. Only you can open it.`
          : `${saved.shipment_id} is shared. Other workers can open it and count on their own.`,
      )
      if (locked && !saved.owned_by_me) setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to change who can open this shipment.'))
    }
  }

  const handleArchive = async (upload: FbaShipmentUpload) => {
    const ok = window.confirm(
      `Archive ${upload.shipment_id}? It will leave the active list and stay in Completed shipments.`,
    )
    if (!ok) return
    setError(null)
    try {
      await fbaShipmentLibraryApi.archive(upload.id)
      setNotice(`${upload.shipment_id} is in the completed archive.`)
      if (selectedId === upload.id) setSelectedId(null)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to archive this shipment.'))
    }
  }

  const handleReport = async (upload: FbaShipmentUpload) => {
    setError(null)
    try {
      const result = await fbaShipmentLibraryApi.downloadReport(upload.id)
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      const data = (err as { response?: { data?: unknown } })?.response?.data
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text()) as { detail?: string }
          setError(parsed.detail || 'Failed to download the accounting report.')
          return
        } catch {
          /* fall through */
        }
      }
      setError(errorMessage(err, 'Failed to download the accounting report.'))
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const linePage = Math.floor(lineOffset / LINE_PAGE_SIZE) + 1
  const linePageCount = Math.max(1, Math.ceil(lineTotal / LINE_PAGE_SIZE))

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">FBA Order Checker</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          Upload the official FBA shipment <strong>.tsv</strong>. The tool stores the yellow fields only:{' '}
          <strong>Shipment ID</strong>, <strong>Merchant SKU</strong>, <strong>external-id</strong>, and{' '}
          <strong>Shipped</strong>. The owner can lock a shipment or share it when other workers need to count it.
          Each person keeps their own counts. Download report is on each shipment. Archive moves it into
          Completed shipments once every line is All Accounted. Remove sends a shipment to Trash, where it
          stays until it is removed for good or Trash is emptied.
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
            <h2 className="text-sm font-semibold text-gray-900">
              {listView === 'trash' ? 'Trash' : listView === 'archive' ? 'Completed shipments' : 'Stored shipments'}
            </h2>
            <p className="text-xs text-gray-500">{total} upload{total === 1 ? '' : 's'} visible</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {listView === 'trash' && (
              <button
                type="button"
                disabled={total === 0 || deletingId === 'empty'}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-40"
                onClick={() => setPendingRemove({ mode: 'empty' })}
              >
                Empty trash
              </button>
            )}
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
              <button
                type="button"
                className={`rounded-md px-3 py-1 ${listView === 'active' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600'}`}
                onClick={() => {
                  setListView('active')
                  setOffset(0)
                  setSelectedId(null)
                }}
              >
                Active
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1 ${listView === 'archive' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600'}`}
                onClick={() => {
                  setListView('archive')
                  setOffset(0)
                  setSelectedId(null)
                }}
              >
                Archive
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1 ${listView === 'trash' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600'}`}
                onClick={() => {
                  setListView('trash')
                  setOffset(0)
                  setSelectedId(null)
                }}
              >
                Trash
              </button>
            </div>
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
                <th className="px-2 py-2">Access</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-gray-500">
                    Loading stored shipments…
                  </td>
                </tr>
              ) : uploads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-gray-500">
                    {listView === 'trash'
                      ? 'Trash is empty.'
                      : listView === 'archive'
                        ? 'No completed shipments yet.'
                        : 'No shipments stored yet.'}
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
                    <td className="px-2 py-2">
                      {upload.trashed_at ? (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                          Trash
                        </span>
                      ) : upload.archived_at ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          Archived
                        </span>
                      ) : upload.is_locked ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          Locked
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Shared
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      {listView !== 'trash' && (
                        <button
                          type="button"
                          className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
                          onClick={() => void handleReport(upload)}
                        >
                          Download
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${listView === 'trash' ? '' : 'ml-3 '}text-sm font-medium text-indigo-700 hover:text-indigo-900`}
                        onClick={() => {
                          setSelectedId(upload.id)
                          setLineOffset(0)
                          setLineSearch('')
                          setLineSearchInput('')
                        }}
                      >
                        View
                      </button>
                      {listView === 'trash' && upload.owned_by_me && (
                        <button
                          type="button"
                          className="ml-3 text-sm font-medium text-gray-800 hover:text-gray-950"
                          onClick={() => void handleRestore(upload)}
                        >
                          Restore
                        </button>
                      )}
                      {upload.owned_by_me && !upload.archived_at && listView !== 'trash' && (
                        <button
                          type="button"
                          className="ml-3 text-sm font-medium text-gray-800 hover:text-gray-950"
                          onClick={() => void handleAccess(upload, !upload.is_locked)}
                        >
                          {upload.is_locked ? 'Share' : 'Lock'}
                        </button>
                      )}
                      {upload.owned_by_me && (
                        <button
                          type="button"
                          disabled={deletingId === upload.id}
                          className="ml-10 border-l border-gray-200 pl-4 text-sm font-medium text-red-700 hover:text-red-900 disabled:opacity-50"
                          onClick={() => void handleDelete(upload)}
                        >
                          {listView === 'trash' ? 'Delete' : 'Remove'}
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
                {selected.is_locked ? ' · Locked' : ' · Shared'}
                {selected.archived_at ? ' · Archived' : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
                onClick={() => void handleReport(selected)}
              >
                Download report
              </button>
              {selected.owned_by_me && selected.fully_accounted && !selected.archived_at && !selected.trashed_at && (
                <button
                  type="button"
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                  onClick={() => void handleArchive(selected)}
                >
                  Archive
                </button>
              )}
            </div>
          </div>
          {selected.trashed_at && (
            <p className="mt-2 text-xs text-gray-500">This shipment is in Trash. Restore it to count again.</p>
          )}
          {!selected.fully_accounted && !selected.archived_at && !selected.trashed_at && (
            <p className="mt-2 text-xs text-gray-500">
              Archive is available when every line is All Accounted. Download report works with the count so far.
            </p>
          )}
          {selected.archived_at && !selected.trashed_at && (
            <p className="mt-2 text-xs text-gray-500">This shipment is in the completed archive.</p>
          )}
          <div className="mt-3 flex flex-wrap items-end justify-end">
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
          {!selected.archived_at && !selected.trashed_at && (
          <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => void handleScan(event)}>
            <input
              ref={scanRef}
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="Scan external-id / UPC"
              autoComplete="off"
              className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!barcode.trim() || scanning}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scanning ? 'Counting…' : 'Count 1'}
            </button>
            <p className="text-xs text-gray-500">
              One scan counts as 1. Shipped stays the file quantity. Your counts stay on this shipment and do not
              change anyone else’s.
            </p>
          </form>
          )}
          {scanAlert && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {scanAlert}
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="bg-amber-100 px-2 py-2">Merchant SKU</th>
                  <th className="bg-amber-100 px-2 py-2">external-id</th>
                  <th className="bg-amber-100 px-2 py-2">Shipped</th>
                  <th className="bg-amber-100 px-2 py-2">Counted</th>
                  <th className="bg-amber-100 px-2 py-2">Missing</th>
                  <th className="bg-amber-100 px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {linesLoading ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-gray-500">
                      Loading lines…
                    </td>
                  </tr>
                ) : lines.length === 0 && unknownLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-gray-500">
                      No matching lines.
                    </td>
                  </tr>
                ) : (
                  [...unknownLines, ...lines].map((line) => (
                    <tr
                      key={line.id}
                      id={`fba-line-${line.id}`}
                      className={`${rowClass(line)} ${activeLineId === line.id ? 'outline outline-2 outline-offset-[-2px] outline-gray-700' : ''}`}
                    >
                      <td className="px-2 py-2 font-medium">{line.merchant_sku || '—'}</td>
                      <td className="px-2 py-2">{externalId(line.external_id) || '—'}</td>
                      <td className="px-2 py-2">{line.not_in_list ? '—' : line.shipped}</td>
                      <td className="px-2 py-2">{line.counted ?? 0}</td>
                      <td className="px-2 py-2">
                        {line.not_in_list ? '—' : (line.missing ?? Math.max(0, line.shipped - (line.counted ?? 0)))}
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(line.status || 'Missing Items')}`}>
                          {line.status || 'Missing Items'}
                        </span>
                      </td>
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
      {pendingRemove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!deletingId) setPendingRemove(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-shipment-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="remove-shipment-title" className="text-lg font-semibold text-gray-900">
              {pendingRemove.mode === 'empty'
                ? 'Empty Trash?'
                : pendingRemove.mode === 'purge'
                  ? 'Remove this shipment for good?'
                  : 'Remove this shipment?'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {pendingRemove.mode === 'empty'
                ? 'Are you sure you want to empty Trash? Every shipment in Trash will be permanently removed.'
                : pendingRemove.mode === 'purge'
                  ? `Are you sure you want to permanently remove shipment ${pendingRemove.upload.shipment_id}? This cannot be undone.`
                  : `Are you sure you want to remove shipment ${pendingRemove.upload.shipment_id}? It will move to Trash and stay there until you delete it or empty Trash.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(deletingId)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                onClick={() => setPendingRemove(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(deletingId)}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                onClick={() => void confirmDelete()}
              >
                {deletingId
                  ? 'Removing…'
                  : pendingRemove.mode === 'empty'
                    ? 'Empty trash'
                    : pendingRemove.mode === 'purge'
                      ? 'Delete'
                      : 'Move to Trash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
