import { useCallback, useRef, useState, type DragEvent } from 'react'
import { smwShipmentAnalyzerApi, type SmwShipmentAnalysisResult } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import { canAccessShipmentAnalyzer } from '../../lib/shipmentAnalyzerAccess'

const ACCEPTED =
  '.xls,.xlsx,.xlsm,.csv,.txt,.tsv,text/csv,application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

const ALLOWED_SUFFIXES = ['.xls', '.xlsx', '.xlsm', '.csv', '.txt', '.tsv']

type Mode = 'basic' | 'advanced'

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

type DropZoneProps = {
  mode: Mode
  title: string
  blurb: string
  hint: string
  files: File[]
  busy: boolean
  disabled: boolean
  onFiles: (files: File[]) => void
  onClear: () => void
  onRun: () => void
}

function DropZone({
  mode,
  title,
  blurb,
  hint,
  files,
  busy,
  disabled,
  onFiles,
  onClear,
  onRun,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = useCallback(
    (incoming: FileList | null | undefined) => {
      if (!incoming || incoming.length === 0) return
      onFiles(Array.from(incoming).filter(isSupported))
    },
    [onFiles],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      accept(e.dataTransfer.files)
    },
    [accept],
  )

  const ready = mode === 'basic' ? files.length === 2 : files.length >= 2

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">{blurb}</p>
      </div>

      <div
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
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
        <p className="text-sm text-gray-600">Drag files here, or</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            accept(e.target.files)
            if (inputRef.current) inputRef.current.value = ''
          }}
        />
        <button
          type="button"
          disabled={disabled}
          className="mt-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
        >
          {mode === 'basic' ? 'Upload 2 files' : 'Upload multiple files'}
        </button>
        <p className="mt-2 text-xs text-gray-400">{hint}</p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1 text-xs text-gray-700">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="truncate" title={file.name}>
              {file.name}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready || busy || disabled}
          onClick={onRun}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? 'Analyzing…'
            : mode === 'basic'
              ? 'Run basic analysis'
              : 'Run advanced analysis'}
        </button>
        {files.length > 0 && !busy && (
          <button type="button" onClick={onClear} className="text-sm text-gray-500 hover:text-gray-800">
            Clear
          </button>
        )}
        {mode === 'basic' && files.length > 2 && (
          <span className="text-xs text-amber-700">Basic analysis takes exactly two files.</span>
        )}
      </div>
    </section>
  )
}

function Outcome({ result, mode }: { result: SmwShipmentAnalysisResult; mode: Mode }) {
  const clean = result.discrepancyCount === 0
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        clean
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      Downloaded <strong>{result.filename}</strong>.{' '}
      {mode === 'basic'
        ? `${result.shipmentId || 'The shipment'} covers ${result.upcCount.toLocaleString()} UPCs and ${result.totalUnits.toLocaleString()} units.`
        : `${result.shipmentCount.toLocaleString()} shipment(s) across ${result.fileCount.toLocaleString()} file(s), ${result.upcCount.toLocaleString()} UPCs and ${result.totalUnits.toLocaleString()} units.`}{' '}
      {clean ? (
        <>No discrepancies in the shipment IDs, UPCs or units.</>
      ) : (
        <>
          {result.discrepancyCount.toLocaleString()} discrepancy row(s) on the Discrepancies tab
          {mode === 'advanced' && result.resolvedCount > 0
            ? `, ${result.resolvedCount.toLocaleString()} traced to another shipment`
            : ''}
          {mode === 'advanced' && result.unresolvedCount > 0
            ? `, ${result.unresolvedCount.toLocaleString()} still unexplained`
            : ''}
          .
        </>
      )}
    </div>
  )
}

