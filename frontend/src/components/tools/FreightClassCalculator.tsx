import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useUser } from '../../contexts/UserContext'
import {
  freightClassCalculatorApi,
  type FreightCalculationResult,
  type FreightShipmentResult,
} from '../../services/api'
import { auditAction } from '../../lib/auditEvents'
import { canAccessFreightClassCalculator } from '../../lib/freightClassAccess'
import { classBadgeStyle, copySummaryToClipboard } from '../../utils/freightClassExport'

const ACCEPTED =
  '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

const TEMPLATE_FILENAME = 'Freight Class Calculator Template.xlsx'

const NMFC_SCALE = [
  ['50+', '50'],
  ['35 – 50', '55'],
  ['30 – 35', '60'],
  ['22.5 – 30', '65'],
  ['15 – 22.5', '70'],
  ['12 – 15', '85'],
  ['10 – 12', '92.5'],
  ['8 – 10', '100'],
  ['6 – 8', '125'],
  ['4 – 6', '175'],
  ['2 – 4', '250'],
  ['1 – 2', '300'],
  ['< 1', '400'],
] as const

type ManualRow = {
  id: string
  pallets: string
  weight: string
  length: string
  width: string
  height: string
}

type TabId = 'bulk' | 'manual'

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

function emptyRow(): ManualRow {
  return {
    id: crypto.randomUUID(),
    pallets: '1',
    weight: '',
    length: '48',
    width: '40',
    height: '',
  }
}

function totalPallets(shipment: FreightShipmentResult): number {
  return shipment.line_items.reduce((sum, li) => sum + li.pallets, 0)
}

function IconBox({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#404040]/12 text-[#404040] dark:bg-white/12 dark:text-white">
      {children}
    </span>
  )
}

function Field({
  label,
  value,
  onChange,
  min,
  step,
  type = 'number',
  className = '',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  min?: number
  step?: number | 'any'
  type?: 'number' | 'text'
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {label}
      </span>
      <input
        type={type}
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm tabular-nums text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-[#81B81D] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81B81D]/25 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-100 dark:focus:bg-gray-800"
      />
    </label>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl border border-gray-300 bg-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-100/80 dark:border-gray-600 dark:bg-gray-800/50"
    >
      <span
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[#81B81D]' : 'bg-border-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-gray-600 dark:text-gray-400">{description}</span>
      </span>
    </button>
  )
}

function ClassBadge({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-4 py-2 text-2xl font-bold',
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg border font-semibold tabular-nums ${sizes[size]} ${classBadgeStyle(value)}`}
    >
      {value}
    </span>
  )
}

function ShipmentResultCard({ shipment }: { shipment: FreightShipmentResult }) {
  return (
    <article className="group rounded-2xl border border-gray-300 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-gray-600 dark:bg-surface">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-gray-800 dark:text-gray-200">{shipment.shipment_id}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-gray-600 dark:text-gray-400">
            <span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{totalPallets(shipment)}</span> pallets
            </span>
            <span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{shipment.total_weight_lbs.toFixed(0)}</span> lbs
            </span>
            <span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{shipment.total_cubic_feet.toFixed(2)}</span> ft³
            </span>
            <span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{shipment.density_pcf.toFixed(2)}</span> lb/ft³
            </span>
          </div>
          {shipment.height_rule_applied && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
              75″ rule applied
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start sm:items-end">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Freight class
          </span>
          <div className="mt-1">
            <ClassBadge value={shipment.freight_class} size="lg" />
          </div>
        </div>
      </div>
    </article>
  )
}

function ResultsPanel({
  result,
  loading,
  copySuccess,
  onCopy,
  onDownload,
}: {
  result: FreightCalculationResult
  loading: boolean
  copySuccess: boolean
  onCopy: () => void
  onDownload: () => void
}) {
  const classes = Object.entries(result.summary.class_breakdown).sort(
    ([a], [b]) => Number(a) - Number(b),
  )

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-gray-700">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">Results</h2>
          <p className="mt-1 text-base text-gray-600 dark:text-gray-400">
            {result.summary.shipment_count} shipment{result.summary.shipment_count === 1 ? '' : 's'}{' '}
            calculated
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {copySuccess ? (
              <>
                <CheckIcon className="h-4 w-4 text-[#81B81D]" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                Copy
              </>
            )}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-[#404040] px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2a2a2a] disabled:opacity-50"
          >
            <DownloadIcon className="h-4 w-4" />
            Excel
          </button>
        </div>
      </div>

      {classes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {classes.map(([cls, count]) => (
            <span
              key={cls}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium ${classBadgeStyle(Number(cls))}`}
            >
              Class {cls}
              <span className="rounded-full bg-black/5 px-1.5 py-px text-xs dark:bg-white/10">
                {count}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {result.shipments.map((shipment) => (
          <ShipmentResultCard key={shipment.shipment_id} shipment={shipment} />
        ))}
      </div>
    </section>
  )
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  )
}

function TruckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  )
}

