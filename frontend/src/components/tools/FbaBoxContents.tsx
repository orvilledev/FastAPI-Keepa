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
  const [open, setOpen] = useState(false)
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
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
            open ? 'bg-gray-50' : 'hover:bg-gray-50'
          }`}
        >
          <span className="text-lg font-semibold text-gray-900">{title}</span>
          <svg
            className={`h-5 w-5 shrink-0 text-gray-500 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </h2>

      {open && (
      <div className="space-y-4 border-t border-gray-200 p-5">
      <p className="text-sm text-gray-600">{description}</p>

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
      </div>
      )}
    </section>
  )
}

type FileSlotProps = {
  label: string
  hint: string
  file: File | null
  onFile: (file: File | null) => void
  onInvalid?: (message: string) => void
}

function FileSlot({ label, hint, file, onFile, onInvalid }: FileSlotProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const acceptFile = useCallback(
    (incoming: File | null | undefined) => {
      if (!incoming) return
      const name = incoming.name.toLowerCase()
      if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
        onInvalid?.('Only .xls or .xlsx Excel files are supported.')
        onFile(null)
        return
      }
      onFile(incoming)
    },
    [onFile, onInvalid],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      acceptFile(e.dataTransfer.files?.[0])
    },
    [acceptFile],
  )

  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">{label}</h4>
        <p className="text-xs text-gray-500">{hint}</p>
      </div>
      <div
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
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
        <p className="text-sm text-gray-600">
          Drag and drop a <strong>.xlsx</strong> here, or
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            acceptFile(e.target.files?.[0])
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
        {file ? (
          <p className="mt-2 truncate text-xs text-gray-700" title={file.name}>
            Selected: <strong>{file.name}</strong>
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-400">No file selected</p>
        )}
      </div>
    </div>
  )
}

type CompareSummary = {
  filename: string
  rowCount: number
  boxCount: number
  upcCount: number
  totalQty: number
  remappedCount: number
  addedCount: number
  addedQty: number
  removedCount: number
  removedQty: number
  lastBox: number
  shipmentId: string
}