export default function SmwShipmentAnalyzer() {
  const { isSuperadmin, userInfoLoading, userInfo, authUser } = useUser()
  const canUse = canAccessShipmentAnalyzer(userInfo?.email || authUser?.email, isSuperadmin)

  const [basicFiles, setBasicFiles] = useState<File[]>([])
  const [advancedFiles, setAdvancedFiles] = useState<File[]>([])
  const [runningMode, setRunningMode] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SmwShipmentAnalysisResult | null>(null)
  const [resultMode, setResultMode] = useState<Mode>('basic')

  const run = useCallback(
    async (mode: Mode, files: File[]) => {
      if (runningMode) return
      setRunningMode(mode)
      setError(null)
      setResult(null)
      try {
        const analysis = await smwShipmentAnalyzerApi.analyze(mode, files)
        setResult(analysis)
        setResultMode(mode)
        downloadBlob(analysis.blob, analysis.filename)
      } catch (err: unknown) {
        const ax = err as { response?: { data?: Blob | { detail?: string } }; message?: string }
        let detail: string | undefined
        const data = ax.response?.data
        if (data instanceof Blob) {
          try {
            const parsed = JSON.parse(await data.text()) as { detail?: string }
            detail = parsed.detail
          } catch {
            detail = undefined
          }
        } else if (data && typeof data === 'object') {
          detail = data.detail
        }
        setError(detail || ax.message || 'Failed to analyze those files.')
      } finally {
        setRunningMode(null)
      }
    },
    [runningMode],
  )

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
        The SMW Shipment Analyzer is restricted to authorized users.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">SMW Shipment Analyzer</h1>
        <p className="mt-1 text-sm text-gray-600">
          Checks a shipment's box contents request against its Amazon pack list on the{' '}
          <strong>shipment ID</strong>, the <strong>UPCs</strong> and the <strong>units</strong>.
          Either file can be .xls, .xlsx or .csv, and you do not need to upload them in any
          particular order — each file is recognised by its own layout. Every run downloads an Excel
          workbook holding the comparison, and a Discrepancies tab appears only when something
          actually disagrees.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {result && <Outcome result={result} mode={resultMode} />}

      <DropZone
        mode="basic"
        title="Basic analysis"
        blurb="One shipment: its box contents request and its pack list. Compares the shipment ID, every UPC, the units behind each UPC, the box counts, and the totals each file states about itself."
        hint="Two files — for example FBA19PL86NCW - bc request.xls and FBA19PL86NCW - pack list.csv"
        files={basicFiles}
        busy={runningMode === 'basic'}
        disabled={runningMode === 'advanced'}
        onFiles={(files) => {
          setError(null)
          setResult(null)
          setBasicFiles(files)
        }}
        onClear={() => {
          setBasicFiles([])
          setResult(null)
          setError(null)
        }}
        onRun={() => run('basic', basicFiles)}
      />

      <DropZone
        mode="advanced"
        title="Advanced analysis"
        blurb="A whole run at once — every box contents request and pack list you have. Files are paired by shipment ID and each one gets the same checks, then any leftover difference is chased across the other shipments: when units sit on one shipment but another is short the same UPC and count, the tool reports where they belong. Differences it cannot explain are listed with what it searched."
        hint="Two or more files, across as many shipments as you like (max 30)"
        files={advancedFiles}
        busy={runningMode === 'advanced'}
        disabled={runningMode === 'basic'}
        onFiles={(files) => {
          setError(null)
          setResult(null)
          setAdvancedFiles(files)
        }}
        onClear={() => {
          setAdvancedFiles([])
          setResult(null)
          setError(null)
        }}
        onRun={() => run('advanced', advancedFiles)}
      />

      <p className="text-xs text-gray-500">
        A box contents request is read as the carton dump with a <strong>PO#:</strong> shipment id and
        repeating <strong>Carton#:</strong> blocks. A pack list is read as the Seller Central export
        whose preamble carries <strong>Shipment ID</strong> and whose table holds one{' '}
        <strong>{'{UPC}-FNSKU'}</strong> row per barcode. Both sides are reduced to units per UPC
        before anything is compared, so cartons and boxes listed in a different order still line up.
      </p>
    </div>
  )
}
