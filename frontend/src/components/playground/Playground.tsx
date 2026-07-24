import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { canAccessPlayground } from '../../lib/playground/access'
import {
  FNSKU_PLAYGROUND_ACCEPT,
  FNSKU_PLAYGROUND_APP_ID,
  isFnskuPlaygroundFileAllowed,
  runFnskuLabelsPlayground,
} from '../../lib/playground/fnskuLabelsRunner'
import {
  clearLegacyPlaygroundIndexedDb,
  formatBytes,
  type PlaygroundSessionFixture,
} from '../../lib/playground/storage'

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

/**
 * Testing Playground — isolated from production tools.
 * Session-only: upload + results live in memory and clear on refresh or close,
 * so each run reflects the app state at that date/time.
 */
export default function Playground() {
  const { userInfo, authUser, isSuperadmin, userInfoLoading } = useUser()
  const email = userInfo?.email || authUser?.email || null
  const allowed = canAccessPlayground(email, isSuperadmin)

  const [fixture, setFixture] = useState<PlaygroundSessionFixture | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    clearLegacyPlaygroundIndexedDb()
  }, [])

  const handleUpload = useCallback(async (file: File | null | undefined) => {
    if (!file) return
    if (!isFnskuPlaygroundFileAllowed(file)) {
      setError('Unsupported file. Upload .csv, .xlsx, .xls, .xlsm, or .zip.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setFixture({
        appId: FNSKU_PLAYGROUND_APP_ID,
        file,
        filename: file.name,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        lastRun: null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [])

  const handleRemove = useCallback(() => {
    if (!fixture) return
    if (
      !window.confirm(
        'Clear this session’s FNSKU test file and any outputs? (They also clear when you refresh or close the app.)',
      )
    ) {
      return
    }
    setError(null)
    setFixture(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [fixture])

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

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#404040] border-t-transparent" />
      </div>
    )
  }

  if (!allowed) {
    return <Navigate to="/dashboard" replace />
  }

  const lastRun = fixture?.lastRun ?? null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-content-primary">
          Testing Playground
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-content-muted">
          Run a one-time check of an app at this moment. Upload a fixture, run the test, then
          download outputs. Refreshing or closing MSW Overwatch clears the session so the next test
          is a fresh snapshot of the app. Does not change Daily Runs, MAP, warehouse data, or the
          live FNSKU Labels tool.
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
        Session only — test files and outputs disappear when you refresh or close the app. Re-upload
        and re-run to check the current app state.
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-content-primary">
              FNSKU Labels
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-content-muted">
              Same parse → Excel + PDF pipeline as the live tool, without writing label history.
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-surface-muted dark:text-content-secondary">
            App id: {FNSKU_PLAYGROUND_APP_ID}
          </span>
        </div>

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
                Session test file: {fixture.filename}
              </p>
              <p className="text-gray-500 dark:text-content-muted">
                {formatBytes(fixture.size)} · uploaded {formatWhen(fixture.uploadedAt)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-content-secondary">
              Drop an Amazon FBA shipment export here (.csv, .xlsx, or .zip), or choose a file.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={FNSKU_PLAYGROUND_ACCEPT}
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
                onClick={handleRemove}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                Clear session
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
              This result is for this session only. Refresh or close the app to start a fresh test.
            </p>
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-gray-700 dark:text-content-secondary">
              {lastRun.summaryLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
