import { useCallback, useRef, useState, type DragEvent } from 'react'
import { obzSmwFbaInvApi } from '../../services/api'

const ACCEPTED = '.csv,.zip,text/csv,application/zip,application/x-zip-compressed'
const ALLOWED_SUFFIXES = ['.csv', '.zip']

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

type GenerateSummary = {
  zipFilename: string
  weeklyFilename: string
  masterFilename: string
  ledgerDate: string
  sourceRows: number
  obzRows: number
  smwRows: number
  droppedAmznRows: number
}

export default function ObzSmwFbaInv() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<GenerateSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('OBZ_SMW FBA INV.zip')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setUpload = useCallback((incoming: File | null) => {
    setSuccess(null)
    setResultBlob(null)
    if (!incoming) {
      setFile(null)
      return
    }
    if (!isSupported(incoming)) {
      setError('Only a .csv inventory ledger or a .zip containing one is supported.')
      setFile(null)
      return
    }
    setError(null)
    setFile(incoming)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const next = e.dataTransfer.files?.[0] || null
      setUpload(next)
    },
    [setUpload],
  )

  const reset = useCallback(() => {
    setFile(null)
    setError(null)
    setSuccess(null)
    setResultBlob(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleDownload = useCallback(async () => {
    if (generating) return
    if (!file) {
      setError('Upload an Amazon inventory ledger (.csv or .zip) first.')
      return
    }
    if (resultBlob) {
      downloadBlob(resultBlob, resultFilename)
      return
    }
    setGenerating(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await obzSmwFbaInvApi.generate(file)
      setResultBlob(result.blob)
      setResultFilename(result.zipFilename)
      setSuccess({
        zipFilename: result.zipFilename,
        weeklyFilename: result.weeklyFilename,
        masterFilename: result.masterFilename,
        ledgerDate: result.ledgerDate,
        sourceRows: result.sourceRows,
        obzRows: result.obzRows,
        smwRows: result.smwRows,
        droppedAmznRows: result.droppedAmznRows,
      })
      downloadBlob(result.blob, result.zipFilename)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to generate the OBZ/SMW FBA INV reports.'
      setError(typeof msg === 'string' ? msg : 'Failed to generate the OBZ/SMW FBA INV reports.')
    } finally {
      setGenerating(false)
    }
  }, [file, generating, resultBlob, resultFilename])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">OBZ / SMW FBA INV</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload Amazon&apos;s inventory ledger (the 3076054020773 CSV, zipped or plain). Download
          builds the two FBA INV workbooks used in the OBZ weekly sales report and the sales-report
          masterfile — dates as datetimes, balances as integers, SKUs as text.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{success.zipFilename}</strong> for ledger date{' '}
          <strong>{success.ledgerDate || '—'}</strong>.
          <div className="mt-1">
            {success.weeklyFilename} — {success.obzRows.toLocaleString()} OBZ rows
          </div>
          <div>
            {success.masterFilename} — {success.smwRows.toLocaleString()} SMW rows
          </div>
          <div className="mt-1 text-green-700">
            Source rows {success.sourceRows.toLocaleString()}
            {success.droppedAmznRows > 0
              ? ` · dropped ${success.droppedAmznRows.toLocaleString()} amzn.gr SKUs`
              : ''}
            .
          </div>
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
        <p className="text-sm text-gray-600">
          Drag and drop the inventory ledger <strong>.csv</strong> or <strong>.zip</strong> here, or
          upload it.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            setUpload(e.target.files?.[0] || null)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={generating}
            className="inline-flex items-center rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          >
            Upload
          </button>
          <button
            type="button"
            disabled={!file || generating}
            onClick={() => void handleDownload()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Download'}
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

        {file ? (
          <div className="mx-auto mt-5 max-w-lg rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-800">
            <span className="block truncate" title={file.name}>
              {file.name}
            </span>
            <span className="text-xs text-gray-500">
              {(file.size / (1024 * 1024)).toFixed(2)} MB
            </span>
          </div>
        ) : (
          <p className="mt-4 text-xs text-gray-400">No file selected</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">What the download contains</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>OBZ WEEKLY SALES REPORT WE MM.DD.YY.xlsx</strong> — sheet <strong>FBA INV</strong>{' '}
            for Oboz sellable warehouse balances
          </li>
          <li>
            <strong>SALES REPORT MASTERFILE MM.DD.YY.xlsx</strong> — sheet <strong>FBA INV</strong> for
            Smartwool sellable warehouse balances
          </li>
        </ul>
        <p className="mt-2">
          Both files are packaged in one ZIP. This tool builds the inventory tabs from the Amazon
          ledger only (orders, sessions, FBM, and Keepa tabs still come from their own source files).
        </p>
      </section>
    </div>
  )
}
