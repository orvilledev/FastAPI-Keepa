import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
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

type ToolPanelProps = {
  title: string
  description: ReactNode
  expectedInput: ReactNode
  defaultFilename: string
  generate: (file: File) => Promise<{
    blob: Blob
    filename: string
    rowCount: number
    boxCount: number
    upcCount: number
    totalQty: number
    shipmentId: string
  }>
}

function ToolPanel({ title, description, expectedInput, defaultFilename, generate }: ToolPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<GenerateSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState(defaultFilename)
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
      setError('Only .xls or .xlsx Excel files are supported.')
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
      const result = await generate(file)
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
  }, [file, generating, generate])

  const handleDownloadResult = useCallback(() => {
    if (!resultBlob) return
    downloadBlob(resultBlob, resultFilename)
  }, [resultBlob, resultFilename])

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      </div>

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

      <div
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400'
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
          Drag and drop a <strong>.xls</strong> or <strong>.xlsx</strong> here, or
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
      </div>

      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
        {expectedInput}
      </div>
    </section>
  )
}

export default function FbaBoxContents() {
  const { isSuperadmin, userInfoLoading, userInfo, authUser } = useUser()
  const canUse = canAccessFbaBoxContents(userInfo?.email || authUser?.email, isSuperadmin)

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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">FBA Box Contents</h1>
        <p className="mt-1 text-sm text-gray-600">
          Convert a spaced-column carton dump into a Box Contents workbook with Dimensions.
        </p>
      </header>

      {/* Tool #1 kept in code but hidden from the UI for now. */}
      {false && (
        <ToolPanel
          title="Tool #1"
          description={
            <>
              Upload an FBA Carton Detail report. Numbers each carton as Box # 1, 2, 3… and downloads a
              workbook with <strong>Box Contents</strong> (UPC, Box #, QTY plus a quantity pivot) and{' '}
              <strong>Dimensions</strong> (Box #, weight rounded up from item weights, length, width,
              height).
            </>
          }
          defaultFilename="FBA Box Contents Output.xlsx"
          generate={fbaBoxContentsApi.generate}
          expectedInput={
            <>
              <h3 className="font-semibold text-gray-900">Expected input</h3>
              <p className="mt-1">
                Amazon FBA Carton Detail export (first row “FBA Carton Detail”). Each carton starts with{' '}
                <code>Carton#:</code>, followed by item lines and a Total row.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <code>Box Contents</code>: UPC as Excel text, Box # and QTY as numbers, plus a Sum of
                  QTY pivot by UPC (rows) and box (columns).
                </li>
                <li>
                  <code>Dimensions</code>: Box #, Weight (item weights rounded up to 1 decimal), Length,
                  Width, Height — all numbers.
                </li>
                <li>
                  Download named <code>{'{filename} Output.xlsx'}</code>.
                </li>
              </ul>
            </>
          }
        />
      )}

      <ToolPanel
        title="NFA and SMW Tool"
        description={
          <>
            Upload a spaced-column carton dump (starts with <code>PO#:</code>). Numbers each carton as
            Box Number 1, 2, 3… and downloads <strong>Box Contents</strong> (UPC, Box Number, QTY plus
            pivot) and <strong>Dimensions</strong> (Weight from each carton Total row as text, Length,
            Width, Height — no Box # column).
          </>
        }
        defaultFilename="FBA Box Contents Output.xlsx"
        generate={fbaBoxContentsApi.generateTool2}
        expectedInput={
          <>
            <h3 className="font-semibold text-gray-900">Expected input</h3>
            <p className="mt-1">
              Carton export whose first row is <code>PO#:</code> / shipment id, with blank spacer
              columns between Sku, UPC, Qty, Weight, and carton dimensions. Each carton starts with{' '}
              <code>Carton#:</code>, then item lines, then a Total row.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <code>Box Contents</code>: UPC (text), Box Number and QTY (numbers), Sum of QTY pivot —
                no Total QTY footer.
              </li>
              <li>
                <code>Dimensions</code>: Weight (copied from the Total row, often with a leading
                space), Length, Width, Height.
              </li>
              <li>
                Download named <code>{'{filename} Output.xlsx'}</code>, for example{' '}
                <code>FBA19PLBV097 Output.xlsx</code>.
              </li>
            </ul>
          </>
        }
      />
    </div>
  )
}
