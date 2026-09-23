import { useCallback, useRef, useState, type DragEvent } from 'react'
import { fbaUploadCompareApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import { canAccessOldSkus } from '../../lib/oldSkusAccess'

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

type FileSlotProps = {
  label: string
  hint: string
  file: File | null
  onFile: (file: File | null) => void
}

function FileSlot({ label, hint, file, onFile }: FileSlotProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const acceptFile = useCallback(
    (incoming: File | null | undefined) => {
      if (!incoming) return
      const name = incoming.name.toLowerCase()
      if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
        onFile(null)
        return
      }
      onFile(incoming)
    },
    [onFile],
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
        <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
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

type GenerateSummary = {
  filename: string
  rowCount: number
  boxCount: number
  upcCount: number
  totalQty: number
  remappedCount: number
  missingCount: number
  shipmentId: string
}

export default function FbaUploadCompare() {
  const { isSuperadmin, userInfoLoading, userInfo, authUser } = useUser()
  const canUse = canAccessOldSkus(userInfo?.email || authUser?.email, isSuperadmin)

  const [outputFile, setOutputFile] = useState<File | null>(null)
  const [amzFile, setAmzFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<GenerateSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('FBA Result.xlsx')

  const reset = useCallback(() => {
    setOutputFile(null)
    setAmzFile(null)
    setError(null)
    setSuccess(null)
    setResultBlob(null)
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!outputFile || !amzFile || generating) return
    setGenerating(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await fbaUploadCompareApi.generate(outputFile, amzFile)
      setResultBlob(result.blob)
      setResultFilename(result.filename)
      setSuccess({
        filename: result.filename,
        rowCount: result.rowCount,
        boxCount: result.boxCount,
        upcCount: result.upcCount,
        totalQty: result.totalQty,
        remappedCount: result.remappedCount,
        missingCount: result.missingCount,
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
      setError(detail || ax.message || 'Failed to generate the Result workbook.')
    } finally {
      setGenerating(false)
    }
  }, [outputFile, amzFile, generating])

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
      <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        FBA Upload Compare is restricted to users who can access the Old SKUs catalog.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">FBA Upload Compare</h1>
        <p className="mt-1 text-sm text-gray-600">
          Compare the FBA Box Contents Output against the Amazon upload file. Old SKUs from the
          catalog replace matching UPCs (yellow highlight). Quantity or SKU gaps go on a{' '}
          <strong>missing items</strong> tab in the Result workbook.
        </p>
      </div>

      <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Downloaded <strong>{success.filename}</strong> ({success.rowCount} lines,{' '}
            {success.boxCount} boxes, {success.upcCount} SKUs/UPCs, {success.totalQty} units
            {success.remappedCount ? `, ${success.remappedCount} remapped to Old SKUs` : ''}
            {success.missingCount ? `, ${success.missingCount} missing-item row(s)` : ', no missing items'}
            {success.shipmentId ? `, ${success.shipmentId}` : ''}).
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <FileSlot
            label="1. Output file"
            hint="FBA… Output.xlsx (Box Contents + Dimensions)"
            file={outputFile}
            onFile={(f) => {
              setError(null)
              setSuccess(null)
              setResultBlob(null)
              setOutputFile(f)
            }}
          />
          <FileSlot
            label="2. AMZ upload file"
            hint="FBA… Upload file - AMZ.xlsx from Seller Central"
            file={amzFile}
            onFile={(f) => {
              setError(null)
              setSuccess(null)
              setResultBlob(null)
              setAmzFile(f)
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!outputFile || !amzFile || generating}
            onClick={handleGenerate}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? 'Comparing…' : 'Compare & download Result'}
          </button>
          {resultBlob && (
            <button
              type="button"
              onClick={handleDownloadResult}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Download Result again
            </button>
          )}
          {(outputFile || amzFile || resultBlob) && (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Clear
            </button>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Remaps use the Old SKUs catalog (UPC Code → OLD SKU). Only UPCs whose Old SKU appears in
          the AMZ upload are replaced and highlighted yellow in column A.
        </p>
      </section>
    </div>
  )
}
