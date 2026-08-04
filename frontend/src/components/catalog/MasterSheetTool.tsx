import { useCallback, useRef, useState, type DragEvent } from 'react'
import { masterSheetApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'

const ACCEPTED =
  '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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
  totalRows: number
  upcMatched: number
  upcMissing: number
  mcByUpc: number
  mcByDescSize: number
  mcMissing: number
}

export default function MasterSheetTool() {
  const { isSuperadmin, userInfoLoading } = useUser()
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<GenerateSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('Master_Sheet.xlsx')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const acceptFile = useCallback((incoming: File | null | undefined) => {
    setError(null)
    setSuccess(null)
    setResultBlob(null)
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
      const result = await masterSheetApi.generate(file)
      setResultBlob(result.blob)
      setResultFilename(result.filename)
      setSuccess({
        filename: result.filename,
        totalRows: result.totalRows,
        upcMatched: result.upcMatched,
        upcMissing: result.upcMissing,
        mcByUpc: result.mcByUpc,
        mcByDescSize: result.mcByDescSize,
        mcMissing: result.mcMissing,
      })
      downloadBlob(result.blob, result.filename)
    } catch (err: unknown) {
      const ax = err as {
        response?: { data?: Blob | { detail?: string }; headers?: Record<string, string> }
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
      setError(detail || ax.message || 'Failed to generate Master Sheet.')
    } finally {
      setGenerating(false)
    }
  }, [file, generating])

  const handleDownloadTemplate = useCallback(async () => {
    setError(null)
    try {
      const blob = await masterSheetApi.downloadTemplate()
      downloadBlob(blob, 'Master_Sheet_Template.xlsx')
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to download template.')
    }
  }, [])

  const handleDownloadResult = useCallback(() => {
    if (!resultBlob) return
    downloadBlob(resultBlob, resultFilename)
  }, [resultBlob, resultFilename])

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading…</div>
      </div>
    )
  }

  if (!isSuperadmin) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">Only superadmin can access this page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Master Sheet</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-content-muted">
          Upload a Master Sheet with STYLE, COLOR, DESCRIPTION, SIZE (and carton fields). UPC is
          looked up from the UPC catalog via S/C/S; MC Length/Width/Height come from DIMS by UPC,
          or by Description + size with M/W/K/T sensitivity. Output never writes N/A.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-surface">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-border dark:bg-surface-muted dark:text-slate-100"
          >
            Download template
          </button>
          <button
            type="button"
            disabled={!resultBlob}
            onClick={handleDownloadResult}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-surface-muted dark:text-slate-100"
          >
            Download result
          </button>
        </div>
      </section>

      <section
        onDragEnter={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setIsDragging(false)
        }}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-6 text-center ${
          isDragging
            ? 'border-[#404040] bg-gray-50 dark:bg-surface-muted'
            : 'border-gray-300 bg-white dark:border-border dark:bg-surface'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />
        <p className="text-sm text-gray-700 dark:text-slate-200">
          {file ? (
            <>
              Selected: <span className="font-medium">{file.name}</span>
            </>
          ) : (
            'Drop a Master Sheet .xlsx here, or choose a file'
          )}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-border"
          >
            Upload file
          </button>
          <button
            type="button"
            disabled={!file || generating}
            onClick={() => void handleGenerate()}
            className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? 'Generating…' : 'Generate & download'}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Uses the UPC and DIMS catalogs already saved in the database. Ignore the Manifest tab if
          present in the workbook.
        </p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <p className="font-medium">Generated {success.filename}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-emerald-900">
            <li>{success.totalRows.toLocaleString()} rows</li>
            <li>
              UPC matched {success.upcMatched.toLocaleString()}
              {success.upcMissing > 0 ? ` · missing ${success.upcMissing.toLocaleString()}` : ''}
            </li>
            <li>
              MC dims: {success.mcByUpc.toLocaleString()} by UPC ·{' '}
              {success.mcByDescSize.toLocaleString()} by Description+size
              {success.mcMissing > 0
                ? ` · ${success.mcMissing.toLocaleString()} left blank (not in DIMS)`
                : ''}
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
