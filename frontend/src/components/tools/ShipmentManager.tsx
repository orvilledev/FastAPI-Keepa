import { useCallback, useRef, useState, type DragEvent } from 'react'
import { shipmentManagerApi, type ShipmentManagerResult } from '../../services/api'

const ACCEPTED =
  '.csv,.txt,.tsv,.xlsx,.xlsm,text/csv,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

const VALID_SUFFIXES = ['.csv', '.txt', '.tsv', '.xlsx', '.xlsm']

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

export default function ShipmentManager() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<ShipmentManagerResult | null>(null)
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
    if (!VALID_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
      setError('Upload the FBA shipment export as a .csv or .xlsx file.')
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
      acceptFile(e.dataTransfer.files?.[0])
    },
    [acceptFile],
  )

  const handleGenerate = useCallback(async () => {
    if (!file || generating) return
    setGenerating(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await shipmentManagerApi.generate(file)
      downloadBlob(result.blob, result.filename)
      setSuccess(result)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        'Failed to generate the WR SKU Update sheet.'
      setError(typeof msg === 'string' ? msg : 'Failed to generate the WR SKU Update sheet.')
    } finally {
      setGenerating(false)
    }
  }, [file, generating])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Shipment Manager</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload an Amazon FBA shipment export (for example <code>FBA19JHYH77Q.csv</code>) to build
          the WR SKU Update sheet — one row per SKU, ready for the warehouse team to add dimensions.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{success.filename}</strong> — {success.skuCount} SKU
          {success.skuCount === 1 ? '' : 's'}
          {success.totalUnits > 0 && <> across {success.totalUnits.toLocaleString()} units</>}
          {success.shipmentId && (
            <>
              {' '}
              for shipment <strong>{success.shipmentId}</strong>
            </>
          )}
          {success.shipTo && <> to {success.shipTo}</>}
          {success.boxCount > 0 && <> ({success.boxCount} boxes)</>}.
          {success.duplicateSkus > 0 && (
            <> Skipped {success.duplicateSkus} duplicate SKU row(s).</>
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
          Drag and drop the FBA shipment export here, or
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
            {generating ? 'Generating…' : 'Download WR SKU Update'}
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
        <h2 className="font-semibold text-gray-900">What this does</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Reads the <strong>Individual units</strong> table from the FBA export, skipping the
            shipment metadata above it and the per-box details below it.
          </li>
          <li>
            Writes one row per SKU into the WR SKU Update sheet: <code>SKU</code> and{' '}
            <code>FNSKU</code> copy across as-is, <code>Description</code> comes from the export's{' '}
            <code>Title</code>, and <code>UPC</code> is the SKU with its <code>-FNSKU</code> suffix
            removed, stored as a number.
          </li>
          <li>
            Leaves the item and carton dimension columns blank — the FBA export does not contain
            them, so the warehouse team fills those in.
          </li>
          <li>Keeps the original template's column widths, header formatting and UPC formatting.</li>
        </ul>
      </section>
    </div>
  )
}
