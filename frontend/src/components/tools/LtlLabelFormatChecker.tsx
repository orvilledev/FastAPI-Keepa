import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ltlLabelFormatCheckerApi,
  type LabelCheckStatus,
  type LabelFileStatus,
  type LabelFormatCheck,
  type LtlBoxOrder,
  type LtlLabelFile,
  type LtlLabelFormatCheckResult,
  type LtlReorderResult,
} from '../../services/api'

/** The uploaded file a result came from; `member` is the PDF's path inside a ZIP. */
type ReorderSource = { file: File; member?: string }

const ACCEPTED = '.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed'
const ALLOWED_SUFFIXES = ['.pdf', '.zip']

type Filter = 'all' | LabelFileStatus | 'out_of_order'

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function errorMessage(err: unknown, fallback: string) {
  const msg =
    (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
    (err as { message?: string })?.message ||
    fallback
  return typeof msg === 'string' ? msg : fallback
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

function hasOrderProblem(file: LtlLabelFile) {
  return file.box_order?.status === 'fail'
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

function OrderBadge({ order }: { order: LtlBoxOrder | null }) {
  if (!order) return <span className="text-gray-400">—</span>
  if (order.status === 'pass') {
    return <span className="whitespace-nowrap text-xs font-semibold text-green-700">✓ In order</span>
  }
  if (order.status === 'warn') {
    return <span className="whitespace-nowrap text-xs font-semibold text-amber-700">! Review</span>
  }
  return (
    <span className="whitespace-nowrap text-xs font-semibold text-red-700">
      ✕ {order.out_of_order > 0 ? `${order.out_of_order} out of order` : 'Out of order'}
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

function ReorderAction({ order, source }: { order: LtlBoxOrder; source: ReorderSource | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<LtlReorderResult | null>(null)

  const numbers = order.entries.map((e) => e.found).filter((n): n is number => n !== null)
  const range =
    order.mode === 'pack_group'
      ? 'B1 → … in each pack group'
      : numbers.length > 0
        ? `B${Math.min(...numbers)} → B${Math.max(...numbers)}`
        : ''

  let blocked: string | null = null
  if (order.unreadable_pages.length > 0) {
    blocked = `It can't be reordered automatically because the B number could not be read on page ${order.unreadable_pages.join(', ')}.`
  } else if (order.duplicates.length > 0) {
    blocked = `It can't be reordered automatically because the same box number is on more than one page (${order.duplicates
      .map((d) => `B${d}`)
      .join(', ')}). Remove the extra label first.`
  } else if (!source) {
    blocked = 'Upload this PDF on its own to download a reordered copy.'
  }

  const run = async () => {
    if (!source || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await ltlLabelFormatCheckerApi.reorder(source.file, source.member)
      downloadBlob(res.blob, res.filename)
      setDone(res)
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to reorder the PDF.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1">
          <strong className="text-gray-900">Fix the order.</strong> Download one PDF with the same pages sorted{' '}
          {range ? <strong>{range}</strong> : 'by box number'}. Pages are only moved — nothing on any label is
          changed.
        </p>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || blocked !== null}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
          {busy ? 'Reordering…' : 'Download reordered PDF'}
        </button>
      </div>
      {blocked && <p className="mt-2 text-xs text-amber-800">{blocked}</p>}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="mt-2 text-xs text-green-800">
          Downloaded <strong>{done.filename}</strong> — {done.pages} page{done.pages === 1 ? '' : 's'}
          {done.firstBox !== null && done.lastBox !== null && order.mode !== 'pack_group'
            ? `, B${done.firstBox} to B${done.lastBox}`
            : ''}
          ; {done.moved === 0 ? 'no pages needed moving' : `${done.moved} page${done.moved === 1 ? '' : 's'} moved`}, label
          content unchanged.
          {done.missing.length > 0 &&
            ` Still missing from the shipment: ${done.missing.map((m) => `B${m}`).join(', ')}.`}
        </p>
      )}
    </div>
  )
}

function BoxOrderPanel({ order, source }: { order: LtlBoxOrder; source: ReorderSource | null }) {
  const wrong = order.entries.filter((e) => e.ok === false)
  const tone =
    order.status === 'fail'
      ? 'border-red-200 bg-red-50 text-red-900'
      : order.status === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-green-200 bg-green-50 text-green-900'
  const first = order.entries[0]
  const last = order.entries[order.entries.length - 1]

  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Box order (B number)</h4>
      <div className={`rounded-lg border p-3 text-sm ${tone}`}>
        {order.status === 'pass' && (
          <p>
            <strong>In order.</strong>{' '}
            {order.mode === 'pack_group'
              ? `All ${order.entries.length} boxes run from B1 within each pack group.`
              : order.entries.length === 1
                ? `B${first?.expected}`
                : `B${first?.expected} to B${last?.expected}, one box per page.`}
          </p>
        )}
        {order.status === 'warn' && (
          <p>
            <strong>Review.</strong>{' '}
            {order.unreadable_pages.length > 0
              ? `The B number could not be read on page ${order.unreadable_pages.join(', ')}.`
              : `The boxes are in sequence but start at B${order.expected_start}, not B1. That is only correct if this PDF is a later part of a shipment split across several files.`}
          </p>
        )}
        {order.status === 'fail' && (
          <p>
            <strong>Out of order.</strong>{' '}
            {wrong.length > 0 &&
              `${wrong.length} of ${order.entries.length} boxes are not in B1, B2, B3, … order${
                first && first.ok === false ? ` — the PDF starts with B${first.found} instead of B${first.expected}` : ''
              }.`}
            {order.duplicates.length > 0 && ` Repeated: ${order.duplicates.map((d) => `B${d}`).join(', ')}.`}
            {order.missing.length > 0 && ` Missing: ${order.missing.map((m) => `B${m}`).join(', ')}.`}
          </p>
        )}
        <p className="mt-1 text-xs opacity-80">Each tile is one page, in page order, showing the B number printed on it.</p>
      </div>

      {order.status === 'fail' && <ReorderAction order={order} source={source} />}

      <div className="mt-2 flex flex-wrap gap-1">
        {order.entries.map((e) => {
          const cls =
            e.ok === null
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : e.ok
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-300 bg-red-100 text-red-800'
          const title =
            e.ok === null
              ? `Page ${e.page}: B number not readable (expected B${e.expected})`
              : e.ok
                ? `Page ${e.page}: ${e.box_tag} — in position`
                : `Page ${e.page}: ${e.box_tag} — should be B${e.expected}`
          return (
            <span
              key={e.page}
              title={title}
              className={`inline-flex min-w-[3.25rem] flex-col items-center rounded border px-1.5 py-0.5 leading-tight ${cls}`}
            >
              <span className="text-[10px] opacity-70">p{e.page}</span>
              <span className="text-xs font-semibold">{e.found === null ? '?' : `B${e.found}`}</span>
            </span>
          )
        })}
      </div>

      {wrong.length > 0 && (
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">Box ID</th>
                <th className="px-3 py-2">Box tag on label</th>
                <th className="px-3 py-2">Found</th>
                <th className="px-3 py-2">Should be</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {wrong.map((e) => (
                <tr key={e.page} className="bg-red-50/40">
                  <td className="px-3 py-1.5">{e.page}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{e.box_id || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{e.box_tag || '—'}</td>
                  <td className="px-3 py-1.5 font-semibold text-red-700">B{e.found}</td>
                  <td className="px-3 py-1.5 font-semibold text-gray-900">B{e.expected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FileDetails({ file, source }: { file: LtlLabelFile; source: ReorderSource | null }) {
  const [showAllPages, setShowAllPages] = useState(false)
  const pagesWithLabelIssues = useMemo(
    () => file.boxes.filter((b) => b.checks.some((c) => c.id !== 'box.order' && c.status !== 'pass')),
    [file.boxes],
  )
  const shownBoxes = showAllPages ? file.boxes : pagesWithLabelIssues

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-4">
          {file.box_order && <BoxOrderPanel order={file.box_order} source={source} />}
          <CheckList title="File" checks={file.checks} />

          {file.boxes.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Label format — per page</h4>
                <button
                  type="button"
                  onClick={() => setShowAllPages((v) => !v)}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {showAllPages ? 'Show only pages with issues' : `Show all ${file.boxes.length} pages`}
                </button>
              </div>
              {!showAllPages && pagesWithLabelIssues.length === 0 && (
                <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                  All {file.boxes.length} label{file.boxes.length === 1 ? '' : 's'} match the LTL box label format.
                </p>
              )}
              {shownBoxes.map((box) => (
                <CheckList
                  key={box.page}
                  title={`Page ${box.page} — ${box.fields.box_tag || 'box tag not read'} · ${box.fields.box_id || 'Box ID not read'}`}
                  checks={showAllPages ? box.checks : box.checks.filter((c) => c.status !== 'pass')}
                />
              ))}
            </div>
          )}
        </div>

        {file.thumbnails.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Pages preview</h4>
            <div className="flex flex-wrap gap-3 lg:flex-col">
              {file.thumbnails.map((thumb) => (
                <figure key={thumb.page} className="w-[306px] max-w-full">
                  <img
                    src={thumb.src}
                    alt={`${file.name} page ${thumb.page}`}
                    className={`w-full rounded-md border bg-white shadow-sm ${
                      thumb.status === 'fail'
                        ? 'border-red-400 ring-2 ring-red-200'
                        : thumb.status === 'warn'
                          ? 'border-amber-400 ring-2 ring-amber-200'
                          : 'border-gray-300'
                    }`}
                  />
                  <figcaption className="mt-1 text-center text-xs text-gray-500">
                    Page {thumb.page}
                    {thumb.box_tag ? ` — ${thumb.box_tag}` : ''}
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

export default function LtlLabelFormatChecker({ embedded = false }: { embedded?: boolean }) {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LtlLabelFormatCheckResult | null>(null)
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
      const data = await ltlLabelFormatCheckerApi.check(incoming)
      if (id !== runId.current) return
      setResult(data)
      if (data.files.length === 1) setExpanded(new Set([data.files[0].path]))
    } catch (err: unknown) {
      if (id !== runId.current) return
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        'Failed to check the LTL labels.'
      setError(typeof msg === 'string' ? msg : 'Failed to check the LTL labels.')
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
      if (filter === 'out_of_order' && !hasOrderProblem(f)) return false
      if (filter !== 'all' && filter !== 'out_of_order' && f.status !== filter) return false
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        f.shipment_id.toLowerCase().includes(q) ||
        f.shipment_name.toLowerCase().includes(q)
      )
    })
  }, [result, filter, query])

  const sourceFor = useCallback(
    (f: LtlLabelFile): ReorderSource | null => {
      if (!result) return null
      if (result.source_kind === 'pdf') return files.length === 1 ? { file: files[0] } : null
      if (result.source_kind === 'zip') return files.length === 1 ? { file: files[0], member: f.path } : null
      const pdfs = files.filter((u) => u.name.toLowerCase().endsWith('.pdf') && u.name.trim() === f.path)
      if (pdfs.length === 1) return { file: pdfs[0] }
      if (pdfs.length > 1) return null
      const zips = files.filter((u) => u.name.toLowerCase().endsWith('.zip') && f.path.startsWith(`${u.name.trim()}/`))
      if (zips.length !== 1) return null
      return { file: zips[0], member: f.path.slice(zips[0].name.trim().length + 1) }
    },
    [files, result],
  )

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
        { id: 'out_of_order', label: 'Out of order', count: summary.out_of_order, tone: 'text-red-700' },
      ]
    : []

  return (
    <div className={embedded ? 'w-full space-y-6' : 'mx-auto max-w-6xl space-y-6'}>
      {!embedded && (
        <header>
          <h1 className="text-2xl font-bold text-gray-900">LTL Label Format Checker</h1>
          <p className="mt-1 text-sm text-gray-600">
            Upload one or more LTL box label <strong>.pdf</strong> files or <strong>.zip</strong> archives of them.
            Each page is checked against the Amazon LTL box label format (one 4x6 in label per box), and the box
            tags are checked to run <strong>B1, B2, B3, …</strong> in page order. Review the results below, then
            download the report.
          </p>
        </header>
      )}

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
          Drag and drop LTL label <strong>.pdf</strong> or <strong>.zip</strong> files here, or upload them. The
          check starts automatically.
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
              ? `${summary.failed} of ${summary.total} label PDF${summary.total === 1 ? '' : 's'} need${summary.failed === 1 ? 's' : ''} fixing.`
              : summary.review > 0
                ? `All ${summary.total} label PDF${summary.total === 1 ? '' : 's'} pass; ${summary.review} need${summary.review === 1 ? 's' : ''} a quick review.`
                : `All ${summary.total} label PDF${summary.total === 1 ? '' : 's'} match the LTL format with boxes in order.`}
            {summary.out_of_order > 0 &&
              ` ${summary.out_of_order} PDF${summary.out_of_order === 1 ? ' has' : 's have'} boxes out of order (B numbers not running B1, B2, B3, …).`}
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
                placeholder="Search file, shipment ID or name"
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
                  <th className="px-3 py-2">Box order</th>
                  <th className="px-3 py-2">Shipment</th>
                  <th className="px-3 py-2">Boxes</th>
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
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <OrderBadge order={f.box_order} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="whitespace-nowrap font-mono text-xs">{f.shipment_id || '—'}</div>
                          {f.shipment_name && <div className="text-xs text-gray-600">{f.shipment_name}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{f.box_count || '—'}</td>
                        <td className="px-3 py-2">{first?.ship_to_name || '—'}</td>
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
                              <FileDetails file={f} source={sourceFor(f)} />
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
            <p className="font-medium text-gray-800">Every page — Amazon LTL box label</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>4.25 × 6 in portrait page with a real text layer (not a scan or screenshot)</li>
              <li>
                &ldquo;PLEASE LEAVE THIS LABEL UNCOVERED&rdquo; across the top, the <strong>FBA</strong> title and,
                when present, the <strong>Mixed</strong> badge
              </li>
              <li>Ship From and Ship To blocks, shipment name bar and Created time stamp</li>
              <li>Box ID text, and the Code 128 barcode must decode to the same Box ID</li>
              <li>
                2D barcode, and the Mixed SKUs / Single SKU block ending with the box tag (
                <strong>P1 - B1</strong> or <strong>FBA… - B1</strong>)
              </li>
              <li>Positions of every element, so a shifted or different layout is caught</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-gray-800">Box order</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                The <strong>B</strong> number on the box tag is the box number. Page 1 must be <strong>B1</strong>,
                page 2 <strong>B2</strong>, and so on
              </li>
              <li>Every page that is out of position is flagged with the B number it should have</li>
              <li>Missing and repeated box numbers are flagged too</li>
              <li>
                When the order is wrong, <strong>Download reordered PDF</strong> saves one file with the same pages
                sorted B1, B2, B3, … — only the page order changes
              </li>
            </ul>
            <p className="mt-3 font-medium text-gray-800">Whole file</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>One box label per page, all from the same shipment</li>
              <li>Filename agrees with the label, and no Box ID repeats in the upload</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          <strong>Fail</strong> means the label format is wrong or the boxes are out of order. <strong>Review</strong>{' '}
          means the format is right but something differs from the usual label (for example a different Ship From,
          extra text, or a filename that does not match).
        </p>
      </section>
    </div>
  )
}
