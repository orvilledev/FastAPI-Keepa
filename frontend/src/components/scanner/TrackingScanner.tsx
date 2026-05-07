import { useCallback, useMemo, useRef, useState } from 'react'
import {
  exportRowsToCsvBlob,
  scanPdfInBrowser,
  type TrackingScannerRow,
  type TrackingScannerScanResponse,
} from '../../utils/trackingExtractor'

type Stats = {
  filename: string
  pairs: number
  matched: number
  needsReview: number
}

const ACCEPTED = '.pdf,application/pdf'

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

function suggestedCsvFilename(sourceFile: string): string {
  const stem = (sourceFile || 'tracking_extract').replace(/\.pdf$/i, '')
  return `${stem}.csv`
}

export default function TrackingScanner() {
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<TrackingScannerRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [scanning, setScanning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelected = useCallback((picked: File | null) => {
    setFile(picked)
    setRows([])
    setStats(null)
    setError(null)
    setSuccess(null)
  }, [])

  const handleScan = useCallback(async () => {
    if (!file) return
    setScanning(true)
    setError(null)
    setSuccess(null)
    try {
      const result: TrackingScannerScanResponse = await scanPdfInBrowser(file)
      setRows(result.rows)
      setStats({
        filename: result.filename,
        pairs: result.pair_count,
        matched: result.matched_count,
        needsReview: result.needs_review_count,
      })
      if (result.matched_count === 0) {
        setSuccess(
          `Scanned ${result.pair_count} page pair(s) but no complete matches were found. Review and edit rows below before exporting.`
        )
      } else {
        setSuccess(
          `Scanned ${result.pair_count} pair(s) — ${result.matched_count} matched, ${result.needs_review_count} need review.`
        )
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to scan PDF.'
      setError(typeof detail === 'string' ? detail : 'Failed to scan PDF.')
    } finally {
      setScanning(false)
    }
  }, [file])

  const handleDownloadCsv = useCallback(async () => {
    if (rows.length === 0) return
    setExporting(true)
    setError(null)
    try {
      const blob = exportRowsToCsvBlob(rows)
      const filename = suggestedCsvFilename(stats?.filename || file?.name || 'tracking_extract')
      downloadBlob(blob, filename)
      setSuccess(`Exported ${rows.length} row(s) to ${filename}.`)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to export CSV.'
      setError(typeof detail === 'string' ? detail : 'Failed to export CSV.')
    } finally {
      setExporting(false)
    }
  }, [rows, stats, file])

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
      const dropped = event.dataTransfer?.files?.[0]
      if (!dropped) return
      if (!/\.pdf$/i.test(dropped.name)) {
        setError('Only PDF files are supported.')
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
        <SummaryCard label="Page pairs" value={stats.pairs} />
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
          Upload a multi-page shipping-label PDF. Odd pages are read for the FBA{' '}
          <strong>shipment ID</strong>; even pages are OCR-scanned for the UPS{' '}
          <strong>tracking number</strong>. Each pair becomes one CSV row.
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
          Drag and drop a PDF here, or
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 inline-flex items-center px-4 py-2 rounded-md bg-[#404040] text-white text-sm font-medium hover:bg-black"
        >
          Choose PDF
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
        />
        {file && (
          <p className="mt-3 text-xs text-gray-500">
            Selected: <span className="font-medium text-gray-700">{file.name}</span> (
            {(file.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={!file || scanning}
            onClick={handleScan}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan PDF'}
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              disabled={exporting}
              onClick={handleDownloadCsv}
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {exporting ? 'Preparing CSV…' : 'Download CSV'}
            </button>
          )}
        </div>
        {summary}
      </section>

      {rows.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Extracted rows ({rows.length})
            </h2>
            <p className="text-xs text-gray-500">
              You can edit any cell before exporting to CSV.
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

      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
        <p className="font-semibold text-gray-700 mb-1">How it works</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Pages 1, 3, 5, … (odd): text extraction reads the FBA shipment ID and box code.</li>
          <li>Pages 2, 4, 6, … (even): each page is rendered and OCR’d to read the UPS Tracking # (1Z…).</li>
          <li>Each odd–even pair becomes one CSV row. Missing values are flagged as <em>Needs review</em>.</li>
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
