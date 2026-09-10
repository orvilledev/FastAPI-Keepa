import { useCallback, useRef, useState, type DragEvent } from 'react'
import { fnskuBoxPivotApi } from '../../services/api'
import { auditAction } from '../../lib/auditEvents'

const ACCEPTED =
  '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

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

type GenerateSummary = {
  filename: string
  rowCount: number
  skuCount: number
  unmatchedCount: number
  unmatchedFnskus: string
}

export default function FnskuBoxPivot() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<GenerateSummary | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setFile(null)
    setError(null)
    setSuccess(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const acceptFile = useCallback((incoming: File | null | undefined) => {
    setError(null)
    setSuccess(null)
    if (!incoming) return
    const name = incoming.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      setError('Only .xlsx Excel files are supported.')
      setFile(null)
      return
    }
    setFile(incoming)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const dropped = e.dataTransfer.files?.[0]
      acceptFile(dropped)
    },
    [acceptFile],
  )

  const handleGenerate = useCallback(async () => {
    if (!file || generating) return
    setGenerating(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await fnskuBoxPivotApi.generate(file)
      downloadBlob(result.blob, result.filename)
      setSuccess({
        filename: result.filename,
        rowCount: result.rowCount,
        skuCount: result.skuCount,
        unmatchedCount: result.unmatchedCount,
        unmatchedFnskus: result.unmatchedFnskus,
      })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to generate the box pivot workbook.'
      setError(typeof msg === 'string' ? msg : 'Failed to generate the box pivot workbook.')
    } finally {
      setGenerating(false)
    }
  }, [file, generating])

  const handleDownloadTemplate = useCallback(async () => {
    if (downloadingTemplate) return
    setDownloadingTemplate(true)
    setError(null)
    try {
      const result = await fnskuBoxPivotApi.downloadTemplate()
      downloadBlob(result.blob, result.filename)
      auditAction('fnsku_box_pivot.template_download', `Downloaded ${result.filename}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to download template.'
      setError(msg)
    } finally {
      setDownloadingTemplate(false)
    }
  }, [downloadingTemplate])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">FNSKU Box Pivot</h1>
          <p className="mt-1 text-sm text-gray-600">
            Upload an FNSKU + BOX# scan sheet. The tool looks up each FNSKU in the warehouse
            catalog and downloads a workbook with scanned rows and a quantity pivot by merchant SKU
            and box.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleDownloadTemplate()}
          disabled={downloadingTemplate}
          className="shrink-0 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
        >
          {downloadingTemplate ? 'Downloading…' : 'Download Template'}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{success.filename}</strong> ({success.rowCount} scan
          {success.rowCount === 1 ? '' : 's'}, {success.skuCount} merchant SKU
          {success.skuCount === 1 ? '' : 's'}).
          {success.unmatchedCount > 0 && (
            <>
              {' '}
              {success.unmatchedCount} FNSKU{success.unmatchedCount === 1 ? '' : 's'} were not in the
              warehouse catalog
              {success.unmatchedFnskus ? ` (${success.unmatchedFnskus})` : ''}.
            </>
          )}
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
          Drag and drop a <strong>.xlsx</strong> scan sheet here, or
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 inline-flex items-center rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black"
        >
          Choose file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            acceptFile(e.target.files?.[0])
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />

        {file && (
          <p className="mt-4 text-sm text-gray-800">
            Selected: <span className="font-medium">{file.name}</span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={!file || generating}
            onClick={() => void handleGenerate()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate pivot workbook'}
          </button>
          <button
            type="button"
            disabled={downloadingTemplate}
            onClick={() => void handleDownloadTemplate()}
            className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
          >
            {downloadingTemplate ? 'Downloading…' : 'Download Template'}
          </button>
          {file && (
            <button
              type="button"
              onClick={reset}
              disabled={generating}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">Expected columns</h2>
        <p className="mt-1">FNSKU, BOX# — one row per scanned unit.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Each row is counted as quantity 1 in the box named by BOX#.</li>
          <li>
            Merchant SKU is looked up from the warehouse product catalog (short SKU when the catalog
            SKU has 7 or fewer digits, otherwise UPC) and written as <code>{'{id}'}-FNSKU</code>.
          </li>
          <li>
            Output has a <code>scanned data</code> sheet plus a <code>Sheet7</code> pivot of Sum of
            QTY by merchant SKU (rows) and box number (columns). FNSKU and merchant SKU stay Excel
            text; BOX# and QTY stay numbers so lookups match.
          </li>
        </ul>
      </section>
    </div>
  )
}
