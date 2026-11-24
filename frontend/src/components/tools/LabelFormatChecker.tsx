import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  labelFormatCheckerApi,
  type LabelCheckStatus,
  type LabelFileStatus,
  type LabelFormatBox,
  type LabelFormatCheck,
  type LabelFormatCheckResult,
  type LabelFormatFile,
} from '../../services/api'

const ACCEPTED = '.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed'
const ALLOWED_SUFFIXES = ['.pdf', '.zip']

type Filter = 'all' | LabelFileStatus

function isSupported(file: File) {
  const name = file.name.toLowerCase()
  return ALLOWED_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function downloadBase64Xlsx(base64: string, filename: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const FILE_STATUS_META: Record<LabelFileStatus, { label: string; badge: string }> = {
  pass: { label: 'Pass', badge: 'bg-green-100 text-green-800 ring-green-200' },
  review: { label: 'Review', badge: 'bg-amber-100 text-amber-800 ring-amber-200' },
  fail: { label: 'Fail', badge: 'bg-red-100 text-red-800 ring-red-200' },
}

const CHECK_META: Record<LabelCheckStatus, { icon: string; text: string; row: string }> = {
  pass: { icon: '✓', text: 'text-green-600', row: '' },
  warn: { icon: '!', text: 'text-amber-600', row: 'bg-amber-50/60' },
  fail: { icon: '✕', text: 'text-red-600', row: 'bg-red-50/70' },
}

function StatusBadge({ status }: { status: LabelFileStatus }) {
  const meta = FILE_STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${meta.badge}`}
    >
      {meta.label}
    </span>
  )
}

function CheckList({ title, checks }: { title: string; checks: LabelFormatCheck[] }) {
  if (checks.length === 0) return null
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {checks.map((check) => {
          const meta = CHECK_META[check.status]
          return (
            <li key={`${check.id}-${check.page ?? 'f'}`} className={`flex gap-3 px-3 py-2 text-sm ${meta.row}`}>
              <span className={`mt-0.5 w-4 shrink-0 text-center font-bold ${meta.text}`} aria-label={check.status}>
                {meta.icon}
              </span>
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{check.label}</div>
                {check.detail && <div className="break-words text-xs text-gray-600">{check.detail}</div>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function boxSummary(box: LabelFormatBox | undefined) {
  const f = box?.fields
  if (!f) return '—'
  const parts: string[] = []
  if (f.box_number && f.box_total) parts.push(`Box ${f.box_number} of ${f.box_total}`)
  if (f.weight_lb !== undefined) parts.push(`${f.weight_lb} lb`)
  return parts.length ? parts.join(' · ') : '—'
}

function FileDetails({ file }: { file: LabelFormatFile }) {
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-4">
          <CheckList title="File" checks={file.checks} />
          {file.boxes.map((box) => (
            <div key={box.index} className="space-y-4">
              {file.boxes.length > 1 && (
                <p className="text-sm font-semibold text-gray-800">
                  Box {box.index} — {box.fields.box_id || 'Box ID not read'}
                </p>
              )}
              <CheckList
                title={`Box label — page ${box.box_page}`}
                checks={box.checks.filter((c) => c.id.startsWith('box.'))}
              />
              <CheckList
                title={box.ups_page ? `UPS label — page ${box.ups_page}` : 'UPS label'}
                checks={box.checks.filter((c) => c.id.startsWith('ups.'))}
              />
            </div>
          ))}
        </div>

        {file.thumbnails.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Pages checked
            </h4>
            <div className="flex flex-wrap gap-3 lg:flex-col">
              {file.thumbnails.map((thumb) => (
                <figure key={thumb.page} className="w-[306px] max-w-full">
                  <img
                    src={thumb.src}
                    alt={`${file.name} page ${thumb.page}`}
                    className="w-full rounded-md border border-gray-300 bg-white shadow-sm"
                  />
                  <figcaption className="mt-1 text-center text-xs text-gray-500">
                    Page {thumb.page} — {thumb.kind === 'box' ? 'Amazon box label' : 'UPS label'}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LabelFormatChecker() {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LabelFormatCheckResult | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [tableWrapWidth, setTableWrapWidth] = useState<number | null>(null)
  const runId = useRef(0)

  // The results table scrolls sideways on narrow screens. Pin the expanded detail panel to the
  // visible width so its text never runs off the edge of the screen.
  useEffect(() => {
    const el = tableWrapRef.current
    if (!el) return undefined
    const measure = () => setTableWrapWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [result])

  const runCheck = useCallback(async (incoming: File[]) => {
    const id = ++runId.current
    setChecking(true)
    setError(null)
    setResult(null)
    setFilter('all')
    setQuery('')
    setExpanded(new Set())
    try {
      const data = await labelFormatCheckerApi.check(incoming)
      if (id !== runId.current) return
      setResult(data)
      if (data.files.length === 1) setExpanded(new Set([data.files[0].path]))
    } catch (err: unknown) {
      if (id !== runId.current) return
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        'Failed to check the label format.'
      setError(typeof msg === 'string' ? msg : 'Failed to check the label format.')
    } finally {
      if (id === runId.current) setChecking(false)
    }
  }, [])

  const setUpload = useCallback(
    (incoming: FileList | File[] | null) => {
      const list = incoming ? Array.from(incoming) : []
      if (!list.length) return
      const unsupported = list.filter((f) => !isSupported(f))
      if (unsupported.length) {
        setError(
          `Only .pdf and .zip are supported. Unsupported: ${unsupported.map((f) => f.name).join(', ')}`,
        )
        return
      }
      setFiles(list)
      void runCheck(list)
    },
    [runCheck],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setUpload(e.dataTransfer.files)
    },
    [setUpload],
  )

  const reset = useCallback(() => {
    runId.current += 1
    setFiles([])
    setError(null)
    setResult(null)
    setChecking(false)
    setFilter('all')
    setQuery('')
    setExpanded(new Set())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleDownload = useCallback(() => {
    if (!result) return
    try {
      downloadBase64Xlsx(result.report_xlsx_base64, result.report_filename)
    } catch {
      setError('Could not build the report download. Please run the check again.')
    }
  }, [result])

  const visibleFiles = useMemo(() => {
    if (!result) return []
    const q = query.trim().toLowerCase()
    return result.files.filter((f) => {
      if (filter !== 'all' && f.status !== filter) return false
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        f.box_id.toLowerCase().includes(q) ||
        f.shipment_name.toLowerCase().includes(q)
      )
    })
  }, [result, filter, query])

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const summary = result?.summary
  const filterButtons: { id: Filter; label: string; count: number; tone: string }[] = summary
    ? [
        { id: 'all', label: 'All', count: summary.total, tone: 'text-gray-900' },
        { id: 'pass', label: 'Passed', count: summary.passed, tone: 'text-green-700' },
        { id: 'review', label: 'Review', count: summary.review, tone: 'text-amber-700' },
        { id: 'fail', label: 'Failed', count: summary.failed, tone: 'text-red-700' },
      ]
    : []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">SPD Label Format Checker</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload one or more box label <strong>.pdf</strong> files or <strong>.zip</strong> archives of them.
          Each PDF is checked against the Amazon <strong>Thermal Printing - 4x6 inches</strong> box label
          format: the Amazon box label on page 1 and the UPS label on page 2. Review the results below, then
          download the report.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-gray-400'
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
          Drag and drop box label <strong>.pdf</strong> or <strong>.zip</strong> files here, or upload them.
          The check starts automatically.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => {
            setUpload(e.target.files)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={checking}
            className="inline-flex items-center rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          >
            Upload
          </button>
          <button
            type="button"
            disabled={!result || checking}
            onClick={handleDownload}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Download report
          </button>
          {files.length > 0 && (
            <button
              type="button"
              onClick={reset}
              disabled={checking}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>

        {files.length > 0 ? (
          <div className="mx-auto mt-5 max-w-lg space-y-2 text-left">
            {files.length > 1 && (
              <p className="text-xs font-medium text-gray-500">
                {files.length} files selected · {formatSize(files.reduce((sum, f) => sum + f.size, 0))}
              </p>
            )}
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
              {files.map((f) => (
                <li key={`${f.name}-${f.size}-${f.lastModified}`} className="min-w-0">
                  <span className="block truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span className="text-xs text-gray-500">{formatSize(f.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-xs text-gray-400">No files selected</p>
        )}
        {checking && (
          <p className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-600" role="status">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#404040] border-t-transparent" />
            Checking labels…
          </p>
        )}
      </section>

      {result && summary && (
        <section className="space-y-4">
          <div
            className={`rounded-lg border p-4 text-sm ${
              summary.failed > 0
                ? 'border-red-200 bg-red-50 text-red-900'
                : summary.review > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-green-200 bg-green-50 text-green-900'
            }`}
          >
            <strong>{result.source_name}</strong> —{' '}
            {summary.failed > 0
              ? `${summary.failed} of ${summary.total} label PDF${summary.total === 1 ? '' : 's'} do not match the expected format.`
              : summary.review > 0
                ? `All ${summary.total} label PDF${summary.total === 1 ? '' : 's'} match the format; ${summary.review} need${summary.review === 1 ? 's' : ''} a quick review.`
                : `All ${summary.total} label PDF${summary.total === 1 ? '' : 's'} match the expected format.`}
            {summary.skipped > 0 && ` ${summary.skipped} non-label item${summary.skipped === 1 ? '' : 's'} skipped.`}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {filterButtons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilter(btn.id)}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  filter === btn.id
                    ? 'border-[#404040] bg-[#404040] text-white'
                    : `border-gray-300 bg-white hover:bg-gray-50 ${btn.tone}`
                }`}
              >
                {btn.label} <span className="font-semibold">{btn.count}</span>
              </button>
            ))}
            {result.files.length > 1 && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search file, Box ID or shipment"
                className="ml-auto w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm sm:w-72"
              />
            )}
          </div>

          <div ref={tableWrapRef} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-24 px-3 py-2">Result</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Box ID</th>
                  <th className="px-3 py-2">Shipment</th>
                  <th className="px-3 py-2">Box</th>
                  <th className="px-3 py-2">Ship to</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2 text-right">Checks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleFiles.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                      No files match this filter.
                    </td>
                  </tr>
                )}
                {visibleFiles.map((f) => {
                  const open = expanded.has(f.path)
                  const first = f.boxes[0]?.fields
                  const passedChecks = f.total_checks - f.failed_checks - f.warning_checks
                  return (
                    <Fragment key={f.path}>
                      <tr
                        className="cursor-pointer align-top hover:bg-gray-50"
                        onClick={() => toggle(f.path)}
                        aria-expanded={open}
                      >
                        <td className="px-3 py-2">
                          <StatusBadge status={f.status} />
                        </td>
                        <td className="max-w-[18rem] px-3 py-2">
                          <button
                            type="button"
                            className="block max-w-full truncate text-left font-medium text-gray-900 hover:underline"
                            title={f.path}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggle(f.path)
                            }}
                          >
                            <span className="mr-1 inline-block w-3 text-gray-400">{open ? '▾' : '▸'}</span>
                            {f.name}
                          </button>
                          <span className="ml-4 text-xs text-gray-500">
                            {f.page_count} page{f.page_count === 1 ? '' : 's'} · {formatSize(f.size_bytes)}
                            {f.box_count > 1 ? ` · ${f.box_count} boxes` : ''}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{f.box_id || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{f.shipment_name || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{boxSummary(f.boxes[0])}</td>
                        <td className="px-3 py-2">
                          {first?.ship_to_name ? (
                            <>
                              {first.ship_to_name}
                              {first.fulfillment_center && (
                                <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-700">
                                  {first.fulfillment_center}
                                </span>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{first?.created || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                          <span className="text-green-700">{passedChecks} ✓</span>
                          {f.warning_checks > 0 && <span className="ml-2 text-amber-700">{f.warning_checks} !</span>}
                          {f.failed_checks > 0 && <span className="ml-2 text-red-700">{f.failed_checks} ✕</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={8} className="bg-gray-50/70 p-0">
                            <div
                              className="sticky left-0"
                              style={tableWrapWidth ? { width: tableWrapWidth } : undefined}
                            >
                              <FileDetails file={f} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
              <p className="font-semibold text-gray-900">Skipped (not checked)</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {result.skipped.map((item) => (
                  <li key={item.name}>
                    <span className="font-medium">{item.name}</span> — {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">What is checked</h2>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div>
            <p className="font-medium text-gray-800">Page 1 — Amazon box label</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>4.25 × 6 in portrait page with a real text layer (not a scan or screenshot)</li>
              <li>
                <strong>FBA</strong> title and <strong>Box N of M - Xlb</strong>
              </li>
              <li>Ship From and Ship To blocks, shipment name bar and Created time stamp</li>
              <li>Box ID text, and the Code 128 barcode must decode to the same Box ID</li>
              <li>2D barcode, Mixed SKUs / Single SKU block with pack group, and the &ldquo;leave uncovered&rdquo; notice</li>
              <li>Positions of every element, so a shifted or different layout is caught</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-gray-800">Page 2 — UPS label</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>4.25 × 6 in portrait page holding one full-page 4×6 image and nothing else</li>
              <li>
                Layout matches the UPS Ground label used by Amazon: rules, black square, MaxiCode, tracking and
                routing barcodes, and the four datamatrix codes
              </li>
            </ul>
            <p className="mt-3 font-medium text-gray-800">Whole file</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Two pages per box, in order (box label, then UPS label)</li>
              <li>Filename agrees with the label, and no Box ID repeats in the upload</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          <strong>Fail</strong> means the format is wrong. <strong>Review</strong> means the format is right but
          something differs from the usual label (for example a different Ship From, extra text, or a filename that
          does not match). The UPS label is an image, so its tracking number and weight are not read.
        </p>
      </section>
    </div>
  )
}