function DnkToolPanel() {
  const [open, setOpen] = useState(false)

  // CCL converter state
  const [cclFile, setCclFile] = useState<File | null>(null)
  const [cclDragging, setCclDragging] = useState(false)
  const [cclGenerating, setCclGenerating] = useState(false)
  const [cclError, setCclError] = useState<string | null>(null)
  const [cclSuccess, setCclSuccess] = useState<GenerateSummary | null>(null)
  const [cclBlob, setCclBlob] = useState<Blob | null>(null)
  const [cclFilename, setCclFilename] = useState('Box Contents.xlsx')
  const cclInputRef = useRef<HTMLInputElement>(null)

  // Manifest compare state
  const [boxFile, setBoxFile] = useState<File | null>(null)
  const [manifestFile, setManifestFile] = useState<File | null>(null)
  const [compareGenerating, setCompareGenerating] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareSuccess, setCompareSuccess] = useState<CompareSummary | null>(null)
  const [compareBlob, setCompareBlob] = useState<Blob | null>(null)
  const [compareFilename, setCompareFilename] = useState('Box Contents - corrected.xlsx')

  const acceptCcl = useCallback((incoming: File | null | undefined) => {
    setCclError(null)
    setCclSuccess(null)
    setCclBlob(null)
    if (!incoming) return
    const name = incoming.name.toLowerCase()
    if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      setCclError('Only .xls or .xlsx Excel files are supported.')
      setCclFile(null)
      return
    }
    setCclFile(incoming)
  }, [])

  const resetCcl = useCallback(() => {
    setCclFile(null)
    setCclError(null)
    setCclSuccess(null)
    setCclBlob(null)
    if (cclInputRef.current) cclInputRef.current.value = ''
  }, [])

  const handleCclGenerate = useCallback(async () => {
    if (!cclFile || cclGenerating) return
    setCclGenerating(true)
    setCclError(null)
    setCclSuccess(null)
    try {
      const result = await fbaBoxContentsApi.generateDnk(cclFile)
      setCclBlob(result.blob)
      setCclFilename(result.filename)
      setCclSuccess({
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
      setCclError(detail || ax.message || 'Failed to generate the Box Contents workbook.')
    } finally {
      setCclGenerating(false)
    }
  }, [cclFile, cclGenerating])

  const resetCompare = useCallback(() => {
    setBoxFile(null)
    setManifestFile(null)
    setCompareError(null)
    setCompareSuccess(null)
    setCompareBlob(null)
  }, [])

  const handleCompare = useCallback(async () => {
    if (!boxFile || !manifestFile || compareGenerating) return
    setCompareGenerating(true)
    setCompareError(null)
    setCompareSuccess(null)
    try {
      const result = await fbaBoxContentsApi.compareDnk(boxFile, manifestFile)
      setCompareBlob(result.blob)
      setCompareFilename(result.filename)
      setCompareSuccess({
        filename: result.filename,
        rowCount: result.rowCount,
        boxCount: result.boxCount,
        upcCount: result.upcCount,
        totalQty: result.totalQty,
        remappedCount: result.remappedCount,
        addedCount: result.addedCount,
        addedQty: result.addedQty,
        removedCount: result.removedCount,
        removedQty: result.removedQty,
        lastBox: result.lastBox,
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
      setCompareError(detail || ax.message || 'Failed to compare Box Contents to the manifest.')
    } finally {
      setCompareGenerating(false)
    }
  }, [boxFile, manifestFile, compareGenerating])

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
            open ? 'bg-gray-50' : 'hover:bg-gray-50'
          }`}
        >
          <span className="text-lg font-semibold text-gray-900">DNK Tool</span>
          <svg
            className={`h-5 w-5 shrink-0 text-gray-500 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </h2>

      {open && (
        <div className="space-y-8 border-t border-gray-200 p-5">
          {/* --- CCL converter --- */}
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Carton Contents List</h3>
              <p className="mt-1 text-sm text-gray-600">
                Upload a DNK Carton Contents List (<code>… CCL.xlsx</code>). Each carton marker like{' '}
                <code>1 of 2</code> becomes a box number, and each item line becomes a row. Downloads{' '}
                <strong>Contents</strong> (Box Number, UPC, Quantity plus a Sum of Quantity pivot) and{' '}
                <strong>Dimensions</strong>.
              </p>
            </div>

            {cclError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {cclError}
              </div>
            )}
            {cclSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                Downloaded <strong>{cclSuccess.filename}</strong> ({cclSuccess.rowCount} line
                {cclSuccess.rowCount === 1 ? '' : 's'}, {cclSuccess.boxCount} box
                {cclSuccess.boxCount === 1 ? '' : 'es'}, {cclSuccess.upcCount} UPC
                {cclSuccess.upcCount === 1 ? '' : 's'}, {cclSuccess.totalQty} units
                {cclSuccess.shipmentId ? `, ${cclSuccess.shipmentId}` : ''}).
              </div>
            )}

            <div
              className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                cclDragging
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-300 bg-gray-50 hover:border-gray-400'
              }`}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCclDragging(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCclDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCclDragging(false)
                acceptCcl(e.dataTransfer.files?.[0])
              }}
            >
              <p className="text-sm text-gray-600">
                Drag and drop a <strong>.xls</strong> or <strong>.xlsx</strong> here, or
              </p>
              <input
                ref={cclInputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => {
                  acceptCcl(e.target.files?.[0])
                  if (cclInputRef.current) cclInputRef.current.value = ''
                }}
              />
              {cclFile && (
                <p className="mt-4 text-sm text-gray-800">
                  Selected: <span className="font-medium">{cclFile.name}</span>
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => cclInputRef.current?.click()}
                  className="rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black"
                >
                  Upload
                </button>
                <button
                  type="button"
                  disabled={!cclFile || cclGenerating}
                  onClick={() => void handleCclGenerate()}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {cclGenerating ? 'Generating…' : 'Download'}
                </button>
                {cclBlob && (
                  <button
                    type="button"
                    onClick={() => downloadBlob(cclBlob, cclFilename)}
                    className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                  >
                    Download again
                  </button>
                )}
                {cclFile && (
                  <button
                    type="button"
                    onClick={resetCcl}
                    disabled={cclGenerating}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
              <h4 className="font-semibold text-gray-900">Expected input</h4>
              <p className="mt-1">
                DNK CCL workbook with a <code>Contents</code> sheet (title{' '}
                <code>Carton Contents</code>, shipment id, then Carton / UPC / Quantity columns) and a{' '}
                <code>Dimensions</code> sheet. Cartons start with markers like <code>1 of 2</code>;{' '}
                <code>Carton Total</code> rows are skipped.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <code>Contents</code>: Box Number and Quantity as numbers, UPC as text, Sum of
                  Quantity pivot by UPC (rows) and box (columns).
                </li>
                <li>
                  <code>Dimensions</code>: Order, Carton, Weight, Length, Width, Height — Weight and
                  dimensions stay numbers (integers when whole).
                </li>
                <li>
                  Download named <code>{'{shipment_id} Box Contents.xlsx'}</code>, for example{' '}
                  <code>FBA19QRSWGPN Box Contents.xlsx</code>.
                </li>
              </ul>
            </div>
          </div>

          {/* --- Manifest compare / correct --- */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Manifest Compare &amp; Correct
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Upload the DNK <strong>Box Contents</strong> file and the Amazon Seller Central{' '}
                <strong>manifest</strong> (source of truth). Remaps Old SKUs from the catalog, tops up
                missing quantities in the <strong>last box</strong>, highlights adjustments in{' '}
                <span className="bg-yellow-200 px-1">yellow</span>, and downloads a corrected workbook.
              </p>
            </div>

            {compareError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {compareError}
              </div>
            )}
            {compareSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                Downloaded <strong>{compareSuccess.filename}</strong> (
                {compareSuccess.rowCount} line{compareSuccess.rowCount === 1 ? '' : 's'},{' '}
                {compareSuccess.boxCount} box{compareSuccess.boxCount === 1 ? '' : 'es'},{' '}
                {compareSuccess.totalQty} units
                {compareSuccess.remappedCount
                  ? `, ${compareSuccess.remappedCount} Old SKU remap${
                      compareSuccess.remappedCount === 1 ? '' : 's'
                    }`
                  : ''}
                {compareSuccess.addedCount
                  ? `, +${compareSuccess.addedQty} in box ${compareSuccess.lastBox}`
                  : ''}
                {compareSuccess.shipmentId ? `, ${compareSuccess.shipmentId}` : ''}).
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FileSlot
                label="1. Box Contents"
                hint="DNK Box Contents.xlsx (Contents + Dimensions)"
                file={boxFile}
                onFile={(f) => {
                  setCompareError(null)
                  setCompareSuccess(null)
                  setCompareBlob(null)
                  setBoxFile(f)
                }}
                onInvalid={setCompareError}
              />
              <FileSlot
                label="2. Manifest"
                hint="Seller Central Box packing information.xlsx"
                file={manifestFile}
                onFile={(f) => {
                  setCompareError(null)
                  setCompareSuccess(null)
                  setCompareBlob(null)
                  setManifestFile(f)
                }}
                onInvalid={setCompareError}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!boxFile || !manifestFile || compareGenerating}
                onClick={() => void handleCompare()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {compareGenerating ? 'Comparing…' : 'Compare & download corrected'}
              </button>
              {compareBlob && (
                <button
                  type="button"
                  onClick={() => downloadBlob(compareBlob, compareFilename)}
                  className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                >
                  Download again
                </button>
              )}
              {(boxFile || manifestFile) && (
                <button
                  type="button"
                  onClick={resetCompare}
                  disabled={compareGenerating}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
              <h4 className="font-semibold text-gray-900">How it works</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  The <strong>manifest</strong> expected quantities and SKUs are the source of truth.
                </li>
                <li>
                  UPCs in Box Contents that map to an Old SKU in the catalog (and appear as that Old
                  SKU on the manifest) are remapped and highlighted yellow.
                </li>
                <li>
                  Missing SKUs / shortfall quantities are appended to the <strong>last box</strong>,
                  highlighted yellow, and listed in the E–G summary next to the Contents table.
                </li>
                <li>
                  Download named <code>{'{shipment_id} Box Contents - corrected.xlsx'}</code>.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
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
          Choose a tool to upload a carton file and download a Box Contents workbook.
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

      <ToolPanel
        title="OBZ Tool"
        description={
          <>
            Upload an Oboz Packing Slip by Carton. Each <code>Carton</code> becomes a box number,
            and each item line becomes a row. Downloads <strong>Box Contents</strong> (Box Number,
            UPC, Qty, a Total formula, and a Sum of Qty pivot).
          </>
        }
        defaultFilename="Box Contents.xlsx"
        generate={fbaBoxContentsApi.generateObz}
        expectedInput={
          <>
            <h3 className="font-semibold text-gray-900">Expected input</h3>
            <p className="mt-1">
              Oboz packing slip whose sheet is titled Packing Slip. Each carton starts with{' '}
              <code>Carton</code> and a carton number, then a header row of <code>PO</code>,{' '}
              <code>UPC/GTIN</code>, and <code>Qty</code>, then one line per item.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <code>Box Number</code> and <code>Qty</code> are numbers. <code>UPC</code> is text,
                with leading zeros removed from the GTIN.
              </li>
              <li>
                The Qty column ends with <code>Total</code> and <code>=SUM(...)</code>. The pivot
                sums qty by UPC and carton.
              </li>
              <li>
                Download named <code>{'{PO} Box Contents.xlsx'}</code>, for example{' '}
                <code>FBA19PZSB42B Box Contents.xlsx</code>.
              </li>
            </ul>
          </>
        }
      />

      <DnkToolPanel />
    </div>
  )
}