export default function FreightClassCalculator() {
  const { isSuperadmin, userInfo, authUser } = useUser()
  const canUse = canAccessFreightClassCalculator(userInfo?.email || authUser?.email, isSuperadmin)
  const [activeTab, setActiveTab] = useState<TabId>('manual')
  const [skipSeventyFiveRule, setSkipSeventyFiveRule] = useState(false)
  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyRow()])
  const [manualShipmentId, setManualShipmentId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FreightCalculationResult | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [showReference, setShowReference] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetResults = useCallback(() => {
    setError(null)
    setResult(null)
    setCopySuccess(false)
  }, [])

  const acceptFile = useCallback(
    (incoming: File | null | undefined) => {
      resetResults()
      if (!incoming) return
      const name = incoming.name.toLowerCase()
      if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
        setError('Only .xlsx Excel files are supported.')
        setFile(null)
        return
      }
      setFile(incoming)
    },
    [resetResults],
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

  const parseManualRows = useCallback(() => {
    const lineItems = manualRows
      .map((row) => ({
        pallets: Number(row.pallets),
        weight: Number(row.weight),
        length: Number(row.length),
        width: Number(row.width),
        height: Number(row.height),
      }))
      .filter(
        (row) =>
          row.pallets > 0 &&
          row.weight > 0 &&
          row.length > 0 &&
          row.width > 0 &&
          row.height > 0 &&
          Number.isFinite(row.pallets) &&
          Number.isFinite(row.weight) &&
          Number.isFinite(row.length) &&
          Number.isFinite(row.width) &&
          Number.isFinite(row.height),
      )

    if (lineItems.length === 0) {
      throw new Error('Enter at least one complete pallet row with positive values.')
    }
    return lineItems
  }, [manualRows])

  const runCalculation = useCallback(async () => {
    setLoading(true)
    resetResults()
    try {
      let data: FreightCalculationResult
      if (activeTab === 'bulk') {
        if (!file) throw new Error('Choose an Excel file to upload.')
        data = await freightClassCalculatorApi.calculateFile(file, skipSeventyFiveRule)
        auditAction('freight_class.bulk_calculate', `Calculated ${data.summary.shipment_count} shipments`)
      } else {
        const lineItems = parseManualRows()
        data = await freightClassCalculatorApi.calculateManual({
          shipment_id: manualShipmentId.trim() || 'Manual Entry',
          skip_seventy_five_inch_rule: skipSeventyFiveRule,
          line_items: lineItems,
        })
        auditAction('freight_class.manual_calculate', `Calculated manual entry (${lineItems.length} rows)`)
      }
      setResult(data)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Calculation failed.'
      setError(typeof msg === 'string' ? msg : 'Calculation failed.')
    } finally {
      setLoading(false)
    }
  }, [activeTab, file, manualShipmentId, parseManualRows, resetResults, skipSeventyFiveRule])

  const handleCopy = useCallback(async () => {
    if (!result) return
    try {
      await copySummaryToClipboard(result)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2500)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }, [result])

  const handleDownloadExcel = useCallback(async () => {
    if (!result) return
    setLoading(true)
    setError(null)
    try {
      const { blob, filename } = await freightClassCalculatorApi.exportExcel(result)
      downloadBlob(blob, filename)
      auditAction('freight_class.export', `Exported ${filename}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setLoading(false)
    }
  }, [result])

  const handleDownloadTemplate = useCallback(async () => {
    setError(null)
    try {
      const { blob, filename } = await freightClassCalculatorApi.downloadTemplate()
      downloadBlob(blob, filename)
      auditAction('freight_class.template_download', `Downloaded ${TEMPLATE_FILENAME}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Template download failed.')
    }
  }, [])

  const clearAll = useCallback(() => {
    setFile(null)
    setResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  if (!canUse) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <div className="max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <IconBox>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </IconBox>
          <h2 className="mt-4 text-lg font-semibold text-content">Access restricted</h2>
          <p className="mt-2 text-sm text-content-muted">This tool is limited to authorized users.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-1 pb-16 pt-2">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <IconBox>
            <TruckIcon className="h-5 w-5" />
          </IconBox>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-2xl">
              Freight Class Calculator
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              NMFC density scale · XPO-compatible logic
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            className="hidden shrink-0 text-sm font-medium text-gray-600 underline-offset-2 hover:text-[#81B81D] hover:underline dark:text-gray-400 sm:block"
          >
            Template
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 inline-flex rounded-full border border-gray-300 bg-gray-100 p-1 dark:border-gray-600 dark:bg-gray-800/60">
        {(
          [
            ['manual', 'Manual'],
            ['bulk', 'Bulk upload'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setActiveTab(id)
              resetResults()
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:ring-gray-600'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Input card */}
      <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-md sm:p-6 dark:border-gray-600 dark:bg-surface">
        <Toggle
          checked={skipSeventyFiveRule}
          onChange={setSkipSeventyFiveRule}
          label="Skip 75″ height rule"
          description="When off, pallet heights from 75–95″ are treated as 96″ before density is calculated."
        />

        <div className="mt-6">
          {activeTab === 'bulk' ? (
            <div className="relative">
              <input
                id="freight-bulk-file-input"
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                onChange={(e) => {
                  acceptFile(e.target.files?.[0])
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              />
              <label
                htmlFor="freight-bulk-file-input"
                className={`block cursor-pointer rounded-xl border-2 border-dashed transition-all ${
                  isDragging
                    ? 'border-[#81B81D] bg-[#81B81D]/5'
                    : file
                      ? 'border-[#81B81D]/40 bg-[#81B81D]/[0.03]'
                      : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800/40'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <div
                    className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                      file ? 'bg-[#81B81D]/15 text-[#81B81D]' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <UploadIcon className="h-6 w-6" />
                  </div>
                  {file ? (
                    <>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{file.name}</p>
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                        {(file.size / 1024).toFixed(1)} KB · Click to replace
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-800 dark:text-gray-200">
                        Drop <span className="font-medium">.xlsx</span> here or{' '}
                        <span className="font-semibold text-[#404040] underline decoration-[#81B81D]/50 underline-offset-2 dark:text-[#81B81D]">
                          browse
                        </span>
                      </p>
                      <p className="mt-2 max-w-xs text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                        Shipment ID, Pallet Number, Pallet Count, Weight, Length, Width, Height
                      </p>
                    </>
                  )}
                </div>
              </label>
              {file && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="mt-3 w-full text-center text-xs font-medium text-gray-600 hover:text-red-600 dark:text-gray-400"
                >
                  Remove file
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <Field
                label="Shipment ID (optional)"
                type="text"
                value={manualShipmentId}
                onChange={setManualShipmentId}
                className="max-w-xs"
              />
              <div className="space-y-3">
                {manualRows.map((row, index) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-gray-300 bg-gray-100 p-4 dark:border-gray-600 dark:bg-gray-800/40"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                        Pallet {index + 1}
                      </span>
                      {manualRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setManualRows((rows) => rows.filter((r) => r.id !== row.id))}
                          className="rounded-md p-1 text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-400"
                          aria-label="Remove pallet row"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <Field
                        label="Pallet Count"
                        value={row.pallets}
                        onChange={(v) =>
                          setManualRows((rows) =>
                            rows.map((r) => (r.id === row.id ? { ...r, pallets: v } : r)),
                          )
                        }
                        min={1}
                        step={1}
                      />
                      <Field
                        label="Weight"
                        value={row.weight}
                        onChange={(v) =>
                          setManualRows((rows) =>
                            rows.map((r) => (r.id === row.id ? { ...r, weight: v } : r)),
                          )
                        }
                      />
                      <Field
                        label="Length"
                        value={row.length}
                        onChange={(v) =>
                          setManualRows((rows) =>
                            rows.map((r) => (r.id === row.id ? { ...r, length: v } : r)),
                          )
                        }
                      />
                      <Field
                        label="Width"
                        value={row.width}
                        onChange={(v) =>
                          setManualRows((rows) =>
                            rows.map((r) => (r.id === row.id ? { ...r, width: v } : r)),
                          )
                        }
                      />
                      <Field
                        label="Height"
                        value={row.height}
                        onChange={(v) =>
                          setManualRows((rows) =>
                            rows.map((r) => (r.id === row.id ? { ...r, height: v } : r)),
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setManualRows((rows) => [...rows, emptyRow()])}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 transition-colors hover:text-[#81B81D] dark:text-gray-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add pallet
              </button>
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center gap-3 border-t border-gray-200 pt-6 dark:border-gray-700">
          <button
            type="button"
            disabled={loading || (activeTab === 'bulk' && !file)}
            onClick={() => void runCalculation()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#81B81D] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#6fa019] hover:shadow disabled:opacity-50 sm:flex-none sm:px-8"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Calculating…
              </>
            ) : (
              'Calculate class'
            )}
          </button>
          {(file || result) && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Reference */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowReference((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-gray-300 bg-gray-100 px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100/80 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-300"
        >
          <span>NMFC density scale</span>
          <svg
            className={`h-4 w-4 transition-transform ${showReference ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showReference && (
          <div className="mt-2 overflow-hidden rounded-xl border border-gray-300 bg-white dark:border-gray-600 dark:bg-surface">
            <div className="grid grid-cols-2 gap-px bg-gray-200 sm:grid-cols-3 dark:bg-gray-700">
              {NMFC_SCALE.map(([range, cls]) => (
                <div
                  key={cls}
                  className="flex items-center justify-between bg-white px-3 py-2 text-xs dark:bg-surface"
                >
                  <span className="text-gray-600 dark:text-gray-400">{range} lb/ft³</span>
                  <ClassBadge value={Number(cls)} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="mt-10">
          <ResultsPanel
            result={result}
            loading={loading}
            copySuccess={copySuccess}
            onCopy={() => void handleCopy()}
            onDownload={() => void handleDownloadExcel()}
          />
        </div>
      )}

      <p className="mt-8 text-center sm:hidden">
        <button
          type="button"
          onClick={() => void handleDownloadTemplate()}
          className="text-sm font-medium text-gray-600 underline-offset-2 hover:text-[#81B81D] hover:underline dark:text-gray-400"
        >
          Download Excel template
        </button>
      </p>
    </div>
  )
}
