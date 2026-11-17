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
  children?: ReactNode
}

function ToolPanel({
  title,
  defaultFilename,
  generate,
  children,
}: ToolPanelProps) {
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

      {children}
      </div>
      )}
    </section>
  )
}

type FileSlotProps = {
  label: string
  file: File | null
  onFile: (file: File | null) => void
  onInvalid?: (message: string) => void
}

function FileSlot({ label, file, onFile, onInvalid }: FileSlotProps) {
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
      <h4 className="text-sm font-semibold text-gray-900">{label}</h4>
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

const CARTON_ACCEPTED =
  `${ACCEPTED},.zip,application/zip,application/x-zip-compressed`
const CARTON_FILE_PATTERN = /\.(xls|xlsx|xlsm|zip)$/i
const MAX_CARTON_FILES = 100

type CartonNumbersSummary = {
  filename: string
  shipmentCount: number
  boxCount: number
  skippedCount: number
  shipments: Array<{ shipmentId: string; boxCount: number }>
}

function cartonFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function Tool2CartonNumbers() {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<CartonNumbersSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('Carton Numbers.xlsx')
  const inputRef = useRef<HTMLInputElement>(null)

  const clearResult = useCallback(() => {
    setError(null)
    setSuccess(null)
    setResultBlob(null)
  }, [])

  const reset = useCallback(() => {
    setFiles([])
    clearResult()
    if (inputRef.current) inputRef.current.value = ''
  }, [clearResult])

  const addFiles = useCallback(
    (incoming: File[]) => {
      clearResult()
      if (incoming.length === 0) return
      const unsupported = incoming.filter((file) => !CARTON_FILE_PATTERN.test(file.name))
      const supported = incoming.filter((file) => CARTON_FILE_PATTERN.test(file.name))
      let message: string | null = null
      if (unsupported.length > 0) {
        message = `Only .xls, .xlsx, or .zip files are supported. Skipped: ${unsupported
          .map((file) => file.name)
          .join(', ')}.`
      }
      const seen = new Set(files.map(cartonFileKey))
      let next = [...files]
      for (const file of supported) {
        const key = cartonFileKey(file)
        if (!seen.has(key)) {
          seen.add(key)
          next.push(file)
        }
      }
      if (next.length > MAX_CARTON_FILES) {
        message = `Upload at most ${MAX_CARTON_FILES} files at a time. Extra files were not added.`
        next = next.slice(0, MAX_CARTON_FILES)
      }
      setFiles(next)
      if (message) setError(message)
    },
    [files, clearResult],
  )

  const removeFile = useCallback(
    (index: number) => {
      clearResult()
      setFiles((current) => current.filter((_, position) => position !== index))
    },
    [clearResult],
  )

  const handleGenerate = useCallback(async () => {
    if (files.length === 0 || generating) return
    setGenerating(true)
    clearResult()
    try {
      const result = await fbaBoxContentsApi.generateCartonNumbers(files)
      setResultBlob(result.blob)
      setResultFilename(result.filename)
      setSuccess({
        filename: result.filename,
        shipmentCount: result.shipmentCount,
        boxCount: result.boxCount,
        skippedCount: result.skippedCount,
        shipments: result.shipments,
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
      setError(detail || ax.message || 'Failed to generate the Carton Numbers workbook.')
    } finally {
      setGenerating(false)
    }
  }, [files, generating, clearResult])

  return (
    <div className="space-y-4 border-t border-gray-200 pt-6">
      <h3 className="text-base font-semibold text-gray-900">Carton Numbers</h3>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <p>
            Downloaded <strong>{success.filename}</strong> ({success.shipmentCount} shipment
            {success.shipmentCount === 1 ? '' : 's'}, {success.boxCount} box
            {success.boxCount === 1 ? '' : 'es'}).
          </p>
          {success.shipments.length > 0 && (
            <ul className="grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
              {success.shipments.map((shipment, index) => (
                <li key={`${shipment.shipmentId}-${index}`}>
                  <span className="font-medium">{shipment.shipmentId}</span> — {shipment.boxCount} box
                  {shipment.boxCount === 1 ? '' : 'es'}
                </li>
              ))}
            </ul>
          )}
          {success.skippedCount > 0 && (
            <p className="text-xs text-green-900">
              {success.skippedCount} other file{success.skippedCount === 1 ? '' : 's'} inside the
              zip {success.skippedCount === 1 ? 'was' : 'were'} not Excel and{' '}
              {success.skippedCount === 1 ? 'was' : 'were'} ignored.
            </p>
          )}
        </div>
      )}

      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
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
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(false)
          addFiles(Array.from(e.dataTransfer.files ?? []))
        }}
      >
        <p className="text-sm text-gray-600">
          Drag and drop <strong>.xls</strong>, <strong>.xlsx</strong>, or <strong>.zip</strong> files
          here, or
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={CARTON_ACCEPTED}
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            if (inputRef.current) inputRef.current.value = ''
          }}
        />

        {files.length > 0 && (
          <div className="mx-auto mt-4 max-w-xl text-left">
            <p className="text-sm font-medium text-gray-800">
              {files.length} file{files.length === 1 ? '' : 's'} selected
            </p>
            <ul className="mt-2 max-h-48 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-200 bg-white">
              {files.map((file, index) => (
                <li
                  key={cartonFileKey(file)}
                  className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-gray-800" title={file.name}>
                    {file.name}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    disabled={generating}
                    aria-label={`Remove ${file.name}`}
                    className="shrink-0 rounded px-1.5 text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={generating}
            className="rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {files.length > 0 ? 'Add files' : 'Upload files'}
          </button>
          <button
            type="button"
            disabled={files.length === 0 || generating}
            onClick={() => void handleGenerate()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate & download'}
          </button>
          {resultBlob && (
            <button
              type="button"
              onClick={() => downloadBlob(resultBlob, resultFilename)}
              className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
            >
              Download again
            </button>
          )}
          {files.length > 0 && (
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
    </div>
  )
}

function Tool2ManifestCompare() {
  const [outputFile, setOutputFile] = useState<File | null>(null)
  const [manifestFile, setManifestFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<CompareSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('Box Contents - Corrected.xlsx')

  const clearResult = useCallback(() => {
    setError(null)
    setSuccess(null)
    setResultBlob(null)
  }, [])

  const reset = useCallback(() => {
    setOutputFile(null)
    setManifestFile(null)
    clearResult()
  }, [clearResult])

  const handleCompare = useCallback(async () => {
    if (!outputFile || !manifestFile || generating) return
    setGenerating(true)
    clearResult()
    try {
      const result = await fbaBoxContentsApi.compareTool2(outputFile, manifestFile)
      setResultBlob(result.blob)
      setResultFilename(result.filename)
      setSuccess({
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
      setError(detail || ax.message || 'Failed to compare the Output to the manifest.')
    } finally {
      setGenerating(false)
    }
  }, [outputFile, manifestFile, generating, clearResult])

  return (
    <div className="space-y-4 border-t border-gray-200 pt-6">
      <h3 className="text-base font-semibold text-gray-900">Manifest Compare &amp; Correct</h3>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{success.filename}</strong> ({success.rowCount} line
          {success.rowCount === 1 ? '' : 's'}, {success.boxCount} box
          {success.boxCount === 1 ? '' : 'es'}, {success.totalQty} units
          {success.remappedCount
            ? `, ${success.remappedCount} Old SKU remap${success.remappedCount === 1 ? '' : 's'}`
            : ''}
          {success.addedCount ? `, +${success.addedQty} in box ${success.lastBox}` : ''}
          {success.removedQty ? `, −${success.removedQty} removed` : ''}
          {success.shipmentId ? `, ${success.shipmentId}` : ''}).
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FileSlot
          label="1. Output"
          file={outputFile}
          onFile={(f) => {
            clearResult()
            setOutputFile(f)
          }}
          onInvalid={setError}
        />
        <FileSlot
          label="2. Manifest"
          file={manifestFile}
          onFile={(f) => {
            clearResult()
            setManifestFile(f)
          }}
          onInvalid={setError}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!outputFile || !manifestFile || generating}
          onClick={() => void handleCompare()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {generating ? 'Comparing…' : 'Compare & download corrected'}
        </button>
        {resultBlob && (
          <button
            type="button"
            onClick={() => downloadBlob(resultBlob, resultFilename)}
            className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
          >
            Download again
          </button>
        )}
        {(outputFile || manifestFile) && (
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
  )
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
            <h3 className="text-base font-semibold text-gray-900">Carton Contents List</h3>

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
          </div>

          {/* --- Manifest compare / correct --- */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="text-base font-semibold text-gray-900">
              Manifest Compare &amp; Correct
            </h3>

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
      </header>

      {/* Tool #1 kept in code but hidden from the UI for now. */}
      {false && (
        <ToolPanel
          title="Tool #1"
          defaultFilename="FBA Box Contents Output.xlsx"
          generate={fbaBoxContentsApi.generate}
        />
      )}

      <ToolPanel
        title="NFA and SMW Tool"
        defaultFilename="FBA Box Contents Output.xlsx"
        generate={fbaBoxContentsApi.generateTool2}
      >
        <Tool2ManifestCompare />
        <Tool2CartonNumbers />
      </ToolPanel>

      <ToolPanel
        title="OBZ Tool"
        defaultFilename="Box Contents.xlsx"
        generate={fbaBoxContentsApi.generateObz}
      />

      <DnkToolPanel />
    </div>
  )
}
