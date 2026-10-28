import { useCallback, useRef, useState, type DragEvent } from 'react'
import { buildNsToolWorkbook, type NsToolResult } from '../../utils/nsToolWorkbook'

const ACCEPTED =
  '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

const ALLOWED_SUFFIXES = ['.xlsx', '.xlsm']

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

function isSupported(file: File) {
  const name = file.name.toLowerCase()
  return ALLOWED_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

export default function NsTool() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<NsToolResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pickFile = useCallback((incoming: File[]) => {
    setResult(null)
    if (incoming.length === 0) return
    const supported = incoming.find(isSupported)
    if (!supported) {
      setError('Only .xlsx or .xlsm files are supported.')
      return
    }
    setError(incoming.length > 1 ? 'Only one workbook is used at a time. The first .xlsx file was kept.' : null)
    setFile(supported)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      pickFile(Array.from(e.dataTransfer.files || []))
    },
    [pickFile],
  )

  const reset = useCallback(() => {
    setFile(null)
    setError(null)
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleDownload = useCallback(async () => {
    if (building || !file) return
    if (result) {
      downloadBlob(result.blob, result.filename)
      return
    }
    setBuilding(true)
    setError(null)
    try {
      const built = await buildNsToolWorkbook(file)
      setResult(built)
      downloadBlob(built.blob, built.filename)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message
      setError(msg || 'Failed to build the NS Tool output.')
    } finally {
      setBuilding(false)
    }
  }, [building, file, result])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">NS Tool</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload the monthly sales and returns totals workbook. The download lists every External ID
          with its FBA and MFN sales and returns, plus gross and net sales totals.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{result.filename}</strong> — {result.rowCount.toLocaleString()} External ID
          {result.rowCount === 1 ? '' : 's'}. Found in FBA sales: {result.matched.fbaSales.toLocaleString()},
          FBA returns: {result.matched.fbaReturns.toLocaleString()}, MFN sales:{' '}
          {result.matched.mfnSales.toLocaleString()}, MFN returns: {result.matched.mfnReturns.toLocaleString()}.
        </div>
      )}

      <section
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-gray-400'
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
        <p className="text-sm text-gray-600">
          Drag and drop the <strong>.xlsx</strong> totals workbook here, or upload it.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            pickFile(Array.from(e.target.files || []))
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={building}
            className="inline-flex items-center rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          >
            Upload
          </button>
          <button
            type="button"
            disabled={!file || building}
            onClick={() => void handleDownload()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {building ? 'Building…' : 'Download'}
          </button>
          {file && (
            <button
              type="button"
              onClick={reset}
              disabled={building}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>

        {file ? (
          <p
            className="mx-auto mt-5 max-w-lg truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-800"
            title={file.name}
          >
            {file.name}
          </p>
        ) : (
          <p className="mt-4 text-xs text-gray-400">No file selected</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">What the upload needs</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            An <strong>External ID</strong> sheet with the IDs in column A under an External ID header.
          </li>
          <li>
            Four pivot sheets whose names contain <strong>FBA SALES</strong>, <strong>FBA RETURNS</strong>,{' '}
            <strong>MFN SALES</strong>, and <strong>MFN RETURNS</strong> (for example, JUL 26 FBA SALES
            TOTAL). Each lists the ID under Row Labels and the quantity next to it.
          </li>
        </ul>
        <h2 className="mt-4 font-semibold text-gray-900">What the download contains</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Column A keeps every External ID in the same order. Column B is left blank.</li>
          <li>
            Columns C to F are each ID&apos;s quantity from the four pivot sheets, headed by the sheet name.
            An ID not found on a sheet is left blank.
          </li>
          <li>Gross sales total is FBA sales plus MFN sales.</li>
          <li>Net sales total is gross sales minus FBA returns and MFN returns.</li>
          <li>
            Quantities from 1 to 1000 in columns C to F, and gross or net totals from 1 to 100, are
            highlighted green.
          </li>
        </ul>
      </section>
    </div>
  )
}
