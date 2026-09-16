import { useCallback, useRef, useState, type DragEvent } from 'react'
import { fbaBoxContentsApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import { canAccessFbaBoxContents } from '../../lib/fbaBoxContentsAccess'

const ACCEPTED =
  '.xls,.xlsx,.xlsm,application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
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
  boxCount: number
  upcCount: number
  totalQty: number
  shipmentId: string
}

export default function FbaBoxContents() {
  const { isSuperadmin, userInfoLoading, userInfo, authUser } = useUser()
  const canUse = canAccessFbaBoxContents(userInfo?.email || authUser?.email, isSuperadmin)
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<GenerateSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('FBA Box Contents Output.xlsx')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setFile(null)
    setError(null)
    setSuccess(null)
    setResultBlob(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const acceptFile = useCallback((incoming: File | null | undefined) => {
    setError(null)
    setSuccess(null)
    setResultBlob(null)
    if (!incoming) return
    const name = incoming.name.toLowerCase()
    if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      setError('Only FBA Carton Detail .xls or .xlsx Excel files are supported.')
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
      const result = await fbaBoxContentsApi.generate(file)
      setResultBlob(result.blob)
      setResultFilename(result.filename)
      setSuccess({
        filename: result.filename,
        rowCount: result.rowCount,
        boxCount: result.boxCount,
        upcCount: result.upcCount,
        totalQty: result.totalQty,
        shipmentId: result.shipmentId,
      })
      downloadBlob(result.blob, result.filename)
    } catch (err: unknown) {
      const ax = err as {
        response?: { data?: Blob | { detail?: string } }
        message?: string
      }
      let detail: string | undefined
      const data = ax.response?.data
      if (data instanceof Blob) {
        try {
          const text = await data.text()
          const parsed = JSON.parse(text) as { detail?: string }
          detail = parsed.detail
        } catch {
          detail = undefined
        }
      } else if (data && typeof data === 'object') {
        detail = data.detail
      }
      setError(detail || ax.message || 'Failed to generate the Box Contents workbook.')
    } finally {
      setGenerating(false)
    }
  }, [file, generating])

  const handleDownloadResult = useCallback(() => {
    if (!resultBlob) return
    downloadBlob(resultBlob, resultFilename)
  }, [resultBlob, resultFilename])

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#404040] border-t-transparent" />
      </div>
    )
  }

  if (!canUse) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Access restricted</h2>
          <p className="mt-2 text-sm text-gray-600">This tool is limited to authorized users.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">FBA Box Contents</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload an FBA Carton Detail report. The tool numbers each carton as Box # 1, 2, 3… and
          downloads an Excel workbook with a <strong>Box Contents</strong> sheet (UPC, Box #, QTY plus
          a quantity pivot) and a <strong>Dimensions</strong> sheet (weight, length, width, height).
          UPCs stay text; box numbers, quantities, and dimensions stay numbers.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{success.filename}</strong> ({success.rowCount} line
          {success.rowCount === 1 ? '' : 's'}, {success.boxCount} box
          {success.boxCount === 1 ? '' : 'es'}, {success.upcCount} UPC
          {success.upcCount === 1 ? '' : 's'}, {success.totalQty} units
          {success.shipmentId ? `, ${success.shipmentId}` : ''}).
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
          Drag and drop an FBA Carton Detail <strong>.xls</strong> or <strong>.xlsx</strong> here, or
        </p>
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
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black"
          >
            Upload
          </button>
          <button
            type="button"
            disabled={!file || generating}
            onClick={() => void handleGenerate()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Download'}
          </button>
          {resultBlob && (
            <button
              type="button"
              onClick={handleDownloadResult}
              className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
            >
              Download again
            </button>
          )}
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
        <h2 className="font-semibold text-gray-900">Expected input</h2>
        <p className="mt-1">
          Amazon FBA Carton Detail export (the file whose first row is “FBA Carton Detail”). Each
          carton starts with <code>Carton#:</code>, followed by item lines and a Total row.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <code>Box Contents</code>: UPC as Excel text, Box # and QTY as numbers, plus a Sum of QTY
            pivot by UPC (rows) and box (columns). Duplicate UPC lines in the same box stay separate
            on the left and are summed in the pivot.
          </li>
          <li>
            <code>Dimensions</code>: one row per carton — Box #, Weight (item weights rounded up to 1
            decimal), Length, Width, Height, all stored as numbers.
          </li>
          <li>
            The download is named <code>{'{filename} Output.xlsx'}</code>, for example{' '}
            <code>FBA19NT5WH3J Output.xlsx</code>.
          </li>
        </ul>
      </section>
    </div>
  )
}
