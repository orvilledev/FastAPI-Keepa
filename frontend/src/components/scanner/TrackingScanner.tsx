import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  exportRowsToExcelBlob,
  scanFilesInBrowser,
  type TrackingScanProgress,
  type TrackingScannerRow,
  type TrackingScannerAggregateResponse,
} from '../../utils/trackingExtractor'
import { trackingScannerApi } from '../../services/api'
import type { TrackingHistorySummary } from '../../types'

type Stats = {
  sources: number
  files: number
  pairs: number
  matched: number
  needsReview: number
}

const ACCEPTED = '.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function suggestedExcelFilename(): string {
  return `tracking_extract_${new Date().toISOString().slice(0, 10)}.xlsx`
}

export default function TrackingScanner() {
  const [files, setFiles] = useState<File[]>([])
  const [rows, setRows] = useState<TrackingScannerRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [scanning, setScanning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [scanProgress, setScanProgress] = useState<TrackingScanProgress | null>(null)
  const [history, setHistory] = useState<TrackingHistorySummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const rows = await trackingScannerApi.listHistory()
      setHistory(rows)
    } catch {
      setError('Could not load tracking history.')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleFileSelected = useCallback((picked: File[]) => {
    setFiles(picked)
    setRows([])
    setStats(null)
    setScanProgress(null)
    setError(null)
    setSuccess(null)
  }, [])

  const handleScan = useCallback(async () => {
    if (files.length === 0) return
    setScanning(true)
    setScanProgress({ completed: 0, total: files.length, percent: 0, current_file: '' })
    setError(null)
    setSuccess(null)
    try {
      const result: TrackingScannerAggregateResponse = await scanFilesInBrowser(files, (progress) => {
        setScanProgress(progress)
      })
      setRows(result.rows)
      setStats({
        sources: result.source_count,
        files: result.file_count,
        pairs: result.pair_count,
        matched: result.matched_count,
        needsReview: result.needs_review_count,
      })
      try {
        const saved = await trackingScannerApi.saveHistory({
          name: `Scan ${new Date().toLocaleString()}`,
          source_count: result.source_count,
          file_count: result.file_count,
          pair_count: result.pair_count,
          matched_count: result.matched_count,
          needs_review_count: result.needs_review_count,
          rows: result.rows,
        })
        setHistory((prev) => [saved, ...prev])
      } catch {
        // Non-blocking: scan results are still available in-memory even if save fails.
      }
      if (result.matched_count === 0) {
        setSuccess(
          `Scanned ${result.file_count} PDF(s) from ${result.source_count} upload(s), with ${result.pair_count} page pair(s). No complete matches were found. Review and edit rows below before exporting.`
        )
      } else {
        setSuccess(
          `Scanned ${result.file_count} PDF(s) from ${result.source_count} upload(s): ${result.pair_count} pair(s), ${result.matched_count} matched, ${result.needs_review_count} need review.`
        )
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to scan files.'
      setError(typeof detail === 'string' ? detail : 'Failed to scan files.')
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }, [files])

  const handleLoadHistory = useCallback(async (id: string) => {
    setHistoryBusyId(id)
    setError(null)
    setSuccess(null)
    try {
      const record = await trackingScannerApi.getHistory(id)
      setRows(record.rows)
      setStats({
        sources: record.source_count,
        files: record.file_count,
        pairs: record.pair_count,
        matched: record.matched_count,
        needsReview: record.needs_review_count,
      })
      setSuccess(`Loaded ${record.row_count} row(s) from history.`)
    } catch {
      setError('Could not load selected history record.')
    } finally {
      setHistoryBusyId(null)
    }
  }, [])

  const handleDeleteHistory = useCallback(async (id: string) => {
    if (!window.confirm('Delete this history record?')) return
    setHistoryBusyId(id)
    setError(null)
    try {
      await trackingScannerApi.deleteHistory(id)
      setHistory((prev) => prev.filter((item) => item.id !== id))
    } catch {
      setError('Could not delete selected history record.')
    } finally {
      setHistoryBusyId(null)
    }
  }, [])

  const handleDownloadExcel = useCallback(async () => {
    if (rows.length === 0) return
    setExporting(true)
    setError(null)
    try {
      const blob = exportRowsToExcelBlob(rows)
      const filename = suggestedExcelFilename()
      downloadBlob(blob, filename)
      setSuccess(`Exported ${rows.length} row(s) to ${filename}.`)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to export Excel file.'
      setError(typeof detail === 'string' ? detail : 'Failed to export Excel file.')
    } finally {
      setExporting(false)
    }
  }, [rows])

  const updateRow = useCallback(
    (index: number, key: keyof TrackingScannerRow, value: string) => {
      setRows((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [key]: value }
        return next
      })
    },
    []
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)
      if (!event.dataTransfer?.files?.length) return
      const dropped = Array.from(event.dataTransfer.files)
      const hasInvalid = dropped.some((f) => !/(\.pdf|\.zip)$/i.test(f.name))
      if (hasInvalid) {
        setError('Only PDF and ZIP files are supported.')
        return
      }
      handleFileSelected(dropped)
    },
    [handleFileSelected]
  )

  const summary = useMemo(() => {
    if (!stats) return null
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <SummaryCard label="PDF files" value={stats.files} />
        <SummaryCard label="Matched" value={stats.matched} accent="green" />
        <SummaryCard label="Needs review" value={stats.needsReview} accent="amber" />
      </div>
    )
  }, [stats])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Tracking Extractor</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload one or more shipping-label PDFs, or ZIPs containing PDFs. Odd pages are read for the FBA{' '}
          <strong>shipment ID</strong>; even pages are OCR-scanned for the UPS{' '}
          <strong>tracking number</strong>. Each pair becomes one row in one Excel export.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {success}
        </div>
      )}

      <section
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(false)
        }}
        onDrop={handleDrop}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="mt-3 text-sm text-gray-600">
          Drag and drop PDF/ZIP files here, or
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 inline-flex items-center px-4 py-2 rounded-md bg-[#404040] text-white text-sm font-medium hover:bg-black"
        >
          Choose files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => handleFileSelected(Array.from(e.target.files ?? []))}
        />
        {files.length > 0 && (
          <div className="mt-3 text-xs text-gray-500 space-y-1">
            <p>
              Selected files: <span className="font-medium text-gray-700">{files.length}</span>
            </p>
            <p className="text-gray-500">
              {files.slice(0, 3).map((f) => f.name).join(', ')}
              {files.length > 3 ? ` +${files.length - 3} more` : ''}
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={files.length === 0 || scanning}
            onClick={handleScan}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan files'}
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              disabled={exporting}
              onClick={handleDownloadExcel}
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {exporting ? 'Preparing Excel…' : 'Download Excel'}
            </button>
          )}
        </div>
        {scanning && scanProgress && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <BatteryProgress percent={scanProgress.percent} />
            <p className="text-xs text-gray-600">
              {scanProgress.percent}% ({scanProgress.completed}/{scanProgress.total})
            </p>
            <p className="text-[11px] text-gray-500 max-w-md truncate">
              {scanProgress.current_file ? `Processing: ${scanProgress.current_file}` : 'Preparing files...'}
            </p>
          </div>
        )}
        {summary}
      </section>

      {rows.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Extracted rows ({rows.length})
            </h2>
            <p className="text-xs text-gray-500">
              You can edit any cell before exporting to Excel.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  <Th>Pages</Th>
                  <Th>Vendor</Th>
                  <Th>Shipment ID</Th>
                  <Th>Box Code</Th>
                  <Th>Carrier</Th>
                  <Th>Tracking #</Th>
                  <Th>Status</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, idx) => {
                  const isReview = row.status === 'needs_review'
                  return (
                    <tr key={idx} className={isReview ? 'bg-amber-50/60' : ''}>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {row.odd_page ?? '—'} / {row.even_page ?? '—'}
                      </td>
                      <Td>
                        <Cell
                          value={row.vendor}
                          onChange={(v) => updateRow(idx, 'vendor', v)}
                        />
                      </Td>
                      <Td>
                        <Cell
                          value={row.shipment_id}
                          onChange={(v) => updateRow(idx, 'shipment_id', v)}
                          mono
                        />
                      </Td>
                      <Td>
                        <Cell
                          value={row.box_code}
                          onChange={(v) => updateRow(idx, 'box_code', v)}
                          mono
                        />
                      </Td>
                      <Td>
                        <Cell
                          value={row.carrier}
                          onChange={(v) => updateRow(idx, 'carrier', v)}
                        />
                      </Td>
                      <Td>
                        <Cell
                          value={row.tracking_number}
                          onChange={(v) => updateRow(idx, 'tracking_number', v.toUpperCase())}
                          mono
                          placeholder="1Z..."
                        />
                      </Td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            isReview
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {isReview ? 'Needs review' : 'OK'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 max-w-xs">
                        {row.notes || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Scan history</h2>
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            Refresh
          </button>
        </div>
        <div className="p-4">
          {historyLoading ? (
            <p className="text-xs text-gray-500">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-gray-500">No history yet. Run a scan to save one.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-auto">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-gray-200 p-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">
                      {item.name || 'Scan history'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString()} • {item.row_count} rows •{' '}
                      {item.file_count} PDFs
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={historyBusyId === item.id}
                      onClick={() => void handleLoadHistory(item.id)}
                      className="px-2 py-1 text-xs rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      disabled={historyBusyId === item.id}
                      onClick={() => void handleDeleteHistory(item.id)}
                      className="px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
        <p className="font-semibold text-gray-700 mb-1">How it works</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Pages 1, 3, 5, … (odd): text extraction reads the FBA shipment ID and box code.</li>
          <li>Pages 2, 4, 6, … (even): each page is rendered and OCR’d to read the UPS Tracking # (1Z…).</li>
          <li>Supports multiple PDF uploads and ZIP files containing PDFs in one scan.</li>
          <li>Each odd–even pair becomes one row. Missing values are flagged as <em>Needs review</em>.</li>
          <li>OCR runs fully in your browser using Tesseract.js (no backend OCR server required).</li>
        </ul>
      </section>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: 'green' | 'amber'
}) {
  const color =
    accent === 'green'
      ? 'text-green-700 bg-green-50 border-green-200'
      : accent === 'amber'
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : 'text-gray-700 bg-white border-gray-200'
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-semibold">{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top">{children}</td>
}

function Cell({
  value,
  onChange,
  mono,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  mono?: boolean
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-transparent border border-transparent hover:border-gray-200 focus:border-indigo-400 focus:bg-white rounded px-2 py-1 text-sm outline-none ${
        mono ? 'font-mono' : ''
      }`}
    />
  )
}

function BatteryProgress({ percent }: { percent: number }) {
  const safePercent = Math.max(0, Math.min(100, percent))
  const tone =
    safePercent < 35
      ? 'bg-red-500'
      : safePercent < 75
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  return (
    <div className="inline-flex items-center gap-1">
      <div className="h-6 w-24 rounded-md border-2 border-gray-400 bg-white p-[2px]">
        <div
          className={`h-full rounded-sm transition-all duration-300 ${tone}`}
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <div className="h-3 w-1.5 rounded-r-sm bg-gray-400" />
    </div>
  )
}
