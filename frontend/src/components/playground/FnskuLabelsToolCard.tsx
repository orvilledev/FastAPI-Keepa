import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FNSKU_PLAYGROUND_ACCEPT,
  FNSKU_PLAYGROUND_APP_ID,
  isFnskuPlaygroundFileAllowed,
  runFnskuLabelsPlayground,
} from '../../lib/playground/fnskuLabelsRunner'
import {
  formatBytes,
  getPlaygroundStoredInput,
  removePlaygroundStoredInput,
  savePlaygroundStoredInput,
  storedInputToSessionFixture,
  type PlaygroundSessionFixture,
} from '../../lib/playground/storage'
import type { PlaygroundToolDef } from '../../lib/playground/catalog'

function downloadBytes(bytes: ArrayBuffer, filename: string, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

type Props = {
  tool: PlaygroundToolDef
  userScope: string
  onRemoveTool: (toolId: string) => void
}

/** Full FNSKU Labels sandbox card (upload persists; run outputs are session-only). */
export default function FnskuLabelsToolCard({ tool, userScope, onRemoveTool }: Props) {
  const [fixture, setFixture] = useState<PlaygroundSessionFixture | null>(null)
  const [loadingFixture, setLoadingFixture] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reloadFixture = useCallback(async () => {
    setLoadingFixture(true)
    setError(null)
    try {
      const stored = await getPlaygroundStoredInput(userScope, FNSKU_PLAYGROUND_APP_ID)
      setFixture(stored ? storedInputToSessionFixture(stored) : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load playground fixture.')
      setFixture(null)
    } finally {
      setLoadingFixture(false)
    }
  }, [userScope])

  useEffect(() => {
    void reloadFixture()
  }, [reloadFixture])

  const handleUpload = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      if (!isFnskuPlaygroundFileAllowed(file)) {
        setError('Unsupported file. Upload .csv, .xlsx, .xls, .xlsm, or .zip.')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const stored = await savePlaygroundStoredInput(
          userScope,
          FNSKU_PLAYGROUND_APP_ID,
          file,
        )
        setFixture(storedInputToSessionFixture(stored))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setBusy(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [userScope],
  )

  const handleRemoveFile = useCallback(async () => {
    if (!fixture) return
    if (
      !window.confirm(
        'Remove the uploaded FNSKU test file? You will need to upload again before running a test.',
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await removePlaygroundStoredInput(userScope, FNSKU_PLAYGROUND_APP_ID)
      setFixture(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove fixture.')
    } finally {
      setBusy(false)
    }
  }, [fixture, userScope])

  const handleRun = useCallback(async () => {
    if (!fixture) {
      setError('Upload a test file first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await runFnskuLabelsPlayground(fixture.file)
      setFixture((prev) => (prev ? { ...prev, lastRun: result } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test run failed.')
    } finally {
      setBusy(false)
    }
  }, [fixture])

  const handleDownload = useCallback(
    (kind: 'excel' | 'pdf' | 'other') => {
      const run = fixture?.lastRun
      if (!run?.ok) return
      const output = (run.outputs || []).find((o) => o.kind === kind)
      if (!output?.bytes || !output.filename) return
      downloadBytes(output.bytes, output.filename, output.mimeType)
    },
    [fixture],
  )

  const lastRun = fixture?.lastRun ?? null

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-content-primary">
            {tool.label}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-content-muted">
            Same parse → Excel + PDF pipeline as the live tool, without writing label history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
            Runner ready
          </span>
          <button
            type="button"
            onClick={() => onRemoveTool(tool.id)}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-border dark:text-content-secondary dark:hover:bg-surface-hover"
          >
            Remove from playground
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {loadingFixture ? (
        <p className="text-sm text-gray-500">Loading uploaded test file…</p>
      ) : (
        <>
          <div
            className={`rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              isDragging
                ? 'border-[#404040] bg-gray-50 dark:border-slate-400 dark:bg-surface-muted'
                : 'border-gray-300 dark:border-border'
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              void handleUpload(e.dataTransfer.files?.[0])
            }}
          >
            {fixture ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-gray-900 dark:text-content-primary">
                  Uploaded test file: {fixture.filename}
                </p>
                <p className="text-gray-500 dark:text-content-muted">
                  {formatBytes(fixture.size)} · uploaded {formatWhen(fixture.uploadedAt)}
                </p>
                {!lastRun && (
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Ready — click Run test for a fresh snapshot.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-content-secondary">
                Drop an Amazon FBA shipment export here ({tool.acceptHint || FNSKU_PLAYGROUND_ACCEPT}
                ), or choose a file.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={tool.accept || FNSKU_PLAYGROUND_ACCEPT}
                className="hidden"
                onChange={(e) => void handleUpload(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-border dark:bg-surface dark:text-content-primary dark:hover:bg-surface-hover"
              >
                {fixture ? 'Replace file' : 'Upload test file'}
              </button>
              {fixture && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemoveFile()}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  Remove file
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !fixture}
              onClick={() => void handleRun()}
              className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e2e2e] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              {busy ? 'Working…' : 'Run test'}
            </button>
            {lastRun?.ok &&
              (lastRun.outputs || []).map((output) => (
                <button
                  key={output.kind}
                  type="button"
                  disabled={busy}
                  onClick={() => handleDownload(output.kind)}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  Download {output.label}
                </button>
              ))}
          </div>

          {lastRun && (
            <div
              className={`rounded-lg border px-4 py-3 ${
                lastRun.ok
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30'
                  : 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
              }`}
            >
              <p
                className={`text-sm font-semibold ${
                  lastRun.ok
                    ? 'text-emerald-800 dark:text-emerald-300'
                    : 'text-red-800 dark:text-red-300'
                }`}
              >
                {lastRun.ok ? 'Testing successful' : 'Testing failed'}
              </p>
              <p
                className={`mt-1 text-sm ${
                  lastRun.ok
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-300'
                }`}
              >
                {lastRun.message}
              </p>
              <p className="mt-2 text-xs font-medium text-gray-600 dark:text-content-secondary">
                Test snapshot: {formatWhen(lastRun.ranAt)}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-content-muted">
                Outputs clear on refresh. Your uploaded file stays — click Run test again for a new
                snapshot.
              </p>
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-gray-700 dark:text-content-secondary">
                {lastRun.summaryLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
