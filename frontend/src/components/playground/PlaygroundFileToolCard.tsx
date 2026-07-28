import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaygroundToolDef } from '../../lib/playground/catalog'
import { auditAction } from '../../lib/auditEvents'
import {
  PLAYGROUND_EXPECTED_ACCEPT,
  comparePlaygroundOutputs,
  isComparableExpectedFile,
} from '../../lib/playground/outputComparison'
import { getPlaygroundRunner } from '../../lib/playground/runners'
import {
  formatBytes,
  getPlaygroundExpectedFiles,
  getPlaygroundStoredInput,
  removePlaygroundExpectedFile,
  removePlaygroundStoredInput,
  savePlaygroundExpectedFiles,
  savePlaygroundStoredInput,
  storedInputToSessionFixture,
  type PlaygroundExpectedFile,
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

type Props = {
  tool: PlaygroundToolDef
  userScope: string
  onRemoveTool: (toolId: string) => void
}

/**
 * Shared playground card for any tool with a registered runner:
 * upload (persists) → Run test → success/fail report → typed downloads (session-only).
 */
export default function PlaygroundFileToolCard({
  tool,
  userScope,
  onRemoveTool,
}: Props) {
  const runner = getPlaygroundRunner(tool)
  const [fixture, setFixture] = useState<PlaygroundSessionFixture | null>(null)
  const [loadingFixture, setLoadingFixture] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progressDetail, setProgressDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [expectedFiles, setExpectedFiles] = useState<PlaygroundExpectedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const expectedInputRef = useRef<HTMLInputElement>(null)

  const reloadFixture = useCallback(async () => {
    setLoadingFixture(true)
    setError(null)
    try {
      const [stored, expected] = await Promise.all([
        getPlaygroundStoredInput(userScope, tool.id),
        getPlaygroundExpectedFiles(userScope, tool.id),
      ])
      setFixture(stored ? storedInputToSessionFixture(stored) : null)
      setExpectedFiles(expected)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load playground fixture.')
      setFixture(null)
      setExpectedFiles([])
    } finally {
      setLoadingFixture(false)
    }
  }, [userScope, tool.id])

  useEffect(() => {
    void reloadFixture()
  }, [reloadFixture])

  const handleUpload = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !runner) return
      if (!runner.isFileAllowed(file)) {
        setError(`Unsupported file. Upload ${runner.acceptHint}.`)
        return
      }
      setBusy(true)
      setError(null)
      try {
        const stored = await savePlaygroundStoredInput(userScope, tool.id, file)
        setFixture(storedInputToSessionFixture(stored))
        auditAction(
          'playground.fixture_upload',
          `Uploaded a ${tool.label} playground test file: ${file.name}`,
          { tool: tool.id, filename: file.name, bytes: file.size },
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setBusy(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [runner, tool.id, userScope],
  )

  const handleRemoveFile = useCallback(async () => {
    if (!fixture) return
    if (
      !window.confirm(
        `Remove the uploaded ${tool.label} test file? You will need to upload again before running a test.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await removePlaygroundStoredInput(userScope, tool.id)
      setFixture(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      auditAction(
        'playground.fixture_remove',
        `Removed the ${tool.label} playground test file`,
        { tool: tool.id },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove fixture.')
    } finally {
      setBusy(false)
    }
  }, [fixture, tool.id, tool.label, userScope])

  const handleUploadExpected = useCallback(
    async (files: FileList | null | undefined) => {
      const picked = Array.from(files || [])
      if (picked.length === 0) return
      const rejected = picked.filter((f) => !isComparableExpectedFile(f))
      if (rejected.length > 0) {
        setError(
          `Cannot compare ${rejected.map((f) => f.name).join(', ')}. Upload an Excel, PDF, ZIP, CSV, or text file.`,
        )
        return
      }
      setBusy(true)
      setError(null)
      try {
        const saved = await savePlaygroundExpectedFiles(userScope, tool.id, picked)
        setExpectedFiles(saved)
        auditAction(
          'playground.fixture_upload',
          `Uploaded ${picked.length} expected ${tool.label} output file(s): ${picked.map((f) => f.name).join(', ')}`,
          { tool: tool.id, role: 'expected_output', count: picked.length },
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Expected output upload failed.')
      } finally {
        setBusy(false)
        if (expectedInputRef.current) expectedInputRef.current.value = ''
      }
    },
    [tool.id, tool.label, userScope],
  )

  const handleRemoveExpected = useCallback(
    async (filename: string) => {
      setBusy(true)
      setError(null)
      try {
        setExpectedFiles(await removePlaygroundExpectedFile(userScope, tool.id, filename))
        auditAction(
          'playground.fixture_remove',
          `Removed an expected ${tool.label} output file: ${filename}`,
          { tool: tool.id, role: 'expected_output', filename },
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not remove expected output.')
      } finally {
        setBusy(false)
      }
    },
    [tool.id, tool.label, userScope],
  )

  const handleRun = useCallback(async () => {
    if (!fixture || !runner) {
      setError('Upload a test file first.')
      return
    }
    setBusy(true)
    setProgressDetail(null)
    setError(null)
    try {
      const result = await runner.run(fixture.file, (p) => {
        setProgressDetail(p.detail || `${p.percent}%`)
      })
      let finalResult = result
      if (expectedFiles.length > 0) {
        setProgressDetail('comparing to expected output')
        finalResult = {
          ...result,
          comparison: await comparePlaygroundOutputs(result.outputs, expectedFiles),
        }
      }
      setFixture((prev) => (prev ? { ...prev, lastRun: finalResult } : prev))
      const verdict = finalResult.comparison
        ? finalResult.comparison.status === 'pass'
          ? 'SUCCESS'
          : 'FAILED'
        : result.ok
          ? 'successful'
          : 'failed'
      auditAction(
        'playground.run',
        `Ran the ${tool.label} playground test: ${verdict}`,
        {
          tool: tool.id,
          filename: fixture.filename,
          ok: result.ok,
          compared: expectedFiles.length,
          verdict,
        },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test run failed.')
      auditAction('playground.run', `Ran the ${tool.label} playground test: failed`, {
        tool: tool.id,
        filename: fixture.filename,
        ok: false,
      })
    } finally {
      setBusy(false)
      setProgressDetail(null)
    }
  }, [expectedFiles, fixture, runner, tool.id, tool.label])

  const handleDownload = useCallback(
    (kind: 'excel' | 'pdf' | 'other') => {
      const run = fixture?.lastRun
      if (!run?.ok) return
      const output = (run.outputs || []).find((o) => o.kind === kind)
      if (!output?.bytes || !output.filename) return
      downloadBytes(output.bytes, output.filename, output.mimeType)
      auditAction(
        'playground.download',
        `Downloaded a ${tool.label} playground output: ${output.filename}`,
        { tool: tool.id, kind, filename: output.filename },
      )
    },
    [fixture, tool.id, tool.label],
  )

  if (!runner) {
    return null
  }

  const lastRun = fixture?.lastRun ?? null
  const comparison = lastRun?.comparison ?? null
  // With an expected output uploaded, the comparison decides the verdict; otherwise
  // the panel keeps reporting only whether the tool ran without error.
  const passed = comparison ? comparison.status === 'pass' : Boolean(lastRun?.ok)

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-content-primary">
            {tool.label}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-content-muted">
            {runner.description}
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
                Drop a test file here ({runner.acceptHint}), or choose a file — same inputs as the
                live {tool.label} tool.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={runner.accept}
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

          <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-border">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-content-primary">
                  Expected output (optional)
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-content-muted">
                  Upload the known-correct output file. Each run is compared against it and
                  reported as SUCCESS or FAILED.
                </p>
              </div>
              <input
                ref={expectedInputRef}
                type="file"
                multiple
                accept={PLAYGROUND_EXPECTED_ACCEPT}
                className="hidden"
                onChange={(e) => void handleUploadExpected(e.target.files)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => expectedInputRef.current?.click()}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-border dark:bg-surface dark:text-content-primary dark:hover:bg-surface-hover"
              >
                Upload expected output
              </button>
            </div>

            {expectedFiles.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-content-muted">
                None uploaded — runs report only whether the tool completed, without a
                pass/fail comparison.
              </p>
            ) : (
              <ul className="mt-3 space-y-1">
                {expectedFiles.map((file) => (
                  <li
                    key={file.filename}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-1.5 text-sm dark:bg-surface-muted"
                  >
                    <span className="text-gray-800 dark:text-content-primary">
                      {file.filename}
                      <span className="ml-2 text-xs text-gray-500 dark:text-content-muted">
                        {formatBytes(file.size)} · added {formatWhen(file.uploadedAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRemoveExpected(file.filename)}
                      className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !fixture}
              onClick={() => void handleRun()}
              className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e2e2e] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              {busy
                ? progressDetail
                  ? `Running… ${progressDetail}`
                  : 'Working…'
                : 'Run test'}
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
                passed
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30'
                  : 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
              }`}
            >
              <p
                className={`font-semibold ${comparison ? 'text-base tracking-wide' : 'text-sm'} ${
                  passed
                    ? 'text-emerald-800 dark:text-emerald-300'
                    : 'text-red-800 dark:text-red-300'
                }`}
              >
                {comparison
                  ? passed
                    ? 'SUCCESS'
                    : 'FAILED'
                  : lastRun.ok
                    ? 'Testing successful'
                    : 'Testing failed'}
              </p>
              <p
                className={`mt-1 text-sm ${
                  passed
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-300'
                }`}
              >
                {comparison
                  ? passed
                    ? 'Output matches the expected output file.'
                    : 'Output does not match the expected output file.'
                  : lastRun.message}
              </p>
              <p className="mt-2 text-xs font-medium text-gray-600 dark:text-content-secondary">
                Test snapshot: {formatWhen(lastRun.ranAt)}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-content-muted">
                Outputs clear on refresh. Your uploaded file stays — click Run test again for a new
                snapshot.
              </p>
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-gray-700 dark:text-content-secondary">
                {comparison && !lastRun.ok && <li>Run error: {lastRun.message}</li>}
                {lastRun.summaryLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              {comparison && (
                <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-border">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-content-secondary">
                    Expected output comparison
                  </p>
                  {comparison.entries.map((entry) => (
                    <div key={entry.expectedFilename} className="text-sm">
                      <p
                        className={
                          entry.matched
                            ? 'font-medium text-emerald-800 dark:text-emerald-300'
                            : 'font-medium text-red-800 dark:text-red-300'
                        }
                      >
                        {entry.matched ? 'Identical' : 'Different'} — {entry.expectedFilename}
                        {entry.actualFilename && entry.actualFilename !== entry.expectedFilename
                          ? ` vs ${entry.actualFilename}`
                          : ''}
                        <span className="ml-1 font-normal text-gray-500 dark:text-content-muted">
                          ({entry.method})
                        </span>
                      </p>
                      {entry.differences.length > 0 && (
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-red-700 dark:text-red-300">
                          {entry.differences.map((line, i) => (
                            <li key={`${entry.expectedFilename}-${i}`}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {comparison.uncheckedOutputs.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-content-muted">
                      Not compared (no expected file uploaded):{' '}
                      {comparison.uncheckedOutputs.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
